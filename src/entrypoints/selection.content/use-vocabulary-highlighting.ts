import type { VocabularyHighlightAnchorRect, VocabularyHoverPreview } from "./vocabulary-highlight-ui"
import type { VocabularyItem } from "@/types/vocabulary"
import type { VocabularyChangedEventDetail } from "@/utils/vocabulary/service"
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
  "#rf-debug-panel",
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
const HIGHLIGHT_EXCLUDE_SELECTOR = HIGHLIGHT_EXCLUDE_SELECTORS.join(",")
const HIGHLIGHT_ROOT_SELECTOR = [
  "[data-read-frog-paragraph]",
  "blockquote",
  "caption",
  "dd",
  "dt",
  "figcaption",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "li",
  "p",
  "summary",
  "td",
  "th",
].join(",")
const HIGHLIGHT_INLINE_TEXT_TAGS = new Set([
  "A",
  "ABBR",
  "B",
  "BDI",
  "BDO",
  "CITE",
  "DATA",
  "DFN",
  "EM",
  "I",
  "KBD",
  "LABEL",
  "Q",
  "S",
  "SMALL",
  "SPAN",
  "STRONG",
  "SUB",
  "SUP",
  "TIME",
  "U",
  "VAR",
  "WBR",
])
const HIGHLIGHT_RESCAN_DELAY_MS = 400
const HIGHLIGHT_BATCH_TERM_LIMIT = 48
const HIGHLIGHT_BATCH_PATTERN_LENGTH_LIMIT = 2400
const HIGHLIGHT_INTERSECTION_VERTICAL_MARGIN_PX = 800
const HIGHLIGHT_INTERSECTION_ROOT_MARGIN = `${HIGHLIGHT_INTERSECTION_VERTICAL_MARGIN_PX}px 0px`
const REGEXP_SPECIAL_CHAR_RE = /[.*+?^${}()|[\]\\]/g
const CHAR_CLASS_SPECIAL_CHAR_RE = /[\\\]-]/g

interface HighlightBatch {
  acrossElements: boolean
  itemByTerm: Map<string, VocabularyItem>
  regex: RegExp
}

interface IncrementalHighlightPlan {
  itemIdsToUnmark: string[]
  itemsToMark: VocabularyItem[]
}

type HighlightMode = "full" | "incremental"
type HighlightContainer = Document | ShadowRoot
type LazyRootWorkMode = "full" | "incremental"

interface LazyRootWork {
  itemIdsToUnmark: Set<string>
  itemsToMark: VocabularyItem[]
  mode: LazyRootWorkMode
  version: number
}

interface CollectHighlightRootsOptions {
  requireConnected?: boolean
}

