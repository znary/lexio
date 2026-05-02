import type {
  VocabularyContextEntry,
  VocabularyItem,
  VocabularyWordFamily,
  VocabularyWordFamilyEntry,
} from "@/types/vocabulary"

const WWW_PREFIX_RE = /^www\./

export const WORD_FAMILY_GROUP_ORDER = ["core", "contrast", "related"] as const

export type WordFamilyGroupKey = (typeof WORD_FAMILY_GROUP_ORDER)[number]

export interface VocabularyCardItem extends Partial<Omit<VocabularyItem, "contextEntries" | "contextSentences" | "contextSentence" | "wordFamily">> {
  contextEntries?: VocabularyContextEntry[]
  contextSentence?: string
  contextSentences?: string[]
  sourceText: string
  translatedText?: string
  wordFamily?: VocabularyWordFamily
}

export interface VocabularyCardExtraField {
  id: string
  label: string
  value: string
}

export function getVocabularyCardDefinition(item: VocabularyCardItem): string {
  return item.definition?.trim() || item.translatedText?.trim() || item.sourceText
}

export function getVocabularyCardPhonetic(item: VocabularyCardItem): string {
  return item.phonetic?.trim() || "/—/"
}

export function getVocabularyCardPartOfSpeech(item: VocabularyCardItem): string {
  return item.partOfSpeech?.trim() || item.kind || "word"
}

export function getVocabularyCardContexts(item: VocabularyCardItem): VocabularyContextEntry[] {
  if (item.contextEntries?.length) {
    return item.contextEntries
  }

  if (item.contextSentences?.length) {
    return item.contextSentences.map(sentence => ({ sentence }))
  }

  if (item.contextSentence?.trim()) {
    return [{ sentence: item.contextSentence }]
  }

  return []
}

export function getVocabularyCardWordFamily(item: VocabularyCardItem): VocabularyWordFamily | null {
  const wordFamily = item.wordFamily
  if (!wordFamily) {
    return null
  }

  return WORD_FAMILY_GROUP_ORDER.some(groupKey => wordFamily[groupKey].length > 0)
    ? wordFamily
    : null
}

export function getVocabularyCardSourceLabel(
  item: VocabularyCardItem,
  unavailableLabel: string,
  fallbackLabel: string,
): string {
  const firstSourceUrl = getVocabularyCardContexts(item).find(entry => entry.sourceUrl)?.sourceUrl
  if (!firstSourceUrl) {
    return unavailableLabel
  }

  try {
    const hostname = new URL(firstSourceUrl).hostname.replace(WWW_PREFIX_RE, "")
    return hostname || fallbackLabel
  }
  catch {
    return fallbackLabel
  }
}

export function hasVocabularyWordFamilyEntries(entries: VocabularyWordFamilyEntry[]): boolean {
  return entries.length > 0
}
