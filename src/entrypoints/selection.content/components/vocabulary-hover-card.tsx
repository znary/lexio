import type { VocabularyHoverPreview } from "../vocabulary-highlight-ui"
import { useAtomValue } from "jotai"
import { useLayoutEffect, useRef, useState } from "react"
import { selectionToolbarRectAtom } from "../selection-toolbar/atoms"
import { getVocabularyHoverCardPosition } from "../vocabulary-highlight-ui"

export function VocabularyHoverCard({
  preview,
}: {
  preview: VocabularyHoverPreview | null
}) {
  const cardRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ left: -9999, top: -9999 })
  const selectionToolbarRect = useAtomValue(selectionToolbarRectAtom)

  useLayoutEffect(() => {
    if (!preview || !cardRef.current) {
      return
    }

    const frameId = window.requestAnimationFrame(() => {
      if (!cardRef.current) {
        return
      }

      setPosition(getVocabularyHoverCardPosition({
        anchorRect: preview.anchorRect,
        cardWidth: cardRef.current.offsetWidth,
        cardHeight: cardRef.current.offsetHeight,
        avoidRect: selectionToolbarRect,
      }))
    })

    return () => {
      window.cancelAnimationFrame(frameId)
    }
  }, [preview, selectionToolbarRect])

  if (!preview) {
    return null
  }

  const meaning = preview.item.definition?.trim() || preview.item.translatedText
  const metadata = [preview.item.partOfSpeech, preview.item.phonetic].filter(Boolean).join(" · ")
  const showLemma = preview.item.lemma && preview.item.lemma !== preview.item.sourceText

  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-[2147483647]">
      <div
        ref={cardRef}
        className="pointer-events-none absolute max-w-80 rounded-xl border border-border/70 bg-popover/95 px-3 py-2.5 text-popover-foreground shadow-xl shadow-black/15 ring-1 ring-foreground/8 backdrop-blur-sm"
        style={position}
      >
        <div className="space-y-1.5">
          <div className="space-y-0.5">
            <p className="text-sm font-medium leading-snug text-popover-foreground whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
              {preview.item.sourceText}
              {showLemma ? ` -> ${preview.item.lemma}` : ""}
            </p>
            {metadata && (
              <p className="text-xs leading-snug text-muted-foreground whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
                {metadata}
              </p>
            )}
          </div>
          <p className="text-sm leading-snug text-popover-foreground whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
            {meaning}
          </p>
          {preview.item.definition?.trim() && preview.item.translatedText !== preview.item.definition && (
            <p className="text-xs leading-snug text-muted-foreground whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
              {preview.item.translatedText}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
