import type { PlatformAuthSession } from "../platform/storage"
import type {
  VocabularyContextEntry,
  VocabularyItem,
  VocabularySettings,
  VocabularyWordFamily,
  VocabularyWordFamilyEntry,
} from "@/types/vocabulary"
import { z } from "zod"
import { vocabularyItemsSchema } from "@/types/vocabulary"
import { storageAdapter } from "../atoms/storage-adapter"
import {
  clearVocabularyItems as apiClearVocabularyItems,
  createVocabularyItem as apiCreateVocabularyItem,
  deleteVocabularyItem as apiDeleteVocabularyItem,
  getVocabularyItems as apiGetVocabularyItems,
  getVocabularyMeta as apiGetVocabularyMeta,
  updateVocabularyItem as apiUpdateVocabularyItem,
  pullPlatformSync,
} from "../platform/api"
import { getPlatformAuthSession, watchPlatformAuthSession } from "../platform/storage"
import { buildVocabularyTermMetadata, countVocabularyWords, isEnglishVocabularyCandidate, normalizeVocabularyText } from "./normalization"

export const VOCABULARY_CHANGED_EVENT = "lexio:vocabulary-changed"

export interface VocabularyChangedEventDetail {
  items?: VocabularyItem[]
}

const LEGACY_VOCABULARY_STORAGE_KEY = "vocabularyItems"
const GUEST_VOCABULARY_SCOPE_KEY = "guest"
const GUEST_VOCABULARY_STORAGE_KEY = "vocabularyItems:guest"
const GUEST_VOCABULARY_META_STORAGE_KEY = "vocabularyMeta:guest"
const VOCABULARY_REMOTE_CHECK_TTL_MS = 5 * 60 * 1000
const MAX_VOCABULARY_CONTEXT_SENTENCES = 10

const vocabularySyncStateSchema = z.object({
  checkedAt: z.number().int().nonnegative(),
  fetchedAt: z.number().int().nonnegative(),
  remoteUpdatedAt: z.number().int().nonnegative().nullable(),
  count: z.number().int().nonnegative(),
})

const nullableVocabularySyncStateSchema = vocabularySyncStateSchema.nullable()

type VocabularySyncState = z.infer<typeof vocabularySyncStateSchema>

interface VocabularyAccountScope {
  accountKey: string
  isSignedIn: boolean
  itemsStorageKey: string
  metaStorageKey: string
}

interface VocabularyAccountState {
  items: VocabularyItem[] | null
  itemsLoaded: boolean
  meta: VocabularySyncState | null
  metaLoaded: boolean
  mutationVersion: number
  refreshPromise: Promise<VocabularyItem[] | null> | null
}

const vocabularyStates = new Map<string, VocabularyAccountState>()

let activeVocabularyScope: VocabularyAccountScope = {
  accountKey: GUEST_VOCABULARY_SCOPE_KEY,
  isSignedIn: false,
  itemsStorageKey: GUEST_VOCABULARY_STORAGE_KEY,
  metaStorageKey: GUEST_VOCABULARY_META_STORAGE_KEY,
}
let authTrackingPromise: Promise<void> | null = null

function notifyVocabularyChanged(detail?: VocabularyChangedEventDetail): void {
  if (typeof document !== "undefined") {
    document.dispatchEvent(new CustomEvent<VocabularyChangedEventDetail>(VOCABULARY_CHANGED_EVENT, { detail }))
  }
}

function sortVocabularyItems(items: VocabularyItem[]): VocabularyItem[] {
  return [...items].sort((left, right) => {
    if (right.lastSeenAt !== left.lastSeenAt) {
      return right.lastSeenAt - left.lastSeenAt
    }

    return right.updatedAt - left.updatedAt
  })
}

function normalizeVocabularyContextSentence(contextSentence: string | null | undefined): string | null {
  const normalizedSentence = contextSentence?.trim()
  return normalizedSentence || null
}

function normalizeVocabularySourceUrl(sourceUrl: string | null | undefined): string | null {
  const normalizedSourceUrl = sourceUrl?.trim()
  return normalizedSourceUrl || null
}

function normalizeVocabularyTranslatedSentence(translatedSentence: string | null | undefined): string | null {
  const normalizedTranslatedSentence = translatedSentence?.trim()
  return normalizedTranslatedSentence || null
}

function normalizeVocabularyContextEntry(
  entry:
    | Partial<Pick<VocabularyContextEntry, "sentence" | "sourceUrl" | "translatedSentence">>
    | null
    | undefined,
): VocabularyContextEntry | null {
  const sentence = normalizeVocabularyContextSentence(entry?.sentence)
  if (!sentence) {
    return null
  }

  const sourceUrl = normalizeVocabularySourceUrl(entry?.sourceUrl)
  const translatedSentence = normalizeVocabularyTranslatedSentence(entry?.translatedSentence)
  return sourceUrl
    ? {
        sentence,
        sourceUrl,
        ...(translatedSentence ? { translatedSentence } : {}),
      }
    : {
        sentence,
        ...(translatedSentence ? { translatedSentence } : {}),
      }
}

