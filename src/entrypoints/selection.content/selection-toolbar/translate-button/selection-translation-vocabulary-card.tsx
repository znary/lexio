import type { VocabularyCardExtraField, VocabularyCardItem } from "@/components/vocabulary/vocabulary-card-data"
import type { BackgroundStructuredObjectStreamSnapshot, ThinkingSnapshot } from "@/types/background-stream"
import type { SelectionToolbarCustomActionOutputField } from "@/types/config/selection-toolbar"
import type { VocabularyItem, VocabularyWordFamily, VocabularyWordFamilyEntry } from "@/types/vocabulary"
import { i18n } from "#imports"
import { IconLoader2 } from "@tabler/icons-react"
import { Thinking } from "@/components/thinking"
import { VocabularyDetailCard } from "@/components/vocabulary/vocabulary-detail-card"
import { CopyButton } from "../../components/copy-button"
import { SpeakButton } from "../../components/speak-button"

interface DetailedExplanationSection {
  isLoading: boolean
  outputSchema: SelectionToolbarCustomActionOutputField[]
  result: BackgroundStructuredObjectStreamSnapshot["output"] | null
  thinking: ThinkingSnapshot | null
}

interface SelectionTranslationVocabularyCardProps {
  contextSentence?: string | null
  detailedExplanation?: DetailedExplanationSection | null
  isTranslating: boolean
  selectionContent: string | null | undefined
  thinking: ThinkingSnapshot | null
  translatedText: string | undefined
  vocabularyItem?: VocabularyItem | null
}

const DICTIONARY_FIELD_IDS = {
  definition: "dictionary-definition",
  difficulty: "dictionary-difficulty",
  lemma: "dictionary-term",
  nuance: "dictionary-nuance",
  partOfSpeech: "dictionary-part-of-speech",
  phonetic: "dictionary-phonetic",
  wordFamilyContrast: "dictionary-word-family-contrast",
  wordFamilyCore: "dictionary-word-family-core",
  wordFamilyRelated: "dictionary-word-family-related",
} as const

const DICTIONARY_FIELD_ID_SET = new Set<string>(Object.values(DICTIONARY_FIELD_IDS))
const WORD_FAMILY_LINE_BREAK_RE = /\r?\n/

function stringifyFieldValue(value: unknown): string {
  if (value === null || value === undefined) {
    return ""
  }

  return typeof value === "string" ? value.trim() : String(value).trim()
}

function getDictionaryFieldValue(
  result: Record<string, unknown> | null,
  outputSchema: SelectionToolbarCustomActionOutputField[],
  fieldId: string,
): string | null {
  if (!result) {
    return null
  }

  const field = outputSchema.find(field => field.id === fieldId)
  if (!field) {
    return null
  }

  const value = stringifyFieldValue(result[field.name])
  return value || null
}

function parseWordFamilyGroupValue(value: string | null): VocabularyWordFamilyEntry[] {
  if (!value) {
    return []
  }

  return value
    .split(WORD_FAMILY_LINE_BREAK_RE)
    .map((line) => {
      const parts = line.split("||").map(part => part.trim())
      const [term = "", middle = "", ...rest] = parts
      const definition = rest.length > 0
        ? rest.join(" || ").trim()
        : middle
      const partOfSpeech = rest.length > 0 ? middle : ""
      if (!term || !definition) {
        return null
      }

      return partOfSpeech
        ? { term, partOfSpeech, definition }
        : { term, definition }
    })
    .filter((entry): entry is VocabularyWordFamilyEntry => entry !== null)
}

function extractWordFamily(
  result: Record<string, unknown> | null,
  outputSchema: SelectionToolbarCustomActionOutputField[],
): VocabularyWordFamily | undefined {
  const wordFamily = {
    core: parseWordFamilyGroupValue(getDictionaryFieldValue(result, outputSchema, DICTIONARY_FIELD_IDS.wordFamilyCore)),
    contrast: parseWordFamilyGroupValue(getDictionaryFieldValue(result, outputSchema, DICTIONARY_FIELD_IDS.wordFamilyContrast)),
    related: parseWordFamilyGroupValue(getDictionaryFieldValue(result, outputSchema, DICTIONARY_FIELD_IDS.wordFamilyRelated)),
  }

  return wordFamily.core.length > 0 || wordFamily.contrast.length > 0 || wordFamily.related.length > 0
    ? wordFamily
    : undefined
}

