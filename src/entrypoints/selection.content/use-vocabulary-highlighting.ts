import type { VocabularyHoverPreview } from "./vocabulary-highlight-ui"
import type { VocabularyItem } from "@/types/vocabulary"
import { useAtomValue } from "jotai"
import { useEffect, useEffectEvent, useRef, useState } from "react"
import { configFieldsAtomMap } from "@/utils/atoms/config"
import { NOTRANSLATE_CLASS } from "@/utils/constants/dom-labels"
import {
  VOCABULARY_HIGHLIGHT_BOUNDARY_LIMITERS,
  VOCABULARY_HIGHLIGHT_CLASS_NAME,
  VOCABULARY_HIGHLIGHT_ITEM_ID_ATTRIBUTE,
  VOCABULARY_HIGHLIGHT_STYLE_ID,
} from "@/utils/constants/vocabulary"
import { getVocabularyItems, VOCABULARY_CHANGED_EVENT } from "@/utils/vocabulary/service"
import { SELECTION_CONTENT_OVERLAY_ROOT_ATTRIBUTE } from "./overlay-layers"
import {
  createVocabularyHighlightStyle,
  toVocabularyHighlightAnchorRect,
} from "./vocabulary-highlight-ui"

const HIGHLIGHT_EXCLUDE_SELECTORS = [
  `[${SELECTION_CONTENT_OVERLAY_ROOT_ATTRIBUTE}]`,
  `.${NOTRANSLATE_CLASS}`,
  "input",
  "textarea",
  "select",
  "option",
  "code",
  "pre",
  "script",
  "style",
  "[contenteditable='']",
  "[contenteditable='true']",
  ".read-frog-translated-content-wrapper",
  "[data-read-frog-host-toast]",
]

interface ActiveHoverHighlight {
  element: HTMLElement
  itemId: string
}

export function shouldHighlightAcrossElements(item: Pick<VocabularyItem, "kind" | "wordCount">) {
  return item.kind === "phrase" || item.wordCount > 1
}

function ensureHighlightStyle(color: string) {
  let styleElement = document.getElementById(VOCABULARY_HIGHLIGHT_STYLE_ID) as HTMLStyleElement | null

  if (!styleElement) {
    styleElement = document.createElement("style")
    styleElement.id = VOCABULARY_HIGHLIGHT_STYLE_ID
    document.head.append(styleElement)
  }

  styleElement.textContent = createVocabularyHighlightStyle(color)
}

function unmark(markInstance: import("mark.js").default): Promise<void> {
  return new Promise((resolve) => {
    markInstance.unmark({
      className: VOCABULARY_HIGHLIGHT_CLASS_NAME,
      done: resolve,
    })
  })
}

function markVocabularyItem(
  markInstance: import("mark.js").default,
  item: VocabularyItem,
): Promise<void> {
  return new Promise((resolve) => {
    markInstance.mark(item.sourceText.trim(), {
      acrossElements: shouldHighlightAcrossElements(item),
      accuracy: {
        value: "exactly",
        limiters: VOCABULARY_HIGHLIGHT_BOUNDARY_LIMITERS,
      },
      caseSensitive: false,
      className: VOCABULARY_HIGHLIGHT_CLASS_NAME,
      each: (element) => {
        element.classList.add(NOTRANSLATE_CLASS)
        element.setAttribute(VOCABULARY_HIGHLIGHT_ITEM_ID_ATTRIBUTE, item.id)
      },
      exclude: HIGHLIGHT_EXCLUDE_SELECTORS,
      ignoreJoiners: true,
      separateWordSearch: false,
      done: resolve,
    })
  })
}

async function markTerms(
  markInstance: import("mark.js").default,
  items: VocabularyItem[],
) {
  for (const item of items) {
    await markVocabularyItem(markInstance, item)
  }
}

function getHighlightElement(target: EventTarget | null) {
  if (!(target instanceof Node)) {
    return null
  }

  const baseElement = target instanceof HTMLElement ? target : target.parentElement
  return baseElement?.closest(`mark.${VOCABULARY_HIGHLIGHT_CLASS_NAME}[${VOCABULARY_HIGHLIGHT_ITEM_ID_ATTRIBUTE}]`) as HTMLElement | null
}

