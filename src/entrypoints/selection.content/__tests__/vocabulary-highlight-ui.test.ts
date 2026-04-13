import { describe, expect, it } from "vitest"
import {
  createVocabularyHighlightStyle,
  getVocabularyHighlightForegroundColor,
  getVocabularyHoverCardPosition,
} from "../vocabulary-highlight-ui"

describe("vocabulary-highlight-ui", () => {
  it("uses dark foreground text for light highlight colors", () => {
    expect(getVocabularyHighlightForegroundColor("#fde68a")).toBe("#111827")
  })

  it("uses light foreground text for dark highlight colors", () => {
    expect(getVocabularyHighlightForegroundColor("#1f2937")).toBe("#f8fafc")
  })

  it("embeds the computed foreground color in the highlight stylesheet", () => {
    expect(createVocabularyHighlightStyle("#fde68a")).toContain("color: #111827 !important;")
  })

  it("places the hover card above the highlight when there is no room below", () => {
    expect(getVocabularyHoverCardPosition({
      anchorRect: {
        top: 260,
        right: 260,
        bottom: 280,
        left: 220,
        width: 40,
        height: 20,
      },
      cardWidth: 180,
      cardHeight: 120,
      viewportWidth: 320,
      viewportHeight: 300,
    })).toEqual({
      left: 132,
      top: 128,
    })
  })
})
