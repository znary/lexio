#!/usr/bin/env node
import { execFile, spawn } from "node:child_process"
import { readFile, writeFile } from "node:fs/promises"
import { extname, join } from "node:path"
import process from "node:process"
import { parseArgs, promisify } from "node:util"

const execFileAsync = promisify(execFile)

const CURLY_APOSTROPHES_RE = /[’‘]/g
const CURLY_QUOTES_RE = /[“”]/g
const DASH_RE = /[–—]/g
const WHITESPACE_RE = /\s+/g
const LATIN_LETTER_RE = /[A-Z]/i
const WORD_SPLIT_RE = /\s+/
const TOKEN_EDGE_PUNCTUATION_RE = /^[^A-Z0-9]+|[^A-Z0-9]+$/gi
const ENGLISH_VOWEL_RE = /[aeiou]/
const ENGLISH_CONSONANT_RE = /[a-z]/
const ENGLISH_ES_ENDING_RE = /(?:[osxz]|ch|sh)$/
const ENGLISH_KEEP_E_ING_ENDING_RE = /(?:ee|oe|ye)$/
const ENGLISH_ES_LEMMA_RE = /(?:ches|shes|sses|xes|zes|oes)$/
const BACKFILL_LLM_PATH = "/__backfill/llm"
const DEFAULT_LLM_DEV_PORT = 8789
const DEFAULT_CONCURRENCY = 3
const MANAGED_CLOUD_MODEL = "managed-cloud-default"
const MAX_DICTIONARY_CONTEXT_SENTENCES = 10

const TARGET_LANGUAGE_NAMES = {
  "en": "English",
  "en-US": "English",
  "ja": "Japanese",
  "ja-JP": "Japanese",
  "ko": "Korean",
  "ko-KR": "Korean",
  "ru": "Russian",
  "tr": "Turkish",
  "vi": "Vietnamese",
  "zh": "Chinese",
  "zh-CN": "Simplified Chinese",
  "zh-TW": "Traditional Chinese",
}

const DICTIONARY_SYSTEM_PROMPT = `You are a dictionary assistant for language learners.

Return one compact dictionary entry for the selected text based on the surrounding paragraphs.

Field rules:
1. The selected text may be a word or a short phrase. Focus on the meaning that best matches the surrounding paragraphs.
2. Write JSON keys in the output schema order. Produce definition and contextSentenceTranslation before slower enrichment fields.
3. Return the definition in {{targetLanguage}}, based on the contextual sense.
4. Translate the sentence that contains the selected text into {{targetLanguage}} for contextSentenceTranslation. If the selected text appears in more than one sentence, choose the sentence that best explains the contextual meaning.
5. Return the lemma or canonical phrase in the source language of the selected text.
6. Return the part of speech or phrase type in English, such as noun, verb, adjective, idiom, or phrasal verb.
7. Return the phonetic transcription when it is natural for that source-language entry.
8. Return the CEFR difficulty for the source-language entry using only A1, A2, B1, B2, C1, or C2.
9. Return a nuance note in {{targetLanguage}} that explains the subtle sense in this context.
10. Return wordFamilyCore, wordFamilyContrast, and wordFamilyRelated as newline-separated strings.
11. Each line in a word family field must use exactly this format: term || partOfSpeech || definition
12. For a word, these fields contain close word-family items. For a phrase, these fields contain nearby expressions that a learner may confuse or use in the same context.
13. wordFamilyCore should contain up to 3 close entries. wordFamilyContrast should contain up to 2 contrasting entries. wordFamilyRelated should contain up to 2 related entries.
14. If a field is unknown or a group has no natural entries, return null instead of guessing.
15. Keep every value compact and useful for learners.
16. Do not translate or rewrite the JSON keys.`

const DICTIONARY_PROMPT = `## Input
Selected text: {{selection}}
Paragraphs: {{paragraphs}}
Target language: {{targetLanguage}}`

const CONTEXT_TRANSLATION_SYSTEM_PROMPT = `You translate saved vocabulary context sentences for language learners.

Rules:
1. Translate every input sentence into {{targetLanguage}}.
2. Preserve the contextual meaning of the selected text: {{selection}}.
3. Return exactly one JSON object and nothing else.
4. The JSON object must have exactly one key: translations.
5. translations must be an array with exactly the same number of items as the input sentences.
6. Each item must be the translation for the sentence at the same array index.
7. If a sentence is already in {{targetLanguage}}, return it unchanged.`

const CONTEXT_TRANSLATION_PROMPT = `## Input
Selected text: {{selection}}
Target language: {{targetLanguage}}
Sentences JSON: {{sentencesJson}}`

const DICTIONARY_OUTPUT_SCHEMA = [
  {
    name: "definition",
    type: "string",
    description: "One concise definition for the contextual sense. Answer this field in {{targetLanguage}}.",
  },
  {
    name: "contextSentenceTranslation",
    type: "string",
    description: "Translate the sentence that contains the selected text into {{targetLanguage}}. Return only that sentence translation.",
  },
  {
    name: "term",
    type: "string",
    description: "Base/canonical lemma of the selected term. Keep this field in the source language of the selected text.",
  },
  {
    name: "partOfSpeech",
    type: "string",
    description: "Grammatical category (e.g., noun, verb, adjective). Keep this field in English.",
  },
  {
    name: "phonetic",
    type: "string",
    description: "Standard phonetic transcription for the term's language (e.g., IPA for English, pinyin for Mandarin, romaji for Japanese). This is for the source-language lemma.",
  },
  {
    name: "difficulty",
    type: "string",
    description: "Estimated CEFR difficulty level A1, A2, B1, B2, C1, or C2. This difficulty is for the source-language lemma.",
  },
  {
    name: "nuance",
    type: "string",
    description: "One short nuance note in {{targetLanguage}} for the contextual sense.",
  },
  {
    name: "wordFamilyCore",
    type: "string",
    description: "Up to 3 close word-family items or nearby phrase expressions. Use one line per item in the format: term || partOfSpeech || definition. Answer definitions in {{targetLanguage}}.",
  },
  {
    name: "wordFamilyContrast",
    type: "string",
    description: "Up to 2 contrasting items. Use one line per item in the format: term || partOfSpeech || definition. Answer definitions in {{targetLanguage}}.",
  },
  {
    name: "wordFamilyRelated",
    type: "string",
    description: "Up to 2 related word-family items or nearby phrase expressions. Use one line per item in the format: term || partOfSpeech || definition. Answer definitions in {{targetLanguage}}.",
  },
]

const ENGLISH_INFLECTION_OVERRIDES = {
  be: {
    extra: ["am"],
    past: ["was", "were", "been"],
    plural: ["are"],
    presentParticiple: ["being"],
    thirdPerson: ["is"],
  },
  come: { past: ["came"] },
  do: { past: ["did", "done"], thirdPerson: ["does"] },
  eat: { past: ["ate", "eaten"] },
  feel: { past: ["felt"] },
  find: { past: ["found"] },
  get: { past: ["got", "gotten"] },
  give: { past: ["gave", "given"] },
  go: { past: ["went", "gone"], thirdPerson: ["goes"] },
  have: { past: ["had"], thirdPerson: ["has"] },
  know: { past: ["knew", "known"] },
  leave: { past: ["left"] },
  make: { past: ["made"] },
  mean: { past: ["meant"] },
  read: { past: ["read"] },
  run: { past: ["ran"] },
  say: { past: ["said"] },
  see: { past: ["saw", "seen"] },
  speak: { past: ["spoke", "spoken"] },
  take: { past: ["took", "taken"] },
  tell: { past: ["told"] },
  think: { past: ["thought"] },
  write: { past: ["wrote", "written"] },
}

const ENGLISH_IRREGULAR_LEMMA_BY_FORM = Object.entries(ENGLISH_INFLECTION_OVERRIDES)
  .reduce((accumulator, [lemma, overrides]) => {
    const forms = [
      ...(overrides.extra ?? []),
      ...(overrides.past ?? []),
      ...(overrides.plural ?? []),
      ...(overrides.presentParticiple ?? []),
      ...(overrides.thirdPerson ?? []),
    ]

    for (const form of forms) {
      accumulator[form] = lemma
    }

    return accumulator
  }, {})

function normalizeVocabularyText(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(CURLY_APOSTROPHES_RE, "'")
    .replace(CURLY_QUOTES_RE, "\"")
    .replace(DASH_RE, "-")
    .replace(WHITESPACE_RE, " ")
    .trim()
    .toLowerCase()
}

function countVocabularyWords(value) {
  const normalized = String(value ?? "")
    .normalize("NFKC")
    .replace(CURLY_APOSTROPHES_RE, "'")
    .replace(DASH_RE, " ")
    .trim()

  if (!normalized) {
    return 0
  }

  return normalized
    .split(WORD_SPLIT_RE)
    .map(token => token.replace(TOKEN_EDGE_PUNCTUATION_RE, ""))
    .filter(Boolean)
    .length
}

function isEnglishVocabularyCandidate(value) {
  return LATIN_LETTER_RE.test(String(value ?? ""))
}

function isEnglishVowel(character) {
  return Boolean(character) && ENGLISH_VOWEL_RE.test(character)
}

function isEnglishConsonant(character) {
  return Boolean(character) && ENGLISH_CONSONANT_RE.test(character) && !isEnglishVowel(character)
}

