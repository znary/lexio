type VocabularyItemRecord = Record<string, unknown>

interface VocabularyRow {
  id: string
  source_text: string
  normalized_text: string
  lemma: string | null
  match_terms_json: string
  translated_text: string
  phonetic: string | null
  part_of_speech: string | null
  definition: string | null
  difficulty: string | null
  source_lang: string
  target_lang: string
  kind: string
  word_count: number
  created_at: number
  last_seen_at: number
  hit_count: number
  updated_at: number
  deleted_at: number | null
}

function readString(item: VocabularyItemRecord, key: string, fallback = ""): string {
  return typeof item[key] === "string" ? item[key] as string : fallback
}

function readOptionalString(item: VocabularyItemRecord, key: string): string | null {
  const value = item[key]
  return typeof value === "string" && value.trim() ? value : null
}

function readNumber(item: VocabularyItemRecord, key: string, fallback: number): number {
  const value = item[key]
  return typeof value === "number" && Number.isFinite(value) ? value : fallback
}

function readNullableNumber(item: VocabularyItemRecord, key: string): number | null {
  const value = item[key]
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function readStringArray(item: VocabularyItemRecord, key: string): string[] {
  const value = item[key]
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    : []
}

function parseMatchTerms(matchTermsJson: string): string[] {
  try {
    const value = JSON.parse(matchTermsJson) as unknown
    return Array.isArray(value)
      ? value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
      : []
  }
  catch {
    return []
  }
}

export function serializeVocabularyItem(item: VocabularyItemRecord): VocabularyRow {
  const now = Date.now()
  const normalizedText = readString(item, "normalizedText")
  const sourceText = readString(item, "sourceText", normalizedText)
  const matchTerms = readStringArray(item, "matchTerms")

  return {
    id: readString(item, "id", crypto.randomUUID()),
    source_text: sourceText,
    normalized_text: normalizedText,
    lemma: readOptionalString(item, "lemma"),
    match_terms_json: JSON.stringify(matchTerms),
    translated_text: readString(item, "translatedText"),
    phonetic: readOptionalString(item, "phonetic"),
    part_of_speech: readOptionalString(item, "partOfSpeech"),
    definition: readOptionalString(item, "definition"),
    difficulty: readOptionalString(item, "difficulty"),
    source_lang: readString(item, "sourceLang"),
    target_lang: readString(item, "targetLang"),
    kind: readString(item, "kind", "word"),
    word_count: readNumber(item, "wordCount", 1),
    created_at: readNumber(item, "createdAt", now),
    last_seen_at: readNumber(item, "lastSeenAt", now),
    hit_count: readNumber(item, "hitCount", 1),
    updated_at: readNumber(item, "updatedAt", now),
    deleted_at: readNullableNumber(item, "deletedAt"),
  }
}

export function deserializeVocabularyItem(row: VocabularyRow): VocabularyItemRecord {
  return {
    id: row.id,
    sourceText: row.source_text,
    normalizedText: row.normalized_text,
    ...(row.lemma ? { lemma: row.lemma } : {}),
    ...(parseMatchTerms(row.match_terms_json).length > 0 ? { matchTerms: parseMatchTerms(row.match_terms_json) } : {}),
    translatedText: row.translated_text,
    ...(row.phonetic ? { phonetic: row.phonetic } : {}),
    ...(row.part_of_speech ? { partOfSpeech: row.part_of_speech } : {}),
    ...(row.definition ? { definition: row.definition } : {}),
    ...(row.difficulty ? { difficulty: row.difficulty } : {}),
    sourceLang: row.source_lang,
    targetLang: row.target_lang,
    kind: row.kind,
    wordCount: row.word_count,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
    hitCount: row.hit_count,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  }
}
