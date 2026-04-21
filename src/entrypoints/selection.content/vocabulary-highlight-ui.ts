import type { VocabularyItem } from "@/types/vocabulary"
import {
  VOCABULARY_HIGHLIGHT_CLASS_NAME,
  VOCABULARY_HIGHLIGHT_ITEM_ID_ATTRIBUTE,
} from "@/utils/constants/vocabulary"

export interface VocabularyHighlightAnchorRect {
  bottom: number
  height: number
  left: number
  right: number
  top: number
  width: number
}

export const VOCABULARY_HOVER_CARD_ATTRIBUTE = "data-rf-vocabulary-hover-card"

export interface VocabularyHoverPreview {
  anchorRect: VocabularyHighlightAnchorRect
  item: VocabularyItem
}

interface VocabularyHoverCardPositionOptions {
  anchorRect: VocabularyHighlightAnchorRect
  avoidRect?: VocabularyHighlightAnchorRect | null
  cardHeight: number
  cardWidth: number
  gap?: number
  minMargin?: number
  viewportHeight?: number
  viewportWidth?: number
}

interface VocabularyHoverBridgeRectOptions {
  anchorRect: VocabularyHighlightAnchorRect
  cardRect: VocabularyHighlightAnchorRect
}

interface VocabularyHoverAreaPoint {
  x: number
  y: number
}

interface VocabularyHoverAreaOptions {
  anchorRect: VocabularyHighlightAnchorRect
  cardRect?: VocabularyHighlightAnchorRect | null
  point: VocabularyHoverAreaPoint
  slop?: number
}

const DEFAULT_CARD_GAP = 12
const DEFAULT_VIEWPORT_MARGIN = 8
const DEFAULT_HOVER_AREA_SLOP = 6
const HEX_COLOR_REGEX = /^[\da-f]{6}$/i

interface RGBColor {
  blue: number
  green: number
  red: number
}

function expandShortHex(hex: string) {
  return hex
    .split("")
    .map(char => `${char}${char}`)
    .join("")
}

function parseHexColor(value: string): RGBColor | null {
  const normalizedValue = value.trim()
  if (!normalizedValue.startsWith("#")) {
    return null
  }

  const hex = normalizedValue.slice(1)
  const expandedHex = hex.length === 3 ? expandShortHex(hex) : hex

  if (!HEX_COLOR_REGEX.test(expandedHex)) {
    return null
  }

  return {
    red: Number.parseInt(expandedHex.slice(0, 2), 16),
    green: Number.parseInt(expandedHex.slice(2, 4), 16),
    blue: Number.parseInt(expandedHex.slice(4, 6), 16),
  }
}

function toLinearChannel(channel: number) {
  const srgb = channel / 255
  return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4
}

function getRelativeLuminance(color: RGBColor) {
  return 0.2126 * toLinearChannel(color.red)
    + 0.7152 * toLinearChannel(color.green)
    + 0.0722 * toLinearChannel(color.blue)
}

export function getVocabularyHighlightForegroundColor(backgroundColor: string) {
  const parsedColor = parseHexColor(backgroundColor)
  if (!parsedColor) {
    return "#111827"
  }

  return getRelativeLuminance(parsedColor) > 0.52 ? "#111827" : "#f8fafc"
}

export function createVocabularyHighlightStyle(color: string) {
  const foregroundColor = getVocabularyHighlightForegroundColor(color)

  return `
    mark.${VOCABULARY_HIGHLIGHT_CLASS_NAME}[${VOCABULARY_HIGHLIGHT_ITEM_ID_ATTRIBUTE}] {
      background: ${color} !important;
      color: ${foregroundColor} !important;
      border-radius: 0.35rem;
      padding: 0 0.14em;
      cursor: pointer;
      text-decoration: none !important;
      box-decoration-break: clone;
      -webkit-box-decoration-break: clone;
      box-shadow:
        inset 0 -1px 0 color-mix(in srgb, ${color} 72%, ${foregroundColor} 16%) !important,
        0 0 0 1px color-mix(in srgb, ${foregroundColor} 8%, transparent) !important;
      transition: box-shadow 120ms ease, filter 120ms ease;
    }

    mark.${VOCABULARY_HIGHLIGHT_CLASS_NAME}[${VOCABULARY_HIGHLIGHT_ITEM_ID_ATTRIBUTE}]:hover {
      filter: saturate(1.03) brightness(0.98);
      box-shadow:
        inset 0 -1px 0 color-mix(in srgb, ${color} 72%, ${foregroundColor} 16%) !important,
        0 0 0 1px color-mix(in srgb, ${foregroundColor} 14%, transparent) !important,
        0 8px 24px rgb(15 23 42 / 0.18) !important;
    }
  `
}

export function toVocabularyHighlightAnchorRect(rect: DOMRect | DOMRectReadOnly): VocabularyHighlightAnchorRect {
  return {
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
    left: rect.left,
    width: rect.width,
    height: rect.height,
  }
}

