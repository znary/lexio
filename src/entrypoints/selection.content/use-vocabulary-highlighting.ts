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
const HIGHLIGHT_MARK_SELECTOR = `mark.${VOCABULARY_HIGHLIGHT_CLASS_NAME}[${VOCABULARY_HIGHLIGHT_ITEM_ID_ATTRIBUTE}]`
const HIGHLIGHT_RESCAN_DELAY_MS = 400
const HIGHLIGHT_BATCH_TERM_LIMIT = 48
const HIGHLIGHT_BATCH_PATTERN_LENGTH_LIMIT = 2400
const REGEXP_SPECIAL_CHAR_RE = /[.*+?^${}()|[\]\\]/g
const CHAR_CLASS_SPECIAL_CHAR_RE = /[\\\]-]/g

interface HighlightBatch {
  acrossElements: boolean
  itemByTerm: Map<string, VocabularyItem>
  regex: RegExp
}

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

function getHighlightSignature(item: VocabularyItem): string {
  return JSON.stringify({
    kind: item.kind,
    matchTerms: getVocabularyHighlightTerms(item),
    sourceText: item.sourceText,
    wordCount: item.wordCount,
  })
}

function doHighlightTermsConflict(leftTerms: string[], rightTerms: string[]): boolean {
  return leftTerms.some(leftTerm =>
    rightTerms.some(rightTerm =>
      leftTerm === rightTerm
      || leftTerm.includes(rightTerm)
      || rightTerm.includes(leftTerm),
    ),
  )
}

function getIncrementalAddedVocabularyItems(
  currentItems: VocabularyItem[],
  nextItems: VocabularyItem[],
): VocabularyItem[] | null {
  const currentById = new Map(currentItems.map(item => [item.id, item]))
  const nextById = new Map(nextItems.map(item => [item.id, item]))

  for (const currentItem of currentItems) {
    const nextItem = nextById.get(currentItem.id)
    if (!nextItem) {
      return null
    }

    if (getHighlightSignature(currentItem) !== getHighlightSignature(nextItem)) {
      return null
    }
  }

  const addedItems = nextItems.filter(item => !currentById.has(item.id))
  if (addedItems.length === 0) {
    return []
  }

  const currentTerms = currentItems.flatMap(getVocabularyHighlightTerms)
  for (const addedItem of addedItems) {
    if (doHighlightTermsConflict(currentTerms, getVocabularyHighlightTerms(addedItem))) {
      return null
    }
  }

  return addedItems
}

function escapeRegExp(value: string): string {
  return value.replace(REGEXP_SPECIAL_CHAR_RE, "\\$&")
}

function escapeCharClass(value: string): string {
  return value.replace(CHAR_CLASS_SPECIAL_CHAR_RE, "\\$&")
}

function createHighlightBoundaryPattern(): string {
  const escapedLimiters = VOCABULARY_HIGHLIGHT_BOUNDARY_LIMITERS
    .map(limiter => escapeCharClass(limiter))
    .join("")

  return `\\s${escapedLimiters}`
}

function createHighlightRegex(terms: string[]): RegExp {
  const alternation = terms.map(term => escapeRegExp(term)).join("|")
  const boundaries = createHighlightBoundaryPattern()
  return new RegExp(`(^|[${boundaries}])(${alternation})(?=$|[${boundaries}])`, "gi")
}

function buildHighlightBatches(
  items: VocabularyItem[],
  acrossElements: boolean,
): HighlightBatch[] {
  const entries: Array<{ item: VocabularyItem, term: string }> = []
  const seenTerms = new Set<string>()

  for (const item of items) {
    if (shouldHighlightAcrossElements(item) !== acrossElements) {
      continue
    }

    for (const term of getVocabularyHighlightTerms(item)) {
      if (seenTerms.has(term)) {
        continue
      }

      seenTerms.add(term)
      entries.push({ item, term })
    }
  }

  const batches: HighlightBatch[] = []
  let currentBatchEntries: typeof entries = []
  let currentPatternLength = 0

  const pushBatch = () => {
    if (currentBatchEntries.length === 0) {
      return
    }

    const terms = currentBatchEntries.map(entry => entry.term)
    batches.push({
      acrossElements,
      itemByTerm: new Map(currentBatchEntries.map(entry => [entry.term, entry.item])),
      regex: createHighlightRegex(terms),
    })
    currentBatchEntries = []
    currentPatternLength = 0
  }

  for (const entry of entries) {
    const nextPatternLength = currentPatternLength + entry.term.length + 1
    if (
      currentBatchEntries.length >= HIGHLIGHT_BATCH_TERM_LIMIT
      || nextPatternLength > HIGHLIGHT_BATCH_PATTERN_LENGTH_LIMIT
    ) {
      pushBatch()
    }

    currentBatchEntries.push(entry)
    currentPatternLength += entry.term.length + 1
  }

  pushBatch()
  return batches
}

