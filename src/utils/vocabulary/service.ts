import type { VocabularyItem, VocabularySettings } from "@/types/vocabulary"
import { vocabularyItemsSchema } from "@/types/vocabulary"
import { storageAdapter } from "../atoms/storage-adapter"
import {
  clearVocabularyItems as apiClearVocabularyItems,
  createVocabularyItem as apiCreateVocabularyItem,
  deleteVocabularyItem as apiDeleteVocabularyItem,
  updateVocabularyItem as apiUpdateVocabularyItem,
} from "../platform/api"
import { buildVocabularyTermMetadata, countVocabularyWords, isEnglishVocabularyCandidate, normalizeVocabularyText } from "./normalization"

export const VOCABULARY_CHANGED_EVENT = "lexio:vocabulary-changed"
const VOCABULARY_STORAGE_KEY = "vocabularyItems"
let vocabularyItemsCache: VocabularyItem[] | null = null

function notifyVocabularyChanged(): void {
  if (typeof document !== "undefined") {
    document.dispatchEvent(new CustomEvent(VOCABULARY_CHANGED_EVENT))
  }
}

function sortVocabularyItems(items: VocabularyItem[]): VocabularyItem[] {
  return [...items].sort((left, right) => right.updatedAt - left.updatedAt)
}

function hydrateVocabularyItem(item: VocabularyItem): VocabularyItem {
  const normalizedSourceText = normalizeVocabularyText(item.sourceText)
  const preferredLemma = item.lemma
    ?? (item.normalizedText && item.normalizedText !== normalizedSourceText ? item.normalizedText : null)
  const metadata = buildVocabularyTermMetadata(item.sourceText, {
    preferredLemma,
  })
  const matchTerms = new Set([
    ...metadata.matchTerms,
    ...(item.matchTerms ?? []).map(term => normalizeVocabularyText(term)).filter(Boolean),
  ])

  return {
    ...item,
    ...(metadata.lemma ? { lemma: item.lemma ?? metadata.lemma } : {}),
    ...(matchTerms.size > 0 ? { matchTerms: [...matchTerms] } : {}),
    normalizedText: metadata.normalizedText || item.normalizedText,
  }
}

function setVocabularyItemsCache(items: VocabularyItem[]): VocabularyItem[] {
  vocabularyItemsCache = sortVocabularyItems(items.map(hydrateVocabularyItem))
  return vocabularyItemsCache
}

async function loadVocabularyItemsFromStorage(): Promise<VocabularyItem[]> {
  const items = await storageAdapter.get<VocabularyItem[]>(VOCABULARY_STORAGE_KEY, [], vocabularyItemsSchema)
  return setVocabularyItemsCache(items)
}

function persistVocabularyItems(items: VocabularyItem[]): Promise<void> {
  return storageAdapter.set(VOCABULARY_STORAGE_KEY, items, vocabularyItemsSchema)
}

function replaceVocabularyItemsCache(items: VocabularyItem[], notify = true): VocabularyItem[] {
  const nextItems = setVocabularyItemsCache(items)
  void persistVocabularyItems(nextItems).catch(() => {})
  if (notify) {
    notifyVocabularyChanged()
  }
  return nextItems
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
  sourceLang: string,
  targetLang: string,
  wordCount: number,
  now: number,
): VocabularyItem {
  const metadata = buildVocabularyTermMetadata(sourceText, {
    preferredLemma: item.lemma,
  })

  return {
    ...item,
    sourceText: sourceText.trim(),
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
  }
}

function classifyVocabularyKind(wordCount: number): "word" | "phrase" {
  return wordCount === 1 ? "word" : "phrase"
}

function buildVocabularyItem(
  sourceText: string,
  translatedText: string,
  sourceLang: string,
  targetLang: string,
  wordCount: number,
  now: number,
): VocabularyItem {
  const metadata = buildVocabularyTermMetadata(sourceText)

  return {
    id: globalThis.crypto.randomUUID(),
    sourceText: sourceText.trim(),
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
  }
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
  return vocabularyItemsCache == null ? null : [...vocabularyItemsCache]
}

