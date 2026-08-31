import type { VocabularyItem } from "@/types/vocabulary"
import { useAtomValue } from "jotai"
import { useCallback, useEffect, useState } from "react"
import { Toaster } from "sonner"
import { configFieldsAtomMap } from "@/utils/atoms/config"
import { VocabularyDetailPopover } from "./components/vocabulary-detail-popover"
import { VocabularyHoverCard } from "./components/vocabulary-hover-card"
import { useInputTranslation } from "./input-translation"
import {
  SELECTION_CONTENT_OVERLAY_LAYERS,
  SELECTION_CONTENT_OVERLAY_ROOT_ATTRIBUTE,
} from "./overlay-layers"
import { SelectionToolbar } from "./selection-toolbar"
import { SelectionCustomActionProvider } from "./selection-toolbar/custom-action-button/provider"
import { SelectionExplainProvider } from "./selection-toolbar/explain-button/provider"
import { SelectionTranslationProvider } from "./selection-toolbar/translate-button/provider"
import { useVocabularyHighlighting } from "./use-vocabulary-highlighting"

export default function App({
  uiContainer,
}: {
  uiContainer: HTMLElement
}) {
  useInputTranslation()
  const {
    hideHoverPreview,
    hoverPreview,
    setHoverCardRect,
    handleHoverCardPointerEnter,
    handleHoverCardPointerLeave,
  } = useVocabularyHighlighting()
  const opacity = useAtomValue(configFieldsAtomMap.selectionToolbar).opacity / 100
  const [detailItem, setDetailItem] = useState<VocabularyItem | null>(null)
  const [detailAnchor, setDetailAnchor] = useState<{ x: number, y: number } | null>(null)

  const handleOpenDetail = useCallback((item: VocabularyItem, anchor: { x: number, y: number }) => {
    setDetailItem(item)
    setDetailAnchor(anchor)
    hideHoverPreview()
  }, [hideHoverPreview])

  const handleCloseDetail = useCallback(() => {
    setDetailItem(null)
    setDetailAnchor(null)
    hideHoverPreview()
  }, [hideHoverPreview])

  const handleDetailOpenChange = useCallback((open: boolean) => {
    if (!open) {
      handleCloseDetail()
    }
  }, [handleCloseDetail])

  useEffect(() => {
    uiContainer.style.setProperty("--rf-selection-opacity", String(opacity))

    return () => {
      uiContainer.style.removeProperty("--rf-selection-opacity")
    }
  }, [opacity, uiContainer])

  return (
    <>
      <SelectionTranslationProvider>
        <SelectionExplainProvider>
          <SelectionCustomActionProvider>
            <SelectionToolbar />
          </SelectionCustomActionProvider>
        </SelectionExplainProvider>
      </SelectionTranslationProvider>
      <VocabularyHoverCard
        preview={detailItem ? null : hoverPreview}
        onCardRectChange={setHoverCardRect}
        onOpenDetail={handleOpenDetail}
        onPointerEnter={handleHoverCardPointerEnter}
        onPointerLeave={handleHoverCardPointerLeave}
      />
      <VocabularyDetailPopover
        anchor={detailAnchor}
        item={detailItem}
        onOpenChange={handleDetailOpenChange}
      />
      <Toaster
        richColors
        className={`${SELECTION_CONTENT_OVERLAY_LAYERS.selectionOverlay} notranslate`}
        {...{ [SELECTION_CONTENT_OVERLAY_ROOT_ATTRIBUTE]: "" }}
      />
    </>
  )
}