function markHighlightBatch(
  markInstance: import("mark.js").default,
  batch: HighlightBatch,
): Promise<void> {
  return new Promise((resolve) => {
    let currentItem: VocabularyItem | null = null

    markInstance.markRegExp(batch.regex, {
      acrossElements: batch.acrossElements,
      caseSensitive: false,
      className: VOCABULARY_HIGHLIGHT_CLASS_NAME,
      filter: (_node, match) => {
        currentItem = batch.itemByTerm.get(normalizeVocabularyText(match)) ?? null
        return currentItem != null
      },
      each: (element) => {
        if (!currentItem) {
          return
        }

        element.classList.add(NOTRANSLATE_CLASS)
        element.setAttribute(VOCABULARY_HIGHLIGHT_ITEM_ID_ATTRIBUTE, currentItem.id)
      },
      exclude: HIGHLIGHT_EXCLUDE_SELECTORS,
      ignoreGroups: 1,
      done: resolve,
    })
  })
}

function yieldToNextFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      resolve()
    })
  })
}

async function markTerms(
  markInstance: import("mark.js").default,
  items: VocabularyItem[],
) {
  const batches = [
    ...buildHighlightBatches(items, false),
    ...buildHighlightBatches(items, true),
  ]

  for (let index = 0; index < batches.length; index += 1) {
    await markHighlightBatch(markInstance, batches[index]!)

    if (index < batches.length - 1) {
      await yieldToNextFrame()
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
    let rehighlightTimer: number | null = null
    let pendingHighlightMode: "full" | "incremental" | null = null
    let queuedHighlightMode: "full" | "incremental" | null = null

    const mergeHighlightMode = (current: "full" | "incremental" | null, next: "full" | "incremental") => {
      return current === "full" || next === "full" ? "full" : "incremental"
    }

    const scheduleHighlight = (mode: "full" | "incremental", delay = HIGHLIGHT_RESCAN_DELAY_MS) => {
      pendingHighlightMode = mergeHighlightMode(pendingHighlightMode, mode)
      if (rehighlightTimer) {
        window.clearTimeout(rehighlightTimer)
      }

      rehighlightTimer = window.setTimeout(() => {
        rehighlightTimer = null
        const nextMode = pendingHighlightMode ?? "full"
        pendingHighlightMode = null
        void applyHighlights(nextMode)
      }, delay)
    }

    const scheduleFullHighlight = (delay = HIGHLIGHT_RESCAN_DELAY_MS) => {
      scheduleHighlight("full", delay)
    }

    const queueHighlight = () => {
      scheduleFullHighlight()
    }

    async function loadActiveVocabularyItems() {
      const [{ default: Mark }, items] = await Promise.all([
        import("mark.js"),
        vocabulary.highlightEnabled ? getVocabularyItems() : Promise.resolve([] as VocabularyItem[]),
      ])

      return {
        Mark,
        activeItems: vocabulary.highlightEnabled ? getActiveVocabularyItems(items) : [],
      }
    }

    async function applyIncrementalHighlights() {
      const { Mark, activeItems } = await loadActiveVocabularyItems()
      if (disposed) {
        return true
      }

      const currentItems = [...itemsByIdRef.current.values()]
      const markInstance = new Mark(document.body)

      if (!vocabulary.highlightEnabled || activeItems.length === 0) {
        return false
      }

      if (currentItems.length === 0 && document.querySelector(HIGHLIGHT_MARK_SELECTOR) !== null) {
        return false
      }

      const addedItems = getIncrementalAddedVocabularyItems(currentItems, activeItems)
      if (addedItems == null) {
        return false
      }

      itemsByIdRef.current = new Map(activeItems.map(item => [item.id, item]))
      ensureHighlightStyle(vocabulary.highlightColor)

      if (addedItems.length > 0) {
        clearActiveSelection()
        await markTerms(markInstance, addedItems)
      }

      refreshHoverPreview()
      return true
    }

    async function applyFullHighlights() {
      const { Mark, activeItems } = await loadActiveVocabularyItems()

      if (disposed) {
        return
      }

      const markInstance = new Mark(document.body)
      itemsByIdRef.current = new Map(activeItems.map(item => [item.id, item]))

      if (!vocabulary.highlightEnabled || activeItems.length === 0) {
        await unmark(markInstance)
        hideHoverPreview()
        return
      }

      ensureHighlightStyle(vocabulary.highlightColor)

      const shouldClearSelection = activeItems.length > 0 || document.querySelector(HIGHLIGHT_MARK_SELECTOR) !== null
      if (shouldClearSelection) {
        clearActiveSelection()
      }

      await unmark(markInstance)
      await markTerms(markInstance, activeItems)
      refreshHoverPreview()
    }

    async function applyHighlights(mode: "full" | "incremental") {
      if (disposed || !document.body || isApplyingHighlights) {
        queuedHighlightMode = mergeHighlightMode(queuedHighlightMode, mode)
        return
      }

      isApplyingHighlights = true

      try {
        if (mode === "incremental" && await applyIncrementalHighlights()) {
          return
        }

        await applyFullHighlights()
      }
      finally {
        isApplyingHighlights = false
        if (queuedHighlightMode) {
          const nextMode = queuedHighlightMode
          queuedHighlightMode = null
          scheduleHighlight(nextMode, 0)
        }
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

    const handleVocabularyChanged = () => {
      scheduleHighlight("incremental", 0)
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
    void applyHighlights("full")

    return () => {
      disposed = true
      clearHideHoverTimer()
      if (rehighlightTimer) {
        window.clearTimeout(rehighlightTimer)
      }
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