function normalizeVocabularyContextEntries(
  contextEntries: Array<Partial<Pick<VocabularyContextEntry, "sentence" | "sourceUrl" | "translatedSentence">> | null | undefined>,
): VocabularyContextEntry[] {
  const uniqueEntries: VocabularyContextEntry[] = []
  const entryBySentence = new Map<string, VocabularyContextEntry>()

  for (const entry of contextEntries) {
    const normalizedEntry = normalizeVocabularyContextEntry(entry)
    if (!normalizedEntry) {
      continue
    }

    const existingEntry = entryBySentence.get(normalizedEntry.sentence)
    if (!existingEntry) {
      uniqueEntries.push(normalizedEntry)
      entryBySentence.set(normalizedEntry.sentence, normalizedEntry)
    }
    else if (!existingEntry.sourceUrl && normalizedEntry.sourceUrl) {
      existingEntry.sourceUrl = normalizedEntry.sourceUrl
    }

    if (normalizedEntry.translatedSentence) {
      if (existingEntry) {
        existingEntry.translatedSentence = normalizedEntry.translatedSentence
      }
    }

    if (uniqueEntries.length >= MAX_VOCABULARY_CONTEXT_SENTENCES) {
      break
    }
  }

  return uniqueEntries
}

function normalizeVocabularyWordFamilyEntry(
  entry: Partial<VocabularyWordFamilyEntry> | null | undefined,
): VocabularyWordFamilyEntry | null {
  const term = typeof entry?.term === "string" && entry.term.trim()
    ? entry.term.trim()
    : null
  const definition = typeof entry?.definition === "string" && entry.definition.trim()
    ? entry.definition.trim()
    : null
  const partOfSpeech = typeof entry?.partOfSpeech === "string" && entry.partOfSpeech.trim()
    ? entry.partOfSpeech.trim()
    : null

  if (!term || !definition) {
    return null
  }

  return partOfSpeech
    ? { term, partOfSpeech, definition }
    : { term, definition }
}

function normalizeVocabularyWordFamilyGroup(
  entries: Array<Partial<VocabularyWordFamilyEntry> | null | undefined>,
): VocabularyWordFamilyEntry[] {
  const normalizedEntries: VocabularyWordFamilyEntry[] = []
  const seenTerms = new Set<string>()

  for (const entry of entries) {
    const normalizedEntry = normalizeVocabularyWordFamilyEntry(entry)
    if (!normalizedEntry) {
      continue
    }

    const normalizedTerm = normalizedEntry.term.toLowerCase()
    if (seenTerms.has(normalizedTerm)) {
      continue
    }

    seenTerms.add(normalizedTerm)
    normalizedEntries.push(normalizedEntry)
  }

  return normalizedEntries
}

function normalizeVocabularyWordFamily(wordFamily: VocabularyWordFamily | null | undefined): VocabularyWordFamily | null {
  if (!wordFamily) {
    return null
  }

  const normalizedWordFamily = {
    core: normalizeVocabularyWordFamilyGroup(wordFamily.core ?? []),
    contrast: normalizeVocabularyWordFamilyGroup(wordFamily.contrast ?? []),
    related: normalizeVocabularyWordFamilyGroup(wordFamily.related ?? []),
  }

  return normalizedWordFamily.core.length > 0
    || normalizedWordFamily.contrast.length > 0
    || normalizedWordFamily.related.length > 0
    ? normalizedWordFamily
    : null
}

function getVocabularyWordFamilyCoreMatchTerms(wordFamily: VocabularyWordFamily | null | undefined): string[] {
  return (wordFamily?.core ?? [])
    .map(entry => normalizeVocabularyText(entry.term))
    .filter(Boolean)
}

function resolveVocabularyContextEntries(
  item: Pick<VocabularyItem, "contextEntries" | "contextSentence" | "contextSentences">,
  nextContextSentence?: string | null,
  nextSourceUrl?: string | null,
  nextTranslatedSentence?: string | null,
): VocabularyContextEntry[] {
  return normalizeVocabularyContextEntries([
    nextContextSentence
      ? {
          sentence: nextContextSentence,
          ...(nextSourceUrl ? { sourceUrl: nextSourceUrl } : {}),
          ...(nextTranslatedSentence ? { translatedSentence: nextTranslatedSentence } : {}),
        }
      : null,
    ...(item.contextEntries ?? []),
    ...(item.contextSentences ?? []).map(sentence => ({ sentence })),
    item.contextSentence ? { sentence: item.contextSentence } : null,
  ])
}

function extractVocabularyContextSentences(contextEntries: VocabularyContextEntry[]): string[] {
  return contextEntries.map(entry => entry.sentence)
}

