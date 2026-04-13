import type { VocabularySettings } from "@/types/vocabulary"

export const DEFAULT_VOCABULARY_SETTINGS: VocabularySettings = {
  autoSave: true,
  highlightEnabled: true,
  maxPhraseWords: 8,
  highlightColor: "#fde68a",
}

export const VOCABULARY_SCHEMA_VERSION = 1
export const VOCABULARY_HIGHLIGHT_CLASS_NAME = "rf-vocabulary-highlight"
export const VOCABULARY_HIGHLIGHT_STYLE_ID = "rf-vocabulary-highlight-style"
export const VOCABULARY_HIGHLIGHT_ITEM_ID_ATTRIBUTE = "data-rf-vocabulary-item-id"
