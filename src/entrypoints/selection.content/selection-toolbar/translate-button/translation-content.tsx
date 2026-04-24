import type { BackgroundStructuredObjectStreamSnapshot } from "@/types/background-stream"
import type { SelectionToolbarCustomActionOutputField } from "@/types/config/selection-toolbar"
import type { VocabularyItem } from "@/types/vocabulary"
import { SelectionTranslationVocabularyCard } from "./selection-translation-vocabulary-card"

interface DetailedExplanationSection {
  isLoading: boolean
  outputSchema: SelectionToolbarCustomActionOutputField[]
  result: BackgroundStructuredObjectStreamSnapshot["output"] | null
}

interface TranslationContentProps {
  contextSentence?: string | null
  detailedExplanation?: DetailedExplanationSection | null
  selectionContent: string | null | undefined
  translatedText: string | undefined
  isTranslating: boolean
  vocabularyItem?: VocabularyItem | null
}

export function TranslationContent({
  contextSentence,
  detailedExplanation = null,
  selectionContent,
  translatedText,
  isTranslating,
  vocabularyItem = null,
}: TranslationContentProps) {
  return (
    <SelectionTranslationVocabularyCard
      contextSentence={contextSentence}
      detailedExplanation={detailedExplanation}
      selectionContent={selectionContent}
      translatedText={translatedText}
      isTranslating={isTranslating}
      vocabularyItem={vocabularyItem}
    />
  )
}
