import { dequal } from "dequal"
import { configSchema } from "@/types/config/config"
import { vocabularyItemsSchema } from "@/types/vocabulary"
import { addBackup } from "../backup/storage"
import { getLocalConfigAndMeta, setLocalConfigAndMeta } from "../config/storage"
import { getLastSyncedConfigAndMeta, setLastSyncConfigAndMeta } from "../config/sync"
import { EXTENSION_VERSION } from "../constants/app"
import { CONFIG_SCHEMA_VERSION } from "../constants/config"
import { VOCABULARY_SCHEMA_VERSION } from "../constants/vocabulary"
import { logger } from "../logger"
import { mergeVocabularyItems } from "../vocabulary/merge"
import {
  getLastSyncedVocabularyItemsAndMeta,
  getLocalVocabularyItemsAndMeta,
  setLastSyncedVocabularyItemsAndMeta,
  setLocalVocabularyItemsAndMeta,
} from "../vocabulary/storage"
import { getPlatformMe, pullPlatformSync, pushPlatformSync } from "./api"

export interface PlatformSyncResult {
  action: "uploaded" | "downloaded" | "merged"
  syncedAt: string
}

export async function syncPlatformNow(): Promise<PlatformSyncResult> {
  const [
    me,
    remotePayload,
    localConfigValueAndMeta,
    lastSyncedConfigValueAndMeta,
    localVocabularyItemsValueAndMeta,
    lastSyncedVocabularyItemsValueAndMeta,
  ] = await Promise.all([
    getPlatformMe(),
    pullPlatformSync(),
    getLocalConfigAndMeta(),
    getLastSyncedConfigAndMeta(),
    getLocalVocabularyItemsAndMeta(),
    getLastSyncedVocabularyItemsAndMeta(),
  ])

  const now = Date.now()
  const remoteUpdatedAt = me.sync.lastPushAt ? Date.parse(me.sync.lastPushAt) : 0
  const remoteConfigResult = remotePayload.settings
    ? configSchema.safeParse(remotePayload.settings)
    : null
  const remoteVocabularyResult = vocabularyItemsSchema.safeParse(remotePayload.vocabularyItems)

  const remoteConfig = remoteConfigResult?.success ? remoteConfigResult.data : null
  const remoteVocabularyItems = remoteVocabularyResult.success ? remoteVocabularyResult.data : []
  const baseVocabularyItems = lastSyncedVocabularyItemsValueAndMeta?.value ?? []
  const mergedVocabularyItems = mergeVocabularyItems({
    baseItems: baseVocabularyItems,
    localItems: localVocabularyItemsValueAndMeta.value,
    remoteItems: remoteVocabularyItems,
  })

  const hasPreviousSync
    = Boolean(lastSyncedConfigValueAndMeta)
      && Boolean(lastSyncedVocabularyItemsValueAndMeta)
      && lastSyncedConfigValueAndMeta?.meta.email === me.user.email
  const remoteHasData = Boolean(remoteConfig) || remoteVocabularyItems.length > 0

  if (!hasPreviousSync && remoteHasData) {
    const downloadedConfig = remoteConfig ?? localConfigValueAndMeta.value
    const downloadedLastModifiedAt = remoteUpdatedAt || now
    const shouldUploadMergedVocabulary = !dequal(mergedVocabularyItems, remoteVocabularyItems)

    await addBackup(localConfigValueAndMeta.value, EXTENSION_VERSION)

    await Promise.all([
      setLocalConfigAndMeta(downloadedConfig, {
        schemaVersion: CONFIG_SCHEMA_VERSION,
        lastModifiedAt: downloadedLastModifiedAt,
      }),
      setLocalVocabularyItemsAndMeta(mergedVocabularyItems, {
        schemaVersion: VOCABULARY_SCHEMA_VERSION,
        lastModifiedAt: downloadedLastModifiedAt,
      }),
      setLastSyncConfigAndMeta(downloadedConfig, {
        schemaVersion: CONFIG_SCHEMA_VERSION,
        lastModifiedAt: downloadedLastModifiedAt,
        lastSyncedAt: now,
        email: me.user.email,
      }),
      setLastSyncedVocabularyItemsAndMeta(mergedVocabularyItems, {
        schemaVersion: VOCABULARY_SCHEMA_VERSION,
        lastModifiedAt: downloadedLastModifiedAt,
        lastSyncedAt: now,
        email: me.user.email,
      }),
    ])

    if (shouldUploadMergedVocabulary || !remoteConfig) {
      await pushPlatformSync({
        settings: downloadedConfig,
        vocabularyItems: mergedVocabularyItems,
      })
    }

    return {
      action: shouldUploadMergedVocabulary || !remoteConfig ? "merged" : "downloaded",
      syncedAt: new Date(now).toISOString(),
    }
  }

  const baseConfigLastModifiedAt = lastSyncedConfigValueAndMeta?.meta.lastModifiedAt ?? 0
  const localConfigChanged = localConfigValueAndMeta.meta.lastModifiedAt > baseConfigLastModifiedAt
  const remoteChanged = remoteUpdatedAt > baseConfigLastModifiedAt
  const shouldUseRemoteConfig = remoteChanged && !localConfigChanged && Boolean(remoteConfig)
  const nextConfig = shouldUseRemoteConfig ? remoteConfig! : localConfigValueAndMeta.value
  const nextConfigLastModifiedAt = shouldUseRemoteConfig
    ? (remoteUpdatedAt || now)
    : localConfigValueAndMeta.meta.lastModifiedAt
  const shouldWriteLocalVocabulary = !dequal(mergedVocabularyItems, localVocabularyItemsValueAndMeta.value)
  const shouldUpload
    = !shouldUseRemoteConfig
      || !dequal(mergedVocabularyItems, remoteVocabularyItems)
      || !remoteConfig

  if (remoteConfigResult && !remoteConfigResult.success) {
    logger.warn("Remote platform config is invalid, keeping the local config")
  }

  await Promise.all([
    ...(shouldUseRemoteConfig
      ? [
          addBackup(localConfigValueAndMeta.value, EXTENSION_VERSION),
          setLocalConfigAndMeta(nextConfig, {
            schemaVersion: CONFIG_SCHEMA_VERSION,
            lastModifiedAt: nextConfigLastModifiedAt,
          }),
        ]
      : []),
    ...(shouldWriteLocalVocabulary
      ? [
          setLocalVocabularyItemsAndMeta(mergedVocabularyItems, {
            schemaVersion: VOCABULARY_SCHEMA_VERSION,
            lastModifiedAt: now,
          }),
        ]
      : []),
    ...(shouldUpload
      ? [
          pushPlatformSync({
            settings: nextConfig,
            vocabularyItems: mergedVocabularyItems,
          }),
        ]
      : []),
  ])

  await Promise.all([
    setLastSyncConfigAndMeta(nextConfig, {
      schemaVersion: CONFIG_SCHEMA_VERSION,
      lastModifiedAt: nextConfigLastModifiedAt,
      lastSyncedAt: now,
      email: me.user.email,
    }),
    setLastSyncedVocabularyItemsAndMeta(mergedVocabularyItems, {
      schemaVersion: VOCABULARY_SCHEMA_VERSION,
      lastModifiedAt: now,
      lastSyncedAt: now,
      email: me.user.email,
    }),
  ])

  return {
    action: shouldUseRemoteConfig
      ? (shouldUpload ? "merged" : "downloaded")
      : (remoteChanged || !dequal(mergedVocabularyItems, remoteVocabularyItems) ? "merged" : "uploaded"),
    syncedAt: new Date(now).toISOString(),
  }
}