function extractDictionaryCardFields(detailedExplanation: DetailedExplanationSection | null | undefined): Partial<VocabularyCardItem> {
  if (!detailedExplanation) {
    return {}
  }

  const { outputSchema, result } = detailedExplanation
  const definition = getDictionaryFieldValue(result, outputSchema, DICTIONARY_FIELD_IDS.definition)
  const difficulty = getDictionaryFieldValue(result, outputSchema, DICTIONARY_FIELD_IDS.difficulty)
  const lemma = getDictionaryFieldValue(result, outputSchema, DICTIONARY_FIELD_IDS.lemma)
  const nuance = getDictionaryFieldValue(result, outputSchema, DICTIONARY_FIELD_IDS.nuance)
  const partOfSpeech = getDictionaryFieldValue(result, outputSchema, DICTIONARY_FIELD_IDS.partOfSpeech)
  const phonetic = getDictionaryFieldValue(result, outputSchema, DICTIONARY_FIELD_IDS.phonetic)
  const wordFamily = extractWordFamily(result, outputSchema)

  return {
    ...(definition ? { definition } : {}),
    ...(difficulty ? { difficulty } : {}),
    ...(lemma ? { lemma } : {}),
    ...(nuance ? { nuance } : {}),
    ...(partOfSpeech ? { partOfSpeech } : {}),
    ...(phonetic ? { phonetic } : {}),
    ...(wordFamily ? { wordFamily } : {}),
  }
}

function extractExtraFields(detailedExplanation: DetailedExplanationSection | null | undefined): VocabularyCardExtraField[] {
  if (!detailedExplanation?.result) {
    return []
  }

  return detailedExplanation.outputSchema
    .filter(field => !field.hidden && !DICTIONARY_FIELD_ID_SET.has(field.id))
    .map((field) => {
      const value = stringifyFieldValue(detailedExplanation.result?.[field.name])
      return value
        ? {
            id: field.id,
            label: field.name,
            value,
          }
        : null
    })
    .filter((field): field is VocabularyCardExtraField => field !== null)
}

function createCardItem({
  contextSentence,
  detailedExplanation,
  selectionContent,
  translatedText,
  vocabularyItem,
}: Pick<SelectionTranslationVocabularyCardProps, "contextSentence" | "detailedExplanation" | "selectionContent" | "translatedText" | "vocabularyItem">): VocabularyCardItem {
  const dictionaryFields = extractDictionaryCardFields(detailedExplanation)
  const sourceText = vocabularyItem?.sourceText?.trim()
    || selectionContent?.trim()
    || translatedText?.trim()
    || "—"
  const normalizedContextSentence = contextSentence?.trim()

  return {
    ...(vocabularyItem ?? {}),
    ...dictionaryFields,
    sourceText,
    translatedText: vocabularyItem?.translatedText?.trim() || translatedText?.trim() || vocabularyItem?.translatedText,
    ...(normalizedContextSentence && !vocabularyItem?.contextEntries?.length
      ? { contextEntries: [{ sentence: normalizedContextSentence }] }
      : {}),
  }
}

function t(key: string): string {
  return i18n.t(key as never)
}

function getCardCopy() {
  return {
    definition: t("action.translationCard.definition"),
    inContext: t("action.translationCard.inContext"),
    mastered: t("action.translationCard.mastered"),
    missingContext: t("action.translationCard.missingContext"),
    moreInformation: t("action.translationCard.moreInformation"),
    practiceNow: t("action.translationCard.practiceNow"),
    translation: i18n.t("action.translation"),
    wordFamily: t("action.translationCard.wordFamily"),
    wordFamilyContrast: t("action.translationCard.wordFamilyContrast"),
    wordFamilyCore: t("action.translationCard.wordFamilyCore"),
    wordFamilyRelated: t("action.translationCard.wordFamilyRelated"),
  }
}

export function SelectionTranslationVocabularyCard({
  contextSentence,
  detailedExplanation = null,
  isTranslating,
  selectionContent,
  thinking,
  translatedText,
  vocabularyItem = null,
}: SelectionTranslationVocabularyCardProps) {
  const cardItem = createCardItem({
    contextSentence,
    detailedExplanation,
    selectionContent,
    translatedText,
    vocabularyItem,
  })
  const extraFields = extractExtraFields(detailedExplanation)
  const isDetailLoading = Boolean(detailedExplanation?.isLoading)
  const hasDefinition = Boolean(cardItem.definition?.trim())
  const sourceText = selectionContent?.trim() || cardItem.sourceText
  const showThinking = thinking && !translatedText
  const showLoadingStatus = isTranslating || isDetailLoading

  const statusPill = showLoadingStatus
    ? (
        <span className="selection-translation-card__status">
          <IconLoader2 className="size-3 animate-spin" strokeWidth={1.8} />
          <span>{i18n.t("translation.loadingStatus.translating")}</span>
        </span>
      )
    : null

  return (
    <div className="selection-translation-card" data-testid="selection-translation-vocabulary-card">
      <VocabularyDetailCard
        variant="popover"
        copy={getCardCopy()}
        item={cardItem}
        extraFields={extraFields}
        headerActions={(
          <>
            {statusPill}
            <CopyButton text={sourceText} />
            <SpeakButton text={sourceText} />
          </>
        )}
        supportingContent={showThinking
          ? <Thinking status={thinking.status} content={thinking.text} />
          : null}
        translationText={translatedText}
        translationLoading={isTranslating && Boolean(translatedText?.trim())}
        showDefinition={hasDefinition}
      />
    </div>
  )
}
