import { resolvePlatformApiUrl } from "./env"

export interface VocabularyContextEntry {
  sentence: string
  sourceUrl?: string
}

export interface VocabularyItem {
  id: string
  sourceText: string
  normalizedText: string
  translatedText: string
  phonetic?: string
  partOfSpeech?: string
  definition?: string
  difficulty?: string
  lemma?: string
  matchTerms?: string[]
  sourceLang: string
  targetLang: string
  kind: "word" | "phrase"
  wordCount: number
  createdAt: number
  lastSeenAt: number
  hitCount: number
  updatedAt: number
  deletedAt: number | null
  masteredAt?: number | null
  contextEntries?: VocabularyContextEntry[]
  contextSentences?: string[]
  contextSentence?: string
}

function isVocabularyContextEntry(value: unknown): value is VocabularyContextEntry {
  if (!value || typeof value !== "object") {
    return false
  }

  const candidate = value as VocabularyContextEntry
  return typeof candidate.sentence === "string" && candidate.sentence.trim().length > 0
}

function isVocabularyItem(value: unknown): value is VocabularyItem {
  if (!value || typeof value !== "object") {
    return false
  }

  const candidate = value as VocabularyItem
  return (
    typeof candidate.id === "string"
    && typeof candidate.sourceText === "string"
    && typeof candidate.normalizedText === "string"
    && typeof candidate.translatedText === "string"
    && (candidate.lemma == null || typeof candidate.lemma === "string")
    && (candidate.matchTerms == null || (Array.isArray(candidate.matchTerms) && candidate.matchTerms.every(term => typeof term === "string")))
    && typeof candidate.sourceLang === "string"
    && typeof candidate.targetLang === "string"
    && (candidate.kind === "word" || candidate.kind === "phrase")
    && typeof candidate.wordCount === "number"
    && typeof candidate.createdAt === "number"
    && typeof candidate.lastSeenAt === "number"
    && typeof candidate.hitCount === "number"
    && typeof candidate.updatedAt === "number"
    && (candidate.deletedAt === null || typeof candidate.deletedAt === "number")
    && (candidate.contextEntries == null || (Array.isArray(candidate.contextEntries) && candidate.contextEntries.every(isVocabularyContextEntry)))
  )
}

async function platformFetch(path: string, token: string): Promise<Response> {
  const response = await fetch(`${resolvePlatformApiUrl()}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  })

  if (response.status === 401) {
    throw new Error("Platform session expired. Sign in again.")
  }

  if (!response.ok) {
    const payload = await response.text()
    throw new Error(payload || `Platform request failed with status ${response.status}`)
  }

  return response
}

export async function getPlatformVocabularyItems(token: string): Promise<VocabularyItem[]> {
  const response = await platformFetch("/v1/vocabulary", token)
  const payload = await response.json() as { items?: unknown }

  if (!Array.isArray(payload.items)) {
    return []
  }

  return payload.items.filter(isVocabularyItem)
}
