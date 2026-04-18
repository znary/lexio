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
} as const

const BUILT_IN_DICTIONARY_SYSTEM_PROMPT = `You are a dictionary assistant for language learners.

Return one compact dictionary entry for the selected text based on the surrounding paragraphs.

Field rules:
1. Focus on the meaning that best matches the surrounding paragraphs.
2. Return the lemma in the source language of the selected text.
3. Return the phonetic transcription for that source-language lemma.
4. Return the part of speech in English, such as noun, verb, or adjective.
5. Return the definition in {{targetLanguage}}, based on the contextual sense.
6. Return the CEFR difficulty for the source-language lemma using only A1, A2, B1, B2, C1, or C2.
7. If a field is unknown, return null instead of guessing.
8. Keep every value compact and useful for learners.
9. Do not translate or rewrite the JSON keys.`

const BUILT_IN_DICTIONARY_PROMPT = `## Input
Selected text: {{selection}}
Paragraphs: {{paragraphs}}
Target language: {{targetLanguage}}`
const WHITESPACE_RE = /\s/
const SENTENCE_PUNCTUATION_RE = /[.?!,;:。！？，；：]/

export function shouldUseBuiltInDictionary(selectionText: string | null | undefined) {
  const value = selectionText?.trim() ?? ""

  if (!value) {
    return false
  }

  if (value.length > 40) {
    return false
  }

  if (WHITESPACE_RE.test(value)) {
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
    outputSchema: [
      createOutputSchemaField(
        BUILT_IN_DICTIONARY_FIELD_NAMES.term,
        "string",
        `${i18n.t(`${T_PREFIX}.fieldTermDescription`)} Keep this field in the source language of the selected text.`,
        "dictionary-term",
        true,
      ),
      createOutputSchemaField(
        BUILT_IN_DICTIONARY_FIELD_NAMES.phonetic,
        "string",
        `${i18n.t(`${T_PREFIX}.fieldPhoneticDescription`)} This is for the source-language lemma.`,
        "dictionary-phonetic",
      ),
      createOutputSchemaField(
        BUILT_IN_DICTIONARY_FIELD_NAMES.partOfSpeech,
        "string",
        `${i18n.t(`${T_PREFIX}.fieldPartOfSpeechDescription`)} Keep this field in English.`,
        "dictionary-part-of-speech",
      ),
      createOutputSchemaField(
        BUILT_IN_DICTIONARY_FIELD_NAMES.definition,
        "string",
        `${i18n.t(`${T_PREFIX}.fieldDefinitionDescription`)} Answer this field in {{targetLanguage}}.`,
        "dictionary-definition",
      ),
      createOutputSchemaField(
        BUILT_IN_DICTIONARY_FIELD_NAMES.difficulty,
        "string",
        `${i18n.t(`${T_PREFIX}.fieldDifficultyDescription`)} This difficulty is for the source-language lemma.`,
        "dictionary-difficulty",
      ),
    ],
  }
}

export function getBuiltInDictionaryFieldLabel(fieldId: string, fallback: string) {
  const key = BUILT_IN_DICTIONARY_LABEL_KEYS[fieldId as keyof typeof BUILT_IN_DICTIONARY_LABEL_KEYS]
  return key ? i18n.t(key) : fallback
}
