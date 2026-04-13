import type { UnresolvedConfigs } from "../atoms/google-drive-sync"
import type { Config } from "@/types/config/config"
import { dequal } from "dequal"
import { configSchema } from "@/types/config/config"
import { mergeVocabularyItems } from "@/utils/vocabulary/merge"
import {
  getLastSyncedVocabularyItemsAndMeta,
  getLocalVocabularyItemsAndMeta,
  setLastSyncedVocabularyItemsAndMeta,
  setLocalVocabularyItemsAndMeta,
} from "@/utils/vocabulary/storage"
import {
  getLocalConfigAndMeta,
  setLocalConfigAndMeta,
} from "../config/storage"
import {
  getLastSyncedConfigAndMeta,
  setLastSyncConfigAndMeta,
} from "../config/sync"
import { CONFIG_SCHEMA_VERSION } from "../constants/config"
import { logger } from "../logger"
import { getRemoteConfigAndMetaWithUserEmail, setRemoteConfigAndMeta } from "./storage"

export type SyncAction = "uploaded" | "downloaded" | "same-changes" | "no-change"

export type SyncResult
  = | { status: "success", action: SyncAction }
    | { status: "unresolved", data: UnresolvedConfigs }
    | { status: "error", error: Error }

/**
 * Sync merged config after conflict resolution
 * - Save merged config to local storage
 * - Upload merged config to Google Drive
 * - Update last sync time and last synced config
 */
export async function syncMergedConfig(mergedConfig: Config, email: string): Promise<void> {
  try {
    const now = Date.now()
    const { value: vocabularyItems } = await getLocalVocabularyItemsAndMeta()

    // Validate merged config
    const validatedConfigResult = configSchema.safeParse(mergedConfig)
    if (!validatedConfigResult.success) {
      logger.error("Merged config is invalid, cannot sync merged config")
      throw new Error("Merged config is invalid for syncing")
    }

    const validatedConfig = validatedConfigResult.data

    // Save to local storage
    await setLocalConfigAndMeta(validatedConfig, { schemaVersion: CONFIG_SCHEMA_VERSION, lastModifiedAt: now })

    // Upload to Google Drive
    await setRemoteConfigAndMeta({
      value: validatedConfig,
      meta: { schemaVersion: CONFIG_SCHEMA_VERSION, lastModifiedAt: now },
    }, vocabularyItems)

    // Update sync metadata
    await Promise.all([
      setLastSyncConfigAndMeta(
        validatedConfig,
        { schemaVersion: CONFIG_SCHEMA_VERSION, lastModifiedAt: now, email },
      ),
      setLastSyncedVocabularyItemsAndMeta(vocabularyItems, {
        schemaVersion: CONFIG_SCHEMA_VERSION,
        lastModifiedAt: now,
        lastSyncedAt: now,
        email,
      }),
    ])

    logger.info("Synced config successfully")
  }
  catch (error) {
    logger.error("Failed to sync config", error)
    throw error
  }
}

