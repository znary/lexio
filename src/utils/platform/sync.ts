import { configSchema } from "@/types/config/config"
import { addBackup } from "../backup/storage"
import { getLocalConfigAndMeta, setLocalConfigAndMeta } from "../config/storage"
import { getLastSyncedConfigAndMeta, setLastSyncConfigAndMeta } from "../config/sync"
import { EXTENSION_VERSION } from "../constants/app"
import { CONFIG_SCHEMA_VERSION } from "../constants/config"
import { logger } from "../logger"
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
  ] = await Promise.all([
    getPlatformMe(),
    pullPlatformSync(),
    getLocalConfigAndMeta(),
    getLastSyncedConfigAndMeta(),
  ])

  const now = Date.now()
  const remoteUpdatedAt = me.sync.lastPushAt ? Date.parse(me.sync.lastPushAt) : 0
  const remoteConfigResult = remotePayload.settings
    ? configSchema.safeParse(remotePayload.settings)
    : null

  const remoteConfig = remoteConfigResult?.success ? remoteConfigResult.data : null

  const hasPreviousSync = Boolean(lastSyncedConfigValueAndMeta)
    && lastSyncedConfigValueAndMeta?.meta.email === me.user.email
  const remoteHasData = Boolean(remoteConfig)

  if (!hasPreviousSync && remoteHasData) {
    const downloadedConfig = remoteConfig ?? localConfigValueAndMeta.value
    const downloadedLastModifiedAt = remoteUpdatedAt || now

    await addBackup(localConfigValueAndMeta.value, EXTENSION_VERSION)

    await Promise.all([
      setLocalConfigAndMeta(downloadedConfig, {
        schemaVersion: CONFIG_SCHEMA_VERSION,
        lastModifiedAt: downloadedLastModifiedAt,
      }),
      setLastSyncConfigAndMeta(downloadedConfig, {
        schemaVersion: CONFIG_SCHEMA_VERSION,
        lastModifiedAt: downloadedLastModifiedAt,
        lastSyncedAt: now,
        email: me.user.email,
      }),
    ])

    if (!remoteConfig) {
      await pushPlatformSync({
        settings: downloadedConfig,
      })
    }

    return {
      action: !remoteConfig ? "merged" : "downloaded",
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
  const shouldUpload = !shouldUseRemoteConfig || !remoteConfig

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
    ...(shouldUpload
      ? [
          pushPlatformSync({
            settings: nextConfig,
          }),
        ]
      : []),
  ])

  await setLastSyncConfigAndMeta(nextConfig, {
    schemaVersion: CONFIG_SCHEMA_VERSION,
    lastModifiedAt: nextConfigLastModifiedAt,
    lastSyncedAt: now,
    email: me.user.email,
  })

  return {
    action: shouldUseRemoteConfig
      ? (shouldUpload ? "merged" : "downloaded")
      : (remoteChanged ? "merged" : "uploaded"),
    syncedAt: new Date(now).toISOString(),
  }
}
