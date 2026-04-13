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

export interface VocabularyHoverPreview {
  anchorRect: VocabularyHighlightAnchorRect
  item: VocabularyItem
}

interface VocabularyHoverCardPositionOptions {
  anchorRect: VocabularyHighlightAnchorRect
  cardHeight: number
  cardWidth: number
  gap?: number
  minMargin?: number
  viewportHeight?: number
  viewportWidth?: number
}

const DEFAULT_CARD_GAP = 12
const DEFAULT_VIEWPORT_MARGIN = 8
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
  const left = Math.min(Math.max(minMargin, centeredLeft), maxLeft)

  const preferredBottomTop = anchorRect.bottom + gap
  const preferredTopTop = anchorRect.top - cardHeight - gap
  const shouldPlaceAbove = preferredBottomTop > maxTop && preferredTopTop >= minMargin
  const top = shouldPlaceAbove
    ? Math.min(Math.max(minMargin, preferredTopTop), maxTop)
    : Math.min(Math.max(minMargin, preferredBottomTop), maxTop)

  return { left, top }
}