export async function getVocabularyItems(options?: { forceRefresh?: boolean }): Promise<VocabularyItem[]> {
  if (!options?.forceRefresh && vocabularyItemsCache != null) {
    return [...vocabularyItemsCache]
  }

  return [...await loadVocabularyItemsFromStorage()]
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

  const items = await getVocabularyItems()
  return items.find(item => isVocabularyItemSelectionMatch(item, lookup, sourceLang, targetLang)) ?? null
}

export async function saveTranslatedSelectionToVocabulary({
  sourceText,
  translatedText,
  sourceLang,
  targetLang,
  settings,
}: {
  sourceText: string
  translatedText: string
  sourceLang: string
  targetLang: string
  settings: VocabularySettings
}): Promise<VocabularyItem | null> {
  if (!canAutoSaveToVocabulary(sourceText, settings)) {
    return null
  }

  const now = Date.now()
  const wordCount = countVocabularyWords(sourceText)
  const lookup = buildVocabularySelectionLookup(sourceText)
  const items = await getVocabularyItems()
  const existingItem = items.find(item => isVocabularyItemSelectionMatch(item, lookup, sourceLang, targetLang))
  const previousItems = getCachedVocabularyItems() ?? items

  if (existingItem) {
    const updatedItem = restoreOrUpdateExistingItem(
      existingItem,
      sourceText,
      translatedText,
      sourceLang,
      targetLang,
      wordCount,
      now,
    )

    replaceVocabularyItemsCache(upsertVocabularyItem(previousItems, updatedItem))

    try {
      await apiUpdateVocabularyItem(updatedItem)
    }
    catch (error) {
      replaceVocabularyItemsCache(previousItems)
      throw error
    }

    return updatedItem
  }

  const newItem = buildVocabularyItem(sourceText, translatedText, sourceLang, targetLang, wordCount, now)
  replaceVocabularyItemsCache(upsertVocabularyItem(previousItems, newItem))

  try {
    await apiCreateVocabularyItem(newItem)
  }
  catch (error) {
    replaceVocabularyItemsCache(previousItems)
    throw error
  }

  return newItem
}

export async function updateVocabularyItemDetails(
  itemId: string,
  details: Partial<Pick<VocabularyItem, "definition" | "difficulty" | "lemma" | "partOfSpeech" | "phonetic">>,
): Promise<VocabularyItem | null> {
  const previousItems = await getVocabularyItems()
  const existingItem = previousItems.find(item => item.id === itemId)
  if (!existingItem) {
    return null
  }

  const nextDetails = Object.fromEntries(
    Object.entries(details).filter(([, value]) => typeof value === "string" && value.trim()),
  ) as Partial<Pick<VocabularyItem, "definition" | "difficulty" | "lemma" | "partOfSpeech" | "phonetic">>

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

  const previousCache = getCachedVocabularyItems() ?? previousItems
  replaceVocabularyItemsCache(upsertVocabularyItem(previousCache, updatedItem))

  try {
    await apiUpdateVocabularyItem(updatedItem)
  }
  catch (error) {
    replaceVocabularyItemsCache(previousCache)
    throw error
  }

  return updatedItem
}

export async function removeVocabularyItem(itemId: string): Promise<void> {
  const previousItems = await getVocabularyItems()
  const nextItems = previousItems.filter(item => item.id !== itemId)
  replaceVocabularyItemsCache(nextItems)

  try {
    await apiDeleteVocabularyItem(itemId)
  }
  catch (error) {
    replaceVocabularyItemsCache(previousItems)
    throw error
  }
}

export async function clearVocabularyItems(): Promise<void> {
  const previousItems = await getVocabularyItems()
  replaceVocabularyItemsCache([])

  try {
    await apiClearVocabularyItems()
  }
  catch (error) {
    replaceVocabularyItemsCache(previousItems)
    throw error
  }
}