function hydrateVocabularyItem(item: VocabularyItem): VocabularyItem {
  const {
    contextEntries,
    contextSentence,
    contextSentences,
    nuance,
    wordFamily: _wordFamily,
    ...restItem
  } = item
  const normalizedSourceText = normalizeVocabularyText(item.sourceText)
  const preferredLemma = item.lemma
    ?? (item.normalizedText && item.normalizedText !== normalizedSourceText ? item.normalizedText : null)
  const metadata = buildVocabularyTermMetadata(item.sourceText, {
    preferredLemma,
  })
  const normalizedWordFamily = normalizeVocabularyWordFamily(item.wordFamily)
  const matchTerms = new Set([
    ...metadata.matchTerms,
    ...getVocabularyWordFamilyCoreMatchTerms(normalizedWordFamily),
    ...(item.matchTerms ?? []).map(term => normalizeVocabularyText(term)).filter(Boolean),
  ])
  const nextContextEntries = resolveVocabularyContextEntries({
    contextEntries,
    contextSentence,
    contextSentences,
  })
  const normalizedNuance = typeof nuance === "string" && nuance.trim()
    ? nuance.trim()
    : null

  return {
    ...restItem,
    ...(nextContextEntries.length > 0
      ? {
          contextEntries: nextContextEntries,
          contextSentences: extractVocabularyContextSentences(nextContextEntries),
        }
      : {}),
    ...(metadata.lemma ? { lemma: item.lemma ?? metadata.lemma } : {}),
    ...(matchTerms.size > 0 ? { matchTerms: [...matchTerms] } : {}),
    ...(normalizedNuance ? { nuance: normalizedNuance } : {}),
    ...(normalizedWordFamily ? { wordFamily: normalizedWordFamily } : {}),
    normalizedText: metadata.normalizedText || item.normalizedText,
    masteredAt: item.masteredAt ?? null,
  }
}

function normalizeVocabularyItems(items: VocabularyItem[]): VocabularyItem[] {
  return sortVocabularyItems(items.map(hydrateVocabularyItem))
}

function cloneVocabularyItems(items: VocabularyItem[]): VocabularyItem[] {
  return [...items]
}

function areVocabularyItemsEquivalent(left: VocabularyItem[], right: VocabularyItem[]): boolean {
  return JSON.stringify(normalizeVocabularyItems(left)) === JSON.stringify(normalizeVocabularyItems(right))
}

function getVocabularyAccountState(scope: VocabularyAccountScope): VocabularyAccountState {
  const existingState = vocabularyStates.get(scope.accountKey)
  if (existingState) {
    return existingState
  }

  const nextState: VocabularyAccountState = {
    items: null,
    itemsLoaded: false,
    meta: null,
    metaLoaded: false,
    mutationVersion: 0,
    refreshPromise: null,
  }
  vocabularyStates.set(scope.accountKey, nextState)
  return nextState
}

function parseVocabularyItems(value: unknown): VocabularyItem[] {
  const parsed = vocabularyItemsSchema.safeParse(value)
  return parsed.success ? parsed.data : []
}

