// @vitest-environment jsdom
import type { VocabularyItem } from "@/types/vocabulary"
import { cleanup, render, waitFor } from "@testing-library/react"
import { atom } from "jotai"
import Mark from "mark.js"
import { createElement } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
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
  getVocabularyItems: (...args: unknown[]) => getVocabularyItemsMock(...args),
  VOCABULARY_CHANGED_EVENT: "lexio:vocabulary-changed",
}))

function createVocabularyItem(overrides: Partial<VocabularyItem>): VocabularyItem {
  return {
    id: "item-1",
    sourceText: "integration",
    normalizedText: "integration",
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

function VocabularyHighlightingHarness() {
  useVocabularyHighlighting()
  return null
}

beforeEach(() => {
  document.body.innerHTML = ""
  getVocabularyItemsMock.mockReset()
})

afterEach(() => {
  cleanup()
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
      expect(document.querySelector("p mark")?.textContent).toBe("Integration")
    })
  })
})
