// @vitest-environment jsdom
import type { VocabularyItem } from "@/types/vocabulary"
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react"
import { atom } from "jotai"
import Mark from "mark.js"
import { createElement, useEffect } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NOTRANSLATE_CLASS } from "@/utils/constants/dom-labels"
import {
  VOCABULARY_HIGHLIGHT_BOUNDARY_LIMITERS,
  VOCABULARY_HIGHLIGHT_CLASS_NAME,
} from "@/utils/constants/vocabulary"
import { SELECTION_CONTENT_OVERLAY_ROOT_ATTRIBUTE } from "../overlay-layers"
import { shouldHighlightAcrossElements, useVocabularyHighlighting } from "../use-vocabulary-highlighting"

const getVocabularyItemsMock = vi.fn<(options?: { skipRemoteProbe?: boolean }) => Promise<VocabularyItem[]>>()

vi.mock("@/utils/atoms/config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/utils/atoms/config")>()
  return {
    ...actual,
    configFieldsAtomMap: {
      ...actual.configFieldsAtomMap,
      vocabulary: atom({
        autoSave: true,
        highlightEnabled: true,
        maxPhraseWords: 8,
        highlightColor: "#fde68a",
      }),
    },
  }
})

vi.mock("@/utils/vocabulary/service", () => ({
  getVocabularyItems: (options?: { skipRemoteProbe?: boolean }) => getVocabularyItemsMock(options),
  setVocabularyItemMastered: vi.fn(),
  VOCABULARY_CHANGED_EVENT: "lexio:vocabulary-changed",
}))

vi.mock("#imports", () => ({
  i18n: {
    t: (key: string) => key,
  },
}))

vi.mock("@/components/ui/base-ui/tooltip", () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => children,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => children,
  TooltipContent: ({ children }: { children: React.ReactNode }) => children,
}))

vi.mock("../selection-toolbar/atoms", async () => {
  const actual = await vi.importActual<typeof import("jotai")>("jotai")
  return {
    selectionToolbarRectAtom: actual.atom(null),
  }
})

function createVocabularyItem(overrides: Partial<VocabularyItem>): VocabularyItem {
  return {
    id: "item-1",
    sourceText: "integration",
    normalizedText: "integration",
    matchTerms: ["integration"],
    translatedText: "集成",
    sourceLang: "en",
    targetLang: "zh-CN",
    kind: "word",
    wordCount: 1,
    createdAt: 1,
    lastSeenAt: 1,
    hitCount: 1,
    updatedAt: 1,
    deletedAt: null,
    ...overrides,
  }
}

function markVocabularyItem(item: VocabularyItem, html: string) {
  document.body.innerHTML = html

  return new Promise<void>((resolve) => {
    new Mark(document.body).mark(item.sourceText.trim(), {
      acrossElements: shouldHighlightAcrossElements(item),
      accuracy: {
        value: "exactly",
        limiters: VOCABULARY_HIGHLIGHT_BOUNDARY_LIMITERS,
      },
      caseSensitive: false,
      className: VOCABULARY_HIGHLIGHT_CLASS_NAME,
      separateWordSearch: false,
      done: resolve,
    })
  })
}

function selectText(node: Node, startOffset = 0, endOffset?: number) {
  const textLength = node.textContent?.length ?? 0
  const range = document.createRange()
  range.setStart(node, startOffset)
  range.setEnd(node, endOffset ?? textLength)

  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
  document.dispatchEvent(new Event("selectionchange"))
}

function VocabularyHighlightingHarness() {
  const { hoverPreview } = useVocabularyHighlighting()
  return hoverPreview ? createElement("div", { "data-testid": "hover-preview-probe" }) : null
}

interface HoverCardRect {
  bottom: number
  height: number
  left: number
  right: number
  top: number
  width: number
}

function HoverCardProbe({
  hoverPreview,
  cardRect,
  onCardRectChange,
  onHoverCardPointerEnter,
  onHoverCardPointerLeave,
}: {
  cardRect: HoverCardRect
  hoverPreview: ReturnType<typeof useVocabularyHighlighting>["hoverPreview"]
  onCardRectChange: ReturnType<typeof useVocabularyHighlighting>["setHoverCardRect"]
  onHoverCardPointerEnter: ReturnType<typeof useVocabularyHighlighting>["handleHoverCardPointerEnter"]
  onHoverCardPointerLeave: ReturnType<typeof useVocabularyHighlighting>["handleHoverCardPointerLeave"]
}) {
  useEffect(() => {
    onCardRectChange(hoverPreview ? cardRect : null)

    return () => {
      onCardRectChange(null)
    }
  }, [cardRect, hoverPreview, onCardRectChange])

  return hoverPreview
    ? createElement("div", {
        "data-testid": "hover-card-probe",
        "onPointerEnter": () => onHoverCardPointerEnter(),
        "onPointerLeave": () => onHoverCardPointerLeave(),
      })
    : null
}

function noop() {}

interface MockIntersectionObserverInstance {
  disconnect: () => void
  observe: (target: Element) => void
  trigger: (target: Element, isIntersecting?: boolean) => void
  unobserve: (target: Element) => void
  observedTargets: Set<Element>
}

let restoreIntersectionObserver: (() => void) | null = null

function installMockIntersectionObserver() {
  const originalIntersectionObserver = globalThis.IntersectionObserver
  const instances: MockIntersectionObserverInstance[] = []

  class MockIntersectionObserver implements MockIntersectionObserverInstance {
    observedTargets = new Set<Element>()

    constructor(private readonly callback: IntersectionObserverCallback) {
      instances.push(this)
    }

    observe(target: Element) {
      this.observedTargets.add(target)
    }

    unobserve(target: Element) {
      this.observedTargets.delete(target)
    }

    disconnect() {
      this.observedTargets.clear()
    }

    trigger(target: Element, isIntersecting = true) {
      this.callback([
        {
          isIntersecting,
          intersectionRatio: isIntersecting ? 1 : 0,
          target,
        } as IntersectionObserverEntry,
      ], this as unknown as IntersectionObserver)
    }
  }

  vi.stubGlobal("IntersectionObserver", MockIntersectionObserver)
  restoreIntersectionObserver = () => {
    if (originalIntersectionObserver) {
      vi.stubGlobal("IntersectionObserver", originalIntersectionObserver)
    }
    else {
      Reflect.deleteProperty(globalThis, "IntersectionObserver")
    }
    restoreIntersectionObserver = null
  }

  return {
    instances,
    triggerIntersecting(target: Element) {
      const observer = instances.find(instance => instance.observedTargets.has(target))
      expect(observer).toBeDefined()
      observer?.trigger(target)
    },
  }
}

function mockHighlightRootRect(
  element: Element,
  rect: Pick<DOMRectReadOnly, "bottom" | "height" | "left" | "right" | "top" | "width">,
) {
  vi.spyOn(element, "getBoundingClientRect").mockReturnValue({
    ...rect,
    x: rect.left,
    y: rect.top,
    toJSON: () => rect,
  } as DOMRect)
}

function createShadowParagraph(text: string) {
  const host = document.createElement("div")
  const shadowRoot = host.attachShadow({ mode: "open" })
  const paragraph = document.createElement("p")
  paragraph.textContent = text
  shadowRoot.append(paragraph)
  document.body.append(host)
  return {
    host,
    shadowRoot,
    paragraph,
  }
}

