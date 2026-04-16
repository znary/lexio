import type { VocabularyItem, VocabularySettings } from "@/types/vocabulary"
import {
  clearVocabularyItems as apiClearVocabularyItems,
  createVocabularyItem as apiCreateVocabularyItem,
  deleteVocabularyItem as apiDeleteVocabularyItem,
  getVocabularyItems as apiGetVocabularyItems,
  updateVocabularyItem as apiUpdateVocabularyItem,
} from "../platform/api"
import { countVocabularyWords, isEnglishVocabularyCandidate, normalizeVocabularyText } from "./normalization"

export const VOCABULARY_CHANGED_EVENT = "lexio:vocabulary-changed"
let vocabularyItemsCache: VocabularyItem[] | null = null

function notifyVocabularyChanged(): void {
  if (typeof document !== "undefined") {
    document.dispatchEvent(new CustomEvent(VOCABULARY_CHANGED_EVENT))
  }
}

function sortVocabularyItems(items: VocabularyItem[]): VocabularyItem[] {
  return [...items].sort((left, right) => right.updatedAt - left.updatedAt)
}

function replaceVocabularyItemsCache(items: VocabularyItem[], notify = true): VocabularyItem[] {
  vocabularyItemsCache = sortVocabularyItems(items)
  if (notify) {
    notifyVocabularyChanged()
  }
  return vocabularyItemsCache
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

function restoreOrUpdateExistingItem(
  item: VocabularyItem,
  sourceText: string,
  translatedText: string,
  sourceLang: string,
  targetLang: string,
  wordCount: number,
  now: number,
): VocabularyItem {
  return {
    ...item,
    sourceText: sourceText.trim(),
    translatedText: translatedText.trim(),
    sourceLang,
    targetLang,
    kind: classifyVocabularyKind(wordCount),
    wordCount,
    lastSeenAt: now,
    hitCount: item.deletedAt == null ? item.hitCount + 1 : 1,
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
  return {
    id: globalThis.crypto.randomUUID(),
    sourceText: sourceText.trim(),
    normalizedText: normalizeVocabularyText(sourceText),
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

  const items = sortVocabularyItems(await apiGetVocabularyItems())
  vocabularyItemsCache = items
  return [...items]
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
  const normalizedText = normalizeVocabularyText(sourceText)
  const items = await getVocabularyItems()
  const existingItem = items.find(item => item.normalizedText === normalizedText)
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
