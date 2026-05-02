import type { VocabularyHighlightAnchorRect, VocabularyHoverPreview } from "../vocabulary-highlight-ui"
import { i18n } from "#imports"
import { useAtomValue } from "jotai"
import { useLayoutEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { VocabularyMasteryToggleButton } from "@/components/vocabulary/mastery-toggle-button"
import { setVocabularyItemMastered } from "@/utils/vocabulary/service"
import { SELECTION_CONTENT_OVERLAY_ROOT_ATTRIBUTE } from "../overlay-layers"
import { selectionToolbarRectAtom } from "../selection-toolbar/atoms"
import {
  getVocabularyHoverCardPosition,
  VOCABULARY_HOVER_CARD_ATTRIBUTE,
} from "../vocabulary-highlight-ui"

export function VocabularyHoverCard({
  preview,
  onCardRectChange,
  onPointerEnter,
  onPointerLeave,
}: {
  onCardRectChange?: (rect: VocabularyHighlightAnchorRect | null) => void
  onPointerEnter?: () => void
  onPointerLeave?: () => void
  preview: VocabularyHoverPreview | null
}) {
  const cardRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ left: -9999, top: -9999 })
  const [markingMastered, setMarkingMastered] = useState(false)
  const selectionToolbarRect = useAtomValue(selectionToolbarRectAtom)

  useLayoutEffect(() => {
    onCardRectChange?.(null)

    if (!preview || !cardRef.current) {
      return
    }

    const frameId = window.requestAnimationFrame(() => {
      if (!cardRef.current) {
        return
      }

      const cardWidth = cardRef.current.offsetWidth
      const cardHeight = cardRef.current.offsetHeight
      const cardPosition = getVocabularyHoverCardPosition({
        anchorRect: preview.anchorRect,
        cardWidth,
        cardHeight,
        avoidRect: selectionToolbarRect,
      })

      setPosition(cardPosition)
      onCardRectChange?.({
        left: cardPosition.left,
        top: cardPosition.top,
        right: cardPosition.left + cardWidth,
        bottom: cardPosition.top + cardHeight,
        width: cardWidth,
        height: cardHeight,
      })
    })

    return () => {
      window.cancelAnimationFrame(frameId)
      onCardRectChange?.(null)
    }
  }, [onCardRectChange, preview, selectionToolbarRect])

  if (!preview) {
    return null
  }

  const meaning = preview.item.definition?.trim() || preview.item.translatedText
  const showLemma = preview.item.lemma && preview.item.lemma !== preview.item.sourceText
  const metadata = [preview.item.partOfSpeech, preview.item.phonetic].filter(Boolean).join(" · ")
  const sourceLabel = i18n.t("options.vocabulary.hoverCard.source")
  const rootLabel = i18n.t("options.vocabulary.hoverCard.root")
  const meaningLabel = i18n.t("options.vocabulary.hoverCard.meaning")
  const detailLabel = i18n.t("options.vocabulary.hoverCard.details")
  const isMastered = preview.item.masteredAt != null
  const masteryLabel = i18n.t(
    (isMastered
      ? "options.vocabulary.hoverCard.unmarkMastered"
      : "options.vocabulary.hoverCard.markMastered") as never,
  )
  const previewItemId = preview.item.id

  async function handleMarkMastered() {
    if (markingMastered) {
      return
    }

    try {
      setMarkingMastered(true)
      await setVocabularyItemMastered(previewItemId, !isMastered)
    }
    catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    }
    finally {
      setMarkingMastered(false)
    }
  }

  return (
    <div
      className="pointer-events-none fixed inset-0 z-[2147483647]"
      {...{ [SELECTION_CONTENT_OVERLAY_ROOT_ATTRIBUTE]: "" }}
    >
      <div
        ref={cardRef}
        {...{ [VOCABULARY_HOVER_CARD_ATTRIBUTE]: "" }}
        className="pointer-events-auto absolute flex max-w-80 flex-col gap-2.5 rounded-xl border border-border/70 bg-popover/95 px-3 py-2.5 text-popover-foreground shadow-xl shadow-black/15 ring-1 ring-foreground/8 backdrop-blur-sm"
        onPointerEnter={onPointerEnter}
        onPointerLeave={onPointerLeave}
        style={position}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1 space-y-1.5">
            <p className="text-sm font-medium leading-snug text-popover-foreground whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
              {`${sourceLabel}：${preview.item.sourceText}`}
            </p>
            {showLemma && (
              <p className="text-xs leading-snug text-muted-foreground whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
                {`${rootLabel}：${preview.item.lemma}`}
              </p>
            )}
            {metadata && (
              <p className="text-xs leading-snug text-muted-foreground whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
                {`${detailLabel}：${metadata}`}
              </p>
            )}
            <p className="text-sm leading-snug text-popover-foreground whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
              {`${meaningLabel}：${meaning}`}
            </p>
          </div>

          <VocabularyMasteryToggleButton
            className="mt-0.5 rounded-full self-start"
            label={masteryLabel}
            mastered={isMastered}
            pending={markingMastered}
            onClick={() => {
              void handleMarkMastered()
            }}
          />
        </div>
      </div>
    </div>
  )
}