function createExcludedShadowParagraph(text: string) {
  const shadowParagraph = createShadowParagraph(text)
  shadowParagraph.host.setAttribute(SELECTION_CONTENT_OVERLAY_ROOT_ATTRIBUTE, "")
  return shadowParagraph
}

function dispatchPointerEventWithComposedPath(
  type: string,
  path: EventTarget[],
  init: MouseEventInit = {},
) {
  const event = new MouseEvent(type, {
    bubbles: true,
    composed: true,
    ...init,
  })

  Object.defineProperty(event, "composedPath", {
    configurable: true,
    value: () => path,
  })

  document.dispatchEvent(event)
}

function InteractiveHoverCardHarness({
  cardRect,
  enableCardPointerHandlers = false,
}: {
  cardRect: HoverCardRect
  enableCardPointerHandlers?: boolean
}) {
  const {
    hoverPreview,
    setHoverCardRect,
    handleHoverCardPointerEnter,
    handleHoverCardPointerLeave,
  } = useVocabularyHighlighting()

  return createElement(HoverCardProbe, {
    hoverPreview,
    cardRect,
    onCardRectChange: setHoverCardRect,
    onHoverCardPointerEnter: enableCardPointerHandlers ? handleHoverCardPointerEnter : noop,
    onHoverCardPointerLeave: enableCardPointerHandlers ? handleHoverCardPointerLeave : noop,
  })
}

beforeEach(() => {
  document.body.innerHTML = ""
  getVocabularyItemsMock.mockReset()
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => window.setTimeout(() => callback(performance.now()), 0))
  vi.stubGlobal("cancelAnimationFrame", (handle: number) => window.clearTimeout(handle))
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(180)
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(72)
})