export async function syncConfig(): Promise<SyncResult> {
  try {
    const localConfigValueAndMeta = await getLocalConfigAndMeta()
    const lastSyncedConfigValueAndMeta = await getLastSyncedConfigAndMeta()
    const localVocabularyItemsValueAndMeta = await getLocalVocabularyItemsAndMeta()
    const lastSyncedVocabularyItemsValueAndMeta = await getLastSyncedVocabularyItemsAndMeta()
    const {
      configValueAndMeta: remoteConfigValueAndMeta,
      vocabularyItems: remoteVocabularyItems,
      email,
    } = await getRemoteConfigAndMetaWithUserEmail()

    const now = Date.now()
    const baseVocabularyItems = lastSyncedVocabularyItemsValueAndMeta?.value ?? []
    const mergedVocabularyItems = mergeVocabularyItems({
      baseItems: baseVocabularyItems,
      localItems: localVocabularyItemsValueAndMeta.value,
      remoteItems: remoteVocabularyItems,
    })

    const syncVocabularyItems = async ({
      nextItems,
      lastModifiedAt,
    }: {
      nextItems: typeof localVocabularyItemsValueAndMeta.value
      lastModifiedAt: number
    }) => {
      await Promise.all([
        setLocalVocabularyItemsAndMeta(nextItems, {
          schemaVersion: CONFIG_SCHEMA_VERSION,
          lastModifiedAt,
        }),
        setLastSyncedVocabularyItemsAndMeta(nextItems, {
          schemaVersion: CONFIG_SCHEMA_VERSION,
          lastModifiedAt,
          lastSyncedAt: now,
          email,
        }),
      ])
    }

    if (email !== lastSyncedConfigValueAndMeta?.meta.email) {
      const firstSyncMergedVocabularyItems = mergeVocabularyItems({
        baseItems: [],
        localItems: localVocabularyItemsValueAndMeta.value,
        remoteItems: remoteVocabularyItems,
      })

      if (remoteConfigValueAndMeta) {
        logger.info("Remote config found, saving remote config")
        const shouldUploadMergedVocabulary = !dequal(firstSyncMergedVocabularyItems, remoteVocabularyItems)
        await Promise.all([
          setLocalConfigAndMeta(remoteConfigValueAndMeta.value, remoteConfigValueAndMeta.meta),
          ...(shouldUploadMergedVocabulary
            ? [setRemoteConfigAndMeta(remoteConfigValueAndMeta, firstSyncMergedVocabularyItems)]
            : []),
          setLastSyncConfigAndMeta(
            remoteConfigValueAndMeta.value,
            { ...remoteConfigValueAndMeta.meta, email, lastSyncedAt: now },
          ),
          syncVocabularyItems({
            nextItems: firstSyncMergedVocabularyItems,
            lastModifiedAt: shouldUploadMergedVocabulary
              ? now
              : Math.max(
                  localVocabularyItemsValueAndMeta.meta.lastModifiedAt,
                  remoteConfigValueAndMeta.meta.lastModifiedAt,
                ),
          }),
        ])
        return { status: "success", action: "downloaded" }
      }
      else {
        logger.info("No remote config found, uploading local config")
        await Promise.all([
          setRemoteConfigAndMeta(localConfigValueAndMeta, localVocabularyItemsValueAndMeta.value),
          setLastSyncConfigAndMeta(
            localConfigValueAndMeta.value,
            { ...localConfigValueAndMeta.meta, email, lastSyncedAt: now },
          ),
          setLastSyncedVocabularyItemsAndMeta(localVocabularyItemsValueAndMeta.value, {
            schemaVersion: CONFIG_SCHEMA_VERSION,
            lastModifiedAt: localVocabularyItemsValueAndMeta.meta.lastModifiedAt,
            lastSyncedAt: now,
            email,
          }),
        ])
        return { status: "success", action: "uploaded" }
      }
    }

    // Check if both local and remote changed since last sync
    const localChangedSinceSync = localConfigValueAndMeta.meta.lastModifiedAt > lastSyncedConfigValueAndMeta.meta.lastModifiedAt
    const remoteChangedSinceSync = remoteConfigValueAndMeta && remoteConfigValueAndMeta.meta.lastModifiedAt > lastSyncedConfigValueAndMeta.meta.lastModifiedAt
    const vocabularyNeedsUpload = !dequal(mergedVocabularyItems, remoteVocabularyItems)
    const vocabularyNeedsDownload = !dequal(mergedVocabularyItems, localVocabularyItemsValueAndMeta.value)

    if (localChangedSinceSync && remoteChangedSinceSync) {
      logger.info("Both local and remote changed since last sync, checking for conflicts")

      const sameLocalAndRemote = dequal(localConfigValueAndMeta.value, remoteConfigValueAndMeta.value)

      if (sameLocalAndRemote) {
        logger.info("Local and remote configurations are the same, no conflicts detected")
        const now = Date.now()

        // if the schemaVersion is different, use local config's schemaVersion
        const mergedConfigValueAndMeta = {
          value: localConfigValueAndMeta.value,
          meta: { schemaVersion: CONFIG_SCHEMA_VERSION, lastModifiedAt: now },
        }

        await Promise.all([
          setLocalConfigAndMeta(mergedConfigValueAndMeta.value, mergedConfigValueAndMeta.meta),
          setRemoteConfigAndMeta(mergedConfigValueAndMeta, mergedVocabularyItems),
          setLastSyncConfigAndMeta(
            mergedConfigValueAndMeta.value,
            { ...mergedConfigValueAndMeta.meta, email, lastSyncedAt: now },
          ),
          syncVocabularyItems({
            nextItems: mergedVocabularyItems,
            lastModifiedAt: vocabularyNeedsDownload || vocabularyNeedsUpload ? now : localVocabularyItemsValueAndMeta.meta.lastModifiedAt,
          }),
        ])

        return { status: "success", action: "same-changes" }
      }

      return {
        status: "unresolved",
        data: {
          base: lastSyncedConfigValueAndMeta.value,
          local: localConfigValueAndMeta.value,
          remote: remoteConfigValueAndMeta.value,
        },
      }
    }
    let nextConfigValueAndMeta = localConfigValueAndMeta
    let shouldWriteLocalConfig = false
    let shouldUploadPayload = false
    let action: SyncAction = "no-change"

    if (localChangedSinceSync) {
      logger.info("Local config is newer, uploading local config")
      nextConfigValueAndMeta = localConfigValueAndMeta
      shouldUploadPayload = true
      action = "uploaded"
    }
    else if (remoteChangedSinceSync) {
      logger.info("Remote config is newer, downloading remote config")
      nextConfigValueAndMeta = remoteConfigValueAndMeta
      shouldWriteLocalConfig = true
      action = "downloaded"
    }

    if (vocabularyNeedsUpload || vocabularyNeedsDownload) {
      shouldUploadPayload = shouldUploadPayload || vocabularyNeedsUpload

      if (action === "no-change") {
        action = vocabularyNeedsUpload && vocabularyNeedsDownload
          ? "same-changes"
          : (vocabularyNeedsUpload ? "uploaded" : "downloaded")
      }
    }

    await Promise.all([
      ...(shouldWriteLocalConfig ? [setLocalConfigAndMeta(nextConfigValueAndMeta.value, nextConfigValueAndMeta.meta)] : []),
      ...(shouldUploadPayload ? [setRemoteConfigAndMeta(nextConfigValueAndMeta, mergedVocabularyItems)] : []),
      setLastSyncConfigAndMeta(
        nextConfigValueAndMeta.value,
        { ...nextConfigValueAndMeta.meta, email, lastSyncedAt: now },
      ),
      syncVocabularyItems({
        nextItems: mergedVocabularyItems,
        lastModifiedAt: vocabularyNeedsDownload || vocabularyNeedsUpload ? now : localVocabularyItemsValueAndMeta.meta.lastModifiedAt,
      }),
    ])

    return { status: "success", action }
  }
  catch (error) {
    logger.error("Config sync failed", error)
    return {
      status: "error",
      error: error instanceof Error ? error : new Error(String(error)),
    }
  }
}
