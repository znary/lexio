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
  nuance: string | null
  word_family_json: string | null
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
  translated_sentence: string | null
  source_url: string | null
  created_at: number
  last_seen_at: number
}

interface VocabularyContextEntryRecord {
  sentence: string
  translatedSentence?: string
  sourceUrl?: string
}

interface VocabularyWordFamilyEntryRecord {
  term: string
  partOfSpeech?: string
  definition: string
}

interface VocabularyWordFamilyRecord {
  core: VocabularyWordFamilyEntryRecord[]
  contrast: VocabularyWordFamilyEntryRecord[]
  related: VocabularyWordFamilyEntryRecord[]
}

const WORD_FAMILY_GROUP_KEYS = ["core", "contrast", "related"] as const
type VocabularyWordFamilyGroupKey = (typeof WORD_FAMILY_GROUP_KEYS)[number]

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

function normalizeTranslatedSentence(translatedSentence: string | null | undefined): string | null {
  return typeof translatedSentence === "string" && translatedSentence.trim()
    ? translatedSentence.trim()
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
  const translatedSentence = normalizeTranslatedSentence(entry?.translatedSentence)
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

    if (existingEntry && normalizedEntry.translatedSentence) {
      existingEntry.translatedSentence = normalizedEntry.translatedSentence
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

function normalizeWordFamilyEntry(
  entry: Partial<VocabularyWordFamilyEntryRecord> | null | undefined,
): VocabularyWordFamilyEntryRecord | null {
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

function normalizeWordFamilyGroup(
  entries: Array<Partial<VocabularyWordFamilyEntryRecord> | null | undefined>,
): VocabularyWordFamilyEntryRecord[] {
  const uniqueEntries: VocabularyWordFamilyEntryRecord[] = []
  const seenTerms = new Set<string>()

  for (const entry of entries) {
    const normalizedEntry = normalizeWordFamilyEntry(entry)
    if (!normalizedEntry) {
      continue
    }

    const normalizedTerm = normalizedEntry.term.toLowerCase()
    if (seenTerms.has(normalizedTerm)) {
      continue
    }

    seenTerms.add(normalizedTerm)
    uniqueEntries.push(normalizedEntry)
  }

  return uniqueEntries
}

function normalizeWordFamily(wordFamily: Partial<Record<VocabularyWordFamilyGroupKey, Array<Partial<VocabularyWordFamilyEntryRecord> | null | undefined>>> | null | undefined): VocabularyWordFamilyRecord | null {
  if (!wordFamily) {
    return null
  }

  const normalizedWordFamily = {
    core: normalizeWordFamilyGroup(wordFamily.core ?? []),
    contrast: normalizeWordFamilyGroup(wordFamily.contrast ?? []),
    related: normalizeWordFamilyGroup(wordFamily.related ?? []),
  }

  return WORD_FAMILY_GROUP_KEYS.some(key => normalizedWordFamily[key].length > 0)
    ? normalizedWordFamily
    : null
}

function readWordFamilyEntryArray(value: unknown): VocabularyWordFamilyEntryRecord[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") {
      return []
    }

    const record = entry as Record<string, unknown>
    const normalizedEntry = normalizeWordFamilyEntry({
      term: typeof record.term === "string" ? record.term : undefined,
      partOfSpeech: typeof record.partOfSpeech === "string" ? record.partOfSpeech : undefined,
      definition: typeof record.definition === "string" ? record.definition : undefined,
    })

    return normalizedEntry ? [normalizedEntry] : []
  })
}

function readVocabularyWordFamily(item: VocabularyItemRecord): VocabularyWordFamilyRecord | null {
  const value = item.wordFamily
  if (!value || typeof value !== "object") {
    return null
  }

  const record = value as Record<string, unknown>
  return normalizeWordFamily({
    core: readWordFamilyEntryArray(record.core),
    contrast: readWordFamilyEntryArray(record.contrast),
    related: readWordFamilyEntryArray(record.related),
  })
}

function parseWordFamily(wordFamilyJson: string | null | undefined): VocabularyWordFamilyRecord | null {
  if (!wordFamilyJson?.trim()) {
    return null
  }

  try {
    const parsed = JSON.parse(wordFamilyJson) as unknown
    if (!parsed || typeof parsed !== "object") {
      return null
    }

    const record = parsed as Record<string, unknown>
    return normalizeWordFamily({
      core: readWordFamilyEntryArray(record.core),
      contrast: readWordFamilyEntryArray(record.contrast),
      related: readWordFamilyEntryArray(record.related),
    })
  }
  catch {
    return null
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
      translatedSentence: typeof record.translatedSentence === "string" ? record.translatedSentence : undefined,
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
    translated_sentence: entry.translatedSentence ?? null,
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
      ...(row.translated_sentence ? { translatedSentence: row.translated_sentence } : {}),
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
  const wordFamily = readVocabularyWordFamily(item)

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
    nuance: readOptionalString(item, "nuance"),
    word_family_json: wordFamily ? JSON.stringify(wordFamily) : null,
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
  const wordFamily = parseWordFamily(row.word_family_json)

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
    ...(row.nuance ? { nuance: row.nuance } : {}),
    ...(wordFamily ? { wordFamily } : {}),
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
