// @vitest-environment jsdom
import type { VocabularyItem } from "@/types/vocabulary"
import Mark from "mark.js"
import { describe, expect, it } from "vitest"
import { VOCABULARY_HIGHLIGHT_CLASS_NAME } from "@/utils/constants/vocabulary"
import { shouldHighlightAcrossElements } from "../use-vocabulary-highlighting"

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
      accuracy: "exactly",
      caseSensitive: false,
      className: VOCABULARY_HIGHLIGHT_CLASS_NAME,
      separateWordSearch: false,
      done: resolve,
    })
  })
}

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
})
