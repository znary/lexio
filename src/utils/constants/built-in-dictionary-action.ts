import type { SelectionToolbarCustomAction } from "@/types/config/selection-toolbar"
import { i18n } from "#imports"
import { createOutputSchemaField, DEFAULT_DICTIONARY_ACTION_ID } from "./custom-action"

const T_PREFIX = "options.floatingButtonAndToolbar.selectionToolbar.customActions.templates.dictionary"

const BUILT_IN_DICTIONARY_LABEL_KEYS = {
  "dictionary-term": `${T_PREFIX}.fieldTerm`,
  "dictionary-phonetic": `${T_PREFIX}.fieldPhonetic`,
  "dictionary-part-of-speech": `${T_PREFIX}.fieldPartOfSpeech`,
  "dictionary-definition": `${T_PREFIX}.fieldDefinition`,
  "dictionary-difficulty": `${T_PREFIX}.fieldDifficulty`,
} as const

const BUILT_IN_DICTIONARY_FIELD_NAMES = {
  term: "term",
  phonetic: "phonetic",
  partOfSpeech: "partOfSpeech",
  definition: "definition",
  difficulty: "difficulty",
  contextSentenceTranslation: "contextSentenceTranslation",
  nuance: "nuance",
  wordFamilyCore: "wordFamilyCore",
  wordFamilyContrast: "wordFamilyContrast",
  wordFamilyRelated: "wordFamilyRelated",
} as const

const BUILT_IN_DICTIONARY_SYSTEM_PROMPT = `You are a dictionary assistant for language learners.

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
10. Return wordFamilyCore, wordFamilyContrast, and wordFamilyRelated as newline-separated strings, in this exact group order: Core, Contrast, Related.
11. Each line in a word family field must use exactly this format: term || partOfSpeech || definition
12. For a word, these fields contain close word-family items. For a phrase, these fields contain nearby expressions that a learner may confuse or use in the same context.
13. wordFamilyCore should contain up to 3 close entries. wordFamilyContrast should contain up to 2 contrasting entries. wordFamilyRelated should contain up to 2 related entries. Keep the line order inside each group as the intended display order.
14. If a field is unknown or a group has no natural entries, return null instead of guessing.
15. Keep every value compact and useful for learners.
16. Do not translate or rewrite the JSON keys.`

const BUILT_IN_DICTIONARY_PROMPT = `## Input
Selected text: {{selection}}
Paragraphs: {{paragraphs}}
Target language: {{targetLanguage}}`
const MAX_BUILT_IN_DICTIONARY_WORDS = 8
const MAX_BUILT_IN_DICTIONARY_LENGTH = 80
const DICTIONARY_WORD_SEPARATOR_RE = /\s+/
const SENTENCE_PUNCTUATION_RE = /[.?!,;:。！？，；：]/

function countDictionaryWords(value: string) {
  return value.split(DICTIONARY_WORD_SEPARATOR_RE).filter(Boolean).length
}

export function shouldUseBuiltInDictionary(selectionText: string | null | undefined) {
  const value = selectionText?.trim() ?? ""

  if (!value) {
    return false
  }

  if (value.length > MAX_BUILT_IN_DICTIONARY_LENGTH) {
    return false
  }

  if (countDictionaryWords(value) > MAX_BUILT_IN_DICTIONARY_WORDS) {
    return false
  }

  if (SENTENCE_PUNCTUATION_RE.test(value)) {
    return false
  }

  return true
}

export function createBuiltInDictionaryAction(providerId: string): SelectionToolbarCustomAction {
  return {
    id: DEFAULT_DICTIONARY_ACTION_ID,
    name: i18n.t(`${T_PREFIX}.name`),
    enabled: true,
    icon: "tabler:book-2",
    providerId,
    systemPrompt: BUILT_IN_DICTIONARY_SYSTEM_PROMPT,
    prompt: BUILT_IN_DICTIONARY_PROMPT,
    outputSchema: createBuiltInDictionaryOutputSchema(),
  }
}

export function createBuiltInDictionaryOutputSchema() {
  return [
    createOutputSchemaField(
      BUILT_IN_DICTIONARY_FIELD_NAMES.definition,
      "string",
      `${i18n.t(`${T_PREFIX}.fieldDefinitionDescription`)} Answer this field in {{targetLanguage}}.`,
      "dictionary-definition",
    ),
    {
      ...createOutputSchemaField(
        BUILT_IN_DICTIONARY_FIELD_NAMES.contextSentenceTranslation,
        "string",
        "Translate the sentence that contains the selected text into {{targetLanguage}}. Return only that sentence translation.",
        "dictionary-context-sentence-translation",
      ),
      hidden: true,
    },
    createOutputSchemaField(
      BUILT_IN_DICTIONARY_FIELD_NAMES.term,
      "string",
      `${i18n.t(`${T_PREFIX}.fieldTermDescription`)} Keep this field in the source language of the selected text.`,
      "dictionary-term",
      true,
    ),
    createOutputSchemaField(
      BUILT_IN_DICTIONARY_FIELD_NAMES.partOfSpeech,
      "string",
      `${i18n.t(`${T_PREFIX}.fieldPartOfSpeechDescription`)} Keep this field in English.`,
      "dictionary-part-of-speech",
    ),
    createOutputSchemaField(
      BUILT_IN_DICTIONARY_FIELD_NAMES.phonetic,
      "string",
      `${i18n.t(`${T_PREFIX}.fieldPhoneticDescription`)} This is for the source-language lemma.`,
      "dictionary-phonetic",
    ),
    createOutputSchemaField(
      BUILT_IN_DICTIONARY_FIELD_NAMES.difficulty,
      "string",
      `${i18n.t(`${T_PREFIX}.fieldDifficultyDescription`)} This difficulty is for the source-language lemma.`,
      "dictionary-difficulty",
    ),
    {
      ...createOutputSchemaField(
        BUILT_IN_DICTIONARY_FIELD_NAMES.nuance,
        "string",
        "One short nuance note in {{targetLanguage}} for the contextual sense.",
        "dictionary-nuance",
      ),
      hidden: true,
    },
    {
      ...createOutputSchemaField(
        BUILT_IN_DICTIONARY_FIELD_NAMES.wordFamilyCore,
        "string",
        "Up to 3 close word-family items or nearby phrase expressions. Use one line per item in the format: term || partOfSpeech || definition. Answer definitions in {{targetLanguage}}.",
        "dictionary-word-family-core",
      ),
      hidden: true,
    },
    {
      ...createOutputSchemaField(
        BUILT_IN_DICTIONARY_FIELD_NAMES.wordFamilyContrast,
        "string",
        "Up to 2 contrasting items. Use one line per item in the format: term || partOfSpeech || definition. Answer definitions in {{targetLanguage}}.",
        "dictionary-word-family-contrast",
      ),
      hidden: true,
    },
    {
      ...createOutputSchemaField(
        BUILT_IN_DICTIONARY_FIELD_NAMES.wordFamilyRelated,
        "string",
        "Up to 2 related word-family items or nearby phrase expressions. Use one line per item in the format: term || partOfSpeech || definition. Answer definitions in {{targetLanguage}}.",
        "dictionary-word-family-related",
      ),
      hidden: true,
    },
  ]
}

export function getBuiltInDictionaryFieldLabel(fieldId: string, fallback: string) {
  const key = BUILT_IN_DICTIONARY_LABEL_KEYS[fieldId as keyof typeof BUILT_IN_DICTIONARY_LABEL_KEYS]
  return key ? i18n.t(key) : fallback
}