afterEach(() => {
  cleanup()
  restoreIntersectionObserver?.()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe("shouldHighlightAcrossElements", () => {
  it("keeps single-word highlights inside their own node when adjacent nodes omit whitespace", async () => {
    const item = createVocabularyItem({
      sourceText: "integration",
      normalizedText: "integration",
      kind: "word",
      wordCount: 1,
    })

    await markVocabularyItem(item, `
      <h2><span>Integration</span><span>checklist</span></h2>
      <p>your integration is working.</p>
    `)

    const headingHighlight = document.querySelector("h2 mark")
    const paragraphHighlight = document.querySelector("p mark")

    expect(headingHighlight?.textContent).toBe("Integration")
    expect(paragraphHighlight?.textContent).toBe("integration")
  })

  it("still allows phrase highlights to span across multiple nodes", async () => {
    const item = createVocabularyItem({
      sourceText: "payment link",
      normalizedText: "payment link",
      kind: "phrase",
      wordCount: 2,
    })

    await markVocabularyItem(item, `
      <p><span>Set your default </span><span>payment </span><span>link</span></p>
    `)

    const highlights = [...document.querySelectorAll("p mark")]
    expect(highlights).toHaveLength(2)
    expect(highlights.map(node => node.textContent)).toEqual(["payment ", "link"])
  })

  it("treats adjacent punctuation as a valid boundary for exact word matches", async () => {
    const item = createVocabularyItem({
      sourceText: "please",
      normalizedText: "please",
      kind: "word",
      wordCount: 1,
    })

    await markVocabularyItem(item, `
      <p>cmon tibo..please</p>
      <p>pleased to help</p>
    `)

    const highlights = [...document.querySelectorAll("mark")]
    expect(highlights).toHaveLength(1)
    expect(highlights[0]?.textContent).toBe("please")
  })

  it("keeps highlighting vocabulary inside tracked page paragraphs", async () => {
    const item = createVocabularyItem({
      sourceText: "integration",
      normalizedText: "integration",
      kind: "word",
      wordCount: 1,
    })

    getVocabularyItemsMock.mockResolvedValue([item])
    document.body.innerHTML = `
      <main>
        <p data-read-frog-paragraph="">Integration is working.</p>
      </main>
    `

    const container = document.createElement("div")
    document.body.append(container)
    render(createElement(VocabularyHighlightingHarness), { container })

    await waitFor(() => {
      const highlight = document.querySelector("p mark")
      expect(highlight?.textContent).toBe("Integration")
      expect(highlight).toHaveClass(NOTRANSLATE_CLASS)
    })
  })

  it("does not start a background remote vocabulary probe while rendering page highlights", async () => {
    const item = createVocabularyItem({
      sourceText: "integration",
      normalizedText: "integration",
      kind: "word",
      wordCount: 1,
    })

    getVocabularyItemsMock.mockResolvedValue([item])
    document.body.innerHTML = `
      <main>
        <p>Integration is working.</p>
      </main>
    `

    const container = document.createElement("div")
    document.body.append(container)
    render(createElement(VocabularyHighlightingHarness), { container })

    await waitFor(() => {
      expect(document.querySelector("p mark")?.textContent).toBe("Integration")
    })
    expect(getVocabularyItemsMock).toHaveBeenCalledWith({ skipRemoteProbe: true })
  })

  it("does not select the whole highlight when it is clicked", async () => {
    const item = createVocabularyItem({
      sourceText: "integration",
      normalizedText: "integration",
      kind: "word",
      wordCount: 1,
    })

    getVocabularyItemsMock.mockResolvedValue([item])
    document.body.innerHTML = `
      <main>
        <p data-read-frog-paragraph="">Integration is working.</p>
      </main>
    `

    const container = document.createElement("div")
    document.body.append(container)
    render(createElement(VocabularyHighlightingHarness), { container })

    const highlight = await waitFor(() => {
      const node = document.querySelector("p mark") as HTMLElement | null
      expect(node).not.toBeNull()
      return node as HTMLElement
    })

    window.getSelection()?.removeAllRanges()
    fireEvent.click(highlight)

    expect(window.getSelection()?.toString()).toBe("")
  })

  it("clears the active page selection before applying highlights", async () => {
    const item = createVocabularyItem({
      sourceText: "integration",
      normalizedText: "integration",
      kind: "word",
      wordCount: 1,
    })

    getVocabularyItemsMock.mockResolvedValue([item])
    document.body.innerHTML = `
      <main>
        <p data-read-frog-paragraph="">Integration is working.</p>
      </main>
    `

    const paragraphText = document.querySelector("p")?.firstChild
    if (!(paragraphText instanceof Text)) {
      throw new TypeError("Paragraph text node is missing")
    }

    selectText(paragraphText, 0, "Integration".length)

    const container = document.createElement("div")
    document.body.append(container)
    render(createElement(VocabularyHighlightingHarness), { container })

    await waitFor(() => {
      expect(getVocabularyItemsMock).toHaveBeenCalledTimes(1)
      const highlight = document.querySelector("p mark")
      expect(highlight?.textContent).toBe("Integration")
    })

    expect(window.getSelection()?.toString()).toBe("")
  })

  it("highlights inflected word-family matches even when the saved source text differs", async () => {
    const item = createVocabularyItem({
      sourceText: "thinking",
      normalizedText: "think",
      matchTerms: ["thinking", "think", "thinks", "thought"],
      kind: "word",
      wordCount: 1,
    })

    getVocabularyItemsMock.mockResolvedValue([item])
    document.body.innerHTML = `
      <main>
        <p data-read-frog-paragraph="">I think this vocabulary highlight should work.</p>
      </main>
    `

    const container = document.createElement("div")
    document.body.append(container)
    render(createElement(VocabularyHighlightingHarness), { container })

    await waitFor(() => {
      const highlight = document.querySelector("p mark")
      expect(highlight?.textContent).toBe("think")
      expect(highlight).toHaveClass(NOTRANSLATE_CLASS)
    })
  })

  it("removes highlights immediately after an item is marked as mastered", async () => {
    const item = createVocabularyItem({
      sourceText: "integration",
      normalizedText: "integration",
      kind: "word",
      wordCount: 1,
    })
    let currentItems: VocabularyItem[] = [item]

    getVocabularyItemsMock.mockImplementation(async () => currentItems)
    document.body.innerHTML = `
      <main>
        <p data-read-frog-paragraph="">Integration is working.</p>
      </main>
    `

    const container = document.createElement("div")
    document.body.append(container)
    render(createElement(VocabularyHighlightingHarness), { container })

    await waitFor(() => {
      const highlight = document.querySelector("p mark")
      expect(highlight?.textContent).toBe("Integration")
    })

    currentItems = [
      {
        ...item,
        masteredAt: 10,
        updatedAt: 10,
      },
    ]
    document.dispatchEvent(new CustomEvent("lexio:vocabulary-changed"))

    await waitFor(() => {
      expect(document.querySelector("p mark")).toBeNull()
    })
  })

  it("does not rescan newly added content immediately after the first full highlight", async () => {
    const item = createVocabularyItem({
      sourceText: "integration",
      normalizedText: "integration",
      kind: "word",
      wordCount: 1,
    })

    getVocabularyItemsMock.mockResolvedValue([item])
    document.body.innerHTML = `
      <main>
        <p>Integration is working.</p>
      </main>
    `

    const container = document.createElement("div")
    document.body.append(container)
    render(createElement(VocabularyHighlightingHarness), { container })

    await waitFor(() => {
      const highlight = document.querySelector("p mark")
      expect(highlight?.textContent).toBe("Integration")
    })

    expect(getVocabularyItemsMock).toHaveBeenCalledTimes(1)

    const appendedParagraph = document.createElement("p")
    appendedParagraph.textContent = "Another integration arrived later."
    document.querySelector("main")?.append(appendedParagraph)

    await new Promise(resolve => window.setTimeout(resolve, 450))
    const highlights = [...document.querySelectorAll("main p mark")]
    expect(highlights).toHaveLength(1)
    expect(getVocabularyItemsMock).toHaveBeenCalledTimes(1)
  })

  it("preserves the current selection when new content is appended after the initial highlight pass", async () => {
    const item = createVocabularyItem({
      sourceText: "integration",
      normalizedText: "integration",
      kind: "word",
      wordCount: 1,
    })

    getVocabularyItemsMock.mockResolvedValue([item])
    document.body.innerHTML = `
      <main>
        <p>Integration is working.</p>
        <p>Keep this selection intact.</p>
      </main>
    `

    const container = document.createElement("div")
    document.body.append(container)
    render(createElement(VocabularyHighlightingHarness), { container })

    await waitFor(() => {
      const highlight = document.querySelector("p mark")
      expect(highlight?.textContent).toBe("Integration")
    })

    const selectionTextNode = document.querySelectorAll("main p")[1]?.firstChild
    if (!(selectionTextNode instanceof Text)) {
      throw new TypeError("Selection text node is missing")
    }

    selectText(selectionTextNode, 0, 4)
    expect(window.getSelection()?.toString()).toBe("Keep")

    const appendedParagraph = document.createElement("p")
    appendedParagraph.textContent = "Late integration should still highlight."
    document.querySelector("main")?.append(appendedParagraph)

    await new Promise(resolve => window.setTimeout(resolve, 450))
    const highlights = [...document.querySelectorAll("main p mark")]
    expect(highlights).toHaveLength(1)
    expect(window.getSelection()?.toString()).toBe("Keep")
  })

  it("highlights roots already near the viewport without waiting for an observer callback", async () => {
    installMockIntersectionObserver()
    const integrationItem = createVocabularyItem({
      id: "item-1",
      sourceText: "integration",
      normalizedText: "integration",
      kind: "word",
      wordCount: 1,
    })
    const cloudItem = createVocabularyItem({
      id: "item-2",
      sourceText: "cloud",
      normalizedText: "cloud",
      matchTerms: ["cloud"],
      translatedText: "云",
      kind: "word",
      wordCount: 1,
    })

    getVocabularyItemsMock.mockResolvedValue([integrationItem, cloudItem])
    document.body.innerHTML = `
      <main>
        <p id="visible-paragraph">Integration is working.</p>
        <p id="hidden-paragraph">The cloud paragraph starts outside the viewport.</p>
      </main>
    `

    const visibleParagraph = document.querySelector("#visible-paragraph")
    const hiddenParagraph = document.querySelector("#hidden-paragraph")
    expect(visibleParagraph).not.toBeNull()
    expect(hiddenParagraph).not.toBeNull()
    mockHighlightRootRect(visibleParagraph!, {
      bottom: 140,
      height: 20,
      left: 0,
      right: 600,
      top: 120,
      width: 600,
    })
    mockHighlightRootRect(hiddenParagraph!, {
      bottom: 2200,
      height: 20,
      left: 0,
      right: 600,
      top: 2180,
      width: 600,
    })

    const container = document.createElement("div")
    document.body.append(container)
    render(createElement(VocabularyHighlightingHarness), { container })

    await waitFor(() => {
      expect(document.querySelector("#visible-paragraph mark")?.textContent).toBe("Integration")
    })
    expect(document.querySelector("#hidden-paragraph mark")).toBeNull()
  })

  it("only highlights roots after they enter the visible area", async () => {
    const observer = installMockIntersectionObserver()
    const integrationItem = createVocabularyItem({
      id: "item-1",
      sourceText: "integration",
      normalizedText: "integration",
      kind: "word",
      wordCount: 1,
    })
    const cloudItem = createVocabularyItem({
      id: "item-2",
      sourceText: "cloud",
      normalizedText: "cloud",
      matchTerms: ["cloud"],
      translatedText: "云",
      kind: "word",
      wordCount: 1,
    })

    getVocabularyItemsMock.mockResolvedValue([integrationItem, cloudItem])
    document.body.innerHTML = `
      <main>
        <p id="visible-paragraph">Integration is working.</p>
        <p id="hidden-paragraph">The cloud paragraph starts outside the viewport.</p>
      </main>
    `

    const container = document.createElement("div")
    document.body.append(container)
    render(createElement(VocabularyHighlightingHarness), { container })

    const visibleParagraph = document.querySelector("#visible-paragraph")
    const hiddenParagraph = document.querySelector("#hidden-paragraph")
    expect(visibleParagraph).not.toBeNull()
    expect(hiddenParagraph).not.toBeNull()

    await waitFor(() => {
      expect(observer.instances[0]?.observedTargets.has(visibleParagraph!)).toBe(true)
      expect(observer.instances[0]?.observedTargets.has(hiddenParagraph!)).toBe(true)
    })

    observer.triggerIntersecting(visibleParagraph!)

    await waitFor(() => {
      expect(document.querySelector("#visible-paragraph mark")?.textContent).toBe("Integration")
    })
    expect(document.querySelector("#hidden-paragraph mark")).toBeNull()

    observer.triggerIntersecting(hiddenParagraph!)

    await waitFor(() => {
      expect(document.querySelector("#hidden-paragraph mark")?.textContent).toBe("cloud")
    })
  })

  it("observes added DOM and highlights it when it becomes visible", async () => {
    const observer = installMockIntersectionObserver()
    const integrationItem = createVocabularyItem({
      id: "item-1",
      sourceText: "integration",
      normalizedText: "integration",
      kind: "word",
      wordCount: 1,
    })

    getVocabularyItemsMock.mockResolvedValue([integrationItem])
    document.body.innerHTML = `
      <main>
        <p id="initial-paragraph">Integration is working.</p>
      </main>
    `

    const container = document.createElement("div")
    document.body.append(container)
    render(createElement(VocabularyHighlightingHarness), { container })

    const initialParagraph = document.querySelector("#initial-paragraph")
    expect(initialParagraph).not.toBeNull()

    await waitFor(() => {
      expect(observer.instances[0]?.observedTargets.has(initialParagraph!)).toBe(true)
    })
    observer.triggerIntersecting(initialParagraph!)

    await waitFor(() => {
      expect(document.querySelector("#initial-paragraph mark")?.textContent).toBe("Integration")
    })

    const addedParagraph = document.createElement("p")
    addedParagraph.id = "added-paragraph"
    addedParagraph.textContent = "A late integration should be highlighted lazily."
    document.querySelector("main")?.append(addedParagraph)

    await waitFor(() => {
      expect(observer.instances[0]?.observedTargets.has(addedParagraph)).toBe(true)
    })
    expect(document.querySelector("#added-paragraph mark")).toBeNull()

    observer.triggerIntersecting(addedParagraph)

    await waitFor(() => {
      expect(document.querySelector("#added-paragraph mark")?.textContent).toBe("integration")
    })
  })

  it("rehighlights a visible root after its DOM is replaced without reloading the vocabulary list", async () => {
    const observer = installMockIntersectionObserver()
    const integrationItem = createVocabularyItem({
      id: "item-1",
      sourceText: "integration",
      normalizedText: "integration",
      kind: "word",
      wordCount: 1,
    })

    getVocabularyItemsMock.mockResolvedValue([integrationItem])
    document.body.innerHTML = `
      <main>
        <p id="visible-paragraph">Integration is working.</p>
      </main>
    `

    const container = document.createElement("div")
    document.body.append(container)
    render(createElement(VocabularyHighlightingHarness), { container })

    const paragraph = document.querySelector("#visible-paragraph")
    expect(paragraph).not.toBeNull()

    await waitFor(() => {
      expect(observer.instances[0]?.observedTargets.has(paragraph!)).toBe(true)
    })
    observer.triggerIntersecting(paragraph!)

    const initialHighlight = await waitFor(() => {
      const node = document.querySelector("#visible-paragraph mark") as HTMLElement | null
      expect(node?.textContent).toBe("Integration")
      return node as HTMLElement
    })
    expect(getVocabularyItemsMock).toHaveBeenCalledTimes(1)

    paragraph!.innerHTML = "<span>Integration</span> still works after replacement."

    await waitFor(() => {
      const replacementHighlight = document.querySelector("#visible-paragraph mark") as HTMLElement | null
      expect(replacementHighlight?.textContent).toBe("Integration")
      expect(replacementHighlight).not.toBe(initialHighlight)
    })
    expect(getVocabularyItemsMock).toHaveBeenCalledTimes(1)
  })

  it("keeps visible highlights in place when childList changes add only empty elements", async () => {
    const observer = installMockIntersectionObserver()
    const integrationItem = createVocabularyItem({
      id: "item-1",
      sourceText: "integration",
      normalizedText: "integration",
      kind: "word",
      wordCount: 1,
    })

    getVocabularyItemsMock.mockResolvedValue([integrationItem])
    document.body.innerHTML = `
      <main>
        <p id="visible-paragraph">Integration is working.</p>
      </main>
    `

    const container = document.createElement("div")
    document.body.append(container)
    render(createElement(VocabularyHighlightingHarness), { container })

    const paragraph = document.querySelector("#visible-paragraph")
    expect(paragraph).not.toBeNull()

    await waitFor(() => {
      expect(observer.instances[0]?.observedTargets.has(paragraph!)).toBe(true)
    })
    observer.triggerIntersecting(paragraph!)

    await waitFor(() => {
      const node = document.querySelector("#visible-paragraph mark") as HTMLElement | null
      expect(node?.textContent).toBe("Integration")
    })

    const decoration = document.createElement("span")
    decoration.setAttribute("aria-hidden", "true")
    paragraph?.append(decoration)

    await new Promise(resolve => window.setTimeout(resolve, 50))

    expect(document.querySelector("#visible-paragraph mark")?.textContent).toBe("Integration")
    expect(paragraph?.lastElementChild).toBe(decoration)
    expect(getVocabularyItemsMock).toHaveBeenCalledTimes(1)
  })

  it("ignores rf debug panels when they update their own text", async () => {
    const observer = installMockIntersectionObserver()
    const integrationItem = createVocabularyItem({
      id: "item-1",
      sourceText: "integration",
      normalizedText: "integration",
      kind: "word",
      wordCount: 1,
    })

    getVocabularyItemsMock.mockResolvedValue([integrationItem])
    document.body.innerHTML = `
      <main>
        <p id="visible-paragraph">Integration is working.</p>
      </main>
    `

    const debugPanel = document.createElement("div")
    debugPanel.id = "rf-debug-panel"
    debugPanel.textContent = "marks=0"
    document.body.append(debugPanel)

    const container = document.createElement("div")
    document.body.append(container)
    render(createElement(VocabularyHighlightingHarness), { container })

    const paragraph = document.querySelector("#visible-paragraph")
    expect(paragraph).not.toBeNull()

    await waitFor(() => {
      expect(observer.instances[0]?.observedTargets.has(paragraph!)).toBe(true)
    })
    expect(observer.instances[0]?.observedTargets.has(debugPanel)).toBe(false)
    observer.triggerIntersecting(paragraph!)

    await waitFor(() => {
      const node = document.querySelector("#visible-paragraph mark") as HTMLElement | null
      expect(node?.textContent).toBe("Integration")
    })

    debugPanel.textContent = "marks=1 childList added=1 removed=1"
    await new Promise(resolve => window.setTimeout(resolve, 50))

    expect(observer.instances[0]?.observedTargets.has(debugPanel)).toBe(false)
    expect(document.querySelector("#visible-paragraph mark")?.textContent).toBe("Integration")
    expect(debugPanel.querySelector("mark")).toBeNull()
    expect(getVocabularyItemsMock).toHaveBeenCalledTimes(1)
  })

  it("keeps offscreen highlights until their root becomes visible again after vocabulary changes", async () => {
    const observer = installMockIntersectionObserver()
    const integrationItem = createVocabularyItem({
      id: "item-1",
      sourceText: "integration",
      normalizedText: "integration",
      kind: "word",
      wordCount: 1,
    })
    const cloudItem = createVocabularyItem({
      id: "item-2",
      sourceText: "cloud",
      normalizedText: "cloud",
      matchTerms: ["cloud"],
      translatedText: "云",
      kind: "word",
      wordCount: 1,
    })
    const keepItem = createVocabularyItem({
      id: "item-3",
      sourceText: "Keep",
      normalizedText: "keep",
      matchTerms: ["keep"],
      translatedText: "保留",
      kind: "word",
      wordCount: 1,
    })

    let currentItems = [integrationItem, cloudItem]
    getVocabularyItemsMock.mockImplementation(async () => currentItems)
    document.body.innerHTML = `
      <main>
        <p id="visible-paragraph">Integration should Keep working.</p>
        <p id="hidden-paragraph">The cloud highlight should stay offscreen.</p>
      </main>
    `

    const container = document.createElement("div")
    document.body.append(container)
    render(createElement(VocabularyHighlightingHarness), { container })

    const visibleParagraph = document.querySelector("#visible-paragraph")
    const hiddenParagraph = document.querySelector("#hidden-paragraph")
    expect(visibleParagraph).not.toBeNull()
    expect(hiddenParagraph).not.toBeNull()

    await waitFor(() => {
      expect(observer.instances[0]?.observedTargets.has(visibleParagraph!)).toBe(true)
      expect(observer.instances[0]?.observedTargets.has(hiddenParagraph!)).toBe(true)
    })
    observer.triggerIntersecting(visibleParagraph!)
    observer.triggerIntersecting(hiddenParagraph!)

    await waitFor(() => {
      expect(document.querySelector("#visible-paragraph mark")?.textContent).toBe("Integration")
      expect(document.querySelector("#hidden-paragraph mark")?.textContent).toBe("cloud")
    })

    observer.instances[0]?.trigger(hiddenParagraph!, false)

    currentItems = [integrationItem, keepItem]
    document.dispatchEvent(new CustomEvent("lexio:vocabulary-changed"))

    await waitFor(() => {
      expect(getVocabularyItemsMock).toHaveBeenCalledTimes(2)
    })

    await waitFor(() => {
      const visibleHighlights = [...document.querySelectorAll("#visible-paragraph mark")]
      expect(visibleHighlights.map(highlight => highlight.textContent)).toEqual(["Integration", "Keep"])
    })
    expect(document.querySelector("#hidden-paragraph mark")?.textContent).toBe("cloud")

    observer.triggerIntersecting(hiddenParagraph!)

    await waitFor(() => {
      expect(document.querySelector("#hidden-paragraph mark")).toBeNull()
    })
  })

  it("highlights initial open shadow root content lazily", async () => {
    const observer = installMockIntersectionObserver()
    const integrationItem = createVocabularyItem({
      id: "item-1",
      sourceText: "integration",
      normalizedText: "integration",
      kind: "word",
      wordCount: 1,
    })

    getVocabularyItemsMock.mockResolvedValue([integrationItem])
    const { paragraph } = createShadowParagraph("Integration lives inside shadow DOM.")

    const container = document.createElement("div")
    document.body.append(container)
    render(createElement(VocabularyHighlightingHarness), { container })

    await waitFor(() => {
      expect(observer.instances[0]?.observedTargets.has(paragraph)).toBe(true)
    })

    observer.triggerIntersecting(paragraph)

    await waitFor(() => {
      expect(paragraph.querySelector("mark")?.textContent).toBe("Integration")
    })
  })

  it("does not observe shadow roots whose host is marked as selection overlay UI", async () => {
    const observer = installMockIntersectionObserver()
    const integrationItem = createVocabularyItem({
      id: "item-1",
      sourceText: "integration",
      normalizedText: "integration",
      kind: "word",
      wordCount: 1,
    })

    getVocabularyItemsMock.mockResolvedValue([integrationItem])
    const { paragraph } = createExcludedShadowParagraph("Integration inside the overlay shadow DOM.")

    const container = document.createElement("div")
    document.body.append(container)
    render(createElement(VocabularyHighlightingHarness), { container })

    await waitFor(() => {
      expect(getVocabularyItemsMock).toHaveBeenCalledTimes(1)
    })

    expect(observer.instances[0]?.observedTargets.has(paragraph)).toBe(false)
    expect(paragraph.querySelector("mark")).toBeNull()
  })

  it("rehighlights visible shadow root content after DOM replacement", async () => {
    const observer = installMockIntersectionObserver()
    const integrationItem = createVocabularyItem({
      id: "item-1",
      sourceText: "integration",
      normalizedText: "integration",
      kind: "word",
      wordCount: 1,
    })

    getVocabularyItemsMock.mockResolvedValue([integrationItem])
    const { paragraph } = createShadowParagraph("Integration lives inside shadow DOM.")

    const container = document.createElement("div")
    document.body.append(container)
    render(createElement(VocabularyHighlightingHarness), { container })

    await waitFor(() => {
      expect(observer.instances[0]?.observedTargets.has(paragraph)).toBe(true)
    })
    observer.triggerIntersecting(paragraph)

    const initialHighlight = await waitFor(() => {
      const node = paragraph.querySelector("mark") as HTMLElement | null
      expect(node?.textContent).toBe("Integration")
      return node as HTMLElement
    })
    expect(getVocabularyItemsMock).toHaveBeenCalledTimes(1)

    paragraph.innerHTML = "<span>Integration</span> still works in shadow DOM."

    await waitFor(() => {
      const replacementHighlight = paragraph.querySelector("mark") as HTMLElement | null
      expect(replacementHighlight?.textContent).toBe("Integration")
      expect(replacementHighlight).not.toBe(initialHighlight)
    })
    expect(getVocabularyItemsMock).toHaveBeenCalledTimes(1)
  })

  it("clears the active page selection before reapplying full highlights after vocabulary changes", async () => {
    const integrationItem = createVocabularyItem({
      id: "item-1",
      sourceText: "integration",
      normalizedText: "integration",
      kind: "word",
      wordCount: 1,
    })
    const keepItem = createVocabularyItem({
      id: "item-2",
      sourceText: "Keep",
      normalizedText: "keep",
      matchTerms: ["keep"],
      translatedText: "保留",
      kind: "word",
      wordCount: 1,
    })
    let currentItems: VocabularyItem[] = [integrationItem]

    getVocabularyItemsMock.mockImplementation(async () => currentItems)
    document.body.innerHTML = `
      <main>
        <p>Integration is working.</p>
        <p>Keep this selection intact.</p>
      </main>
    `

    const container = document.createElement("div")
    document.body.append(container)
    render(createElement(VocabularyHighlightingHarness), { container })

    await waitFor(() => {
      const highlight = document.querySelector("p mark")
      expect(highlight?.textContent).toBe("Integration")
    })

    const selectionTextNode = document.querySelectorAll("main p")[1]?.firstChild
    if (!(selectionTextNode instanceof Text)) {
      throw new TypeError("Selection text node is missing")
    }

    selectText(selectionTextNode, 0, 4)
    expect(window.getSelection()?.toString()).toBe("Keep")

    currentItems = [integrationItem, keepItem]
    document.dispatchEvent(new CustomEvent("lexio:vocabulary-changed"))

    await waitFor(() => {
      expect(getVocabularyItemsMock).toHaveBeenCalledTimes(2)
      const highlights = [...document.querySelectorAll("main p mark")]
      expect(highlights).toHaveLength(2)
      expect(highlights[1]?.textContent).toBe("Keep")
    })

    expect(window.getSelection()?.toString()).toBe("")
  })

  it("keeps existing highlights and applies small vocabulary additions incrementally", async () => {
    const integrationItem = createVocabularyItem({
      id: "item-1",
      sourceText: "integration",
      normalizedText: "integration",
      kind: "word",
      wordCount: 1,
    })
    const keepItem = createVocabularyItem({
      id: "item-2",
      sourceText: "Keep",
      normalizedText: "keep",
      matchTerms: ["keep"],
      translatedText: "保留",
      kind: "word",
      wordCount: 1,
    })
    let currentItems: VocabularyItem[] = [integrationItem]

    getVocabularyItemsMock.mockImplementation(async () => currentItems)
    document.body.innerHTML = `
      <main>
        <p>Integration is working.</p>
        <p>Keep this selection intact.</p>
      </main>
    `

    const container = document.createElement("div")
    document.body.append(container)
    render(createElement(VocabularyHighlightingHarness), { container })

    await waitFor(() => {
      const highlight = document.querySelector("p mark")
      expect(highlight?.textContent).toBe("Integration")
    })
    const existingHighlight = document.querySelector("p mark")

    const largePageNodes = document.createDocumentFragment()
    for (let index = 0; index < 1810; index += 1) {
      largePageNodes.append(document.createElement("span"))
    }
    document.body.append(largePageNodes)

    currentItems = [integrationItem, keepItem]
    document.dispatchEvent(new CustomEvent("lexio:vocabulary-changed"))

    await waitFor(() => {
      expect(getVocabularyItemsMock).toHaveBeenCalledTimes(2)
      const highlights = [...document.querySelectorAll("main p mark")]
      expect(highlights.map(highlight => highlight.textContent)).toEqual(["Integration", "Keep"])
    })
    expect(document.querySelector("main p mark")).toBe(existingHighlight)
  })

  it("uses vocabulary change snapshots without reloading vocabulary items", async () => {
    const integrationItem = createVocabularyItem({
      id: "item-1",
      sourceText: "integration",
      normalizedText: "integration",
      kind: "word",
      wordCount: 1,
    })
    const cloudItem = createVocabularyItem({
      id: "item-2",
      sourceText: "cloud",
      normalizedText: "cloud",
      matchTerms: ["cloud"],
      translatedText: "云",
      kind: "word",
      wordCount: 1,
    })

    getVocabularyItemsMock.mockResolvedValue([integrationItem])
    document.body.innerHTML = `
      <main>
        <p>Integration is working.</p>
        <p>The cloud should be highlighted after the update.</p>
      </main>
    `

    const container = document.createElement("div")
    document.body.append(container)
    render(createElement(VocabularyHighlightingHarness), { container })

    const existingHighlight = await waitFor(() => {
      const highlight = document.querySelector("main p mark")
      expect(highlight?.textContent).toBe("Integration")
      return highlight
    })
    expect(getVocabularyItemsMock).toHaveBeenCalledTimes(1)

    document.dispatchEvent(new CustomEvent("lexio:vocabulary-changed", {
      detail: {
        items: [integrationItem, cloudItem],
      },
    }))

    await waitFor(() => {
      const highlights = [...document.querySelectorAll("main p mark")]
      expect(highlights.map(highlight => highlight.textContent)).toEqual(["Integration", "cloud"])
    })
    expect(getVocabularyItemsMock).toHaveBeenCalledTimes(1)
    expect(document.querySelector("main p mark")).toBe(existingHighlight)
  })

  it("removes stale item highlights without replacing unrelated highlights", async () => {
    const integrationItem = createVocabularyItem({
      id: "item-1",
      sourceText: "integration",
      normalizedText: "integration",
      kind: "word",
      wordCount: 1,
    })
    const cloudItem = createVocabularyItem({
      id: "item-2",
      sourceText: "cloud",
      normalizedText: "cloud",
      matchTerms: ["cloud"],
      translatedText: "云",
      kind: "word",
      wordCount: 1,
    })

    getVocabularyItemsMock.mockResolvedValue([integrationItem, cloudItem])
    document.body.innerHTML = `
      <main>
        <p>Integration is working.</p>
        <p>The cloud highlight will be removed.</p>
      </main>
    `

    const container = document.createElement("div")
    document.body.append(container)
    render(createElement(VocabularyHighlightingHarness), { container })

    const existingHighlight = await waitFor(() => {
      const highlights = [...document.querySelectorAll("main p mark")]
      expect(highlights.map(highlight => highlight.textContent)).toEqual(["Integration", "cloud"])
      return highlights[0]
    })

    document.dispatchEvent(new CustomEvent("lexio:vocabulary-changed", {
      detail: {
        items: [integrationItem],
      },
    }))

    await waitFor(() => {
      const highlights = [...document.querySelectorAll("main p mark")]
      expect(highlights.map(highlight => highlight.textContent)).toEqual(["Integration"])
    })
    expect(getVocabularyItemsMock).toHaveBeenCalledTimes(1)
    expect(document.querySelector("main p mark")).toBe(existingHighlight)
  })

  it("keeps unrelated highlights in place when dictionary details update a newly added item", async () => {
    const integrationItem = createVocabularyItem({
      id: "item-1",
      sourceText: "integration",
      normalizedText: "integration",
      kind: "word",
      wordCount: 1,
    })
    const initialSawItem = createVocabularyItem({
      id: "item-2",
      sourceText: "saw",
      normalizedText: "see",
      matchTerms: ["see", "sees", "seeing", "saw", "seen"],
      translatedText: "看见",
      kind: "word",
      wordCount: 1,
    })
    const detailedSawItem = {
      ...initialSawItem,
      normalizedText: "saw",
      matchTerms: ["saw", "saws", "sawing", "sawed"],
      lemma: "saw",
      updatedAt: 2,
    }
    let currentItems: VocabularyItem[] = [integrationItem]

    getVocabularyItemsMock.mockImplementation(async () => currentItems)
    document.body.innerHTML = `
      <main>
        <p>Integration is working.</p>
        <p>I saw the result.</p>
      </main>
    `

    const container = document.createElement("div")
    document.body.append(container)
    render(createElement(VocabularyHighlightingHarness), { container })

    const existingHighlight = await waitFor(() => {
      const highlight = [...document.querySelectorAll("main p mark")]
        .find(node => node.textContent === "Integration")
      expect(highlight).not.toBeUndefined()
      return highlight
    })

    currentItems = [integrationItem, initialSawItem]
    document.dispatchEvent(new CustomEvent("lexio:vocabulary-changed"))

    await waitFor(() => {
      const highlights = [...document.querySelectorAll("main p mark")]
      expect(highlights.map(highlight => highlight.textContent)).toEqual(["Integration", "saw"])
    })

    currentItems = [integrationItem, detailedSawItem]
    document.dispatchEvent(new CustomEvent("lexio:vocabulary-changed"))

    await waitFor(() => {
      const highlights = [...document.querySelectorAll("main p mark")]
      expect(highlights.map(highlight => highlight.textContent)).toEqual(["Integration", "saw"])
    })
    expect([...document.querySelectorAll("main p mark")]
      .find(node => node.textContent === "Integration")).toBe(existingHighlight)
  })

  it("keeps unrelated highlights in place when a newly added item overlaps an existing term", async () => {
    const integrationItem = createVocabularyItem({
      id: "item-0",
      sourceText: "integration",
      normalizedText: "integration",
      matchTerms: ["integration"],
      translatedText: "集成",
      kind: "word",
      wordCount: 1,
    })
    const cloudsItem = createVocabularyItem({
      id: "item-1",
      sourceText: "clouds",
      normalizedText: "cloud",
      matchTerms: ["clouds"],
      translatedText: "云",
      kind: "word",
      wordCount: 1,
    })
    const cloudItem = createVocabularyItem({
      id: "item-2",
      sourceText: "cloud",
      normalizedText: "cloud",
      matchTerms: ["cloud"],
      translatedText: "云",
      kind: "word",
      wordCount: 1,
    })
    let currentItems: VocabularyItem[] = [integrationItem, cloudsItem]

    getVocabularyItemsMock.mockImplementation(async () => currentItems)
    document.body.innerHTML = `
      <main>
        <p>Integration remains highlighted.</p>
        <p>Clouds are not the same as one cloud.</p>
      </main>
    `

    const container = document.createElement("div")
    document.body.append(container)
    render(createElement(VocabularyHighlightingHarness), { container })

    const unrelatedHighlight = await waitFor(() => {
      const highlight = [...document.querySelectorAll("main p mark")]
        .find(node => node.textContent === "Integration")
      expect(highlight).not.toBeUndefined()
      return highlight
    })

    currentItems = [integrationItem, cloudsItem, cloudItem]
    document.dispatchEvent(new CustomEvent("lexio:vocabulary-changed"))

    await waitFor(() => {
      const highlights = [...document.querySelectorAll("main p mark")]
      expect(highlights.map(highlight => highlight.textContent)).toEqual(["Integration", "Clouds", "cloud"])
    })
    expect([...document.querySelectorAll("main p mark")]
      .find(node => node.textContent === "Integration")).toBe(unrelatedHighlight)
  })

  it("reruns highlighting when a vocabulary change arrives during an active scan", async () => {
    const integrationItem = createVocabularyItem({
      id: "item-1",
      sourceText: "integration",
      normalizedText: "integration",
      kind: "word",
      wordCount: 1,
    })
    const incomingItem = createVocabularyItem({
      id: "item-2",
      sourceText: "incoming",
      normalizedText: "incoming",
      matchTerms: ["incoming"],
      translatedText: "传入的",
      kind: "word",
      wordCount: 1,
    })
    let currentItems: VocabularyItem[] = [integrationItem]
    let resolveInitialItems: (items: VocabularyItem[]) => void = () => {}

    getVocabularyItemsMock
      .mockReturnValueOnce(new Promise<VocabularyItem[]>((resolve) => {
        resolveInitialItems = resolve
      }))
      .mockImplementation(async () => currentItems)

    document.body.innerHTML = `
      <main>
        <p>Integration is working.</p>
        <p>An incoming request arrived later.</p>
      </main>
    `

    const container = document.createElement("div")
    document.body.append(container)
    render(createElement(VocabularyHighlightingHarness), { container })

    currentItems = [integrationItem, incomingItem]
    document.dispatchEvent(new CustomEvent("lexio:vocabulary-changed"))
    resolveInitialItems([integrationItem])

    await waitFor(() => {
      const highlights = [...document.querySelectorAll("main p mark")]
      expect(highlights.map(highlight => highlight.textContent)).toEqual(["Integration", "incoming"])
    })
    expect(getVocabularyItemsMock).toHaveBeenCalledTimes(2)
  })

  it("still highlights all words when the vocabulary list is large", async () => {
    const items = Array.from({ length: 60 }, (_, index) => {
      const term = `term${String(index).padStart(2, "0")}`
      return createVocabularyItem({
        id: `item-${index}`,
        sourceText: term,
        normalizedText: term,
        matchTerms: [term],
        translatedText: `译文${index}`,
      })
    })

    getVocabularyItemsMock.mockResolvedValue(items)
    document.body.innerHTML = `
      <main>
        <p>${items.map(item => item.sourceText).join(" ")}</p>
      </main>
    `

    const container = document.createElement("div")
    document.body.append(container)
    render(createElement(VocabularyHighlightingHarness), { container })

    await waitFor(() => {
      const highlights = [...document.querySelectorAll("main p mark")]
      expect(highlights).toHaveLength(items.length)
    })
  })

  it("keeps the hover card open after a visible light DOM root is rehighlighted", async () => {
    const observer = installMockIntersectionObserver()
    const item = createVocabularyItem({
      sourceText: "integration",
      normalizedText: "integration",
      kind: "word",
    })

    getVocabularyItemsMock.mockResolvedValue([item])
    document.body.innerHTML = `
      <main>
        <p id="hover-paragraph" data-read-frog-paragraph="">Integration is working.</p>
      </main>
    `

    const container = document.createElement("div")
    document.body.append(container)
    render(createElement(InteractiveHoverCardHarness, {
      cardRect: {
        top: 76,
        right: 310,
        bottom: 148,
        left: 130,
        width: 180,
        height: 72,
      },
    }), { container })

    const paragraph = document.querySelector("#hover-paragraph")
    expect(paragraph).not.toBeNull()

    await waitFor(() => {
      expect(observer.instances[0]?.observedTargets.has(paragraph!)).toBe(true)
    })
    observer.triggerIntersecting(paragraph!)

    const highlight = await waitFor(() => {
      const node = document.querySelector("#hover-paragraph mark") as HTMLElement | null
      expect(node).not.toBeNull()
      return node as HTMLElement
    })

    vi.spyOn(highlight, "getBoundingClientRect").mockReturnValue({
      top: 160,
      right: 240,
      bottom: 180,
      left: 200,
      width: 40,
      height: 20,
      x: 200,
      y: 160,
      toJSON: () => ({}),
    } as DOMRect)

    fireEvent.pointerOver(highlight, {
      clientX: 220,
      clientY: 170,
    })

    await waitFor(() => {
      expect(document.querySelector("[data-testid='hover-card-probe']")).not.toBeNull()
    })

    paragraph!.innerHTML = "<span>Integration</span> still works after rehighlight."

    const replacementHighlight = await waitFor(() => {
      const node = document.querySelector("#hover-paragraph mark") as HTMLElement | null
      expect(node).not.toBeNull()
      expect(node).not.toBe(highlight)
      return node as HTMLElement
    })

    vi.spyOn(replacementHighlight, "getBoundingClientRect").mockReturnValue({
      top: 160,
      right: 240,
      bottom: 180,
      left: 200,
      width: 40,
      height: 20,
      x: 200,
      y: 160,
      toJSON: () => ({}),
    } as DOMRect)

    await waitFor(() => {
      expect(document.querySelector("[data-testid='hover-card-probe']")).not.toBeNull()
    })
  })

  it("opens and keeps shadow DOM hover interactions alive through composed paths", async () => {
    const observer = installMockIntersectionObserver()
    const item = createVocabularyItem({
      sourceText: "integration",
      normalizedText: "integration",
      kind: "word",
    })

    getVocabularyItemsMock.mockResolvedValue([item])
    const { host, shadowRoot, paragraph } = createShadowParagraph("Integration is working in shadow DOM.")

    const container = document.createElement("div")
    document.body.append(container)
    render(createElement(InteractiveHoverCardHarness, {
      enableCardPointerHandlers: true,
      cardRect: {
        top: 76,
        right: 310,
        bottom: 148,
        left: 130,
        width: 180,
        height: 72,
      },
    }), { container })

    await waitFor(() => {
      expect(observer.instances[0]?.observedTargets.has(paragraph)).toBe(true)
    })
    observer.triggerIntersecting(paragraph)

    const highlight = await waitFor(() => {
      const node = paragraph.querySelector("mark") as HTMLElement | null
      expect(node).not.toBeNull()
      return node as HTMLElement
    })

    vi.spyOn(highlight, "getBoundingClientRect").mockReturnValue({
      top: 160,
      right: 240,
      bottom: 180,
      left: 200,
      width: 40,
      height: 20,
      x: 200,
      y: 160,
      toJSON: () => ({}),
    } as DOMRect)

    dispatchPointerEventWithComposedPath("pointerover", [
      highlight,
      paragraph,
      shadowRoot,
      host,
      document.body,
      document,
      window,
    ], {
      clientX: 220,
      clientY: 170,
    })

    await waitFor(() => {
      const node = document.querySelector("[data-testid='hover-card-probe']") as HTMLElement | null
      expect(node).not.toBeNull()
      return node as HTMLElement
    })
    await new Promise(resolve => window.setTimeout(resolve, 0))
    await new Promise(resolve => window.setTimeout(resolve, 20))

    vi.useFakeTimers()

    dispatchPointerEventWithComposedPath("pointermove", [
      host,
      document.body,
      document,
      window,
    ], {
      clientX: 210,
      clientY: 154,
    })
    await vi.advanceTimersByTimeAsync(120)
    expect(document.querySelector("[data-testid='hover-card-probe']")).not.toBeNull()
  })

  it("keeps the hover card open while the cursor crosses the bridge between the highlight and the card", async () => {
    const item = createVocabularyItem({
      sourceText: "integration",
      normalizedText: "integration",
      kind: "word",
    })

    getVocabularyItemsMock.mockResolvedValue([item])
    document.body.innerHTML = `
      <main>
        <p data-read-frog-paragraph="">Integration is working.</p>
      </main>
    `

    const container = document.createElement("div")
    document.body.append(container)
    render(createElement(InteractiveHoverCardHarness, {
      cardRect: {
        top: 76,
        right: 310,
        bottom: 148,
        left: 130,
        width: 180,
        height: 72,
      },
    }), { container })

    const highlight = await waitFor(() => {
      const node = document.querySelector("p mark") as HTMLElement | null
      expect(node).not.toBeNull()
      return node as HTMLElement
    })

    vi.spyOn(highlight, "getBoundingClientRect").mockReturnValue({
      top: 160,
      right: 240,
      bottom: 180,
      left: 200,
      width: 40,
      height: 20,
      x: 200,
      y: 160,
      toJSON: () => ({}),
    } as DOMRect)

    fireEvent.pointerOver(highlight, {
      clientX: 220,
      clientY: 170,
    })

    await waitFor(() => {
      expect(document.querySelector("[data-testid='hover-card-probe']")).not.toBeNull()
    })

    vi.useFakeTimers()
    fireEvent.pointerMove(document.body, {
      clientX: 210,
      clientY: 154,
    })
    await vi.advanceTimersByTimeAsync(120)

    expect(document.querySelector("[data-testid='hover-card-probe']")).not.toBeNull()
  })

  it("keeps the hover card open when the card overlaps the highlight", async () => {
    const item = createVocabularyItem({
      sourceText: "integration",
      normalizedText: "integration",
      kind: "word",
    })

    getVocabularyItemsMock.mockResolvedValue([item])
    document.body.innerHTML = `
      <main>
        <p data-read-frog-paragraph="">Integration is working.</p>
      </main>
    `

    const container = document.createElement("div")
    document.body.append(container)
    render(createElement(InteractiveHoverCardHarness, {
      cardRect: {
        top: 150,
        right: 320,
        bottom: 222,
        left: 170,
        width: 150,
        height: 72,
      },
    }), { container })

    const highlight = await waitFor(() => {
      const node = document.querySelector("p mark") as HTMLElement | null
      expect(node).not.toBeNull()
      return node as HTMLElement
    })

    vi.spyOn(highlight, "getBoundingClientRect").mockReturnValue({
      top: 160,
      right: 240,
      bottom: 180,
      left: 200,
      width: 40,
      height: 20,
      x: 200,
      y: 160,
      toJSON: () => ({}),
    } as DOMRect)

    fireEvent.pointerOver(highlight, {
      clientX: 220,
      clientY: 170,
    })

    await waitFor(() => {
      expect(document.querySelector("[data-testid='hover-card-probe']")).not.toBeNull()
    })

    vi.useFakeTimers()
    fireEvent.pointerMove(document.body, {
      clientX: 214,
      clientY: 170,
    })
    await vi.advanceTimersByTimeAsync(120)

    expect(document.querySelector("[data-testid='hover-card-probe']")).not.toBeNull()
  })

  it("keeps the hover card open after the pointer enters the card itself", async () => {
    const item = createVocabularyItem({
      sourceText: "integration",
      normalizedText: "integration",
      kind: "word",
    })

    getVocabularyItemsMock.mockResolvedValue([item])
    document.body.innerHTML = `
      <main>
        <p data-read-frog-paragraph="">Integration is working.</p>
      </main>
    `

    const container = document.createElement("div")
    document.body.append(container)
    render(createElement(InteractiveHoverCardHarness, {
      enableCardPointerHandlers: true,
      cardRect: {
        top: 76,
        right: 310,
        bottom: 148,
        left: 130,
        width: 180,
        height: 72,
      },
    }), { container })

    const highlight = await waitFor(() => {
      const node = document.querySelector("p mark") as HTMLElement | null
      expect(node).not.toBeNull()
      return node as HTMLElement
    })

    vi.spyOn(highlight, "getBoundingClientRect").mockReturnValue({
      top: 160,
      right: 240,
      bottom: 180,
      left: 200,
      width: 40,
      height: 20,
      x: 200,
      y: 160,
      toJSON: () => ({}),
    } as DOMRect)

    fireEvent.pointerOver(highlight, {
      clientX: 220,
      clientY: 170,
    })

    const hoverCard = await waitFor(() => {
      const node = document.querySelector("[data-testid='hover-card-probe']") as HTMLElement | null
      expect(node).not.toBeNull()
      return node as HTMLElement
    })

    vi.useFakeTimers()

    fireEvent.pointerMove(document.body, {
      clientX: 40,
      clientY: 40,
    })
    fireEvent.pointerEnter(hoverCard)
    await vi.advanceTimersByTimeAsync(120)

    expect(document.querySelector("[data-testid='hover-card-probe']")).not.toBeNull()
  })
})
