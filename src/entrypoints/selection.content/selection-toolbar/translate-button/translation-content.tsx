import type { SelectionToolbarInlineError } from "../inline-error"
import type { BackgroundStructuredObjectStreamSnapshot, ThinkingSnapshot } from "@/types/background-stream"
import type { SelectionToolbarCustomActionOutputField } from "@/types/config/selection-toolbar"
import { i18n } from "#imports"
import { IconChevronDown, IconLoader2, IconSparkles } from "@tabler/icons-react"
import { Activity } from "react"
import { Thinking } from "@/components/thinking"
import { Button } from "@/components/ui/base-ui/button"
import { cn } from "@/utils/styles/utils"
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
  const detailedExplanationLabel = detailedExplanation?.isExpanded
    ? i18n.t("action.hideDetailedExplanation" as Parameters<typeof i18n.t>[0])
    : i18n.t("action.viewDetailedExplanation" as Parameters<typeof i18n.t>[0])
  const detailedExplanationHint = detailedExplanation?.isExpanded
    ? i18n.t("action.hideDetailedExplanationHint" as Parameters<typeof i18n.t>[0])
    : i18n.t("action.viewDetailedExplanationHint" as Parameters<typeof i18n.t>[0])

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
        <Activity mode={translatedText ? "visible" : "hidden"}>
          <div className="flex items-center gap-1">
            <CopyButton text={translatedText} />
            <SpeakButton text={translatedText} />
          </div>
        </Activity>
        {showDetailedExplanationToggle && (
          <div className="space-y-3 pt-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-label={detailedExplanationLabel}
              aria-expanded={detailedExplanation.isExpanded}
              className={cn(
                "h-auto w-full justify-between rounded-xl border-border/70 bg-muted/25 px-3 py-3 text-left shadow-none transition-all hover:border-border hover:bg-muted/40 active:scale-[0.985]",
                detailedExplanation.isExpanded && "border-primary/30 bg-primary/[0.06] text-foreground shadow-xs",
              )}
              onClick={detailedExplanation.onToggle}
            >
              <span className="flex min-w-0 items-center gap-2">
                <span className={cn(
                  "flex size-7 shrink-0 items-center justify-center rounded-full bg-background/90 text-muted-foreground ring-1 ring-border/60",
                  detailedExplanation.isExpanded && "text-primary ring-primary/25",
                )}
                >
                  <IconSparkles className="size-3.5" strokeWidth={1.8} />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{detailedExplanationLabel}</span>
                  <span className="block text-xs text-muted-foreground">
                    {detailedExplanationHint}
                  </span>
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-2 text-muted-foreground">
                {detailedExplanation.isLoading && <IconLoader2 className="size-3.5 animate-spin" strokeWidth={1.8} />}
                <IconChevronDown
                  className={cn("size-4 transition-transform duration-200", detailedExplanation.isExpanded && "rotate-180")}
                  strokeWidth={1.8}
                />
              </span>
            </Button>

            {detailedExplanation.isExpanded && (
              <div className="rounded-xl border border-border/60 bg-muted/20 px-3 py-3 shadow-xs">
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
      </div>
    </div>
  )
}