export function useVocabularyHighlighting() {
  const vocabulary = useAtomValue(configFieldsAtomMap.vocabulary)
  const [hoverPreview, setHoverPreview] = useState<VocabularyHoverPreview | null>(null)
  const itemsByIdRef = useRef(new Map<string, VocabularyItem>())
  const hoverHighlightRef = useRef<ActiveHoverHighlight | null>(null)
  const hideHoverTimerRef = useRef<number | null>(null)

  const clearHideHoverTimer = () => {
    if (hideHoverTimerRef.current !== null) {
      window.clearTimeout(hideHoverTimerRef.current)
      hideHoverTimerRef.current = null
    }
  }

  const hideHoverPreview = useEffectEvent(() => {
    clearHideHoverTimer()
    hoverHighlightRef.current = null
    setHoverPreview(null)
  })

  const refreshHoverPreview = useEffectEvent(() => {
    const activeHighlight = hoverHighlightRef.current
    if (!activeHighlight) {
      return
    }

    if (!activeHighlight.element.isConnected) {
      hideHoverPreview()
      return
    }

    const item = itemsByIdRef.current.get(activeHighlight.itemId)
    if (!item || !item.translatedText.trim()) {
      hideHoverPreview()
      return
    }

    setHoverPreview({
      item,
      anchorRect: toVocabularyHighlightAnchorRect(activeHighlight.element.getBoundingClientRect()),
    })
  })

  const showHoverPreview = useEffectEvent((element: HTMLElement) => {
    const itemId = element.getAttribute(VOCABULARY_HIGHLIGHT_ITEM_ID_ATTRIBUTE)
    if (!itemId) {
      return
    }

    const item = itemsByIdRef.current.get(itemId)
    if (!item || !item.translatedText.trim()) {
      return
    }

    clearHideHoverTimer()
    hoverHighlightRef.current = {
      element,
      itemId,
    }

    setHoverPreview({
      item,
      anchorRect: toVocabularyHighlightAnchorRect(element.getBoundingClientRect()),
    })
  })

  const scheduleHideHoverPreview = useEffectEvent(() => {
    clearHideHoverTimer()
    hideHoverTimerRef.current = window.setTimeout(() => {
      hideHoverTimerRef.current = null
      hideHoverPreview()
    }, 60)
  })

  useEffect(() => {
    let disposed = false
    let isApplyingHighlights = false
    let markInstance: import("mark.js").default | null = null
    let observer: MutationObserver | null = null
    let rehighlightTimer: number | null = null

    const scheduleHighlight = (delay = 400) => {
      if (rehighlightTimer) {
        window.clearTimeout(rehighlightTimer)
      }

      rehighlightTimer = window.setTimeout(() => {
        rehighlightTimer = null
        void applyHighlights()
      }, delay)
    }

    const queueHighlight = () => {
      scheduleHighlight()
    }

    async function applyHighlights() {
      if (disposed || !document.body || isApplyingHighlights) {
        return
      }

      isApplyingHighlights = true

      try {
        const [{ default: Mark }, items] = await Promise.all([
          import("mark.js"),
          getVocabularyItems(),
        ])

        if (disposed) {
          return
        }

        markInstance ??= new Mark(document.body)
        await unmark(markInstance)

        const activeItems = items
          .filter(item => item.deletedAt == null && item.sourceText.trim())
          .sort((left, right) => right.sourceText.length - left.sourceText.length)

        itemsByIdRef.current = new Map(activeItems.map(item => [item.id, item]))

        if (!vocabulary.highlightEnabled || activeItems.length === 0) {
          hideHoverPreview()
          return
        }

        ensureHighlightStyle(vocabulary.highlightColor)
        await markTerms(markInstance, activeItems)
        refreshHoverPreview()
      }
      finally {
        isApplyingHighlights = false
      }
    }

    const handleHighlightClick = (event: MouseEvent) => {
      const target = getHighlightElement(event.target)
      if (!target) {
        return
      }

      event.preventDefault()
      event.stopPropagation()

      const range = document.createRange()
      range.selectNodeContents(target)

      const selection = window.getSelection()
      selection?.removeAllRanges()
      selection?.addRange(range)

      document.dispatchEvent(new MouseEvent("mouseup", {
        bubbles: true,
        cancelable: true,
        clientX: event.clientX,
        clientY: event.clientY,
        view: window,
      }))
    }

    const handleHighlightMouseOver = (event: MouseEvent) => {
      const target = getHighlightElement(event.target)
      if (!target) {
        return
      }

      showHoverPreview(target)
    }

    const handleHighlightMouseOut = (event: MouseEvent) => {
      const target = getHighlightElement(event.target)
      if (!target) {
        return
      }

      const nextTarget = getHighlightElement(event.relatedTarget)
      if (nextTarget === target) {
        return
      }

      const targetItemId = target.getAttribute(VOCABULARY_HIGHLIGHT_ITEM_ID_ATTRIBUTE)
      const nextItemId = nextTarget?.getAttribute(VOCABULARY_HIGHLIGHT_ITEM_ID_ATTRIBUTE)
      if (targetItemId && targetItemId === nextItemId) {
        return
      }

      scheduleHideHoverPreview()
    }

    observer = new MutationObserver(() => {
      if (isApplyingHighlights) {
        return
      }
      scheduleHighlight()
    })

    if (document.body) {
      observer.observe(document.body, {
        childList: true,
        subtree: true,
      })
    }

    const handleVocabularyChanged = () => {
      scheduleHighlight(0)
    }

    document.addEventListener("click", handleHighlightClick, true)
    document.addEventListener("mouseover", handleHighlightMouseOver, true)
    document.addEventListener("mouseout", handleHighlightMouseOut, true)
    document.addEventListener(VOCABULARY_CHANGED_EVENT, handleVocabularyChanged)
    window.addEventListener("hashchange", queueHighlight)
    window.addEventListener("popstate", queueHighlight)
    window.addEventListener("resize", refreshHoverPreview)
    window.addEventListener("scroll", refreshHoverPreview, true)
    void applyHighlights()

    return () => {
      disposed = true
      clearHideHoverTimer()
      if (rehighlightTimer) {
        window.clearTimeout(rehighlightTimer)
      }
      observer?.disconnect()
      document.removeEventListener("click", handleHighlightClick, true)
      document.removeEventListener("mouseover", handleHighlightMouseOver, true)
      document.removeEventListener("mouseout", handleHighlightMouseOut, true)
      document.removeEventListener(VOCABULARY_CHANGED_EVENT, handleVocabularyChanged)
      window.removeEventListener("hashchange", queueHighlight)
      window.removeEventListener("popstate", queueHighlight)
      window.removeEventListener("resize", refreshHoverPreview)
      window.removeEventListener("scroll", refreshHoverPreview, true)
      hoverHighlightRef.current = null
      setHoverPreview(null)
    }
  }, [vocabulary.highlightColor, vocabulary.highlightEnabled])

  return hoverPreview
}
