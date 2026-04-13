import type { VocabularyItem, VocabularyKind, VocabularySettings } from "@/types/vocabulary"
import { countVocabularyWords, isEnglishVocabularyCandidate, normalizeVocabularyText } from "./normalization"
import { getLocalVocabularyItemsAndMeta, setLocalVocabularyItemsAndMeta, sortVocabularyItems } from "./storage"

function classifyVocabularyKind(wordCount: number): VocabularyKind {
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
  const { value: items, meta } = await getLocalVocabularyItemsAndMeta()
  const existingItem = items.find(item => item.normalizedText === normalizedText)

  const nextItem = existingItem
    ? restoreOrUpdateExistingItem(existingItem, sourceText, translatedText, sourceLang, targetLang, wordCount, now)
    : buildVocabularyItem(sourceText, translatedText, sourceLang, targetLang, wordCount, now)

  const nextItems = sortVocabularyItems(
    existingItem
      ? items.map(item => item.id === existingItem.id ? nextItem : item)
      : [...items, nextItem],
  )

  await setLocalVocabularyItemsAndMeta(nextItems, {
    schemaVersion: meta.schemaVersion,
    lastModifiedAt: now,
  })

  return nextItem
}

export async function removeVocabularyItem(itemId: string): Promise<void> {
  const now = Date.now()
  const { value: items, meta } = await getLocalVocabularyItemsAndMeta()
  const nextItems = items.map((item) => {
    if (item.id !== itemId || item.deletedAt != null) {
      return item
    }

    return {
      ...item,
      updatedAt: now,
      deletedAt: now,
    }
  })

  await setLocalVocabularyItemsAndMeta(nextItems, {
    schemaVersion: meta.schemaVersion,
    lastModifiedAt: now,
  })
}

export async function clearVocabularyItems(): Promise<void> {
  const now = Date.now()
  const { value: items, meta } = await getLocalVocabularyItemsAndMeta()
  const nextItems = items.map(item => ({
    ...item,
    updatedAt: now,
    deletedAt: now,
  }))

  await setLocalVocabularyItemsAndMeta(nextItems, {
    schemaVersion: meta.schemaVersion,
    lastModifiedAt: now,
  })
}
