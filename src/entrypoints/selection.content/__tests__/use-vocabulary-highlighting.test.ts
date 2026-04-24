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
import { shouldHighlightAcrossElements, useVocabularyHighlighting } from "../use-vocabulary-highlighting"

const getVocabularyItemsMock = vi.fn<() => Promise<VocabularyItem[]>>()

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
  getVocabularyItems: () => getVocabularyItemsMock(),
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

  it("keeps existing highlights and patches small vocabulary changes when a full rescan is too large", async () => {
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
