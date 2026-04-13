import { storage } from "#imports"
import { useAtomValue } from "jotai"
import { useEffect } from "react"
import { configFieldsAtomMap } from "@/utils/atoms/config"
import { VOCABULARY_ITEMS_STORAGE_KEY } from "@/utils/constants/config"
import { NOTRANSLATE_CLASS } from "@/utils/constants/dom-labels"
import { VOCABULARY_HIGHLIGHT_CLASS_NAME, VOCABULARY_HIGHLIGHT_STYLE_ID } from "@/utils/constants/vocabulary"
import { getActiveVocabularyItems, getLocalVocabularyItemsAndMeta } from "@/utils/vocabulary/storage"
import { SELECTION_CONTENT_OVERLAY_ROOT_ATTRIBUTE } from "./overlay-layers"

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
  "[data-read-frog-paragraph]",
]

function ensureHighlightStyle(color: string) {
  let styleElement = document.getElementById(VOCABULARY_HIGHLIGHT_STYLE_ID) as HTMLStyleElement | null

  if (!styleElement) {
    styleElement = document.createElement("style")
    styleElement.id = VOCABULARY_HIGHLIGHT_STYLE_ID
    document.head.append(styleElement)
  }

  styleElement.textContent = `
    mark.${VOCABULARY_HIGHLIGHT_CLASS_NAME} {
      background: ${color};
      color: inherit;
      border-radius: 0.25rem;
      padding: 0 0.1em;
      box-shadow: inset 0 -1px 0 color-mix(in srgb, ${color} 65%, #000 15%);
      cursor: pointer;
    }
  `
}

function unmark(markInstance: import("mark.js").default): Promise<void> {
  return new Promise((resolve) => {
    markInstance.unmark({
      className: VOCABULARY_HIGHLIGHT_CLASS_NAME,
      done: resolve,
    })
  })
}

function markTerms(markInstance: import("mark.js").default, terms: string[]): Promise<void> {
  return new Promise((resolve) => {
    markInstance.mark(terms, {
      acrossElements: true,
      accuracy: "exactly",
      caseSensitive: false,
      className: VOCABULARY_HIGHLIGHT_CLASS_NAME,
      exclude: HIGHLIGHT_EXCLUDE_SELECTORS,
      ignoreJoiners: true,
      separateWordSearch: false,
      done: resolve,
    })
  })
}

export function useVocabularyHighlighting() {
  const vocabulary = useAtomValue(configFieldsAtomMap.vocabulary)

  useEffect(() => {
    let disposed = false
    let isApplyingHighlights = false
    let markInstance: import("mark.js").default | null = null
    let observer: MutationObserver | null = null
    let rehighlightTimer: number | null = null

    const scheduleHighlight = () => {
      if (rehighlightTimer) {
        window.clearTimeout(rehighlightTimer)
      }

      rehighlightTimer = window.setTimeout(() => {
        rehighlightTimer = null
        void applyHighlights()
      }, 400)
    }

    async function applyHighlights() {
      if (disposed || !document.body || isApplyingHighlights) {
        return
      }

      isApplyingHighlights = true

      try {
        const [{ default: Mark }, { value: items }] = await Promise.all([
          import("mark.js"),
          getLocalVocabularyItemsAndMeta(),
        ])

        if (disposed) {
          return
        }

        markInstance ??= new Mark(document.body)
        await unmark(markInstance)

        const activeItems = getActiveVocabularyItems(items)
        if (!vocabulary.highlightEnabled || activeItems.length === 0) {
          return
        }

        const terms = [...new Set(activeItems
          .map(item => item.sourceText.trim())
          .filter(Boolean))]
          .sort((left, right) => right.length - left.length)

        if (terms.length === 0) {
          return
        }

        ensureHighlightStyle(vocabulary.highlightColor)
        await markTerms(markInstance, terms)
      }
      finally {
        isApplyingHighlights = false
      }
    }

    const handleHighlightClick = (event: MouseEvent) => {
      const target = event.target instanceof Element
        ? event.target.closest(`mark.${VOCABULARY_HIGHLIGHT_CLASS_NAME}`) as HTMLElement | null
        : null

      if (!target) {
        return
      }

      event.preventDefault()
      event.stopPropagation()

      const range = document.createRange()
      range.selectNodeContents(target)

      const selection = window.getSelection()
      selection?.removeAllRanges()
      selection?.addRange(range)

      document.dispatchEvent(new MouseEvent("mouseup", {
        bubbles: true,
        cancelable: true,
        clientX: event.clientX,
        clientY: event.clientY,
        view: window,
      }))
    }

    observer = new MutationObserver(() => {
      if (isApplyingHighlights) {
        return
      }
      scheduleHighlight()
    })

    if (document.body) {
      observer.observe(document.body, {
        childList: true,
        subtree: true,
      })
    }

    const unwatch = storage.watch(`local:${VOCABULARY_ITEMS_STORAGE_KEY}`, () => {
      scheduleHighlight()
    })

    document.addEventListener("click", handleHighlightClick, true)
    window.addEventListener("hashchange", scheduleHighlight)
    window.addEventListener("popstate", scheduleHighlight)
    void applyHighlights()

    return () => {
      disposed = true
      if (rehighlightTimer) {
        window.clearTimeout(rehighlightTimer)
      }
      observer?.disconnect()
      unwatch()
      document.removeEventListener("click", handleHighlightClick, true)
      window.removeEventListener("hashchange", scheduleHighlight)
      window.removeEventListener("popstate", scheduleHighlight)
    }
  }, [vocabulary.highlightColor, vocabulary.highlightEnabled])
}