function endsWithShortConsonantVowelConsonant(word) {
  if (word.length < 3) {
    return false
  }

  const first = word.at(-3)
  const second = word.at(-2)
  const third = word.at(-1)
  return isEnglishConsonant(first) && isEnglishVowel(second) && isEnglishConsonant(third) && !"wxy".includes(third ?? "")
}

function hasTrailingDoubledConsonant(word) {
  if (word.length < 2) {
    return false
  }

  const last = word.at(-1)
  const previous = word.at(-2)
  return Boolean(last) && last === previous && isEnglishConsonant(last) && !"wxy".includes(last)
}

function canRestoreSilentE(stem) {
  if (stem.length < 2) {
    return false
  }

  return isEnglishConsonant(stem.at(-1)) && isEnglishVowel(stem.at(-2))
}

function buildEnglishSuffixedPluralOrThirdPerson(lemma) {
  if (lemma.endsWith("y") && isEnglishConsonant(lemma.at(-2))) {
    return `${lemma.slice(0, -1)}ies`
  }

  if (ENGLISH_ES_ENDING_RE.test(lemma)) {
    return `${lemma}es`
  }

  return `${lemma}s`
}

function buildEnglishPresentParticiple(lemma) {
  if (lemma.endsWith("ie")) {
    return `${lemma.slice(0, -2)}ying`
  }

  if (lemma.endsWith("e") && !ENGLISH_KEEP_E_ING_ENDING_RE.test(lemma)) {
    return `${lemma.slice(0, -1)}ing`
  }

  if (endsWithShortConsonantVowelConsonant(lemma)) {
    return `${lemma}${lemma.at(-1)}ing`
  }

  return `${lemma}ing`
}

function buildEnglishPastTense(lemma) {
  if (lemma.endsWith("e")) {
    return `${lemma}d`
  }

  if (lemma.endsWith("y") && isEnglishConsonant(lemma.at(-2))) {
    return `${lemma.slice(0, -1)}ied`
  }

  if (endsWithShortConsonantVowelConsonant(lemma)) {
    return `${lemma}${lemma.at(-1)}ed`
  }

  return `${lemma}ed`
}

function buildEnglishWordFamily(lemma) {
  const overrides = ENGLISH_INFLECTION_OVERRIDES[lemma] ?? {}
  const family = new Set([lemma])

  for (const plural of overrides.plural ?? [buildEnglishSuffixedPluralOrThirdPerson(lemma)]) {
    family.add(plural)
  }

  for (const thirdPerson of overrides.thirdPerson ?? [buildEnglishSuffixedPluralOrThirdPerson(lemma)]) {
    family.add(thirdPerson)
  }

  for (const presentParticiple of overrides.presentParticiple ?? [buildEnglishPresentParticiple(lemma)]) {
    family.add(presentParticiple)
  }

  for (const past of overrides.past ?? [buildEnglishPastTense(lemma)]) {
    family.add(past)
  }

  for (const extra of overrides.extra ?? []) {
    family.add(extra)
  }

  return [...family]
}

function getEnglishLemmaCandidates(surface) {
  const candidates = []
  const pushCandidate = (value) => {
    const normalized = normalizeVocabularyText(value)
    if (normalized && !candidates.includes(normalized)) {
      candidates.push(normalized)
    }
  }

  const irregularLemma = ENGLISH_IRREGULAR_LEMMA_BY_FORM[surface]
  if (irregularLemma) {
    pushCandidate(irregularLemma)
  }

  if (surface.endsWith("ying") && surface.length > 5) {
    pushCandidate(`${surface.slice(0, -4)}ie`)
  }

  if (surface.endsWith("ied") && surface.length > 4) {
    pushCandidate(isEnglishVowel(surface.at(-4)) ? surface.slice(0, -1) : `${surface.slice(0, -3)}y`)
  }

  if (surface.endsWith("ies") && surface.length > 4) {
    pushCandidate(isEnglishVowel(surface.at(-4)) ? surface.slice(0, -1) : `${surface.slice(0, -3)}y`)
  }

  if (surface.endsWith("ing") && surface.length > 5) {
    const stem = surface.slice(0, -3)
    pushCandidate(stem)
    if (hasTrailingDoubledConsonant(stem)) {
      pushCandidate(stem.slice(0, -1))
    }
    if (canRestoreSilentE(stem)) {
      pushCandidate(`${stem}e`)
    }
  }

  if (surface.endsWith("ed") && surface.length > 4) {
    const stem = surface.slice(0, -2)
    pushCandidate(stem)
    if (hasTrailingDoubledConsonant(stem)) {
      pushCandidate(stem.slice(0, -1))
    }
    if (canRestoreSilentE(stem)) {
      pushCandidate(`${stem}e`)
    }
  }

  if (surface.endsWith("es") && surface.length > 4) {
    if (ENGLISH_ES_LEMMA_RE.test(surface)) {
      pushCandidate(surface.slice(0, -2))
    }
    pushCandidate(surface.slice(0, -1))
  }

  if (surface.endsWith("s") && surface.length > 3 && !surface.endsWith("ss")) {
    pushCandidate(surface.slice(0, -1))
  }

  pushCandidate(surface)
  return candidates
}

function inferEnglishLemma(surface) {
  for (const candidate of getEnglishLemmaCandidates(surface)) {
    if (buildEnglishWordFamily(candidate).includes(surface)) {
      return candidate
    }
  }

  return surface
}

function buildVocabularyTermMetadata(sourceText, options = {}) {
  const normalizedSourceText = normalizeVocabularyText(sourceText)
  const wordCount = countVocabularyWords(sourceText)

  if (!normalizedSourceText) {
    return { matchTerms: [], normalizedText: "" }
  }

  if (wordCount !== 1 || !isEnglishVocabularyCandidate(sourceText)) {
    return {
      matchTerms: [normalizedSourceText],
      normalizedText: normalizedSourceText,
    }
  }

  const preferredLemma = options.preferredLemma ? normalizeVocabularyText(options.preferredLemma) : null
  const lemma = preferredLemma || inferEnglishLemma(normalizedSourceText)
  const matchTerms = new Set(buildEnglishWordFamily(lemma))
  matchTerms.add(normalizedSourceText)

  return {
    lemma,
    matchTerms: [...matchTerms],
    normalizedText: lemma,
  }
}

function normalizeWordFamilyEntry(entry) {
  const term = typeof entry?.term === "string" && entry.term.trim() ? entry.term.trim() : null
  const definition = typeof entry?.definition === "string" && entry.definition.trim() ? entry.definition.trim() : null
  const partOfSpeech = typeof entry?.partOfSpeech === "string" && entry.partOfSpeech.trim() ? entry.partOfSpeech.trim() : null

  if (!term || !definition) {
    return null
  }

  return partOfSpeech ? { term, partOfSpeech, definition } : { term, definition }
}

function normalizeWordFamilyGroup(entries) {
  const normalizedEntries = []
  const seenTerms = new Set()

  for (const entry of Array.isArray(entries) ? entries : []) {
    const normalizedEntry = normalizeWordFamilyEntry(entry)
    if (!normalizedEntry) {
      continue
    }

    const normalizedTerm = normalizeVocabularyText(normalizedEntry.term)
    if (seenTerms.has(normalizedTerm)) {
      continue
    }

    seenTerms.add(normalizedTerm)
    normalizedEntries.push(normalizedEntry)
  }

  return normalizedEntries
}

function normalizeWordFamily(wordFamily) {
  if (!wordFamily || typeof wordFamily !== "object") {
    return null
  }

  const normalizedWordFamily = {
    core: normalizeWordFamilyGroup(wordFamily.core),
    contrast: normalizeWordFamilyGroup(wordFamily.contrast),
    related: normalizeWordFamilyGroup(wordFamily.related),
  }

  return normalizedWordFamily.core.length > 0
    || normalizedWordFamily.contrast.length > 0
    || normalizedWordFamily.related.length > 0
    ? normalizedWordFamily
    : null
}

function hasWordFamilyCore(wordFamily) {
  return (wordFamily?.core?.length ?? 0) > 0
}

function mergeGeneratedWordFamily(existingWordFamily, generatedWordFamily) {
  const existing = normalizeWordFamily(existingWordFamily)
  const generated = normalizeWordFamily(generatedWordFamily)
  if (!generated) {
    return existing
  }

  if (!existing) {
    return generated
  }

  return normalizeWordFamily({
    core: existing.core.length > 0 ? existing.core : generated.core,
    contrast: existing.contrast.length > 0 ? existing.contrast : generated.contrast,
    related: existing.related.length > 0 ? existing.related : generated.related,
  })
}

function getWordFamilyCoreMatchTerms(wordFamily) {
  return (wordFamily?.core ?? [])
    .map(entry => normalizeVocabularyText(entry.term))
    .filter(Boolean)
}

function normalizeStringArray(value) {
  return Array.isArray(value)
    ? value.map(entry => normalizeVocabularyText(entry)).filter(Boolean)
    : []
}

function unique(values) {
  return [...new Set(values.filter(Boolean))]
}

