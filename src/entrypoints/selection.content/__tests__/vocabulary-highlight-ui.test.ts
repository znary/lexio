import { describe, expect, it } from "vitest"
import {
  createVocabularyHighlightStyle,
  getVocabularyHighlightForegroundColor,
  getVocabularyHoverBridgeRect,
  getVocabularyHoverCardPosition,
  isPointInVocabularyHoverArea,
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

  it("keeps the hover card above the highlight and away from the selection toolbar", () => {
    expect(getVocabularyHoverCardPosition({
      anchorRect: {
        top: 160,
        right: 240,
        bottom: 180,
        left: 200,
        width: 40,
        height: 20,
      },
      cardWidth: 180,
      cardHeight: 72,
      viewportWidth: 480,
      viewportHeight: 320,
      avoidRect: {
        top: 192,
        right: 310,
        bottom: 236,
        left: 130,
        width: 180,
        height: 44,
      },
    })).toEqual({
      left: 130,
      top: 76,
    })
  })

  it("creates a hover bridge across the gap between the highlight and a card above it", () => {
    expect(getVocabularyHoverBridgeRect({
      anchorRect: {
        top: 160,
        right: 240,
        bottom: 180,
        left: 200,
        width: 40,
        height: 20,
      },
      cardRect: {
        top: 76,
        right: 310,
        bottom: 148,
        left: 130,
        width: 180,
        height: 72,
      },
    })).toEqual({
      left: 130,
      right: 310,
      top: 148,
      bottom: 160,
      width: 180,
      height: 12,
    })
  })

  it("treats the gap between the highlight and the card as part of the hover area", () => {
    expect(isPointInVocabularyHoverArea({
      point: { x: 210, y: 154 },
      anchorRect: {
        top: 160,
        right: 240,
        bottom: 180,
        left: 200,
        width: 40,
        height: 20,
      },
      cardRect: {
        top: 76,
        right: 310,
        bottom: 148,
        left: 130,
        width: 180,
        height: 72,
      },
    })).toBe(true)
  })

  it("keeps overlap points inside the hover area when the card covers the highlight", () => {
    expect(isPointInVocabularyHoverArea({
      point: { x: 214, y: 170 },
      anchorRect: {
        top: 160,
        right: 240,
        bottom: 180,
        left: 200,
        width: 40,
        height: 20,
      },
      cardRect: {
        top: 150,
        right: 320,
        bottom: 222,
        left: 170,
        width: 150,
        height: 72,
      },
    })).toBe(true)
  })
})
