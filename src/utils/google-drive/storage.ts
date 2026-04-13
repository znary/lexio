import type { RemoteSyncPayload } from "./types"
import type { Config } from "@/types/config/config"
import type { ConfigValueAndMeta } from "@/types/config/meta"
import type { VocabularyItem } from "@/types/vocabulary"
import { ConfigVersionTooNewError } from "../config/errors"
import { migrateConfig } from "../config/migration"
import { CONFIG_SCHEMA_VERSION } from "../constants/config"
import { logger } from "../logger"
import { downloadFile, findFileInAppData, uploadFile } from "./api"
import { getGoogleUserInfo, getValidAccessToken } from "./auth"
import { GOOGLE_DRIVE_CONFIG_FILENAME } from "./constants"
import { parseRemoteSyncPayload } from "./payload"

export async function getRemoteConfigAndMetaWithUserEmail(): Promise<{
  configValueAndMeta: ConfigValueAndMeta | null
  vocabularyItems: VocabularyItem[]
  email: string
}> {
  try {
    const accessToken = await getValidAccessToken()

    // Fetch user email from Google API
    const userInfo = await getGoogleUserInfo(accessToken)

    const file = await findFileInAppData(GOOGLE_DRIVE_CONFIG_FILENAME)

    if (!file) {
      return { configValueAndMeta: null, vocabularyItems: [], email: userInfo.email }
    }

    const content = await downloadFile(file.id)
    const remoteData = await parseRemoteSyncPayload(JSON.parse(content))

    let migratedConfig: Config
    try {
      migratedConfig = await migrateConfig(remoteData.settings, remoteData.schemaVersion)
    }
    catch (error) {
      if (error instanceof ConfigVersionTooNewError) {
        throw error
      }
      logger.error("Failed to migrate remote config", error)
      return { configValueAndMeta: null, vocabularyItems: [], email: userInfo.email }
    }

    return {
      configValueAndMeta: {
        value: migratedConfig,
        meta: {
          schemaVersion: CONFIG_SCHEMA_VERSION,
          lastModifiedAt: remoteData.updatedAt,
        },
      },
      vocabularyItems: remoteData.vocabularyItems,
      email: userInfo.email,
    }
  }
  catch (error) {
    logger.error("Failed to get remote config", error)
    throw error
  }
}

export async function setRemoteConfigAndMeta(
  configValueAndMeta: ConfigValueAndMeta,
  vocabularyItems: VocabularyItem[],
): Promise<void> {
  try {
    const existingFile = await findFileInAppData(GOOGLE_DRIVE_CONFIG_FILENAME)

    const payload: RemoteSyncPayload = {
      schemaVersion: CONFIG_SCHEMA_VERSION,
      updatedAt: configValueAndMeta.meta.lastModifiedAt,
      settings: configValueAndMeta.value,
      providerConfig: configValueAndMeta.value.providersConfig,
      vocabularyItems,
    }

    const content = JSON.stringify(payload, null, 2)
    await uploadFile(GOOGLE_DRIVE_CONFIG_FILENAME, content, existingFile?.id)
  }
  catch (error) {
    logger.error("Failed to upload local config", error)
    throw error
  }
}
