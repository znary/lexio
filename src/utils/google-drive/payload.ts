import type { RemoteSyncPayload } from "./types"
import type { ConfigValueAndMeta } from "@/types/config/meta"
import { z } from "zod"
import { configSchema } from "@/types/config/config"
import { providersConfigSchema } from "@/types/config/provider"
import { vocabularyItemsSchema } from "@/types/vocabulary"
import { migrateConfig } from "../config/migration"
import { CONFIG_SCHEMA_VERSION } from "../constants/config"

const legacyRemoteConfigSchema = z.object({
  value: z.unknown(),
  meta: z.object({
    schemaVersion: z.number().int().min(1),
    lastModifiedAt: z.number().int().nonnegative(),
  }),
})

export const remoteSyncPayloadSchema = z.object({
  schemaVersion: z.number().int().min(1),
  updatedAt: z.number().int().nonnegative(),
  settings: configSchema,
  providerConfig: providersConfigSchema,
  vocabularyItems: vocabularyItemsSchema,
})

export async function parseRemoteSyncPayload(raw: unknown): Promise<RemoteSyncPayload> {
  const payloadResult = remoteSyncPayloadSchema.safeParse(raw)
  if (payloadResult.success) {
    return payloadResult.data
  }

  const legacyResult = legacyRemoteConfigSchema.safeParse(raw)
  if (!legacyResult.success) {
    throw new Error("Remote sync payload is invalid")
  }

  const legacyValue = legacyResult.data as ConfigValueAndMeta
  const migratedConfig = await migrateConfig(legacyValue.value, legacyValue.meta.schemaVersion)

  return {
    schemaVersion: CONFIG_SCHEMA_VERSION,
    updatedAt: legacyValue.meta.lastModifiedAt,
    settings: migratedConfig,
    providerConfig: migratedConfig.providersConfig,
    vocabularyItems: [],
  }
}
