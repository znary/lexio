import type { Config } from "@/types/config/config"
import type { VocabularyItem } from "@/types/vocabulary"

export interface RemoteSyncPayload {
  schemaVersion: number
  updatedAt: number
  settings: Config
  providerConfig: Config["providersConfig"]
  vocabularyItems: VocabularyItem[]
}