export function getVocabularyHoverCardPosition({
  anchorRect,
  avoidRect = null,
  cardHeight,
  cardWidth,
  gap = DEFAULT_CARD_GAP,
  minMargin = DEFAULT_VIEWPORT_MARGIN,
  viewportHeight = window.innerHeight,
  viewportWidth = window.innerWidth,
}: VocabularyHoverCardPositionOptions) {
  const maxLeft = Math.max(minMargin, viewportWidth - cardWidth - minMargin)
  const maxTop = Math.max(minMargin, viewportHeight - cardHeight - minMargin)

  const centeredLeft = anchorRect.left + (anchorRect.width / 2) - (cardWidth / 2)
  const middleTop = anchorRect.top + (anchorRect.height / 2) - (cardHeight / 2)

  const clampLeft = (left: number) => Math.min(Math.max(minMargin, left), maxLeft)
  const clampTop = (top: number) => Math.min(Math.max(minMargin, top), maxTop)

  const createRect = (left: number, top: number) => ({
    left,
    top,
    right: left + cardWidth,
    bottom: top + cardHeight,
  })

  const intersects = (left: number, top: number) => {
    if (!avoidRect) {
      return false
    }

    const cardRect = createRect(left, top)
    return (
      cardRect.left < avoidRect.right
      && cardRect.right > avoidRect.left
      && cardRect.top < avoidRect.bottom
      && cardRect.bottom > avoidRect.top
    )
  }

  const candidates = [
    {
      left: clampLeft(centeredLeft),
      top: clampTop(anchorRect.top - cardHeight - gap),
    },
    {
      left: clampLeft(centeredLeft),
      top: clampTop(anchorRect.bottom + gap),
    },
    {
      left: clampLeft(anchorRect.right + gap),
      top: clampTop(middleTop),
    },
    {
      left: clampLeft(anchorRect.left - cardWidth - gap),
      top: clampTop(middleTop),
    },
  ]

  for (const candidate of candidates) {
    if (!intersects(candidate.left, candidate.top)) {
      return candidate
    }
  }

  return candidates[0] ?? {
    left: clampLeft(centeredLeft),
    top: clampTop(anchorRect.top - cardHeight - gap),
  }
}

export function getVocabularyHoverBridgeRect({
  anchorRect,
  cardRect,
}: VocabularyHoverBridgeRectOptions) {
  if (cardRect.bottom <= anchorRect.top) {
    const left = Math.min(anchorRect.left, cardRect.left)
    const right = Math.max(anchorRect.right, cardRect.right)
    const top = cardRect.bottom
    const bottom = anchorRect.top
    return {
      left,
      right,
      top,
      bottom,
      width: right - left,
      height: bottom - top,
    }
  }

  if (cardRect.top >= anchorRect.bottom) {
    const left = Math.min(anchorRect.left, cardRect.left)
    const right = Math.max(anchorRect.right, cardRect.right)
    const top = anchorRect.bottom
    const bottom = cardRect.top
    return {
      left,
      right,
      top,
      bottom,
      width: right - left,
      height: bottom - top,
    }
  }

  if (cardRect.left >= anchorRect.right) {
    const left = anchorRect.right
    const right = cardRect.left
    const top = Math.min(anchorRect.top, cardRect.top)
    const bottom = Math.max(anchorRect.bottom, cardRect.bottom)
    return {
      left,
      right,
      top,
      bottom,
      width: right - left,
      height: bottom - top,
    }
  }

  if (cardRect.right <= anchorRect.left) {
    const left = cardRect.right
    const right = anchorRect.left
    const top = Math.min(anchorRect.top, cardRect.top)
    const bottom = Math.max(anchorRect.bottom, cardRect.bottom)
    return {
      left,
      right,
      top,
      bottom,
      width: right - left,
      height: bottom - top,
    }
  }

  return null
}

function expandRect(rect: VocabularyHighlightAnchorRect, amount: number): VocabularyHighlightAnchorRect {
  return {
    top: rect.top - amount,
    right: rect.right + amount,
    bottom: rect.bottom + amount,
    left: rect.left - amount,
    width: rect.width + amount * 2,
    height: rect.height + amount * 2,
  }
}

function isPointInRect(point: VocabularyHoverAreaPoint, rect: VocabularyHighlightAnchorRect) {
  return point.x >= rect.left
    && point.x <= rect.right
    && point.y >= rect.top
    && point.y <= rect.bottom
}

export function isPointInVocabularyHoverArea({
  point,
  anchorRect,
  cardRect = null,
  slop = DEFAULT_HOVER_AREA_SLOP,
}: VocabularyHoverAreaOptions) {
  if (isPointInRect(point, expandRect(anchorRect, slop))) {
    return true
  }

  if (!cardRect) {
    return false
  }

  if (isPointInRect(point, expandRect(cardRect, slop))) {
    return true
  }

  const bridgeRect = getVocabularyHoverBridgeRect({
    anchorRect,
    cardRect,
  })

  if (!bridgeRect) {
    return false
  }

  return isPointInRect(point, expandRect(bridgeRect, slop))
}