function parseVocabularySyncState(value: unknown): VocabularySyncState | null {
  const parsed = nullableVocabularySyncStateSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

function getVocabularyAccountId(session: PlatformAuthSession | null): string | null {
  const userId = session?.user?.id?.trim()
  if (userId) {
    return encodeURIComponent(userId)
  }

  const email = session?.user?.email?.trim().toLowerCase()
  if (email) {
    return encodeURIComponent(email)
  }

  return null
}

function createVocabularyScope(session: PlatformAuthSession | null): VocabularyAccountScope {
  const accountId = session?.token ? getVocabularyAccountId(session) : null
  if (accountId) {
    const accountKey = `platform:${accountId}`
    return {
      accountKey,
      isSignedIn: true,
      itemsStorageKey: `vocabularyItems:${accountKey}`,
      metaStorageKey: `vocabularyMeta:${accountKey}`,
    }
  }

  return {
    accountKey: GUEST_VOCABULARY_SCOPE_KEY,
    isSignedIn: false,
    itemsStorageKey: GUEST_VOCABULARY_STORAGE_KEY,
    metaStorageKey: GUEST_VOCABULARY_META_STORAGE_KEY,
  }
}

function applyActiveVocabularyScope(session: PlatformAuthSession | null): void {
  const nextScope = createVocabularyScope(session)
  const scopeChanged = nextScope.accountKey !== activeVocabularyScope.accountKey
  activeVocabularyScope = nextScope

  if (scopeChanged) {
    notifyVocabularyChanged()
  }
}

async function ensureVocabularyAuthTracking(): Promise<void> {
  if (authTrackingPromise) {
    return await authTrackingPromise
  }

  authTrackingPromise = (async () => {
    try {
      applyActiveVocabularyScope(await getPlatformAuthSession())
    }
    catch {
      applyActiveVocabularyScope(null)
    }

    watchPlatformAuthSession((session) => {
      applyActiveVocabularyScope(session)
    })
  })()

  return await authTrackingPromise
}

async function getActiveVocabularyScope(): Promise<VocabularyAccountScope> {
  await ensureVocabularyAuthTracking()
  return activeVocabularyScope
}

function getLatestVocabularyUpdatedAt(items: VocabularyItem[]): number | null {
  return items.reduce<number | null>((latest, item) => {
    if (latest == null || item.updatedAt > latest) {
      return item.updatedAt
    }
    return latest
  }, null)
}

function buildVocabularySyncState(
  items: VocabularyItem[],
  options?: {
    checkedAt?: number
    fetchedAt?: number
    remoteUpdatedAt?: number | null
  },
): VocabularySyncState {
  const checkedAt = options?.checkedAt ?? Date.now()
  const fetchedAt = options?.fetchedAt ?? checkedAt

  return {
    checkedAt,
    fetchedAt,
    remoteUpdatedAt: options?.remoteUpdatedAt ?? getLatestVocabularyUpdatedAt(items),
    count: items.length,
  }
}

function isVocabularySyncStateStale(meta: VocabularySyncState | null): boolean {
  return !meta || (Date.now() - meta.checkedAt) >= VOCABULARY_REMOTE_CHECK_TTL_MS
}

function setVocabularyItemsCache(
  scope: VocabularyAccountScope,
  items: VocabularyItem[],
  options?: { notify?: boolean },
): VocabularyItem[] {
  const state = getVocabularyAccountState(scope)
  const previousItems = state.items ?? []
  const nextItems = normalizeVocabularyItems(items)

  state.items = nextItems
  state.itemsLoaded = true
  void storageAdapter.set(scope.itemsStorageKey, nextItems, vocabularyItemsSchema).catch(() => {})

  if (options?.notify !== false && !areVocabularyItemsEquivalent(previousItems, nextItems)) {
    notifyVocabularyChanged({ items: cloneVocabularyItems(nextItems) })
  }

  return nextItems
}

function setVocabularySyncState(
  scope: VocabularyAccountScope,
  meta: VocabularySyncState | null,
): VocabularySyncState | null {
  const state = getVocabularyAccountState(scope)
  state.meta = meta
  state.metaLoaded = true
  void storageAdapter.set(scope.metaStorageKey, meta, nullableVocabularySyncStateSchema).catch(() => {})
  return meta
}

function markVocabularySnapshotFresh(scope: VocabularyAccountScope, items: VocabularyItem[]): void {
  setVocabularySyncState(scope, buildVocabularySyncState(items))
}

async function loadVocabularyItemsFromStorage(scope: VocabularyAccountScope): Promise<VocabularyItem[]> {
  const state = getVocabularyAccountState(scope)
  if (state.itemsLoaded && state.items != null) {
    return cloneVocabularyItems(state.items)
  }

  let storedItems = parseVocabularyItems(
    await storageAdapter.get(scope.itemsStorageKey, [], vocabularyItemsSchema),
  )

  if (!scope.isSignedIn && storedItems.length === 0) {
    storedItems = parseVocabularyItems(
      await storageAdapter.get(LEGACY_VOCABULARY_STORAGE_KEY, [], vocabularyItemsSchema),
    )
  }

  if (scope.isSignedIn && storedItems.length === 0) {
    storedItems = parseVocabularyItems(
      await storageAdapter.get(GUEST_VOCABULARY_STORAGE_KEY, [], vocabularyItemsSchema),
    )

    if (storedItems.length === 0) {
      storedItems = parseVocabularyItems(
        await storageAdapter.get(LEGACY_VOCABULARY_STORAGE_KEY, [], vocabularyItemsSchema),
      )
    }
  }

  return cloneVocabularyItems(setVocabularyItemsCache(scope, storedItems, { notify: false }))
}

async function loadVocabularySyncStateFromStorage(scope: VocabularyAccountScope): Promise<VocabularySyncState | null> {
  const state = getVocabularyAccountState(scope)
  if (state.metaLoaded) {
    return state.meta
  }

  const storedMeta = parseVocabularySyncState(
    await storageAdapter.get(scope.metaStorageKey, null, nullableVocabularySyncStateSchema),
  )
  state.meta = storedMeta
  state.metaLoaded = true
  return storedMeta
}

async function ensureVocabularySnapshot(scope: VocabularyAccountScope): Promise<{
  items: VocabularyItem[]
  meta: VocabularySyncState | null
}> {
  const [items, meta] = await Promise.all([
    loadVocabularyItemsFromStorage(scope),
    loadVocabularySyncStateFromStorage(scope),
  ])

  return { items, meta }
}

async function refreshVocabularyItemsFromRemote(
  scope: VocabularyAccountScope,
  options?: {
    checkedAt?: number
    mutationVersion?: number
    remoteUpdatedAt?: number | null
  },
): Promise<VocabularyItem[]> {
  const state = getVocabularyAccountState(scope)
  const mutationVersion = options?.mutationVersion ?? state.mutationVersion
  const remoteItems = await apiGetVocabularyItems()

  if (state.mutationVersion !== mutationVersion) {
    return cloneVocabularyItems(state.items ?? [])
  }

  const nextItems = setVocabularyItemsCache(scope, remoteItems)
  setVocabularySyncState(scope, buildVocabularySyncState(nextItems, {
    checkedAt: options?.checkedAt,
    remoteUpdatedAt: options?.remoteUpdatedAt,
  }))

  return cloneVocabularyItems(nextItems)
}

async function bootstrapVocabularyItemsFromRemote(
  scope: VocabularyAccountScope,
  options?: {
    checkedAt?: number
    mutationVersion?: number
    remoteUpdatedAt?: number | null
  },
): Promise<VocabularyItem[]> {
  if (scope.isSignedIn) {
    const state = getVocabularyAccountState(scope)
    const mutationVersion = options?.mutationVersion ?? state.mutationVersion

    try {
      const remotePayload = await pullPlatformSync()

      if (state.mutationVersion !== mutationVersion) {
        return cloneVocabularyItems(state.items ?? [])
      }

      const nextItems = setVocabularyItemsCache(scope, remotePayload.vocabularyItems ?? [])
      setVocabularySyncState(scope, buildVocabularySyncState(nextItems, {
        checkedAt: options?.checkedAt,
        remoteUpdatedAt: options?.remoteUpdatedAt,
      }))

      return cloneVocabularyItems(nextItems)
    }
    catch {
      // Fall back to the dedicated vocabulary endpoint when the broader sync pull fails.
    }
  }

  return await refreshVocabularyItemsFromRemote(scope, options)
}

async function probeVocabularyRemote(
  scope: VocabularyAccountScope,
  options?: { mutationVersion?: number },
): Promise<VocabularyItem[]> {
  const state = getVocabularyAccountState(scope)
  const mutationVersion = options?.mutationVersion ?? state.mutationVersion
  const { items, meta } = await ensureVocabularySnapshot(scope)
  if (items.length === 0) {
    return await bootstrapVocabularyItemsFromRemote(scope, { mutationVersion })
  }

  const remoteMeta = await apiGetVocabularyMeta()
  const nextRemoteUpdatedAt = remoteMeta.updatedAt ?? null
  const checkedAt = Date.now()

  if (meta && meta.remoteUpdatedAt === nextRemoteUpdatedAt && meta.count === remoteMeta.count) {
    if (state.mutationVersion !== mutationVersion) {
      return cloneVocabularyItems(state.items ?? [])
    }

    setVocabularySyncState(scope, {
      ...meta,
      checkedAt,
      remoteUpdatedAt: nextRemoteUpdatedAt,
      count: remoteMeta.count,
    })
    return cloneVocabularyItems(items)
  }

  return await refreshVocabularyItemsFromRemote(scope, {
    checkedAt,
    mutationVersion,
    remoteUpdatedAt: nextRemoteUpdatedAt,
  })
}

function scheduleVocabularyRemoteProbe(scope: VocabularyAccountScope): void {
  if (!scope.isSignedIn) {
    return
  }

  const state = getVocabularyAccountState(scope)
  if (state.refreshPromise) {
    return
  }

  const mutationVersion = state.mutationVersion
  state.refreshPromise = (async () => {
    try {
      return await probeVocabularyRemote(scope, { mutationVersion })
    }
    catch {
      return cloneVocabularyItems(state.items ?? [])
    }
    finally {
      state.refreshPromise = null
    }
  })()
}

function upsertVocabularyItem(items: VocabularyItem[], nextItem: VocabularyItem): VocabularyItem[] {
  const existingIndex = items.findIndex(item => item.id === nextItem.id)

  if (existingIndex >= 0) {
    const nextItems = [...items]
    nextItems[existingIndex] = nextItem
    return nextItems
  }

  return [...items, nextItem]
}

function isVocabularyLanguagePairMatch(
  item: Pick<VocabularyItem, "sourceLang" | "targetLang">,
  sourceLang: string,
  targetLang: string,
): boolean {
  return item.sourceLang === sourceLang && item.targetLang === targetLang
}

function buildVocabularySelectionLookup(sourceText: string) {
  const metadata = buildVocabularyTermMetadata(sourceText)
  const normalizedSourceText = normalizeVocabularyText(sourceText)
  const matchTerms = new Set([
    normalizedSourceText,
    metadata.normalizedText,
    ...metadata.matchTerms,
  ])

  return {
    matchTerms: [...matchTerms].filter(Boolean),
    normalizedText: metadata.normalizedText || normalizedSourceText,
  }
}

function isVocabularyItemSelectionMatch(
  item: VocabularyItem,
  lookup: ReturnType<typeof buildVocabularySelectionLookup>,
  sourceLang: string,
  targetLang: string,
): boolean {
  if (item.deletedAt != null || !isVocabularyLanguagePairMatch(item, sourceLang, targetLang)) {
    return false
  }

  const itemTerms = new Set([
    item.normalizedText,
    ...(item.matchTerms ?? []),
  ].map(term => normalizeVocabularyText(term)).filter(Boolean))

  return lookup.matchTerms.some(term => itemTerms.has(term))
}

function restoreOrUpdateExistingItem(
  item: VocabularyItem,
  sourceText: string,
  translatedText: string,
  contextSentence: string | null | undefined,
  sourceUrl: string | null | undefined,
  translatedContextSentence: string | null | undefined,
  sourceLang: string,
  targetLang: string,
  wordCount: number,
  now: number,
): VocabularyItem {
  const metadata = buildVocabularyTermMetadata(sourceText, {
    preferredLemma: item.lemma,
  })
  const nextContextEntries = resolveVocabularyContextEntries(item, contextSentence, sourceUrl, translatedContextSentence)

  return {
    ...item,
    sourceText: sourceText.trim(),
    ...(nextContextEntries.length > 0
      ? {
          contextEntries: nextContextEntries,
          contextSentences: extractVocabularyContextSentences(nextContextEntries),
        }
      : {}),
    ...(metadata.lemma ? { lemma: metadata.lemma } : {}),
    ...(metadata.matchTerms.length > 0 ? { matchTerms: metadata.matchTerms } : {}),
    translatedText: translatedText.trim(),
    sourceLang,
    targetLang,
    kind: classifyVocabularyKind(wordCount),
    wordCount,
    lastSeenAt: now,
    hitCount: item.deletedAt == null ? item.hitCount + 1 : 1,
    normalizedText: metadata.normalizedText,
    updatedAt: now,
    deletedAt: null,
    masteredAt: null,
  }
}

function classifyVocabularyKind(wordCount: number): "word" | "phrase" {
  return wordCount === 1 ? "word" : "phrase"
}

function buildVocabularyItem(
  sourceText: string,
  translatedText: string,
  contextSentence: string | null | undefined,
  sourceUrl: string | null | undefined,
  translatedContextSentence: string | null | undefined,
  sourceLang: string,
  targetLang: string,
  wordCount: number,
  now: number,
): VocabularyItem {
  const metadata = buildVocabularyTermMetadata(sourceText)
  const nextContextEntries = resolveVocabularyContextEntries({
    contextEntries: [],
    contextSentence: undefined,
    contextSentences: [],
  }, contextSentence, sourceUrl, translatedContextSentence)

  return {
    id: globalThis.crypto.randomUUID(),
    sourceText: sourceText.trim(),
    ...(nextContextEntries.length > 0
      ? {
          contextEntries: nextContextEntries,
          contextSentences: extractVocabularyContextSentences(nextContextEntries),
        }
      : {}),
    ...(metadata.lemma ? { lemma: metadata.lemma } : {}),
    ...(metadata.matchTerms.length > 0 ? { matchTerms: metadata.matchTerms } : {}),
    normalizedText: metadata.normalizedText,
    translatedText: translatedText.trim(),
    sourceLang,
    targetLang,
    kind: classifyVocabularyKind(wordCount),
    wordCount,
    createdAt: now,
    lastSeenAt: now,
    hitCount: 1,
    updatedAt: now,
    deletedAt: null,
    masteredAt: null,
  }
}

function beginVocabularyMutation(scope: VocabularyAccountScope): {
  previousItems: VocabularyItem[]
  previousMeta: VocabularySyncState | null
} {
  const state = getVocabularyAccountState(scope)
  state.mutationVersion += 1

  return {
    previousItems: cloneVocabularyItems(state.items ?? []),
    previousMeta: state.meta,
  }
}

function revertVocabularyMutation(
  scope: VocabularyAccountScope,
  snapshot: {
    previousItems: VocabularyItem[]
    previousMeta: VocabularySyncState | null
  },
): void {
  const state = getVocabularyAccountState(scope)
  state.mutationVersion += 1
  setVocabularyItemsCache(scope, snapshot.previousItems)
  setVocabularySyncState(scope, snapshot.previousMeta)
}

export function canAutoSaveToVocabulary(sourceText: string, settings: VocabularySettings): boolean {
  if (!settings.autoSave) {
    return false
  }

  if (!isEnglishVocabularyCandidate(sourceText)) {
    return false
  }

  const wordCount = countVocabularyWords(sourceText)
  if (wordCount === 0) {
    return false
  }

  return wordCount <= settings.maxPhraseWords
}

export function getCachedVocabularyItems(): VocabularyItem[] | null {
  const state = vocabularyStates.get(activeVocabularyScope.accountKey)
  if (!state?.itemsLoaded || state.items == null) {
    return null
  }

  return cloneVocabularyItems(state.items)
}

export async function getVocabularyItems(options?: { forceRefresh?: boolean, localOnly?: boolean, skipRemoteProbe?: boolean }): Promise<VocabularyItem[]> {
  const scope = await getActiveVocabularyScope()
  const state = getVocabularyAccountState(scope)

  if (options?.forceRefresh) {
    const { items } = await ensureVocabularySnapshot(scope)
    if (!scope.isSignedIn) {
      return cloneVocabularyItems(items)
    }

    try {
      return await refreshVocabularyItemsFromRemote(scope)
    }
    catch {
      return cloneVocabularyItems(state.items ?? [])
    }
  }

  if (state.itemsLoaded && state.items != null) {
    if (!options?.localOnly && !options?.skipRemoteProbe && scope.isSignedIn && isVocabularySyncStateStale(state.meta)) {
      scheduleVocabularyRemoteProbe(scope)
    }
    return cloneVocabularyItems(state.items)
  }

  const { items, meta } = await ensureVocabularySnapshot(scope)
  if (items.length > 0) {
    if (!options?.localOnly && !options?.skipRemoteProbe && scope.isSignedIn && isVocabularySyncStateStale(meta)) {
      scheduleVocabularyRemoteProbe(scope)
    }
    return cloneVocabularyItems(items)
  }

  if (options?.localOnly) {
    return cloneVocabularyItems(items)
  }

  try {
    return await bootstrapVocabularyItemsFromRemote(scope)
  }
  catch {
    return cloneVocabularyItems(items)
  }
}

export async function findVocabularyItemForSelection({
  sourceText,
  sourceLang,
  targetLang,
}: {
  sourceText: string
  sourceLang: string
  targetLang: string
}): Promise<VocabularyItem | null> {
  const lookup = buildVocabularySelectionLookup(sourceText)
  if (!lookup.normalizedText) {
    return null
  }

  const items = await getVocabularyItems({ skipRemoteProbe: true })
  return items.find(item => isVocabularyItemSelectionMatch(item, lookup, sourceLang, targetLang)) ?? null
}

export async function saveTranslatedSelectionToVocabulary({
  sourceText,
  translatedText,
  contextSentence,
  sourceUrl,
  translatedContextSentence,
  sourceLang,
  targetLang,
  settings,
}: {
  sourceText: string
  translatedText: string
  contextSentence?: string
  sourceUrl?: string
  translatedContextSentence?: string
  sourceLang: string
  targetLang: string
  settings: VocabularySettings
}): Promise<VocabularyItem | null> {
  if (!canAutoSaveToVocabulary(sourceText, settings)) {
    return null
  }

  const scope = await getActiveVocabularyScope()
  const now = Date.now()
  const wordCount = countVocabularyWords(sourceText)
  const lookup = buildVocabularySelectionLookup(sourceText)
  const items = await getVocabularyItems({ skipRemoteProbe: true })
  const existingItem = items.find(item => isVocabularyItemSelectionMatch(item, lookup, sourceLang, targetLang))
  const state = getVocabularyAccountState(scope)
  const currentItems = state.items ?? items

  if (existingItem) {
    const updatedItem = restoreOrUpdateExistingItem(
      existingItem,
      sourceText,
      translatedText,
      contextSentence,
      sourceUrl,
      translatedContextSentence,
      sourceLang,
      targetLang,
      wordCount,
      now,
    )
    const snapshot = beginVocabularyMutation(scope)
    const nextItems = upsertVocabularyItem(currentItems, updatedItem)

    setVocabularyItemsCache(scope, nextItems)

    try {
      await apiUpdateVocabularyItem(updatedItem)
      markVocabularySnapshotFresh(scope, nextItems)
    }
    catch (error) {
      revertVocabularyMutation(scope, snapshot)
      throw error
    }

    return updatedItem
  }

  const newItem = buildVocabularyItem(
    sourceText,
    translatedText,
    contextSentence,
    sourceUrl,
    translatedContextSentence,
    sourceLang,
    targetLang,
    wordCount,
    now,
  )
  const snapshot = beginVocabularyMutation(scope)
  const nextItems = upsertVocabularyItem(currentItems, newItem)

  setVocabularyItemsCache(scope, nextItems)

  try {
    await apiCreateVocabularyItem(newItem)
    markVocabularySnapshotFresh(scope, nextItems)
  }
  catch (error) {
    revertVocabularyMutation(scope, snapshot)
    throw error
  }

  return newItem
}

export async function updateVocabularyItemContextTranslation({
  itemId,
  contextSentence,
  translatedSentence,
  sourceUrl,
}: {
  itemId: string
  contextSentence: string
  translatedSentence: string
  sourceUrl?: string
}): Promise<VocabularyItem | null> {
  const normalizedContextSentence = normalizeVocabularyContextSentence(contextSentence)
  const normalizedTranslatedSentence = normalizeVocabularyTranslatedSentence(translatedSentence)
  if (!normalizedContextSentence || !normalizedTranslatedSentence) {
    return null
  }

  const scope = await getActiveVocabularyScope()
  const previousItems = await getVocabularyItems({ skipRemoteProbe: true })
  const existingItem = previousItems.find(item => item.id === itemId)
  if (!existingItem) {
    return null
  }

  const nextContextEntries = resolveVocabularyContextEntries(
    existingItem,
    normalizedContextSentence,
    normalizeVocabularySourceUrl(sourceUrl),
    normalizedTranslatedSentence,
  )
  const currentContextEntries = normalizeVocabularyContextEntries([
    ...(existingItem.contextEntries ?? []),
    ...(existingItem.contextSentences ?? []).map(sentence => ({ sentence })),
    existingItem.contextSentence ? { sentence: existingItem.contextSentence } : null,
  ])

  if (JSON.stringify(nextContextEntries) === JSON.stringify(currentContextEntries)) {
    return existingItem
  }

  const updatedItem = hydrateVocabularyItem({
    ...existingItem,
    contextEntries: nextContextEntries,
    contextSentences: extractVocabularyContextSentences(nextContextEntries),
    updatedAt: Date.now(),
  })

  const snapshot = beginVocabularyMutation(scope)
  const nextItems = upsertVocabularyItem(previousItems, updatedItem)
  setVocabularyItemsCache(scope, nextItems)

  try {
    await apiUpdateVocabularyItem(updatedItem)
    markVocabularySnapshotFresh(scope, nextItems)
  }
  catch (error) {
    revertVocabularyMutation(scope, snapshot)
    throw error
  }

  return updatedItem
}

export async function updateVocabularyItemDetails(
  itemId: string,
  details: Partial<Pick<VocabularyItem, "definition" | "difficulty" | "lemma" | "nuance" | "partOfSpeech" | "phonetic" | "wordFamily">>,
): Promise<VocabularyItem | null> {
  const scope = await getActiveVocabularyScope()
  const previousItems = await getVocabularyItems({ skipRemoteProbe: true })
  const existingItem = previousItems.find(item => item.id === itemId)
  if (!existingItem) {
    return null
  }

  const nextDetails = {
    ...(typeof details.definition === "string" && details.definition.trim() ? { definition: details.definition.trim() } : {}),
    ...(typeof details.difficulty === "string" && details.difficulty.trim() ? { difficulty: details.difficulty.trim() } : {}),
    ...(typeof details.lemma === "string" && details.lemma.trim() ? { lemma: details.lemma.trim() } : {}),
    ...(typeof details.nuance === "string" && details.nuance.trim() && existingItem.kind === "word"
      ? { nuance: details.nuance.trim() }
      : {}),
    ...(typeof details.partOfSpeech === "string" && details.partOfSpeech.trim() ? { partOfSpeech: details.partOfSpeech.trim() } : {}),
    ...(typeof details.phonetic === "string" && details.phonetic.trim() ? { phonetic: details.phonetic.trim() } : {}),
    ...(() => {
      const normalizedWordFamily = normalizeVocabularyWordFamily(details.wordFamily)
      return normalizedWordFamily ? { wordFamily: normalizedWordFamily } : {}
    })(),
  } as Partial<Pick<VocabularyItem, "definition" | "difficulty" | "lemma" | "nuance" | "partOfSpeech" | "phonetic" | "wordFamily">>

  if (Object.keys(nextDetails).length === 0) {
    return existingItem
  }

  const metadata = buildVocabularyTermMetadata(existingItem.sourceText, {
    preferredLemma: nextDetails.lemma ?? existingItem.lemma,
  })
  const updatedItem = hydrateVocabularyItem({
    ...existingItem,
    ...nextDetails,
    ...(metadata.lemma ? { lemma: metadata.lemma } : {}),
    ...(metadata.matchTerms.length > 0 ? { matchTerms: metadata.matchTerms } : {}),
    normalizedText: metadata.normalizedText,
    updatedAt: Date.now(),
  })

  const snapshot = beginVocabularyMutation(scope)
  const nextItems = upsertVocabularyItem(previousItems, updatedItem)
  setVocabularyItemsCache(scope, nextItems)

  try {
    await apiUpdateVocabularyItem(updatedItem)
    markVocabularySnapshotFresh(scope, nextItems)
  }
  catch (error) {
    revertVocabularyMutation(scope, snapshot)
    throw error
  }

  return updatedItem
}

export async function setVocabularyItemMastered(itemId: string, mastered: boolean): Promise<VocabularyItem | null> {
  const scope = await getActiveVocabularyScope()
  const previousItems = await getVocabularyItems({ skipRemoteProbe: true })
  const existingItem = previousItems.find(item => item.id === itemId)
  if (!existingItem) {
    return null
  }

  const updatedItem = hydrateVocabularyItem({
    ...existingItem,
    masteredAt: mastered ? Date.now() : null,
    updatedAt: Date.now(),
  })

  const snapshot = beginVocabularyMutation(scope)
  const nextItems = upsertVocabularyItem(previousItems, updatedItem)
  setVocabularyItemsCache(scope, nextItems)

  try {
    await apiUpdateVocabularyItem(updatedItem)
    markVocabularySnapshotFresh(scope, nextItems)
  }
  catch (error) {
    revertVocabularyMutation(scope, snapshot)
    throw error
  }

  return updatedItem
}

export async function removeVocabularyItem(itemId: string): Promise<void> {
  await removeVocabularyItems([itemId])
}

export async function removeVocabularyItems(itemIds: string[]): Promise<void> {
  const scope = await getActiveVocabularyScope()
  const previousItems = await getVocabularyItems({ skipRemoteProbe: true })
  const uniqueItemIds = [...new Set(itemIds.map(id => id.trim()).filter(Boolean))]

  if (uniqueItemIds.length === 0) {
    return
  }

  const snapshot = beginVocabularyMutation(scope)
  const removedItemIds = new Set(uniqueItemIds)
  const optimisticItems = previousItems.filter(item => !removedItemIds.has(item.id))
  setVocabularyItemsCache(scope, optimisticItems)

  const results = await Promise.allSettled(
    uniqueItemIds.map(async itemId => await apiDeleteVocabularyItem(itemId)),
  )
  const failedResult = results.find(result => result.status === "rejected")

  if (failedResult) {
    const deletedItemIds = new Set(
      results.flatMap((result, index) => result.status === "fulfilled" ? [uniqueItemIds[index]] : []),
    )
    const partialItems = snapshot.previousItems.filter(item => !deletedItemIds.has(item.id))
    setVocabularyItemsCache(scope, partialItems)
    setVocabularySyncState(scope, buildVocabularySyncState(partialItems))
    throw failedResult.reason
  }

  markVocabularySnapshotFresh(scope, optimisticItems)
}

export async function clearVocabularyItems(): Promise<void> {
  const scope = await getActiveVocabularyScope()
  await getVocabularyItems({ skipRemoteProbe: true })
  const snapshot = beginVocabularyMutation(scope)
  setVocabularyItemsCache(scope, [])

  try {
    await apiClearVocabularyItems()
    markVocabularySnapshotFresh(scope, [])
  }
  catch (error) {
    revertVocabularyMutation(scope, snapshot)
    throw error
  }
}

void ensureVocabularyAuthTracking()
