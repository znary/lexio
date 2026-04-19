import type { SelectionToolbarCustomAction } from "@/types/config/selection-toolbar"
import { i18n } from "#imports"
import { createOutputSchemaField, DEFAULT_EXPLAIN_ACTION_ID } from "./custom-action"

const T_PREFIX = "options.floatingButtonAndToolbar.selectionToolbar.explain"

const EXPLAIN_FIELD_LABELS = {
  "explain-meaning": "Meaning",
  "explain-why": "Why it matters",
  "explain-tip": "Learner tip",
} as const

const EXPLAIN_FIELD_NAMES = {
  meaning: "meaning",
  why: "why",
  tip: "tip",
} as const

const BUILT_IN_EXPLAIN_SYSTEM_PROMPT = `You are a patient language teacher.

Explain the selected text in a learner-friendly way.

Rules:
1. Focus on the selected text in its surrounding paragraphs.
2. Keep the explanation practical and short enough to read quickly.
3. Use the user's target language for every explanation field.
4. If the selection is ambiguous, explain the most likely meaning in context.
5. Do not add markdown, bullet points, or extra keys outside the output schema.
6. If a field is unknown or not helpful, return an empty string.
7. Do not translate or rewrite the JSON keys.`

const BUILT_IN_EXPLAIN_PROMPT = `## Input
Selected text: {{selection}}
Paragraphs: {{paragraphs}}
Target language: {{targetLanguage}}
Webpage title: {{webTitle}}
Webpage content: {{webContent}}`

export function createBuiltInExplainAction(providerId: string): SelectionToolbarCustomAction {
  return {
    id: DEFAULT_EXPLAIN_ACTION_ID,
    name: i18n.t(`${T_PREFIX}.name`),
    enabled: true,
    icon: "tabler:message-question",
    providerId,
    systemPrompt: BUILT_IN_EXPLAIN_SYSTEM_PROMPT,
    prompt: BUILT_IN_EXPLAIN_PROMPT,
    outputSchema: createBuiltInExplainOutputSchema(),
  }
}

export function createBuiltInExplainOutputSchema() {
  return [
    createOutputSchemaField(
      EXPLAIN_FIELD_NAMES.meaning,
      "string",
      `${i18n.t(`${T_PREFIX}.fieldMeaningDescription`)} Keep it short and learner-friendly.`,
      "explain-meaning",
    ),
    createOutputSchemaField(
      EXPLAIN_FIELD_NAMES.why,
      "string",
      `${i18n.t(`${T_PREFIX}.fieldWhyDescription`)} Focus on the wording, grammar, or nuance that matters in context.`,
      "explain-why",
    ),
    createOutputSchemaField(
      EXPLAIN_FIELD_NAMES.tip,
      "string",
      `${i18n.t(`${T_PREFIX}.fieldTipDescription`)} Give one practical note the learner can reuse later.`,
      "explain-tip",
    ),
  ]
}

export function getBuiltInExplainFieldLabel(fieldId: string, fallback: string) {
  return EXPLAIN_FIELD_LABELS[fieldId as keyof typeof EXPLAIN_FIELD_LABELS] ?? fallback
}
