import type { SelectionToolbarInlineError } from "../inline-error"
import type { BackgroundStructuredObjectStreamSnapshot, ThinkingSnapshot } from "@/types/background-stream"
import type { SelectionToolbarCustomActionOutputField } from "@/types/config/selection-toolbar"
import { i18n } from "#imports"
import { IconLoader2 } from "@tabler/icons-react"
import { Activity } from "react"
import { Thinking } from "@/components/thinking"
import { Button } from "@/components/ui/base-ui/button"
import { CopyButton } from "../../components/copy-button"
import { SelectionSourceContent } from "../../components/selection-source-content"
import { SelectionToolbarErrorAlert } from "../../components/selection-toolbar-error-alert"
import { SpeakButton } from "../../components/speak-button"
import { StructuredObjectRenderer } from "../custom-action-button/structured-object-renderer"

interface DetailedExplanationSection {
  error: SelectionToolbarInlineError | null
  isExpanded: boolean
  isLoading: boolean
  onToggle: () => void
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
  const showDetailedExplanationToggle = detailedExplanation && translatedText?.trim()

  return (
    <div className="p-4">
      <SelectionSourceContent text={selectionContent} separatorClassName="mb-3" />
      <div className="space-y-2">
        {thinking && (
          <Thinking status={thinking.status} content={thinking.text} />
        )}
        <p className="text-sm whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
          {showLoadingIndicator && <IconLoader2 className="inline size-4 animate-spin" strokeWidth={1.6} />}
          {translatedText}
          {showStreamingIndicator && " ●"}
        </p>
        {showDetailedExplanationToggle && (
          <div className="space-y-3 pt-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-auto justify-start px-0 text-sm"
              onClick={detailedExplanation.onToggle}
            >
              {detailedExplanation.isExpanded
                ? i18n.t("action.hideDetailedExplanation" as Parameters<typeof i18n.t>[0])
                : i18n.t("action.viewDetailedExplanation" as Parameters<typeof i18n.t>[0])}
              {detailedExplanation.isLoading && <IconLoader2 className="size-3.5 animate-spin" strokeWidth={1.8} />}
            </Button>

            {detailedExplanation.isExpanded && (
              <div className="rounded-xl border bg-muted/20 px-3 py-3">
                <StructuredObjectRenderer
                  outputSchema={detailedExplanation.outputSchema}
                  value={detailedExplanation.result}
                  isStreaming={detailedExplanation.isLoading}
                  thinking={detailedExplanation.thinking}
                />
                <SelectionToolbarErrorAlert error={detailedExplanation.error} className="px-0 pb-0 pt-3" />
              </div>
            )}
          </div>
        )}
        <Activity mode={translatedText ? "visible" : "hidden"}>
          <div className="flex items-center gap-1">
            <CopyButton text={translatedText} />
            <SpeakButton text={translatedText} />
          </div>
        </Activity>
      </div>
    </div>
  )
}