function createBackfilledVocabularyItem(item, options = {}) {
  const sourceText = typeof item.sourceText === "string" ? item.sourceText : ""
  const normalizedSourceText = normalizeVocabularyText(sourceText)
  const generatedLemma = typeof options.generatedLemma === "string" && options.generatedLemma.trim()
    ? options.generatedLemma.trim()
    : null
  const nextLemma = typeof item.lemma === "string" && item.lemma.trim()
    ? item.lemma.trim()
    : options.preserveLemma ? null : generatedLemma
  const preferredLemma = nextLemma
    ?? (typeof item.normalizedText === "string" && item.normalizedText && item.normalizedText !== normalizedSourceText ? item.normalizedText : null)
  const metadata = buildVocabularyTermMetadata(sourceText, { preferredLemma })
  const wordFamily = mergeGeneratedWordFamily(item.wordFamily, options.generatedWordFamily)
  const contextEntries = mergeGeneratedContextTranslations(item, options.generatedContextTranslations)
  const matchTerms = unique([
    ...metadata.matchTerms,
    ...getWordFamilyCoreMatchTerms(wordFamily),
    ...normalizeStringArray(item.matchTerms),
  ])

  return {
    ...item,
    ...(!options.preserveLemma && metadata.lemma ? { lemma: nextLemma ?? metadata.lemma } : {}),
    ...(!options.preserveNormalizedText
      ? { normalizedText: metadata.normalizedText || item.normalizedText || normalizedSourceText }
      : {}),
    ...(contextEntries
      ? {
          contextEntries,
          contextSentences: contextEntries.map(entry => entry.sentence),
        }
      : {}),
    ...(wordFamily ? { wordFamily } : {}),
    ...(matchTerms.length > 0 ? { matchTerms } : {}),
  }
}

function summarizeChange(before, after) {
  const beforeTerms = new Set(normalizeStringArray(before.matchTerms))
  const afterTerms = normalizeStringArray(after.matchTerms)
  const addedMatchTerms = afterTerms.filter(term => !beforeTerms.has(term))
  const changedFields = []

  for (const field of ["lemma", "normalizedText", "contextEntries", "matchTerms", "wordFamily"]) {
    if (JSON.stringify(before[field] ?? null) !== JSON.stringify(after[field] ?? null)) {
      changedFields.push(field)
    }
  }

  return {
    addedMatchTerms,
    changedFields,
    needsContextTranslations: hasMissingContextTranslations(after),
    needsWordFamilyCore: !hasWordFamilyCore(normalizeWordFamily(after.wordFamily)),
  }
}

function getVocabularyItemsFromPayload(payload) {
  if (Array.isArray(payload)) {
    return payload
  }

  if (Array.isArray(payload?.vocabularyItems)) {
    return payload.vocabularyItems
  }

  if (Array.isArray(payload?.items)) {
    return payload.items
  }

  throw new Error("Input JSON must be an array or an object with vocabularyItems/items.")
}

function setVocabularyItemsInPayload(payload, items) {
  if (Array.isArray(payload)) {
    return items
  }

  if (Array.isArray(payload?.vocabularyItems)) {
    return { ...payload, vocabularyItems: items }
  }

  if (Array.isArray(payload?.items)) {
    return { ...payload, items }
  }

  return payload
}

function parseInteger(value, fallback) {
  if (value === undefined) {
    return fallback
  }

  const parsed = Number.parseInt(String(value), 10)
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Invalid integer: ${value}`)
  }

  return parsed
}

function parsePositiveInteger(value, fallback) {
  const parsed = parseInteger(value, fallback)
  if (parsed < 1) {
    throw new Error(`Invalid positive integer: ${value}`)
  }

  return parsed
}

function splitIds(values) {
  return values
    .flatMap(value => String(value).split(","))
    .map(value => value.trim())
    .filter(Boolean)
}

function resolveOutputPath(inputPath) {
  const extension = extname(inputPath)
  const base = extension ? inputPath.slice(0, -extension.length) : inputPath
  return `${base}.patched${extension || ".json"}`
}

function stripJsonFence(value) {
  const trimmed = value.trim()
  if (!trimmed.startsWith("```")) {
    return trimmed
  }

  const lines = trimmed.split("\n")
  if (lines.length < 3 || !lines.at(-1)?.trim().startsWith("```")) {
    return trimmed
  }

  return lines.slice(1, -1).join("\n").trim()
}

function trimTrailingSlash(value) {
  return value.endsWith("/") ? value.slice(0, -1) : value
}

function resolveTargetLanguageName(languageCode) {
  return TARGET_LANGUAGE_NAMES[languageCode] ?? languageCode ?? "target language"
}

function replaceDictionaryPromptTokens(prompt, tokens) {
  return prompt
    .replaceAll("{{selection}}", tokens.selection)
    .replaceAll("{{paragraphs}}", tokens.paragraphs)
    .replaceAll("{{targetLanguage}}", tokens.targetLanguage)
}

function replaceContextTranslationPromptTokens(prompt, tokens) {
  return prompt
    .replaceAll("{{selection}}", tokens.selection)
    .replaceAll("{{targetLanguage}}", tokens.targetLanguage)
    .replaceAll("{{sentencesJson}}", tokens.sentencesJson)
}

function formatYamlMultiline(value) {
  return value
    .split("\n")
    .map(line => `    ${line}`)
    .join("\n")
}

function formatStructuredOutputField(field, tokens) {
  const description = replaceDictionaryPromptTokens(field.description, tokens).trim()
  const descriptionBlock = description
    ? `  description: |-\n${formatYamlMultiline(description)}`
    : "  description: \"\""

  return [
    `- key: ${JSON.stringify(field.name)}`,
    `  type: ${field.type}`,
    "  nullable: true",
    descriptionBlock,
  ].join("\n")
}

function buildStructuredOutputContract(tokens) {
  const fieldsAndTypes = DICTIONARY_OUTPUT_SCHEMA
    .map(field => formatStructuredOutputField(field, tokens))
    .join("\n")

  return `## Structured Output Contract
Return exactly one JSON object and nothing else.

### Required Keys and Types
${fieldsAndTypes}

### Hard Requirements
1. Include every required key exactly once.
2. Do not add any extra keys.
3. Use the exact key names shown above.
4. Write keys in the exact order shown above so important fields can stream first.
5. Output valid JSON only. Use double quotes for keys and string values.
6. Do not wrap the JSON in markdown or code fences.
7. If a value is unknown, use null.
8. Number fields must be JSON numbers, never quoted strings.
`
}

function buildDictionaryMessages(item) {
  const targetLanguage = resolveTargetLanguageName(item.targetLang)
  const tokens = {
    selection: String(item.sourceText ?? ""),
    paragraphs: getVocabularyParagraphs(item),
    targetLanguage,
  }
  const systemPrompt = [
    replaceDictionaryPromptTokens(DICTIONARY_SYSTEM_PROMPT, tokens).trim(),
    buildStructuredOutputContract(tokens),
  ].join("\n\n")
  const prompt = replaceDictionaryPromptTokens(DICTIONARY_PROMPT, tokens)

  return [
    {
      role: "system",
      content: systemPrompt,
    },
    {
      role: "user",
      content: prompt,
    },
  ]
}

function buildContextTranslationMessages(item, contextEntries) {
  const targetLanguage = resolveTargetLanguageName(item.targetLang)
  const tokens = {
    selection: String(item.sourceText ?? ""),
    sentencesJson: JSON.stringify(contextEntries.map(entry => entry.sentence), null, 2),
    targetLanguage,
  }
  return [
    {
      role: "system",
      content: replaceContextTranslationPromptTokens(CONTEXT_TRANSLATION_SYSTEM_PROMPT, tokens).trim(),
    },
    {
      role: "user",
      content: replaceContextTranslationPromptTokens(CONTEXT_TRANSLATION_PROMPT, tokens),
    },
  ]
}

function extractChatCompletionContent(payload) {
  const content = payload?.choices?.[0]?.message?.content
  if (typeof content === "string") {
    return content
  }

  if (!Array.isArray(content)) {
    return ""
  }

  return content
    .map(part => typeof part?.text === "string" ? part.text : "")
    .join("")
}

function normalizeDictionaryString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : ""
}

function parseDictionaryWordFamilyGroup(value, limit) {
  const entries = []
  const seenTerms = new Set()

  for (const rawLine of normalizeDictionaryString(value).split("\n")) {
    const line = rawLine.trim()
    if (!line) {
      continue
    }

    const parts = line.split("||").map(part => part.trim())
    const [term = "", middle = "", ...rest] = parts
    const definition = rest.length > 0
      ? rest.join(" || ").trim()
      : middle
    const partOfSpeech = rest.length > 0 ? middle : ""
    if (!term || !definition) {
      continue
    }

    const normalizedTerm = normalizeVocabularyText(term)
    if (seenTerms.has(normalizedTerm)) {
      continue
    }

    seenTerms.add(normalizedTerm)
    entries.push(partOfSpeech ? { term, partOfSpeech, definition } : { term, definition })

    if (entries.length >= limit) {
      break
    }
  }

  return entries
}

function normalizeDictionaryPayload(value) {
  if (!value || typeof value !== "object") {
    return null
  }

  const record = value
  const lemma = normalizeDictionaryString(record.term)
  const contextSentenceTranslation = normalizeDictionaryString(record.contextSentenceTranslation)
  const wordFamily = normalizeWordFamily({
    core: parseDictionaryWordFamilyGroup(record.wordFamilyCore, 3),
    contrast: parseDictionaryWordFamilyGroup(record.wordFamilyContrast, 2),
    related: parseDictionaryWordFamilyGroup(record.wordFamilyRelated, 2),
  })

  return lemma || contextSentenceTranslation || wordFamily
    ? { lemma, contextSentenceTranslation, wordFamily }
    : null
}