interface ActiveHoverHighlight {
  element: HTMLElement
  itemId: string
  root: HTMLElement | null
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

function getEventPathTargets(source: Event | EventTarget | null): EventTarget[] {
  if (
    source
    && typeof source === "object"
    && "composedPath" in source
    && typeof source.composedPath === "function"
  ) {
    return source.composedPath()
  }

  return []
}

function getClosestElementAcrossShadowBoundary(element: Element | null, selector: string): Element | null {
  let current: Element | null = element

  while (current) {
    const closestElement = current.closest(selector)
    if (closestElement) {
      return closestElement
    }

    const rootNode = current.getRootNode()
    current = rootNode instanceof ShadowRoot ? rootNode.host : null
  }

  return null
}

function getClosestElementFromEventSource(source: Event | EventTarget | null, selector: string) {
  for (const node of getEventPathTargets(source)) {
    if (!(node instanceof Element)) {
      continue
    }

    const closestElement = getClosestElementAcrossShadowBoundary(node, selector)
    if (closestElement instanceof HTMLElement) {
      return closestElement
    }
  }

  const target = source instanceof Event ? source.target : source
  if (!(target instanceof Node)) {
    return null
  }

  const baseElement = target instanceof HTMLElement ? target : target.parentElement
  if (baseElement?.matches(selector)) {
    return baseElement as HTMLElement
  }

  return getClosestElementAcrossShadowBoundary(baseElement, selector) as HTMLElement | null
}

function isEventTargetInsideDocument(target: EventTarget | null) {
  if (!(target instanceof Node)) {
    return false
  }

  if (document.contains(target)) {
    return true
  }

  const root = target.getRootNode()
  return root instanceof ShadowRoot && document.contains(root.host)
}

function getHoverCardElement(source: Event | EventTarget | null) {
  return getClosestElementFromEventSource(source, `[${VOCABULARY_HOVER_CARD_ATTRIBUTE}]`)
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

function unwrapHighlightElement(element: HTMLElement): void {
  const parent = element.parentNode
  if (!parent) {
    return
  }

  const fragment = document.createDocumentFragment()
  while (element.firstChild) {
    fragment.append(element.firstChild)
  }

  parent.replaceChild(fragment, element)
}

function getHighlightElements(root: ParentNode): HTMLElement[] {
  return root instanceof HTMLElement && root.matches(HIGHLIGHT_MARK_SELECTOR)
    ? [root, ...root.querySelectorAll<HTMLElement>(HIGHLIGHT_MARK_SELECTOR)]
    : [...root.querySelectorAll<HTMLElement>(HIGHLIGHT_MARK_SELECTOR)]
}

function unmarkVocabularyHighlightsInRoot(root: ParentNode): void {
  for (const element of getHighlightElements(root)) {
    unwrapHighlightElement(element)
  }
}

function unmarkVocabularyItemsInRoot(root: ParentNode, itemIds: Set<string>): void {
  for (const element of getHighlightElements(root)) {
    const itemId = element.getAttribute(VOCABULARY_HIGHLIGHT_ITEM_ID_ATTRIBUTE)
    if (itemId && itemIds.has(itemId)) {
      unwrapHighlightElement(element)
    }
  }
}

function unmarkVocabularyItems(itemIds: Set<string>): void {
  for (const element of document.querySelectorAll<HTMLElement>(HIGHLIGHT_MARK_SELECTOR)) {
    const itemId = element.getAttribute(VOCABULARY_HIGHLIGHT_ITEM_ID_ATTRIBUTE)
    if (itemId && itemIds.has(itemId)) {
      unwrapHighlightElement(element)
    }
  }
}

function findHighlightElementByItemId(root: ParentNode, itemId: string): HTMLElement | null {
  return getHighlightElements(root)
    .find(element => element.getAttribute(VOCABULARY_HIGHLIGHT_ITEM_ID_ATTRIBUTE) === itemId) ?? null
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

function getIncrementalHighlightPlan(
  currentItems: VocabularyItem[],
  nextItems: VocabularyItem[],
): IncrementalHighlightPlan | null {
  const currentById = new Map(currentItems.map(item => [item.id, item]))
  const nextById = new Map(nextItems.map(item => [item.id, item]))
  const retainedItems: VocabularyItem[] = []
  const changedTermSets: string[][] = []
  const itemIdsToUnmark = new Set<string>()
  const itemIdsToRefresh = new Set<string>()

  for (const currentItem of currentItems) {
    const nextItem = nextById.get(currentItem.id)
    if (!nextItem) {
      itemIdsToUnmark.add(currentItem.id)
      changedTermSets.push(getVocabularyHighlightTerms(currentItem))
      continue
    }

    if (getHighlightSignature(currentItem) !== getHighlightSignature(nextItem)) {
      itemIdsToUnmark.add(nextItem.id)
      itemIdsToRefresh.add(nextItem.id)
      changedTermSets.push(
        getVocabularyHighlightTerms(currentItem),
        getVocabularyHighlightTerms(nextItem),
      )
    }
    else {
      retainedItems.push(nextItem)
    }
  }

  for (const item of nextItems) {
    if (!currentById.has(item.id)) {
      itemIdsToRefresh.add(item.id)
      changedTermSets.push(getVocabularyHighlightTerms(item))
    }
  }

  if (itemIdsToUnmark.size === 0 && itemIdsToRefresh.size === 0) {
    return {
      itemIdsToUnmark: [],
      itemsToMark: [],
    }
  }

  for (const retainedItem of retainedItems) {
    const retainedTerms = getVocabularyHighlightTerms(retainedItem)
    if (changedTermSets.some(terms => doHighlightTermsConflict(retainedTerms, terms))) {
      itemIdsToUnmark.add(retainedItem.id)
      itemIdsToRefresh.add(retainedItem.id)
    }
  }

  return {
    itemIdsToUnmark: [...itemIdsToUnmark],
    itemsToMark: nextItems.filter(item => itemIdsToRefresh.has(item.id)),
  }
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

function getHighlightElement(source: Event | EventTarget | null) {
  return getClosestElementFromEventSource(
    source,
    `mark.${VOCABULARY_HIGHLIGHT_CLASS_NAME}[${VOCABULARY_HIGHLIGHT_ITEM_ID_ATTRIBUTE}]`,
  )
}

function isHighlightExcludedElement(element: Element): boolean {
  return getClosestElementAcrossShadowBoundary(element, HIGHLIGHT_EXCLUDE_SELECTOR) != null
    || getClosestElementAcrossShadowBoundary(element, HIGHLIGHT_MARK_SELECTOR) != null
}

function hasMeaningfulText(node: Node): boolean {
  return Boolean(node.textContent?.trim())
}

function hasMeasuredLayoutBox(rect: DOMRectReadOnly): boolean {
  return rect.width !== 0
    || rect.height !== 0
    || rect.top !== 0
    || rect.right !== 0
    || rect.bottom !== 0
    || rect.left !== 0
}

function isHighlightRootNearViewport(root: HTMLElement): boolean {
  const rect = root.getBoundingClientRect()
  if (!hasMeasuredLayoutBox(rect)) {
    return false
  }

  const viewportHeight = window.innerHeight || document.documentElement.clientHeight
  const viewportWidth = window.innerWidth || document.documentElement.clientWidth

  return rect.bottom >= -HIGHLIGHT_INTERSECTION_VERTICAL_MARGIN_PX
    && rect.top <= viewportHeight + HIGHLIGHT_INTERSECTION_VERTICAL_MARGIN_PX
    && rect.right >= 0
    && rect.left <= viewportWidth
}

function getPreferredHighlightRoot(element: HTMLElement): HTMLElement | null {
  const preferredRoot = element.closest(HIGHLIGHT_ROOT_SELECTOR)
  if (preferredRoot instanceof HTMLElement && !isHighlightExcludedElement(preferredRoot)) {
    return preferredRoot
  }

  return null
}

function getGenericHighlightRoot(element: HTMLElement): HTMLElement | null {
  let root: HTMLElement | null = element

  while (root && root.parentElement && root.parentElement !== document.body) {
    const parent: HTMLElement = root.parentElement
    if (isHighlightExcludedElement(parent)) {
      return null
    }

    if (parent.matches(HIGHLIGHT_ROOT_SELECTOR)) {
      return parent
    }

    if (!HIGHLIGHT_INLINE_TEXT_TAGS.has(root.tagName)) {
      break
    }

    root = parent
  }

  if (!root || root === document.body || root === document.documentElement || isHighlightExcludedElement(root)) {
    return null
  }

  return hasMeaningfulText(root) ? root : null
}

function getHighlightRootForTextNode(textNode: Text): HTMLElement | null {
  const parentElement = textNode.parentElement
  if (!parentElement || isHighlightExcludedElement(parentElement)) {
    return null
  }

  return getPreferredHighlightRoot(parentElement) ?? getGenericHighlightRoot(parentElement)
}

function getHighlightRootForElement(element: HTMLElement): HTMLElement | null {
  if (isHighlightExcludedElement(element)) {
    return null
  }

  return getPreferredHighlightRoot(element) ?? getGenericHighlightRoot(element)
}

function getHighlightRootForNode(node: Node): HTMLElement | null {
  if (node instanceof Text) {
    return getHighlightRootForTextNode(node)
  }

  if (node instanceof HTMLElement) {
    return getHighlightRootForElement(node)
  }

  return null
}

function collectHighlightRoots(root: Node, options: CollectHighlightRootsOptions = {}): HTMLElement[] {
  if (!document.body) {
    return []
  }

  const { requireConnected = true } = options

  if (root instanceof Text) {
    const highlightRoot = hasMeaningfulText(root) ? getHighlightRootForTextNode(root) : null
    return highlightRoot && (!requireConnected || highlightRoot.isConnected) ? [highlightRoot] : []
  }

  if (root instanceof ShadowRoot && isHighlightExcludedElement(root.host)) {
    return []
  }

  const container = root instanceof Document ? document.body : root
  if (!(container instanceof HTMLElement || container instanceof DocumentFragment)) {
    return []
  }

  if (container instanceof HTMLElement && isHighlightExcludedElement(container)) {
    return []
  }

  const roots = new Set<HTMLElement>()
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
  let textNode = walker.nextNode()

  while (textNode) {
    if (hasMeaningfulText(textNode)) {
      const highlightRoot = getHighlightRootForTextNode(textNode as Text)
      if (highlightRoot && (!requireConnected || highlightRoot.isConnected)) {
        roots.add(highlightRoot)
      }
    }
    textNode = walker.nextNode()
  }

  return [...roots]
}

function collectAccessibleHighlightContainers(root: Node): HighlightContainer[] {
  const containers = new Set<HighlightContainer>()

  const visitNode = (node: Node | null) => {
    if (!node) {
      return
    }

    if (node instanceof Document) {
      containers.add(node)
      visitNode(node.body)
      return
    }

    if (node instanceof ShadowRoot) {
      if (isHighlightExcludedElement(node.host)) {
        return
      }

      containers.add(node)
      for (const childNode of node.childNodes) {
        visitNode(childNode)
      }
      return
    }

    if (node instanceof Element) {
      if (isHighlightExcludedElement(node)) {
        return
      }

      if (node.shadowRoot) {
        visitNode(node.shadowRoot)
      }

      for (const child of node.children) {
        visitNode(child)
      }
      return
    }

    if (node instanceof DocumentFragment) {
      for (const childNode of node.childNodes) {
        visitNode(childNode)
      }
    }
  }

  visitNode(root)
  return [...containers]
}

function isVocabularyHighlightNode(node: Node): boolean {
  if (!(node instanceof Element)) {
    return false
  }

  return node.matches(HIGHLIGHT_MARK_SELECTOR) || node.querySelector(HIGHLIGHT_MARK_SELECTOR) != null
}

function isVocabularyHighlightMutation(mutation: MutationRecord): boolean {
  const targetElement = mutation.target instanceof Element
    ? mutation.target
    : mutation.target.parentElement

  return getClosestElementAcrossShadowBoundary(targetElement, HIGHLIGHT_MARK_SELECTOR) != null
}

function hasAddedHighlightableContent(mutation: MutationRecord): boolean {
  const changedNodes = [...mutation.addedNodes, ...mutation.removedNodes]
  if (changedNodes.some(node => isVocabularyHighlightNode(node))) {
    return false
  }

  return [...mutation.addedNodes].some(node => hasMeaningfulText(node))
}

function hasAddedMeaningfulNonHighlightContent(mutation: MutationRecord): boolean {
  return [...mutation.addedNodes].some(node => !isVocabularyHighlightNode(node) && hasMeaningfulText(node))
}

function getVocabularyHighlightItemIds(nodes: Iterable<Node>): Set<string> {
  const itemIds = new Set<string>()

  for (const node of nodes) {
    if (!(node instanceof HTMLElement)) {
      continue
    }

    for (const element of getHighlightElements(node)) {
      const itemId = element.getAttribute(VOCABULARY_HIGHLIGHT_ITEM_ID_ATTRIBUTE)
      if (itemId) {
        itemIds.add(itemId)
      }
    }
  }

  return itemIds
}

function getContainingVocabularyHighlightElement(node: Node): HTMLElement | null {
  const element = node instanceof Element ? node : node.parentElement
  const highlight = getClosestElementAcrossShadowBoundary(element, HIGHLIGHT_MARK_SELECTOR)

  return highlight instanceof HTMLElement ? highlight : null
}

function getContainingVocabularyHighlightItemId(node: Node): string | null {
  return getContainingVocabularyHighlightElement(node)
    ?.getAttribute(VOCABULARY_HIGHLIGHT_ITEM_ID_ATTRIBUTE) ?? null
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

  const resolveActiveHoverHighlight = useEffectEvent((activeHighlight: ActiveHoverHighlight) => {
    if (activeHighlight.element.isConnected) {
      return activeHighlight
    }

    const root = activeHighlight.root
    if (!root?.isConnected) {
      return null
    }

    const replacementHighlight = findHighlightElementByItemId(root, activeHighlight.itemId)
    if (!replacementHighlight) {
      return null
    }

    return {
      element: replacementHighlight,
      itemId: activeHighlight.itemId,
      root,
    } satisfies ActiveHoverHighlight
  })

  const refreshHoverPreview = useEffectEvent(() => {
    const activeHighlight = hoverHighlightRef.current
    if (!activeHighlight) {
      return
    }

    const resolvedHighlight = resolveActiveHoverHighlight(activeHighlight)
    if (!resolvedHighlight) {
      hideHoverPreview()
      return
    }

    hoverHighlightRef.current = resolvedHighlight

    const item = itemsByIdRef.current.get(resolvedHighlight.itemId)
    if (!item || !item.translatedText.trim()) {
      hideHoverPreview()
      return
    }

    updateHoverPreview({
      item,
      anchorRect: toVocabularyHighlightAnchorRect(resolvedHighlight.element.getBoundingClientRect()),
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
      root: getHighlightRootForElement(element.parentElement ?? element),
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

    const hoveredHighlight = getHighlightElement(event)
    const hoveredItemId = hoveredHighlight?.getAttribute(VOCABULARY_HIGHLIGHT_ITEM_ID_ATTRIBUTE)
    if (hoveredItemId === activeItemId) {
      return true
    }

    if (getHoverCardElement(event)) {
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
    let isApplyingHighlightRequest = false
    let isProcessingRootHighlights = false
    let rehighlightTimer: number | null = null
    let clearMutationSuppressionTimer: number | null = null
    let pendingHighlightMode: HighlightMode | null = null
    let pendingVocabularyItems: VocabularyItem[] | null = null
    let queuedHighlightMode: HighlightMode | null = null
    let queuedVocabularyItems: VocabularyItem[] | null = null
    let MarkConstructor: typeof import("mark.js").default | null = null
    let activeLazyItems: VocabularyItem[] = []
    let lazyVocabularyVersion = 0
    let lazyRootVersions = new WeakMap<HTMLElement, number>()
    let rootHighlightTimer: number | null = null
    let rootHighlightTimerDelay: number | null = null
    let intersectionObserver: IntersectionObserver | null = null
    let suppressHighlightMutationReactions = false
    const observedRoots = new Set<HTMLElement>()
    const observedContainers = new Set<HighlightContainer>()
    const mutationObservers = new Map<HighlightContainer, MutationObserver>()
    const visibleRoots = new Set<HTMLElement>()
    const pendingRootWork = new Map<HTMLElement, LazyRootWork>()

    const mergeHighlightMode = (current: HighlightMode | null, next: HighlightMode) => {
      return current === "full" || next === "full" ? "full" : "incremental"
    }

    const canUseLazyHighlighting = () => {
      return typeof IntersectionObserver !== "undefined" && typeof MutationObserver !== "undefined"
    }

    const scheduleHighlight = (
      mode: HighlightMode,
      delay = HIGHLIGHT_RESCAN_DELAY_MS,
      vocabularyItems?: VocabularyItem[],
    ) => {
      pendingHighlightMode = mergeHighlightMode(pendingHighlightMode, mode)
      if (vocabularyItems) {
        pendingVocabularyItems = vocabularyItems
      }
      else if (mode === "full") {
        pendingVocabularyItems = null
      }

      if (rehighlightTimer) {
        window.clearTimeout(rehighlightTimer)
      }

      rehighlightTimer = window.setTimeout(() => {
        rehighlightTimer = null
        const nextMode = pendingHighlightMode ?? "full"
        const nextVocabularyItems = pendingVocabularyItems
        pendingHighlightMode = null
        pendingVocabularyItems = null
        void applyHighlights(nextMode, nextVocabularyItems ?? undefined)
      }, delay)
    }

    const scheduleFullHighlight = (delay = HIGHLIGHT_RESCAN_DELAY_MS) => {
      scheduleHighlight("full", delay)
    }

    const beginHighlightMutationSuppression = () => {
      if (clearMutationSuppressionTimer !== null) {
        window.clearTimeout(clearMutationSuppressionTimer)
        clearMutationSuppressionTimer = null
      }

      suppressHighlightMutationReactions = true
    }

    const scheduleEndHighlightMutationSuppression = () => {
      if (clearMutationSuppressionTimer !== null) {
        window.clearTimeout(clearMutationSuppressionTimer)
      }

      clearMutationSuppressionTimer = window.setTimeout(() => {
        clearMutationSuppressionTimer = null
        suppressHighlightMutationReactions = false
      }, 0)
    }

    const queueHighlight = () => {
      scheduleFullHighlight()
    }

    const clearAllHighlightMarkup = () => {
      for (const container of collectAccessibleHighlightContainers(document)) {
        unmarkVocabularyHighlightsInRoot(container)
      }
    }

    const hasAnyHighlightMarkup = () => {
      return collectAccessibleHighlightContainers(document)
        .some(container => getHighlightElements(container).length > 0)
    }

    const getMarkConstructor = async () => {
      if (MarkConstructor) {
        return MarkConstructor
      }

      const { default: Mark } = await import("mark.js")
      MarkConstructor = Mark
      return Mark
    }

    const mergeVocabularyItemsById = (left: VocabularyItem[], right: VocabularyItem[]) => {
      const itemsById = new Map<string, VocabularyItem>()
      for (const item of [...left, ...right]) {
        itemsById.set(item.id, item)
      }
      return [...itemsById.values()]
    }

    const flushQueuedHighlightRequest = () => {
      if (!queuedHighlightMode) {
        return
      }

      const nextMode = queuedHighlightMode
      const nextVocabularyItems = queuedVocabularyItems
      queuedHighlightMode = null
      queuedVocabularyItems = null
      scheduleHighlight(nextMode, 0, nextVocabularyItems ?? undefined)
    }

    const forgetHighlightRoot = (root: HTMLElement) => {
      intersectionObserver?.unobserve(root)
      observedRoots.delete(root)
      visibleRoots.delete(root)
      pendingRootWork.delete(root)
      lazyRootVersions.delete(root)
    }

    const disconnectContainerObserver = (container: HighlightContainer) => {
      mutationObservers.get(container)?.disconnect()
      mutationObservers.delete(container)
      observedContainers.delete(container)
    }

    const cleanupRemovedHighlightRoots = (node: Node) => {
      for (const root of collectHighlightRoots(node, { requireConnected: false })) {
        forgetHighlightRoot(root)
      }
    }

    const cleanupRemovedHighlightContainers = (node: Node) => {
      for (const container of collectAccessibleHighlightContainers(node)) {
        if (container instanceof ShadowRoot) {
          disconnectContainerObserver(container)
        }
      }
    }

    const scheduleQueuedRootHighlights = (delay = 0) => {
      if (rootHighlightTimer !== null) {
        if (rootHighlightTimerDelay === 0 && delay > 0) {
          return
        }

        window.clearTimeout(rootHighlightTimer)
      }

      rootHighlightTimer = window.setTimeout(() => {
        rootHighlightTimer = null
        rootHighlightTimerDelay = null
        void processQueuedRootHighlights()
      }, delay)
      rootHighlightTimerDelay = delay
    }

    const queueRootHighlight = (
      root: HTMLElement,
      mode: LazyRootWorkMode,
      itemsToMark: VocabularyItem[],
      itemIdsToUnmark = new Set<string>(),
      delay = 0,
    ) => {
      if (!root.isConnected || !visibleRoots.has(root)) {
        return
      }

      const currentWork = pendingRootWork.get(root)
      if (!currentWork || mode === "full" || currentWork.mode === "full") {
        pendingRootWork.set(root, {
          itemIdsToUnmark: mode === "full" ? new Set() : new Set(itemIdsToUnmark),
          itemsToMark: mode === "full" ? activeLazyItems : itemsToMark,
          mode: mode === "full" || currentWork?.mode === "full" ? "full" : "incremental",
          version: lazyVocabularyVersion,
        })
      }
      else {
        pendingRootWork.set(root, {
          itemIdsToUnmark: new Set([...currentWork.itemIdsToUnmark, ...itemIdsToUnmark]),
          itemsToMark: mergeVocabularyItemsById(currentWork.itemsToMark, itemsToMark),
          mode: "incremental",
          version: lazyVocabularyVersion,
        })
      }

      scheduleQueuedRootHighlights(delay)
    }

    async function processQueuedRootHighlights() {
      if (disposed) {
        return
      }

      if (isProcessingRootHighlights || isApplyingHighlightRequest) {
        scheduleQueuedRootHighlights()
        return
      }

      isProcessingRootHighlights = true
      beginHighlightMutationSuppression()

      try {
        const Mark = await getMarkConstructor()
        const workEntries = [...pendingRootWork.entries()]
        pendingRootWork.clear()

        for (const [root, work] of workEntries) {
          if (disposed) {
            return
          }

          if (!root.isConnected || !visibleRoots.has(root)) {
            continue
          }

          const rootVersion = lazyRootVersions.get(root)
          const canRunIncrementalHighlight = work.mode === "incremental"
            && (rootVersion === work.version || rootVersion === work.version - 1)
          const shouldRunFullHighlight = work.mode === "full" || !canRunIncrementalHighlight
          const markInstance = new Mark(root)

          if (shouldRunFullHighlight) {
            unmarkVocabularyHighlightsInRoot(root)
            if (activeLazyItems.length > 0) {
              await markTerms(markInstance, activeLazyItems)
            }
          }
          else {
            if (work.itemIdsToUnmark.size > 0) {
              unmarkVocabularyItemsInRoot(root, work.itemIdsToUnmark)
            }
            if (work.itemsToMark.length > 0) {
              await markTerms(markInstance, work.itemsToMark)
            }
          }

          lazyRootVersions.set(root, work.version)
          refreshHoverPreview()
          await yieldToNextFrame()
        }
      }
      finally {
        isProcessingRootHighlights = false
        scheduleEndHighlightMutationSuppression()
        flushQueuedHighlightRequest()
        if (pendingRootWork.size > 0) {
          scheduleQueuedRootHighlights()
        }
      }
    }

    const observeHighlightRoot = (root: HTMLElement) => {
      if (observedRoots.has(root) || isHighlightExcludedElement(root)) {
        return
      }

      observedRoots.add(root)
      intersectionObserver?.observe(root)
      if (isHighlightRootNearViewport(root)) {
        visibleRoots.add(root)
        if (activeLazyItems.length > 0 && lazyRootVersions.get(root) !== lazyVocabularyVersion) {
          queueRootHighlight(root, "full", activeLazyItems)
        }
      }
    }

    const observeHighlightRoots = (root: Node) => {
      for (const highlightRoot of collectHighlightRoots(root)) {
        observeHighlightRoot(highlightRoot)
      }
    }

    const observeHighlightContainer = (container: HighlightContainer) => {
      const observationTarget = container instanceof Document ? container.body : container
      if (!observationTarget) {
        return
      }

      if (!observedContainers.has(container)) {
        const mutationObserver = new MutationObserver(handleDomMutations)
        mutationObserver.observe(observationTarget, {
          characterData: true,
          childList: true,
          subtree: true,
        })
        observedContainers.add(container)
        mutationObservers.set(container, mutationObserver)
      }

      observeHighlightRoots(container)
    }

    const observeHighlightContainers = (root: Node) => {
      for (const container of collectAccessibleHighlightContainers(root)) {
        observeHighlightContainer(container)
      }
    }

    const scheduleVisibleRootsFullHighlight = () => {
      for (const root of visibleRoots) {
        queueRootHighlight(root, "full", activeLazyItems)
      }
    }

    const handleIntersectingRoots: IntersectionObserverCallback = (entries) => {
      for (const entry of entries) {
        const root = entry.target
        if (!(root instanceof HTMLElement)) {
          continue
        }

        if (entry.isIntersecting || entry.intersectionRatio > 0) {
          visibleRoots.add(root)
          if (lazyRootVersions.get(root) !== lazyVocabularyVersion) {
            queueRootHighlight(root, "full", activeLazyItems)
          }
        }
        else {
          visibleRoots.delete(root)
        }
      }
    }

    function handleDomMutations(mutations: MutationRecord[]) {
      if (!activeLazyItems.length) {
        return
      }

      if ((isApplyingHighlightRequest || isProcessingRootHighlights || suppressHighlightMutationReactions) && !mutations.some(hasAddedHighlightableContent)) {
        return
      }

      const incrementalRootItemIds = new Map<HTMLElement, Set<string>>()

      const queueIncrementalRootRefresh = (root: HTMLElement, itemIdsToUnmark = new Set<string>()) => {
        const existingItemIds = incrementalRootItemIds.get(root)
        if (existingItemIds) {
          for (const itemId of itemIdsToUnmark) {
            existingItemIds.add(itemId)
          }
          return
        }

        incrementalRootItemIds.set(root, new Set(itemIdsToUnmark))
      }

      for (const mutation of mutations) {
        if (mutation.type === "characterData" && mutation.target instanceof Text) {
          const containingHighlight = getContainingVocabularyHighlightElement(mutation.target)
          const root = containingHighlight
            ? getHighlightRootForElement(containingHighlight.parentElement ?? containingHighlight)
            : getHighlightRootForTextNode(mutation.target)

          if (root) {
            const itemId = containingHighlight
              ? getContainingVocabularyHighlightItemId(mutation.target)
              : null
            if (itemId) {
              queueIncrementalRootRefresh(root, new Set([itemId]))
            }
            else {
              queueIncrementalRootRefresh(root)
            }
          }
          continue
        }

        if (isVocabularyHighlightMutation(mutation)) {
          continue
        }

        if (mutation.type !== "childList") {
          continue
        }

        const targetRoot = getHighlightRootForNode(mutation.target)
        if (targetRoot) {
          const itemIdsToUnmark = getVocabularyHighlightItemIds(mutation.removedNodes)
          if (hasAddedMeaningfulNonHighlightContent(mutation) || itemIdsToUnmark.size > 0) {
            queueIncrementalRootRefresh(targetRoot, itemIdsToUnmark)
          }
        }

        for (const node of mutation.removedNodes) {
          cleanupRemovedHighlightRoots(node)
          cleanupRemovedHighlightContainers(node)
        }

        for (const node of mutation.addedNodes) {
          observeHighlightContainers(node)
          observeHighlightRoots(node)
          for (const root of collectHighlightRoots(node)) {
            queueIncrementalRootRefresh(root)
          }
        }
      }

      for (const [root, itemIdsToUnmark] of incrementalRootItemIds) {
        if (!root.isConnected) {
          forgetHighlightRoot(root)
          continue
        }

        observeHighlightRoot(root)
        if (visibleRoots.has(root)) {
          queueRootHighlight(root, "incremental", activeLazyItems, itemIdsToUnmark, HIGHLIGHT_RESCAN_DELAY_MS)
        }
      }

      refreshHoverPreview()
    }

    const ensureLazyObservers = () => {
      if (!document.body || !canUseLazyHighlighting()) {
        return false
      }

      if (!intersectionObserver) {
        intersectionObserver = new IntersectionObserver(handleIntersectingRoots, {
          root: null,
          rootMargin: HIGHLIGHT_INTERSECTION_ROOT_MARGIN,
          threshold: 0,
        })
      }

      observeHighlightContainers(document)

      return true
    }

    const resetLazyHighlightRoots = () => {
      intersectionObserver?.disconnect()
      observedRoots.clear()
      visibleRoots.clear()
      pendingRootWork.clear()
      lazyRootVersions = new WeakMap()
      observeHighlightContainers(document)
    }

    const disconnectLazyObservers = () => {
      intersectionObserver?.disconnect()
      intersectionObserver = null
      for (const container of [...observedContainers]) {
        disconnectContainerObserver(container)
      }
      observedRoots.clear()
      visibleRoots.clear()
      pendingRootWork.clear()
      lazyRootVersions = new WeakMap()
      if (rootHighlightTimer !== null) {
        window.clearTimeout(rootHighlightTimer)
        rootHighlightTimer = null
        rootHighlightTimerDelay = null
      }
    }

    async function loadActiveVocabularyItems(vocabularyItems?: VocabularyItem[]) {
      const [{ default: Mark }, items] = await Promise.all([
        import("mark.js"),
        vocabulary.highlightEnabled
          ? Promise.resolve(vocabularyItems ?? getVocabularyItems({ skipRemoteProbe: true }))
          : Promise.resolve([] as VocabularyItem[]),
      ])

      MarkConstructor = Mark

      return {
        Mark,
        activeItems: vocabulary.highlightEnabled ? getActiveVocabularyItems(items) : [],
      }
    }

    async function applyIncrementalHighlights(vocabularyItems?: VocabularyItem[]) {
      const { Mark, activeItems } = await loadActiveVocabularyItems(vocabularyItems)
      if (disposed) {
        return true
      }

      const currentItems = [...itemsByIdRef.current.values()]
      const markInstance = new Mark(document.body)

      if (!vocabulary.highlightEnabled) {
        return false
      }

      if (currentItems.length === 0 && hasAnyHighlightMarkup()) {
        return false
      }

      if (activeItems.length === 0) {
        if (currentItems.length === 0) {
          return true
        }

        clearActiveSelection()
        disconnectLazyObservers()
        beginHighlightMutationSuppression()
        clearAllHighlightMarkup()
        scheduleEndHighlightMutationSuppression()
        itemsByIdRef.current = new Map()
        activeLazyItems = []
        hideHoverPreview()
        return true
      }

      const plan = getIncrementalHighlightPlan(currentItems, activeItems)
      if (plan == null) {
        return false
      }

      itemsByIdRef.current = new Map(activeItems.map(item => [item.id, item]))
      activeLazyItems = activeItems
      ensureHighlightStyle(vocabulary.highlightColor)

      const hasPlanChanges = plan.itemIdsToUnmark.length > 0 || plan.itemsToMark.length > 0
      if (!hasPlanChanges) {
        refreshHoverPreview()
        return true
      }

      lazyVocabularyVersion += 1

      if (hasPlanChanges) {
        clearActiveSelection()
      }

      if (canUseLazyHighlighting()) {
        if (ensureLazyObservers()) {
          const itemIdsToUnmark = new Set(plan.itemIdsToUnmark)
          for (const root of visibleRoots) {
            const rootVersion = lazyRootVersions.get(root)
            queueRootHighlight(
              root,
              rootVersion === lazyVocabularyVersion - 1 ? "incremental" : "full",
              plan.itemsToMark,
              itemIdsToUnmark,
            )
          }
          refreshHoverPreview()
          return true
        }
      }

      if (plan.itemIdsToUnmark.length > 0) {
        beginHighlightMutationSuppression()
        unmarkVocabularyItems(new Set(plan.itemIdsToUnmark))
      }

      if (plan.itemsToMark.length > 0) {
        beginHighlightMutationSuppression()
        await markTerms(markInstance, plan.itemsToMark)
      }

      if (plan.itemIdsToUnmark.length > 0 || plan.itemsToMark.length > 0) {
        scheduleEndHighlightMutationSuppression()
      }

      refreshHoverPreview()
      return true
    }

    async function applyFullHighlights(vocabularyItems?: VocabularyItem[]) {
      const { Mark, activeItems } = await loadActiveVocabularyItems(vocabularyItems)

      if (disposed) {
        return
      }

      const markInstance = new Mark(document.body)
      itemsByIdRef.current = new Map(activeItems.map(item => [item.id, item]))
      activeLazyItems = activeItems
      lazyVocabularyVersion += 1

      if (!vocabulary.highlightEnabled || activeItems.length === 0) {
        disconnectLazyObservers()
        beginHighlightMutationSuppression()
        clearAllHighlightMarkup()
        scheduleEndHighlightMutationSuppression()
        activeLazyItems = []
        hideHoverPreview()
        return
      }

      ensureHighlightStyle(vocabulary.highlightColor)

      const shouldClearSelection = activeItems.length > 0 || hasAnyHighlightMarkup()
      if (shouldClearSelection) {
        clearActiveSelection()
      }

      if (canUseLazyHighlighting()) {
        if (ensureLazyObservers()) {
          beginHighlightMutationSuppression()
          clearAllHighlightMarkup()
          resetLazyHighlightRoots()
          scheduleEndHighlightMutationSuppression()
          scheduleVisibleRootsFullHighlight()
          refreshHoverPreview()
          return
        }
      }

      beginHighlightMutationSuppression()
      clearAllHighlightMarkup()
      await markTerms(markInstance, activeItems)
      scheduleEndHighlightMutationSuppression()
      refreshHoverPreview()
    }

    async function applyHighlights(mode: HighlightMode, vocabularyItems?: VocabularyItem[]) {
      if (disposed || !document.body || isApplyingHighlightRequest) {
        queuedHighlightMode = mergeHighlightMode(queuedHighlightMode, mode)
        if (vocabularyItems) {
          queuedVocabularyItems = vocabularyItems
        }
        else if (mode === "full") {
          queuedVocabularyItems = null
        }
        return
      }

      isApplyingHighlightRequest = true

      try {
        if (mode === "incremental" && await applyIncrementalHighlights(vocabularyItems)) {
          return
        }

        await applyFullHighlights(vocabularyItems)
      }
      finally {
        isApplyingHighlightRequest = false
        flushQueuedHighlightRequest()
        if (pendingRootWork.size > 0) {
          scheduleQueuedRootHighlights()
        }
      }
    }

    const handlePointerMove = (event: PointerEvent) => {
      const target = getHighlightElement(event)
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
      const target = getHighlightElement(event)
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

    const handlePointerLeave = (event: PointerEvent) => {
      if (isEventTargetInsideDocument(event.relatedTarget)) {
        return
      }

      if (hoverPreviewRef.current && isPointerInsideActiveHoverArea(event)) {
        clearHideHoverTimer()
        refreshHoverPreview()
        return
      }

      scheduleHideHoverPreview()
    }

    const handleVocabularyChanged = (event: Event) => {
      const detail = (event as CustomEvent<VocabularyChangedEventDetail>).detail
      const vocabularyItems = Array.isArray(detail?.items) ? detail.items : undefined
      scheduleHighlight("incremental", 0, vocabularyItems)
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
      if (clearMutationSuppressionTimer !== null) {
        window.clearTimeout(clearMutationSuppressionTimer)
      }
      disconnectLazyObservers()
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
