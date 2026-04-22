type VocabularyItemRecord = Record<string, unknown>
const MAX_VOCABULARY_CONTEXT_SENTENCES = 10

interface VocabularyRow {
  id: string
  source_text: string
  normalized_text: string
  context_sentence?: string | null
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
  mastered_at: number | null
}

interface VocabularyContextSentenceRow {
  vocabulary_item_id: string
  sentence: string
  source_url: string | null
  created_at: number
  last_seen_at: number
}

interface VocabularyContextEntryRecord {
  sentence: string
  sourceUrl?: string
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

function normalizeSourceUrl(sourceUrl: string | null | undefined): string | null {
  return typeof sourceUrl === "string" && sourceUrl.trim()
    ? sourceUrl.trim()
    : null
}

function normalizeContextEntry(
  entry: Partial<VocabularyContextEntryRecord> | null | undefined,
): VocabularyContextEntryRecord | null {
  const sentence = typeof entry?.sentence === "string" && entry.sentence.trim()
    ? entry.sentence.trim()
    : null

  if (!sentence) {
    return null
  }

  const sourceUrl = normalizeSourceUrl(entry?.sourceUrl)
  return sourceUrl
    ? { sentence, sourceUrl }
    : { sentence }
}

function normalizeContextEntries(
  entries: Array<Partial<VocabularyContextEntryRecord> | null | undefined>,
): VocabularyContextEntryRecord[] {
  const uniqueEntries: VocabularyContextEntryRecord[] = []
  const entryBySentence = new Map<string, VocabularyContextEntryRecord>()

  for (const entry of entries) {
    const normalizedEntry = normalizeContextEntry(entry)
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

    if (uniqueEntries.length >= MAX_VOCABULARY_CONTEXT_SENTENCES) {
      break
    }
  }

  return uniqueEntries
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

function readContextEntryArray(item: VocabularyItemRecord, key: string): VocabularyContextEntryRecord[] {
  const value = item[key]
  if (!Array.isArray(value)) {
    return []
  }

  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") {
      return []
    }

    const record = entry as Record<string, unknown>
    const normalizedEntry = normalizeContextEntry({
      sentence: typeof record.sentence === "string" ? record.sentence : undefined,
      sourceUrl: typeof record.sourceUrl === "string" ? record.sourceUrl : undefined,
    })

    return normalizedEntry ? [normalizedEntry] : []
  })
}

export function readVocabularyContextEntries(item: VocabularyItemRecord): VocabularyContextEntryRecord[] {
  const legacyContextSentence = readOptionalString(item, "contextSentence")

  return normalizeContextEntries([
    ...readContextEntryArray(item, "contextEntries"),
    ...readStringArray(item, "contextSentences").map(sentence => ({ sentence })),
    legacyContextSentence
      ? {
          sentence: legacyContextSentence,
        }
      : null,
  ])
}

export function readVocabularyContextSentences(item: VocabularyItemRecord): string[] {
  return readVocabularyContextEntries(item).map(entry => entry.sentence)
}

export function buildVocabularyContextSentenceRows(
  itemId: string,
  item: VocabularyItemRecord,
  baseTimestamp = Date.now(),
): VocabularyContextSentenceRow[] {
  return readVocabularyContextEntries(item).map((entry, index) => ({
    vocabulary_item_id: itemId,
    sentence: entry.sentence,
    source_url: entry.sourceUrl ?? null,
    created_at: baseTimestamp - index,
    last_seen_at: baseTimestamp - index,
  }))
}

export function mergeVocabularyContextSentenceRows(
  items: VocabularyItemRecord[],
  rows: VocabularyContextSentenceRow[],
): VocabularyItemRecord[] {
  const groupedEntries = new Map<string, VocabularyContextEntryRecord[]>()

  for (const row of rows) {
    const currentEntries = groupedEntries.get(row.vocabulary_item_id) ?? []
    currentEntries.push({
      sentence: row.sentence,
      ...(row.source_url ? { sourceUrl: row.source_url } : {}),
    })
    groupedEntries.set(row.vocabulary_item_id, currentEntries)
  }

  return items.map((item) => {
    const itemId = typeof item.id === "string" ? item.id : ""
    const mergedEntries = normalizeContextEntries([
      ...(itemId ? (groupedEntries.get(itemId) ?? []) : []),
      ...readVocabularyContextEntries(item),
    ])

    const {
      contextEntries: _currentContextEntries,
      contextSentence: _legacyContextSentence,
      contextSentences: _currentContextSentences,
      ...restItem
    } = item

    return mergedEntries.length > 0
      ? {
          ...restItem,
          contextEntries: mergedEntries,
          contextSentences: mergedEntries.map(entry => entry.sentence),
        }
      : restItem
  })
}

export function serializeVocabularyItem(item: VocabularyItemRecord): VocabularyRow {
  const now = Date.now()
  const itemId = readString(item, "id").trim() || crypto.randomUUID()
  const normalizedText = readString(item, "normalizedText")
  const sourceText = readString(item, "sourceText", normalizedText)
  const matchTerms = readStringArray(item, "matchTerms")

  return {
    id: itemId,
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
    mastered_at: readNullableNumber(item, "masteredAt"),
  }
}

export function deserializeVocabularyItem(row: VocabularyRow): VocabularyItemRecord {
  const contextEntries = normalizeContextEntries([
    row.context_sentence
      ? {
          sentence: row.context_sentence,
        }
      : null,
  ])

  return {
    id: row.id,
    sourceText: row.source_text,
    normalizedText: row.normalized_text,
    ...(contextEntries.length > 0
      ? {
          contextEntries,
          contextSentences: contextEntries.map(entry => entry.sentence),
        }
      : {}),
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
    masteredAt: row.mastered_at,
  }
}