function normalizeContextSentence(value) {
  return typeof value === "string" && value.trim() ? value.trim() : ""
}

function normalizeTranslatedContextSentence(value) {
  return typeof value === "string" && value.trim() ? value.trim() : ""
}

function normalizeContextSourceUrl(value) {
  return typeof value === "string" && value.trim() ? value.trim() : ""
}

function normalizeVocabularyContextEntry(entry) {
  const sentence = normalizeContextSentence(entry?.sentence)
  if (!sentence) {
    return null
  }

  const translatedSentence = normalizeTranslatedContextSentence(entry?.translatedSentence)
  const sourceUrl = normalizeContextSourceUrl(entry?.sourceUrl)
  return {
    sentence,
    ...(translatedSentence ? { translatedSentence } : {}),
    ...(sourceUrl ? { sourceUrl } : {}),
  }
}

function getVocabularyContextEntries(item) {
  const entries = []
  const entryBySentence = new Map()
  const addEntry = (entry) => {
    const normalizedEntry = normalizeVocabularyContextEntry(entry)
    if (!normalizedEntry) {
      return
    }

    const existingEntry = entryBySentence.get(normalizedEntry.sentence)
    if (!existingEntry) {
      entries.push(normalizedEntry)
      entryBySentence.set(normalizedEntry.sentence, normalizedEntry)
    }
    else {
      if (!existingEntry.translatedSentence && normalizedEntry.translatedSentence) {
        existingEntry.translatedSentence = normalizedEntry.translatedSentence
      }
      if (!existingEntry.sourceUrl && normalizedEntry.sourceUrl) {
        existingEntry.sourceUrl = normalizedEntry.sourceUrl
      }
    }
  }

  for (const entry of item.contextEntries ?? []) {
    addEntry(entry)
    if (entries.length >= MAX_DICTIONARY_CONTEXT_SENTENCES) {
      return entries
    }
  }

  for (const sentence of item.contextSentences ?? []) {
    addEntry({ sentence })
    if (entries.length >= MAX_DICTIONARY_CONTEXT_SENTENCES) {
      return entries
    }
  }

  addEntry({ sentence: item.contextSentence })
  return entries
}

function getMissingContextTranslationEntries(item) {
  return getVocabularyContextEntries(item)
    .filter(entry => !normalizeTranslatedContextSentence(entry.translatedSentence))
}

function hasMissingContextTranslations(item) {
  return getMissingContextTranslationEntries(item).length > 0
}

function normalizeGeneratedContextTranslations(value) {
  const rawEntries = value instanceof Map
    ? Array.from(value, ([sentence, translatedSentence]) => ({ sentence, translatedSentence }))
    : Array.isArray(value)
      ? value
      : []
  const entries = []
  const seenSentences = new Set()

  for (const entry of rawEntries) {
    const sentence = normalizeContextSentence(entry?.sentence)
    const translatedSentence = normalizeTranslatedContextSentence(entry?.translatedSentence)
    if (!sentence || !translatedSentence || seenSentences.has(sentence)) {
      continue
    }

    seenSentences.add(sentence)
    entries.push({ sentence, translatedSentence })
  }

  return entries
}

function mergeGeneratedContextTranslations(item, generatedContextTranslations) {
  const translations = new Map(
    normalizeGeneratedContextTranslations(generatedContextTranslations)
      .map(entry => [entry.sentence, entry.translatedSentence]),
  )
  if (translations.size === 0) {
    return null
  }

  let changed = false
  const nextEntries = getVocabularyContextEntries(item).map((entry) => {
    if (normalizeTranslatedContextSentence(entry.translatedSentence)) {
      return entry
    }

    const translatedSentence = translations.get(entry.sentence)
    if (!translatedSentence) {
      return entry
    }

    changed = true
    return {
      ...entry,
      translatedSentence,
    }
  })

  return changed ? nextEntries : null
}

function getVocabularyParagraphs(item) {
  const sentences = []
  const addSentence = (sentence) => {
    const normalized = typeof sentence === "string" && sentence.trim() ? sentence.trim() : ""
    if (normalized && !sentences.includes(normalized)) {
      sentences.push(normalized)
    }
  }

  for (const entry of item.contextEntries ?? []) {
    addSentence(entry?.sentence)
    if (sentences.length >= MAX_DICTIONARY_CONTEXT_SENTENCES) {
      break
    }
  }

  for (const sentence of item.contextSentences ?? []) {
    if (sentences.length >= MAX_DICTIONARY_CONTEXT_SENTENCES) {
      break
    }
    addSentence(sentence)
  }

  addSentence(item.contextSentence)
  return sentences.length > 0 ? sentences.join("\n") : String(item.sourceText ?? "")
}

function parseJsonValue(value, fallback) {
  if (typeof value !== "string" || !value.trim()) {
    return fallback
  }

  try {
    return JSON.parse(value)
  }
  catch {
    return fallback
  }
}

