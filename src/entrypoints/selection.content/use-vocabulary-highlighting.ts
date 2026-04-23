import type { VocabularyHighlightAnchorRect, VocabularyHoverPreview } from "./vocabulary-highlight-ui"
import type { VocabularyItem } from "@/types/vocabulary"
import { useAtomValue } from "jotai"
import { useCallback, useEffect, useEffectEvent, useRef, useState } from "react"
import { configFieldsAtomMap } from "@/utils/atoms/config"
import { NOTRANSLATE_CLASS } from "@/utils/constants/dom-labels"
import {
  VOCABULARY_HIGHLIGHT_BOUNDARY_LIMITERS,
  VOCABULARY_HIGHLIGHT_CLASS_NAME,
  VOCABULARY_HIGHLIGHT_ITEM_ID_ATTRIBUTE,
  VOCABULARY_HIGHLIGHT_STYLE_ID,
} from "@/utils/constants/vocabulary"
import { normalizeVocabularyText } from "@/utils/vocabulary/normalization"
import { getVocabularyItems, VOCABULARY_CHANGED_EVENT } from "@/utils/vocabulary/service"
import { SELECTION_CONTENT_OVERLAY_ROOT_ATTRIBUTE } from "./overlay-layers"
import {
  createVocabularyHighlightStyle,
  isPointInVocabularyHoverArea,
  toVocabularyHighlightAnchorRect,
  VOCABULARY_HOVER_CARD_ATTRIBUTE,
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
const HIGHLIGHT_EXCLUDE_SELECTOR = HIGHLIGHT_EXCLUDE_SELECTORS.join(", ")
const HIGHLIGHT_MARK_SELECTOR = `mark.${VOCABULARY_HIGHLIGHT_CLASS_NAME}[${VOCABULARY_HIGHLIGHT_ITEM_ID_ATTRIBUTE}]`
const HIGHLIGHT_RESCAN_DELAY_MS = 400

type PendingHighlightWork = "full" | "incremental"

interface ActiveHoverHighlight {
  element: HTMLElement
  itemId: string
}

interface VocabularyHighlightingState {
  handleHoverCardPointerEnter: () => void
  handleHoverCardPointerLeave: () => void
  hoverPreview: VocabularyHoverPreview | null
  setHoverCardRect: (rect: VocabularyHighlightAnchorRect | null) => void
}

const HOVER_PREVIEW_HIDE_DELAY = 120
const HOVER_CARD_MEASURE_GRACE_MS = 160

export function shouldHighlightAcrossElements(item: Pick<VocabularyItem, "kind" | "wordCount">) {
  return item.kind === "phrase" || item.wordCount > 1
}

function isSameRect(left: VocabularyHighlightAnchorRect, right: VocabularyHighlightAnchorRect) {
  return left.top === right.top
    && left.right === right.right
    && left.bottom === right.bottom
    && left.left === right.left
    && left.width === right.width
    && left.height === right.height
}

function getHoverCardElement(target: EventTarget | null) {
  if (!(target instanceof Node)) {
    return null
  }

  const baseElement = target instanceof HTMLElement ? target : target.parentElement
  return baseElement?.closest(`[${VOCABULARY_HOVER_CARD_ATTRIBUTE}]`) as HTMLElement | null
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

function getVocabularyHighlightTerms(item: VocabularyItem): string[] {
  const normalizedTerms = (item.matchTerms?.length ? item.matchTerms : [item.sourceText])
    .map(term => normalizeVocabularyText(term))
    .filter(Boolean)

  return [...new Set(normalizedTerms)].sort((left, right) => right.length - left.length)
}

function getActiveVocabularyItems(items: VocabularyItem[]): VocabularyItem[] {
  return items
    .filter(item => item.deletedAt == null && item.masteredAt == null && item.sourceText.trim())
    .sort((left, right) => {
      const leftLongestTerm = getVocabularyHighlightTerms(left)[0]?.length ?? left.sourceText.length
      const rightLongestTerm = getVocabularyHighlightTerms(right)[0]?.length ?? right.sourceText.length
      return rightLongestTerm - leftLongestTerm
    })
}

function markVocabularyTerm(
  markInstance: import("mark.js").default,
  item: VocabularyItem,
  term: string,
): Promise<void> {
  return new Promise((resolve) => {
    markInstance.mark(term, {
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
    for (const term of getVocabularyHighlightTerms(item)) {
      await markVocabularyTerm(markInstance, item, term)
    }
  }
}

function getHighlightElement(target: EventTarget | null) {
  if (!(target instanceof Node)) {
    return null
  }

  const baseElement = target instanceof HTMLElement ? target : target.parentElement
  return baseElement?.closest(`mark.${VOCABULARY_HIGHLIGHT_CLASS_NAME}[${VOCABULARY_HIGHLIGHT_ITEM_ID_ATTRIBUTE}]`) as HTMLElement | null
}

function isElementExcludedFromHighlighting(element: HTMLElement) {
  return !!element.closest(`${HIGHLIGHT_EXCLUDE_SELECTOR}, ${HIGHLIGHT_MARK_SELECTOR}`)
}

function addHighlightRoot(roots: HTMLElement[], candidate: HTMLElement | null) {
  if (!candidate || !candidate.isConnected || !candidate.textContent?.trim()) {
    return
  }

  if (isElementExcludedFromHighlighting(candidate)) {
    return
  }

  if (roots.some(root => root === candidate || root.contains(candidate))) {
    return
  }

  for (let index = roots.length - 1; index >= 0; index -= 1) {
    if (candidate.contains(roots[index])) {
      roots.splice(index, 1)
    }
  }

  roots.push(candidate)
}

function collectMutationHighlightRoots(records: MutationRecord[]) {
  const roots: HTMLElement[] = []

  for (const record of records) {
    if (record.type !== "childList") {
      continue
    }

    record.addedNodes.forEach((node) => {
      if (node instanceof HTMLElement) {
        addHighlightRoot(roots, node)
        return
      }

      if (node instanceof Text) {
        addHighlightRoot(roots, node.parentElement)
      }
    })
  }

  return roots
}

function clearActiveSelection() {
  const selection = window.getSelection()
  if (!selection || selection.toString().trim() === "") {
    return
  }

  selection.removeAllRanges()
}

export function useVocabularyHighlighting(): VocabularyHighlightingState {
  const vocabulary = useAtomValue(configFieldsAtomMap.vocabulary)
  const [hoverPreview, setHoverPreview] = useState<VocabularyHoverPreview | null>(null)
  const itemsByIdRef = useRef(new Map<string, VocabularyItem>())
  const hoverHighlightRef = useRef<ActiveHoverHighlight | null>(null)
  const hoverPreviewRef = useRef<VocabularyHoverPreview | null>(null)
  const hoverCardRectRef = useRef<VocabularyHighlightAnchorRect | null>(null)
  const isPointerInsideHoverCardRef = useRef(false)
  const hoverOpenedAtRef = useRef(0)
  const hideHoverTimerRef = useRef<number | null>(null)

  const clearHideHoverTimer = useCallback(() => {
    if (hideHoverTimerRef.current !== null) {
      window.clearTimeout(hideHoverTimerRef.current)
      hideHoverTimerRef.current = null
    }
  }, [])

  const hideHoverPreview = useCallback(() => {
    clearHideHoverTimer()
    hoverHighlightRef.current = null
    hoverPreviewRef.current = null
    hoverCardRectRef.current = null
    isPointerInsideHoverCardRef.current = false
    setHoverPreview(null)
  }, [clearHideHoverTimer])

  const setHoverCardRect = useCallback((rect: VocabularyHighlightAnchorRect | null) => {
    hoverCardRectRef.current = rect
  }, [])

  const handleHoverCardPointerEnter = useCallback(() => {
    isPointerInsideHoverCardRef.current = true
    clearHideHoverTimer()
  }, [clearHideHoverTimer])

  const updateHoverPreview = useEffectEvent((nextPreview: VocabularyHoverPreview) => {
    hoverPreviewRef.current = nextPreview
    setHoverPreview((currentPreview) => {
      if (
        currentPreview
        && currentPreview.item.id === nextPreview.item.id
        && isSameRect(currentPreview.anchorRect, nextPreview.anchorRect)
      ) {
        return currentPreview
      }

      return nextPreview
    })
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

    updateHoverPreview({
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

    const previousHighlight = hoverHighlightRef.current
    const isSameHighlight = previousHighlight?.element === element && previousHighlight.itemId === itemId

    clearHideHoverTimer()
    hoverHighlightRef.current = {
      element,
      itemId,
    }
    isPointerInsideHoverCardRef.current = false

    if (!isSameHighlight) {
      hoverOpenedAtRef.current = window.performance.now()
      hoverCardRectRef.current = null
    }

    updateHoverPreview({
      item,
      anchorRect: toVocabularyHighlightAnchorRect(element.getBoundingClientRect()),
    })
  })

  const scheduleHideHoverPreview = useCallback(() => {
    clearHideHoverTimer()
    hideHoverTimerRef.current = window.setTimeout(() => {
      hideHoverTimerRef.current = null
      hideHoverPreview()
    }, HOVER_PREVIEW_HIDE_DELAY)
  }, [clearHideHoverTimer, hideHoverPreview])

  const handleHoverCardPointerLeave = useCallback(() => {
    isPointerInsideHoverCardRef.current = false
    scheduleHideHoverPreview()
  }, [scheduleHideHoverPreview])

  const isPointerInsideActiveHoverArea = useEffectEvent((event: PointerEvent) => {
    const activePreview = hoverPreviewRef.current
    const activeItemId = hoverHighlightRef.current?.itemId
    if (!activePreview || !activeItemId) {
      return false
    }

    if (isPointerInsideHoverCardRef.current) {
      return true
    }

    const hoveredHighlight = getHighlightElement(event.target)
    const hoveredItemId = hoveredHighlight?.getAttribute(VOCABULARY_HIGHLIGHT_ITEM_ID_ATTRIBUTE)
    if (hoveredItemId === activeItemId) {
      return true
    }

    if (getHoverCardElement(event.target)) {
      return true
    }

    if (
      hoverCardRectRef.current == null
      && window.performance.now() - hoverOpenedAtRef.current <= HOVER_CARD_MEASURE_GRACE_MS
    ) {
      return true
    }

    return isPointInVocabularyHoverArea({
      point: {
        x: event.clientX,
        y: event.clientY,
      },
      anchorRect: activePreview.anchorRect,
      cardRect: hoverCardRectRef.current,
    })
  })

  useEffect(() => {
    let disposed = false
    let isApplyingHighlights = false
    let observer: MutationObserver | null = null
    let rehighlightTimer: number | null = null
    let pendingWork: PendingHighlightWork | null = null
    const pendingMutationRoots = new Set<HTMLElement>()
    let activeItemsCache: VocabularyItem[] = []
    let hasAppliedInitialHighlights = false

    const scheduleHighlight = (work: PendingHighlightWork, delay = HIGHLIGHT_RESCAN_DELAY_MS) => {
      pendingWork = work
      if (rehighlightTimer) {
        window.clearTimeout(rehighlightTimer)
      }

      rehighlightTimer = window.setTimeout(() => {
        rehighlightTimer = null
        const nextWork = pendingWork
        pendingWork = null

        if (nextWork === "full") {
          pendingMutationRoots.clear()
          void applyFullHighlights()
          return
        }

        const roots = [...pendingMutationRoots]
        pendingMutationRoots.clear()
        void applyIncrementalHighlights(roots)
      }, delay)
    }

    const queueHighlight = () => {
      scheduleHighlight("full")
    }

    async function applyFullHighlights() {
      if (disposed || !document.body || isApplyingHighlights) {
        return
      }

      isApplyingHighlights = true

      try {
        const [{ default: Mark }, items] = await Promise.all([
          import("mark.js"),
          vocabulary.highlightEnabled ? getVocabularyItems() : Promise.resolve([] as VocabularyItem[]),
        ])

        if (disposed) {
          return
        }

        const markInstance = new Mark(document.body)
        await unmark(markInstance)

        const activeItems = vocabulary.highlightEnabled ? getActiveVocabularyItems(items) : []
        activeItemsCache = activeItems

        itemsByIdRef.current = new Map(activeItems.map(item => [item.id, item]))

        if (!vocabulary.highlightEnabled || activeItems.length === 0) {
          hideHoverPreview()
          return
        }

        if (!hasAppliedInitialHighlights) {
          clearActiveSelection()
        }

        ensureHighlightStyle(vocabulary.highlightColor)
        await markTerms(markInstance, activeItems)
        hasAppliedInitialHighlights = true
        refreshHoverPreview()
      }
      finally {
        isApplyingHighlights = false
      }
    }

    async function applyIncrementalHighlights(roots: HTMLElement[]) {
      if (disposed || !document.body || isApplyingHighlights || !vocabulary.highlightEnabled || roots.length === 0) {
        return
      }

      if (activeItemsCache.length === 0) {
        return
      }

      isApplyingHighlights = true

      try {
        const { default: Mark } = await import("mark.js")

        if (disposed) {
          return
        }

        for (const root of roots) {
          if (!root.isConnected || !root.textContent?.trim() || isElementExcludedFromHighlighting(root)) {
            continue
          }

          const markInstance = new Mark(root)
          await unmark(markInstance)
          await markTerms(markInstance, activeItemsCache)
        }

        refreshHoverPreview()
      }
      finally {
        isApplyingHighlights = false
      }
    }

    const handlePointerMove = (event: PointerEvent) => {
      const target = getHighlightElement(event.target)
      if (target) {
        showHoverPreview(target)
        return
      }

      if (!hoverPreviewRef.current) {
        return
      }

      if (isPointerInsideActiveHoverArea(event)) {
        clearHideHoverTimer()
        refreshHoverPreview()
        return
      }

      scheduleHideHoverPreview()
    }

    const handlePointerOver = (event: PointerEvent) => {
      const target = getHighlightElement(event.target)
      if (target) {
        showHoverPreview(target)
        return
      }

      if (!hoverPreviewRef.current) {
        return
      }

      if (isPointerInsideActiveHoverArea(event)) {
        clearHideHoverTimer()
      }
    }

    const handlePointerLeave = () => {
      scheduleHideHoverPreview()
    }

    observer = new MutationObserver((records) => {
      if (isApplyingHighlights || !vocabulary.highlightEnabled) {
        return
      }

      const nextRoots = collectMutationHighlightRoots(records)
      if (nextRoots.length === 0) {
        return
      }

      nextRoots.forEach(root => pendingMutationRoots.add(root))
      scheduleHighlight("incremental")
    })

    if (document.body) {
      observer.observe(document.body, {
        childList: true,
        subtree: true,
      })
    }

    const handleVocabularyChanged = () => {
      scheduleHighlight("full", 0)
    }

    document.addEventListener("pointerover", handlePointerOver, true)
    document.addEventListener("pointermove", handlePointerMove, true)
    document.addEventListener("pointerleave", handlePointerLeave, true)
    document.addEventListener(VOCABULARY_CHANGED_EVENT, handleVocabularyChanged)
    window.addEventListener("hashchange", queueHighlight)
    window.addEventListener("popstate", queueHighlight)
    window.addEventListener("blur", hideHoverPreview)
    window.addEventListener("resize", refreshHoverPreview)
    window.addEventListener("scroll", refreshHoverPreview, true)
    void applyFullHighlights()

    return () => {
      disposed = true
      clearHideHoverTimer()
      if (rehighlightTimer) {
        window.clearTimeout(rehighlightTimer)
      }
      observer?.disconnect()
      document.removeEventListener("pointerover", handlePointerOver, true)
      document.removeEventListener("pointermove", handlePointerMove, true)
      document.removeEventListener("pointerleave", handlePointerLeave, true)
      document.removeEventListener(VOCABULARY_CHANGED_EVENT, handleVocabularyChanged)
      window.removeEventListener("hashchange", queueHighlight)
      window.removeEventListener("popstate", queueHighlight)
      window.removeEventListener("blur", hideHoverPreview)
      window.removeEventListener("resize", refreshHoverPreview)
      window.removeEventListener("scroll", refreshHoverPreview, true)
      hoverHighlightRef.current = null
      hoverPreviewRef.current = null
      hoverCardRectRef.current = null
      setHoverPreview(null)
    }
  }, [
    clearHideHoverTimer,
    hideHoverPreview,
    scheduleHideHoverPreview,
    vocabulary.highlightColor,
    vocabulary.highlightEnabled,
  ])

  return {
    handleHoverCardPointerEnter,
    handleHoverCardPointerLeave,
    hoverPreview,
    setHoverCardRect,
  }
}

export { VOCABULARY_HOVER_CARD_ATTRIBUTE }
