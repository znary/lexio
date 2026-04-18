import type { SelectionToolbarInlineError } from "../inline-error"
import type { BackgroundStructuredObjectStreamSnapshot, ThinkingSnapshot } from "@/types/background-stream"
import type { SelectionToolbarCustomActionOutputField } from "@/types/config/selection-toolbar"
import { i18n } from "#imports"
import { IconLoader2 } from "@tabler/icons-react"
import { Thinking } from "@/components/thinking"
import { SelectionSourceContent } from "../../components/selection-source-content"
import { SelectionToolbarErrorAlert } from "../../components/selection-toolbar-error-alert"
import { StructuredObjectRenderer } from "../custom-action-button/structured-object-renderer"

interface DetailedExplanationSection {
  error: SelectionToolbarInlineError | null
  isLoading: boolean
  outputSchema: SelectionToolbarCustomActionOutputField[]
  result: BackgroundStructuredObjectStreamSnapshot["output"] | null
  thinking: ThinkingSnapshot | null
}

interface TranslationContentProps {
  detailedExplanation?: DetailedExplanationSection | null
  selectionContent: string | null | undefined
  translatedText: string | undefined
  isTranslating: boolean
  thinking: ThinkingSnapshot | null
}

export function TranslationContent({
  detailedExplanation = null,
  selectionContent,
  translatedText,
  isTranslating,
  thinking,
}: TranslationContentProps) {
  const showLoadingIndicator = isTranslating && !thinking && !translatedText
  const showStreamingIndicator = isTranslating && !thinking && translatedText
  const showDetailedExplanation = Boolean(detailedExplanation)
  const showTranslatedItem = Boolean(translatedText?.trim()) || isTranslating

  return (
    <div className="p-4">
      <SelectionSourceContent text={selectionContent} separatorClassName="mb-3" />
      <div className="space-y-4">
        {thinking && !showDetailedExplanation && (
          <Thinking status={thinking.status} content={thinking.text} />
        )}
        {showTranslatedItem && (
          <div className="space-y-1.5">
            <div className="flex items-center gap-1 min-h-6">
              <div className="inline-flex min-w-0 items-center gap-0.5 text-xs font-medium text-muted-foreground">
                <span className="truncate">{i18n.t("action.translation")}</span>
              </div>
            </div>
            <p className="text-sm whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
              {showLoadingIndicator && <IconLoader2 className="inline size-4 animate-spin" strokeWidth={1.6} />}
              {translatedText}
              {showStreamingIndicator && " ●"}
            </p>
          </div>
        )}
        {showDetailedExplanation && detailedExplanation && (
          <div className="space-y-2">
            <StructuredObjectRenderer
              outputSchema={detailedExplanation.outputSchema}
              value={detailedExplanation.result}
              isStreaming={detailedExplanation.isLoading}
              showThinking={false}
              thinking={detailedExplanation.thinking}
            />
            <SelectionToolbarErrorAlert error={detailedExplanation.error} className="px-0 pb-0" />
          </div>
        )}
      </div>
    </div>
  )
}