function rowToVocabularyItem(row) {
  const wordFamily = normalizeWordFamily(parseJsonValue(row.word_family_json, null))
  const matchTerms = parseJsonValue(row.match_terms_json, [])
  const contextEntries = parseJsonValue(row.context_entries_json, [])
  return {
    id: row.id,
    sourceText: row.source_text,
    normalizedText: row.normalized_text,
    ...(row.context_sentence ? { contextSentence: row.context_sentence } : {}),
    ...(Array.isArray(contextEntries) && contextEntries.length > 0
      ? {
          contextEntries: contextEntries
            .filter(entry => entry && typeof entry === "object" && typeof entry.sentence === "string" && entry.sentence.trim())
            .map(entry => ({
              sentence: entry.sentence,
              ...(typeof entry.translatedSentence === "string" && entry.translatedSentence.trim()
                ? { translatedSentence: entry.translatedSentence }
                : {}),
              ...(typeof entry.sourceUrl === "string" && entry.sourceUrl.trim() ? { sourceUrl: entry.sourceUrl } : {}),
            })),
        }
      : {}),
    ...(row.lemma ? { lemma: row.lemma } : {}),
    matchTerms: Array.isArray(matchTerms) ? matchTerms : [],
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

function sqlString(value) {
  return value == null ? "NULL" : `'${String(value).replaceAll("'", "''")}'`
}

function sqlNumber(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "NULL"
  }

  return String(Math.trunc(value))
}

function buildIdFilter(ids) {
  if (ids.length === 0) {
    return ""
  }

  return `AND id IN (${ids.map(id => sqlString(id)).join(", ")})`
}

function buildMissingContextTranslationExistsSql(itemTableName) {
  return `EXISTS (
    SELECT 1
    FROM vocabulary_item_context_sentences
    WHERE vocabulary_item_context_sentences.vocabulary_item_id = ${itemTableName}.id
      AND TRIM(COALESCE(vocabulary_item_context_sentences.sentence, '')) <> ''
      AND TRIM(COALESCE(vocabulary_item_context_sentences.translated_sentence, '')) = ''
  )`
}

function buildVocabularyRowsSelectSql(options) {
  const deletedFilter = options.includeDeleted ? "" : "AND deleted_at IS NULL"
  const missingWordFamilyCoreOrder = options.generateWordFamily
    ? `
      CASE
        WHEN word_family_json IS NULL THEN 0
        WHEN NOT json_valid(word_family_json) THEN 0
        WHEN COALESCE(json_array_length(json_extract(word_family_json, '$.core')), 0) = 0 THEN 0
        ELSE 1
      END,
    `
    : ""
  const missingContextTranslationOrder = options.backfillContextTranslations
    ? `
      CASE
        WHEN ${buildMissingContextTranslationExistsSql("vocabulary_items")} THEN 0
        ELSE 1
      END,
    `
    : ""
  return `
    SELECT
      id,
      source_text,
      normalized_text,
      context_sentence,
      lemma,
      match_terms_json,
      translated_text,
      phonetic,
      part_of_speech,
      definition,
      difficulty,
      nuance,
      word_family_json,
      source_lang,
      target_lang,
      kind,
      word_count,
      created_at,
      last_seen_at,
      hit_count,
      updated_at,
      deleted_at,
      mastered_at,
      (
        SELECT COALESCE(json_group_array(json_object(
          'sentence', latest_context_sentences.sentence,
          'translatedSentence', latest_context_sentences.translated_sentence,
          'sourceUrl', latest_context_sentences.source_url
        )), '[]')
        FROM (
          SELECT
            sentence,
            translated_sentence,
            source_url
          FROM vocabulary_item_context_sentences AS latest_context_sentences
          WHERE latest_context_sentences.vocabulary_item_id = vocabulary_items.id
          ORDER BY latest_context_sentences.last_seen_at DESC,
                   latest_context_sentences.created_at DESC
          LIMIT ${sqlNumber(MAX_DICTIONARY_CONTEXT_SENTENCES)}
        ) AS latest_context_sentences
      ) AS context_entries_json
    FROM vocabulary_items
    WHERE 1 = 1
      ${deletedFilter}
      ${buildIdFilter(options.ids)}
    ORDER BY ${missingWordFamilyCoreOrder}${missingContextTranslationOrder} updated_at DESC, last_seen_at DESC
    LIMIT ${sqlNumber(options.scanLimit)}
    OFFSET ${sqlNumber(options.offset)}
  `
}

function buildVocabularyStatsSql(options) {
  const deletedFilter = options.includeDeleted ? "" : "AND deleted_at IS NULL"
  return `
    SELECT
      COUNT(*) AS total_items,
      SUM(missing_word_family_core) AS missing_word_family_core,
      SUM(missing_core_match_terms) AS missing_core_match_terms,
      SUM(missing_context_sentence_translation) AS missing_context_sentence_translation,
      SUM(
        CASE
          WHEN missing_word_family_core = 1
            OR missing_core_match_terms = 1
            OR ${options.backfillContextTranslations ? "missing_context_sentence_translation = 1" : "0"}
          THEN 1
          ELSE 0
        END
      ) AS rows_needing_backfill
    FROM (
      SELECT
        id,
        CASE
          WHEN word_family_json IS NULL THEN 1
          WHEN NOT json_valid(word_family_json) THEN 1
          WHEN COALESCE(json_array_length(json_extract(word_family_json, '$.core')), 0) = 0 THEN 1
          ELSE 0
        END AS missing_word_family_core,
        CASE
          WHEN EXISTS (
            SELECT 1
            FROM (
              SELECT
                CASE
                  WHEN json_valid(core_entry.value) THEN CAST(json_extract(core_entry.value, '$.term') AS TEXT)
                  ELSE NULL
                END AS core_term
              FROM json_each(
                CASE
                  WHEN word_family_json IS NOT NULL AND json_valid(word_family_json)
                    THEN COALESCE(json_extract(word_family_json, '$.core'), '[]')
                  ELSE '[]'
                END
              ) AS core_entry
            ) AS core_terms
            WHERE core_terms.core_term IS NOT NULL
              AND trim(core_terms.core_term) <> ''
              AND NOT EXISTS (
                SELECT 1
                FROM json_each(
                  CASE
                    WHEN match_terms_json IS NOT NULL AND json_valid(match_terms_json) THEN match_terms_json
                    ELSE '[]'
                  END
                ) AS match_term
                WHERE lower(trim(CAST(match_term.value AS TEXT))) = lower(trim(core_terms.core_term))
              )
          ) THEN 1
          ELSE 0
        END AS missing_core_match_terms
        ,
        CASE
          WHEN ${buildMissingContextTranslationExistsSql("vocabulary_items")} THEN 1
          ELSE 0
        END AS missing_context_sentence_translation
      FROM vocabulary_items
      WHERE 1 = 1
        ${deletedFilter}
        ${buildIdFilter(options.ids)}
    ) AS vocabulary_stats
  `
}

function extractWranglerResults(stdout) {
  const payload = JSON.parse(stdout)
  const results = Array.isArray(payload) ? payload : [payload]
  const failedResult = results.find(result => !result?.success)
  if (failedResult) {
    throw new Error(`Wrangler D1 command failed: ${stdout}`)
  }

  return results.flatMap(result => result.results ?? [])
}

async function runWranglerD1(options, sql) {
  const args = [
    "-C",
    options.wranglerCwd,
    "exec",
    "wrangler",
    "d1",
    "execute",
    options.database,
    options.local ? "--local" : "--remote",
    "--json",
    "--command",
    sql,
  ]

  let stdout
  try {
    const result = await execFileAsync("pnpm", args, {
      cwd: process.cwd(),
      maxBuffer: 1024 * 1024 * 20,
    })
    stdout = result.stdout
  }
  catch (error) {
    const stderr = typeof error?.stderr === "string" ? error.stderr.trim() : ""
    const failedStdout = typeof error?.stdout === "string" ? error.stdout.trim() : ""
    const details = [stderr, failedStdout].filter(Boolean).join("\n")
    throw new Error(details || (error instanceof Error ? error.message : String(error)))
  }

  return extractWranglerResults(stdout)
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function waitForBackfillDevServer(origin, childProcess, getOutput) {
  const healthUrl = `${origin}/health`
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (childProcess.exitCode !== null) {
      throw new Error(`wrangler dev exited before it was ready.\n${getOutput()}`)
    }

    try {
      const response = await fetch(healthUrl)
      if (response.ok) {
        return
      }
    }
    catch {
      // Keep polling until wrangler finishes binding the local proxy.
    }

    await sleep(500)
  }

  throw new Error(`Timed out waiting for wrangler dev at ${origin}.\n${getOutput()}`)
}

async function startBackfillLlmDevServer(options) {
  const port = options.llmDevPort
  const origin = `http://127.0.0.1:${port}`
  const baseUrl = `${origin}${BACKFILL_LLM_PATH}`
  const args = [
    "-C",
    options.wranglerCwd,
    "exec",
    "wrangler",
    "dev",
    "--remote",
    "--port",
    String(port),
    "--var",
    "LEXIO_BACKFILL_DEV:true",
    "--log-level",
    "error",
  ]
  let output = ""
  const appendOutput = (chunk) => {
    output = `${output}${chunk.toString()}`
    if (output.length > 10_000) {
      output = output.slice(-10_000)
    }
  }
  const childProcess = spawn("pnpm", args, {
    cwd: process.cwd(),
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  })
  childProcess.stdout?.on("data", appendOutput)
  childProcess.stderr?.on("data", appendOutput)
  childProcess.unref()
  childProcess.stdout?.unref()
  childProcess.stderr?.unref()

  logSection("Platform LLM Dev Proxy")
  console.log(`Starting wrangler dev --remote on ${origin}...`)
  try {
    await waitForBackfillDevServer(origin, childProcess, () => output.trim())
  }
  catch (error) {
    if (childProcess.exitCode === null) {
      try {
        if (childProcess.pid) {
          process.kill(-childProcess.pid, "SIGTERM")
        }
        else {
          childProcess.kill("SIGTERM")
        }
      }
      catch {
        childProcess.kill("SIGTERM")
      }
    }
    throw error
  }
  console.log(`Platform LLM endpoint ready: ${baseUrl}`)

  return {
    baseUrl,
    stop() {
      if (childProcess.exitCode !== null) {
        return
      }

      try {
        if (childProcess.pid) {
          process.kill(-childProcess.pid, "SIGTERM")
          return
        }
      }
      catch {
        // Fall through to killing just the direct child process.
      }

      childProcess.kill("SIGTERM")
    },
  }
}

function buildD1Patch(row, before, after, generatedDetails, options) {
  const patch = {}
  const nextMatchTermsJson = JSON.stringify(after.matchTerms ?? [])
  if (nextMatchTermsJson !== (row.match_terms_json ?? "[]")) {
    patch.match_terms_json = nextMatchTermsJson
  }

  if (options.generateWordFamily && generatedDetails?.wordFamily) {
    patch.word_family_json = after.wordFamily ? JSON.stringify(after.wordFamily) : null
  }
  else if (options.normalizeWordFamily && JSON.stringify(after.wordFamily ?? null) !== JSON.stringify(before.wordFamily ?? null)) {
    patch.word_family_json = after.wordFamily ? JSON.stringify(after.wordFamily) : null
  }

  if (options.updateLemma && (after.lemma ?? null) !== (before.lemma ?? null)) {
    patch.lemma = after.lemma ?? null
  }

  if (options.updateNormalizedText && (after.normalizedText ?? null) !== (before.normalizedText ?? null)) {
    patch.normalized_text = after.normalizedText ?? before.normalizedText ?? ""
  }

  if (Object.keys(patch).length > 0) {
    patch.updated_at = Date.now()
  }

  return patch
}

function buildD1ContextTranslationUpdateSqls(rowId, before, after) {
  const beforeEntryBySentence = new Map(
    getVocabularyContextEntries(before).map(entry => [entry.sentence, entry]),
  )
  const timestamp = Date.now()
  const statements = []

  for (const [index, entry] of getVocabularyContextEntries(after).entries()) {
    const translatedSentence = normalizeTranslatedContextSentence(entry.translatedSentence)
    if (!translatedSentence) {
      continue
    }

    const beforeEntry = beforeEntryBySentence.get(entry.sentence)
    if (normalizeTranslatedContextSentence(beforeEntry?.translatedSentence)) {
      continue
    }

    const sourceUrl = normalizeContextSourceUrl(entry.sourceUrl)
    statements.push(`
      INSERT INTO vocabulary_item_context_sentences (
        vocabulary_item_id,
        sentence,
        translated_sentence,
        source_url,
        created_at,
        last_seen_at
      )
      VALUES (
        ${sqlString(rowId)},
        ${sqlString(entry.sentence)},
        ${sqlString(translatedSentence)},
        ${sourceUrl ? sqlString(sourceUrl) : "NULL"},
        ${sqlNumber(timestamp - index)},
        ${sqlNumber(timestamp - index)}
      )
      ON CONFLICT(vocabulary_item_id, sentence) DO UPDATE SET
        translated_sentence = CASE
          WHEN vocabulary_item_context_sentences.translated_sentence IS NULL
            OR TRIM(vocabulary_item_context_sentences.translated_sentence) = ''
          THEN excluded.translated_sentence
          ELSE vocabulary_item_context_sentences.translated_sentence
        END,
        source_url = COALESCE(vocabulary_item_context_sentences.source_url, excluded.source_url),
        last_seen_at = MAX(vocabulary_item_context_sentences.last_seen_at, excluded.last_seen_at);
    `.trim())
  }

  return statements
}

function buildD1UpdateSql(rowId, patch) {
  const assignments = Object.entries(patch).map(([key, value]) => {
    const sqlValue = typeof value === "number" ? sqlNumber(value) : sqlString(value)
    return `${key} = ${sqlValue}`
  })

  if (assignments.length === 0) {
    return ""
  }

  return `UPDATE vocabulary_items SET ${assignments.join(", ")} WHERE id = ${sqlString(rowId)};`
}

function summarizeD1Patch(before, after, patch, contextTranslationUpdateCount = 0) {
  const summary = summarizeChange(before, after)
  const changedFields = new Set(Object.keys(patch).filter(field => field !== "updated_at"))
  if (contextTranslationUpdateCount > 0) {
    changedFields.add("contextEntries")
  }

  return {
    ...summary,
    changedFields: [...changedFields],
  }
}

function formatCount(value) {
  const number = typeof value === "number" ? value : Number(value)
  return Number.isFinite(number) ? number.toLocaleString("en-US") : "0"
}

function formatTerms(terms, limit = 6) {
  if (!terms.length) {
    return "-"
  }

  const visibleTerms = terms.slice(0, limit).join(", ")
  return terms.length > limit ? `${visibleTerms}, ... (+${terms.length - limit})` : visibleTerms
}

function describeMode(options) {
  if (options.input) {
    return options.write ? "input write" : "input dry-run"
  }

  const location = options.local ? "D1 local" : "CF D1 remote"
  return options.write ? `${location} write` : `${location} dry-run`
}

function logSection(title) {
  console.log(`\n== ${title} ==`)
}

function logRunStart(options, aiConfig) {
  logSection("Vocabulary Backfill")
  console.log(`Mode: ${describeMode(options)}`)
  console.log(`Database: ${options.input ? "input file" : options.database}`)
  console.log(`Changed-row limit: ${options.all ? "ALL" : options.limit}`)
  console.log(`Scan limit: ${options.input ? "n/a" : options.scanLimit}`)
  console.log(`Offset: ${options.offset}`)
  console.log(`Generate missing wordFamily.core: ${options.generateWordFamily ? "yes" : "no"}`)
  console.log(`Backfill context sentence translations: ${options.backfillContextTranslations ? "yes" : "no"}`)
  console.log(`LLM concurrency: ${options.concurrency}`)
  if (options.generateWordFamily || options.backfillContextTranslations) {
    console.log(`LLM endpoint: ${aiConfig.platformLlmBaseUrl ?? "temporary wrangler dev --remote proxy"}`)
    console.log(`LLM model: ${aiConfig.platformLlmModel}`)
  }
  if (options.generateWordFamily) {
    console.log(`Word-family generation path: replay built-in dictionary request through platform LLM`)
  }
  if (options.backfillContextTranslations) {
    console.log(`Context translation path: batch missing saved context sentences through platform LLM`)
  }
  console.log(`Write changes: ${options.write ? "yes" : "no"}`)
  if (!options.generateWordFamily && !options.backfillContextTranslations) {
    console.log("Scope: matchTerms only; missing wordFamily.core rows will not be generated in this run.")
  }
  else if (!options.generateWordFamily) {
    console.log("Scope: wordFamily.core generation disabled in this run.")
  }
}

function logD1Stats(stats, title = "Current D1 Gap", options = {}) {
  const row = stats[0] ?? {}
  const missingCoreNote = options.generateWordFamily
    ? ""
    : " (unchanged unless --generate-word-family is used)"
  const missingContextTranslationNote = options.backfillContextTranslations
    ? ""
    : " (unchanged unless --context-translations is used)"
  logSection(title)
  console.log(`Eligible rows: ${formatCount(row.total_items)}`)
  console.log(`Rows missing wordFamily.core: ${formatCount(row.missing_word_family_core)}${missingCoreNote}`)
  console.log(`Rows with wordFamily.core not fully in matchTerms: ${formatCount(row.missing_core_match_terms)}`)
  console.log(`Rows missing context sentence translations: ${formatCount(row.missing_context_sentence_translation)}${missingContextTranslationNote}`)
  console.log(`Rows needing backfill: ${formatCount(row.rows_needing_backfill)}`)
}

function logItemProgress({ index, total, item, generatedDetails, patch, summary }) {
  const label = `${item.sourceText ?? "(empty)"} [${item.id ?? "no-id"}]`
  const prefix = `[${index}/${total}] ${label}`

  if (summary.changedFields.length === 0) {
    const missingReasons = [
      summary.needsWordFamilyCore ? "missing wordFamily.core" : "",
      summary.needsContextTranslations ? "missing context translations" : "",
    ].filter(Boolean)
    console.log(`${prefix}: skip (${missingReasons.join("; ") || "complete"})`)
    return
  }

  const fieldNames = patch
    ? summary.changedFields.join(", ")
    : summary.changedFields.join(", ")
  const generatedContextTranslationCount = normalizeGeneratedContextTranslations(generatedDetails?.contextTranslations).length
  const generatedDetailsText = [
    generatedDetails?.wordFamily ? "generated wordFamily.core" : "",
    generatedContextTranslationCount > 0
      ? `translated ${formatCount(generatedContextTranslationCount)} context sentence(s)`
      : "",
  ].filter(Boolean)
  const generated = generatedDetailsText.length > 0 ? `; ${generatedDetailsText.join("; ")}` : ""
  const addedTerms = summary.addedMatchTerms.length > 0
    ? `; +matchTerms: ${formatTerms(summary.addedMatchTerms)}`
    : ""
  console.log(`${prefix}: queue update (${fieldNames || "metadata"}${generated}${addedTerms})`)
}

function logWordFamilyGenerationStart({ index, total, item }) {
  const label = `${item.sourceText ?? "(empty)"} [${item.id ?? "no-id"}]`
  console.log(`[${index}/${total}] ${label}: generating wordFamily.core...`)
}

function logContextTranslationGenerationStart({ index, total, item, contextEntryCount }) {
  const label = `${item.sourceText ?? "(empty)"} [${item.id ?? "no-id"}]`
  console.log(`[${index}/${total}] ${label}: translating ${formatCount(contextEntryCount)} context sentence(s)...`)
}

function summarizeReports(reports) {
  return {
    changedItems: reports.filter(report => report.changedFields.length > 0).length,
    generatedWordFamily: reports.filter(report => report.generatedWordFamily).length,
    generatedContextTranslations: reports.reduce((total, report) => total + (report.generatedContextTranslations ?? 0), 0),
    rowsWithGeneratedContextTranslations: reports.filter(report => (report.generatedContextTranslations ?? 0) > 0).length,
    missingContextTranslationsAfter: reports.filter(report => report.needsContextTranslations).length,
    missingWordFamilyCoreAfter: reports.filter(report => report.needsWordFamilyCore).length,
    addedMatchTerms: reports.reduce((total, report) => total + report.addedMatchTerms.length, 0),
    rowsWithAddedMatchTerms: reports.filter(report => report.addedMatchTerms.length > 0).length,
  }
}

function logFinalSummary({ reports, scannedRows, updateCount, options, wrote, outputPath }) {
  const summary = summarizeReports(reports)
  const changedCount = updateCount ?? summary.changedItems
  logSection("Summary")
  console.log(`Processed rows: ${formatCount(scannedRows)}`)
  console.log(`Rows needing update in this batch: ${formatCount(changedCount)}`)
  console.log(`Generated wordFamily.core: ${formatCount(summary.generatedWordFamily)}`)
  console.log(`Rows with generated context translations: ${formatCount(summary.rowsWithGeneratedContextTranslations)}`)
  console.log(`Generated context translations: ${formatCount(summary.generatedContextTranslations)}`)
  console.log(`Rows with added matchTerms: ${formatCount(summary.rowsWithAddedMatchTerms)}`)
  console.log(`Added match terms: ${formatCount(summary.addedMatchTerms)}`)
  console.log(`Still missing context translations in processed rows: ${formatCount(summary.missingContextTranslationsAfter)}`)
  console.log(`Still missing wordFamily.core in processed rows: ${formatCount(summary.missingWordFamilyCoreAfter)}`)
  if (outputPath) {
    console.log(`Output file: ${outputPath}`)
  }

  if (changedCount === 0) {
    console.log(`Final state: no changes needed in processed rows`)
  }
  else if (wrote) {
    console.log(`Final state: changes written`)
  }
  else {
    console.log(`Final state: dry-run only, no data changed`)
  }

  if (!wrote && changedCount > 0) {
    const commandHint = options.input
      ? "Re-run with --write to write a patched JSON file."
      : "Re-run with --write to update D1."
    console.log(commandHint)
  }

  if (!options.generateWordFamily && summary.missingWordFamilyCoreAfter > 0) {
    console.log("Note: missing wordFamily.core was not generated because --match-terms-only is set.")
  }
  if (!options.backfillContextTranslations && summary.missingContextTranslationsAfter > 0) {
    console.log("Note: missing context translations were not generated because context translation backfill is disabled.")
  }
}

async function requestPlatformChatCompletion(config, messages, label) {
  const headers = {
    "Content-Type": "application/json",
  }
  if (config.platformToken) {
    headers.Authorization = `Bearer ${config.platformToken}`
  }

  const response = await fetch(`${trimTrailingSlash(config.platformLlmBaseUrl)}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: config.platformLlmModel,
      messages,
      temperature: 0.1,
    }),
  })

  if (!response.ok) {
    throw new Error(`Platform LLM request failed for ${label}: ${response.status} ${await response.text()}`)
  }

  const payload = await response.json()
  const content = extractChatCompletionContent(payload)
  if (!content.trim()) {
    throw new Error(`Platform LLM response missing content for ${label}`)
  }

  return content
}

async function generateWordFamily(item, config) {
  const sourceText = String(item.sourceText ?? "")
  const content = await requestPlatformChatCompletion(
    config,
    buildDictionaryMessages(item),
    sourceText,
  )

  return normalizeDictionaryPayload(JSON.parse(stripJsonFence(content)))
}

function normalizeContextTranslationPayload(value, contextEntries) {
  if (!value || typeof value !== "object" || !Array.isArray(value.translations)) {
    throw new Error("Context translation response must be a JSON object with a translations array.")
  }

  if (value.translations.length !== contextEntries.length) {
    throw new Error(`Context translation response count mismatch: expected ${contextEntries.length}, got ${value.translations.length}.`)
  }

  return contextEntries.map((entry, index) => {
    const translatedSentence = normalizeTranslatedContextSentence(value.translations[index])
    if (!translatedSentence) {
      throw new Error(`Context translation response missing translation at index ${index}.`)
    }

    return {
      sentence: entry.sentence,
      translatedSentence,
    }
  })
}

async function generateContextSentenceTranslations(item, contextEntries, config) {
  if (contextEntries.length === 0) {
    return []
  }

  const sourceText = String(item.sourceText ?? "")
  const content = await requestPlatformChatCompletion(
    config,
    buildContextTranslationMessages(item, contextEntries),
    `${sourceText} context sentences`,
  )

  return normalizeContextTranslationPayload(JSON.parse(stripJsonFence(content)), contextEntries)
}

function printHelp() {
  console.log(`Backfill vocabulary word family data and match terms.

Usage:
  node scripts/backfill-vocabulary-word-family.mjs --limit 2
  node scripts/backfill-vocabulary-word-family.mjs --id voc_1 --write
  node scripts/backfill-vocabulary-word-family.mjs --limit 2 --write
  node scripts/backfill-vocabulary-word-family.mjs --limit 2 --match-terms-only --write
  node scripts/backfill-vocabulary-word-family.mjs --input vocabulary.json
  node scripts/backfill-vocabulary-word-family.mjs --input vocabulary.json --limit 2

Default behavior is remote Cloudflare D1 dry-run, generating missing wordFamily.core, backfilling missing context translations, and limiting to 2 changed rows. Use --write to persist.

Options:
  --database <name>           D1 database name/binding. Default: lexio-platform.
  --local                     Use local D1 instead of remote Cloudflare D1.
  --wrangler-cwd <dir>        Directory containing wrangler config. Default: apps/platform-api.
  --input <file>              Read a JSON array or { vocabularyItems/items } snapshot.
  --output <file>             Write patched JSON when using --write with --input.
  --id <id[,id]>              Only process specific item ids. Repeatable.
  --limit <n>                 Update at most n changed rows unless --all is set. Default: 2.
  --scan-limit <n>            Read at most n candidate rows from D1. Default: max(50, limit * 20).
  --offset <n>                Skip n candidate rows before scanning. Default: 0.
  --all                       Remove the changed-row limit. Use with care.
  --concurrency <n>           Max concurrent LLM-backed item processing. Default: ${DEFAULT_CONCURRENCY}.
  --write                     Persist changes. Without it, dry-run only.
  --generate-word-family      Explicitly enable wordFamily.core generation. This is the default.
  --match-terms-only          Do not generate wordFamily.core; only merge existing core terms into matchTerms.
  --context-translations      Backfill missing context translations even with --match-terms-only.
  --skip-context-translations Do not backfill missing context translations.
  --llm-base-url <url>        Platform LLM base URL. Default: temporary wrangler dev --remote proxy.
  --llm-dev-port <n>          Local port for the temporary wrangler dev proxy. Default: ${DEFAULT_LLM_DEV_PORT}.
  --llm-model <model>         Model sent to the platform LLM endpoint. Default: ${MANAGED_CLOUD_MODEL}.
  --platform-token <token>    Optional platform auth token when calling a protected remote endpoint.
  --include-deleted           Include deleted vocabulary items.
  --normalize-word-family     Rewrite normalized existing word_family_json too.
  --update-lemma              Also write back inferred/generated lemma.
  --update-normalized-text    Also write back normalized_text.
  --help                      Show this help.
`)
}

function parseCli(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      "all": { type: "boolean", default: false },
      "concurrency": { type: "string" },
      "context-translations": { type: "boolean", default: false },
      "database": { type: "string" },
      "generate-word-family": { type: "boolean", default: false },
      "help": { type: "boolean", short: "h", default: false },
      "id": { type: "string", multiple: true, default: [] },
      "include-deleted": { type: "boolean", default: false },
      "input": { type: "string", short: "i" },
      "limit": { type: "string" },
      "llm-base-url": { type: "string" },
      "llm-dev-port": { type: "string" },
      "llm-model": { type: "string" },
      "local": { type: "boolean", default: false },
      "match-terms-only": { type: "boolean", default: false },
      "normalize-word-family": { type: "boolean", default: false },
      "offset": { type: "string" },
      "output": { type: "string", short: "o" },
      "platform-token": { type: "string" },
      "scan-limit": { type: "string" },
      "skip-context-translations": { type: "boolean", default: false },
      "update-lemma": { type: "boolean", default: false },
      "update-normalized-text": { type: "boolean", default: false },
      "wrangler-cwd": { type: "string" },
      "write": { type: "boolean", default: false },
    },
    allowPositionals: false,
  })
  const limit = parseInteger(values.limit, 2)
  const matchTermsOnly = Boolean(values["match-terms-only"])
  if (values["context-translations"] && values["skip-context-translations"]) {
    throw new Error("Use either --context-translations or --skip-context-translations, not both.")
  }

  return {
    all: Boolean(values.all),
    backfillContextTranslations: !values["skip-context-translations"] && (!matchTermsOnly || Boolean(values["context-translations"])),
    concurrency: parsePositiveInteger(values.concurrency, DEFAULT_CONCURRENCY),
    database: values.database ?? "lexio-platform",
    generateWordFamily: !matchTermsOnly || Boolean(values["generate-word-family"]),
    help: Boolean(values.help),
    ids: splitIds(values.id ?? []),
    includeDeleted: Boolean(values["include-deleted"]),
    input: values.input,
    limit,
    platformLlmBaseUrl: values["llm-base-url"] ?? process.env.BACKFILL_PLATFORM_LLM_BASE_URL ?? process.env.PLATFORM_LLM_BASE_URL,
    llmDevPort: parseInteger(values["llm-dev-port"], DEFAULT_LLM_DEV_PORT),
    platformLlmModel: values["llm-model"] ?? process.env.BACKFILL_PLATFORM_LLM_MODEL ?? MANAGED_CLOUD_MODEL,
    platformToken: values["platform-token"] ?? process.env.BACKFILL_PLATFORM_TOKEN,
    local: Boolean(values.local),
    matchTermsOnly,
    normalizeWordFamily: Boolean(values["normalize-word-family"]),
    offset: parseInteger(values.offset, 0),
    output: values.output,
    scanLimit: parseInteger(values["scan-limit"], Math.max(50, limit * 20)),
    updateLemma: Boolean(values["update-lemma"]),
    updateNormalizedText: Boolean(values["update-normalized-text"]),
    wranglerCwd: values["wrangler-cwd"] ?? "apps/platform-api",
    write: Boolean(values.write),
  }
}

function selectCandidateIndexes(items, options) {
  const idSet = new Set(options.ids)
  const eligible = items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => options.includeDeleted || item.deletedAt == null)
    .filter(({ item }) => idSet.size === 0 || idSet.has(String(item.id ?? "")))
  const sortedEligible = options.generateWordFamily || options.backfillContextTranslations
    ? [...eligible].sort((left, right) => {
        const leftMissingCore = options.generateWordFamily && !hasWordFamilyCore(normalizeWordFamily(left.item.wordFamily)) ? 0 : 1
        const rightMissingCore = options.generateWordFamily && !hasWordFamilyCore(normalizeWordFamily(right.item.wordFamily)) ? 0 : 1
        const leftMissingContextTranslation = options.backfillContextTranslations && hasMissingContextTranslations(left.item) ? 0 : 1
        const rightMissingContextTranslation = options.backfillContextTranslations && hasMissingContextTranslations(right.item) ? 0 : 1
        return leftMissingCore - rightMissingCore
          || leftMissingContextTranslation - rightMissingContextTranslation
          || left.index - right.index
      })
    : eligible

  if (idSet.size > 0 || options.all) {
    return sortedEligible.map(entry => entry.index)
  }

  return sortedEligible
    .slice(options.offset, options.offset + options.limit)
    .map(entry => entry.index)
}

async function mapWithConcurrency(values, concurrency, mapper) {
  const results = Array.from({ length: values.length })
  let nextIndex = 0
  const workerCount = Math.min(concurrency, values.length)

  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < values.length) {
      const currentIndex = nextIndex
      nextIndex += 1
      results[currentIndex] = await mapper(values[currentIndex], currentIndex)
    }
  }))

  return results
}

function countGeneratedContextTranslations(generatedDetails) {
  return normalizeGeneratedContextTranslations(generatedDetails?.contextTranslations).length
}

async function generateBackfillDetails({
  aiConfig,
  ensurePlatformLlm,
  index,
  item,
  options,
  total,
}) {
  const normalizedExistingWordFamily = normalizeWordFamily(item.wordFamily)
  const needsWordFamily = options.generateWordFamily && !hasWordFamilyCore(normalizedExistingWordFamily)
  const missingContextTranslationEntries = options.backfillContextTranslations
    ? getMissingContextTranslationEntries(item)
    : []

  if (!needsWordFamily && missingContextTranslationEntries.length === 0) {
    return null
  }

  await ensurePlatformLlm()

  let generatedWordFamilyDetails = null
  if (needsWordFamily) {
    logWordFamilyGenerationStart({
      index,
      total,
      item,
    })
    generatedWordFamilyDetails = await generateWordFamily(item, aiConfig)
  }

  let contextTranslations = []
  if (missingContextTranslationEntries.length > 0) {
    logContextTranslationGenerationStart({
      index,
      total,
      item,
      contextEntryCount: missingContextTranslationEntries.length,
    })
    contextTranslations = await generateContextSentenceTranslations(
      item,
      missingContextTranslationEntries,
      aiConfig,
    )
  }

  return {
    lemma: generatedWordFamilyDetails?.lemma,
    wordFamily: generatedWordFamilyDetails?.wordFamily,
    contextTranslations,
  }
}

async function main() {
  const options = parseCli(process.argv.slice(2))
  if (options.help) {
    printHelp()
    return
  }

  const aiConfig = {
    platformLlmBaseUrl: options.platformLlmBaseUrl,
    platformLlmModel: options.platformLlmModel,
    platformToken: options.platformToken,
  }

  logRunStart(options, aiConfig)

  let llmDevServer = null
  let ensurePlatformLlmPromise = null
  const ensurePlatformLlm = async () => {
    if (aiConfig.platformLlmBaseUrl) {
      return
    }

    ensurePlatformLlmPromise ??= startBackfillLlmDevServer(options)
      .then((server) => {
        llmDevServer = server
        aiConfig.platformLlmBaseUrl = server.baseUrl
        return server
      })
      .catch((error) => {
        ensurePlatformLlmPromise = null
        throw error
      })

    await ensurePlatformLlmPromise
  }

  try {
    if (options.input) {
      const payload = JSON.parse(await readFile(options.input, "utf8"))
      const items = getVocabularyItemsFromPayload(payload)
      const selectedIndexes = selectCandidateIndexes(items, options)
      const nextItems = [...items]
      const reports = []

      logSection("Input Snapshot")
      console.log(`Total items: ${formatCount(items.length)}`)
      console.log(`Selected items: ${formatCount(selectedIndexes.length)}`)
      logSection("Progress")

      const inputResults = await mapWithConcurrency(selectedIndexes, options.concurrency, async (itemIndex, selectedPosition) => {
        const before = items[itemIndex]
        const generatedDetails = await generateBackfillDetails({
          aiConfig,
          ensurePlatformLlm,
          index: selectedPosition + 1,
          item: before,
          options,
          total: selectedIndexes.length,
        })
        const after = createBackfilledVocabularyItem(before, {
          generatedLemma: generatedDetails?.lemma,
          generatedContextTranslations: generatedDetails?.contextTranslations,
          generatedWordFamily: generatedDetails?.wordFamily,
          preserveLemma: !options.updateLemma,
          preserveNormalizedText: !options.updateNormalizedText,
        })
        const summary = summarizeChange(before, after)

        return {
          itemIndex,
          before,
          after,
          generatedDetails,
          summary,
        }
      })

      for (const result of inputResults) {
        nextItems[result.itemIndex] = options.write
          ? { ...result.after, updatedAt: result.summary.changedFields.length > 0 ? Date.now() : result.after.updatedAt }
          : result.after
        logItemProgress({
          index: reports.length + 1,
          total: selectedIndexes.length,
          item: result.before,
          generatedDetails: result.generatedDetails,
          summary: result.summary,
        })
        reports.push({
          id: result.before.id,
          sourceText: result.before.sourceText,
          generatedContextTranslations: countGeneratedContextTranslations(result.generatedDetails),
          generatedWordFamily: Boolean(result.generatedDetails?.wordFamily),
          ...result.summary,
        })
      }

      if (!options.write) {
        logFinalSummary({
          reports,
          scannedRows: selectedIndexes.length,
          updateCount: reports.filter(report => report.changedFields.length > 0).length,
          options,
          wrote: false,
        })
        return
      }

      const nextPayload = setVocabularyItemsInPayload(payload, nextItems)
      const outputPath = options.output ?? resolveOutputPath(options.input)
      await writeFile(outputPath, `${JSON.stringify(nextPayload, null, 2)}\n`)
      logFinalSummary({
        reports,
        scannedRows: selectedIndexes.length,
        updateCount: reports.filter(report => report.changedFields.length > 0).length,
        options,
        wrote: true,
        outputPath,
      })
      return
    }

    const stats = await runWranglerD1(options, buildVocabularyStatsSql(options))
    logD1Stats(stats, "Current D1 Gap", options)
    logSection("Scanning")
    console.log(`Reading up to ${formatCount(options.scanLimit)} row(s) from ${options.local ? "local D1" : "remote CF D1"}...`)
    const rows = await runWranglerD1(options, buildVocabularyRowsSelectSql(options))
    console.log(`Rows loaded: ${formatCount(rows.length)}`)
    logSection("Progress")
    const reports = []
    let updateCount = 0
    let writingSectionLogged = false

    for (let rowOffset = 0; rowOffset < rows.length;) {
      if (!options.all && updateCount >= options.limit) {
        console.log(`Changed-row limit reached (${formatCount(options.limit)}); stopping this batch.`)
        break
      }

      const remainingChangedRows = options.all ? options.concurrency : options.limit - updateCount
      const batchSize = Math.max(1, Math.min(options.concurrency, remainingChangedRows))
      const rowBatch = rows.slice(rowOffset, rowOffset + batchSize)
      const rowResults = await mapWithConcurrency(rowBatch, options.concurrency, async (row, batchIndex) => {
        const before = rowToVocabularyItem(row)
        const generatedDetails = await generateBackfillDetails({
          aiConfig,
          ensurePlatformLlm,
          index: rowOffset + batchIndex + 1,
          item: before,
          options,
          total: rows.length,
        })
        const after = createBackfilledVocabularyItem(before, {
          generatedLemma: generatedDetails?.lemma,
          generatedContextTranslations: generatedDetails?.contextTranslations,
          generatedWordFamily: generatedDetails?.wordFamily,
          preserveLemma: !options.updateLemma,
          preserveNormalizedText: !options.updateNormalizedText,
        })
        const contextTranslationUpdateSqls = buildD1ContextTranslationUpdateSqls(row.id, before, after)
        const patch = buildD1Patch(row, before, after, generatedDetails, options)
        if (contextTranslationUpdateSqls.length > 0 && !patch.updated_at) {
          patch.updated_at = Date.now()
        }
        const itemUpdateSql = buildD1UpdateSql(row.id, patch)
        const updateSql = [
          itemUpdateSql,
          ...contextTranslationUpdateSqls,
        ].filter(Boolean).join("\n")
        const summary = summarizeD1Patch(before, after, patch, contextTranslationUpdateSqls.length)

        return {
          before,
          generatedDetails,
          patch,
          summary,
          updateSql,
        }
      })
      const batchUpdateStatements = []

      for (const result of rowResults) {
        if (result.updateSql) {
          batchUpdateStatements.push(result.updateSql)
        }
        logItemProgress({
          index: reports.length + 1,
          total: rows.length,
          item: result.before,
          generatedDetails: result.generatedDetails,
          patch: result.patch,
          summary: result.summary,
        })
        reports.push({
          id: result.before.id,
          sourceText: result.before.sourceText,
          generatedContextTranslations: countGeneratedContextTranslations(result.generatedDetails),
          generatedWordFamily: Boolean(result.generatedDetails?.wordFamily),
          ...result.summary,
        })
      }

      if (batchUpdateStatements.length > 0) {
        if (options.write) {
          if (!writingSectionLogged) {
            logSection("Writing")
            writingSectionLogged = true
          }
          console.log(`Applying ${formatCount(batchUpdateStatements.length)} update(s) to ${options.local ? "local D1" : "remote CF D1"}...`)
          await runWranglerD1(options, batchUpdateStatements.join("\n"))
        }

        updateCount += batchUpdateStatements.length
      }

      rowOffset += rowBatch.length
    }

    if (!options.write) {
      logFinalSummary({
        reports,
        scannedRows: reports.length,
        updateCount,
        options,
        wrote: false,
      })
      return
    }

    if (updateCount === 0) {
      logFinalSummary({
        reports,
        scannedRows: reports.length,
        updateCount,
        options,
        wrote: true,
      })
      return
    }

    const nextStats = await runWranglerD1(options, buildVocabularyStatsSql(options))
    logD1Stats(nextStats, "D1 Gap After Write", options)
    logFinalSummary({
      reports,
      scannedRows: reports.length,
      updateCount,
      options,
      wrote: true,
    })
  }
  finally {
    llmDevServer?.stop()
  }
}

if (process.argv[1] && process.argv[1].endsWith(join("scripts", "backfill-vocabulary-word-family.mjs"))) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}

export {
  createBackfilledVocabularyItem,
  normalizeVocabularyText,
  normalizeWordFamily,
  summarizeChange,
}
