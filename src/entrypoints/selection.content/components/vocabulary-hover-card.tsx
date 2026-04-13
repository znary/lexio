import type { VocabularyHoverPreview } from "../vocabulary-highlight-ui"
import { useLayoutEffect, useRef, useState } from "react"
import { getVocabularyHoverCardPosition } from "../vocabulary-highlight-ui"

export function VocabularyHoverCard({
  preview,
}: {
  preview: VocabularyHoverPreview | null
}) {
  const cardRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ left: -9999, top: -9999 })

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
      }))
    })

    return () => {
      window.cancelAnimationFrame(frameId)
    }
  }, [preview])

  if (!preview) {
    return null
  }

  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-[2147483647]">
      <div
        ref={cardRef}
        className="pointer-events-none absolute max-w-80 rounded-xl border border-border/70 bg-popover/95 px-3 py-2.5 text-popover-foreground shadow-xl shadow-black/15 ring-1 ring-foreground/8 backdrop-blur-sm"
        style={position}
      >
        <p className="text-sm font-semibold leading-snug break-words [overflow-wrap:anywhere]">
          {preview.item.sourceText}
        </p>
        <p className="mt-2 text-sm leading-snug text-muted-foreground whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
          {preview.item.translatedText}
        </p>
      </div>
    </div>
  )
}
