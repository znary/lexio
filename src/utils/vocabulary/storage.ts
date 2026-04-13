import type {
  LastSyncedVocabularyItemsMeta,
  LastSyncedVocabularyItemsValueAndMeta,
  VocabularyItem,
  VocabularyItemsMeta,
  VocabularyItemsValueAndMeta,
} from "@/types/vocabulary"
import { storage } from "#imports"
import { vocabularyItemsSchema } from "@/types/vocabulary"
import {
  LAST_SYNCED_VOCABULARY_ITEMS_STORAGE_KEY,
  VOCABULARY_ITEMS_STORAGE_KEY,
} from "../constants/config"
import { VOCABULARY_SCHEMA_VERSION } from "../constants/vocabulary"
import { logger } from "../logger"

function parseVocabularyItems(value: unknown): VocabularyItem[] {
  const parsed = vocabularyItemsSchema.safeParse(value)
  if (!parsed.success) {
    logger.error("Invalid vocabulary items in storage", parsed.error)
    return []
  }

  return parsed.data
}

function buildVocabularyMeta(meta: Partial<VocabularyItemsMeta> | undefined): VocabularyItemsMeta {
  return {
    schemaVersion: meta?.schemaVersion ?? VOCABULARY_SCHEMA_VERSION,
    lastModifiedAt: meta?.lastModifiedAt ?? 0,
  }
}

export function getActiveVocabularyItems(items: VocabularyItem[]): VocabularyItem[] {
  return items.filter(item => item.deletedAt == null)
}

export function sortVocabularyItems(items: VocabularyItem[]): VocabularyItem[] {
  return [...items].sort((left, right) => right.updatedAt - left.updatedAt)
}

export async function getLocalVocabularyItemsAndMeta(): Promise<VocabularyItemsValueAndMeta> {
  const [value, meta] = await Promise.all([
    storage.getItem<unknown>(`local:${VOCABULARY_ITEMS_STORAGE_KEY}`),
    storage.getMeta<VocabularyItemsMeta>(`local:${VOCABULARY_ITEMS_STORAGE_KEY}`),
  ])

  return {
    value: sortVocabularyItems(parseVocabularyItems(value)),
    meta: buildVocabularyMeta(meta),
  }
}

export async function setLocalVocabularyItemsAndMeta(
  items: VocabularyItem[],
  meta?: Partial<VocabularyItemsMeta>,
): Promise<void> {
  const lastModifiedAt = meta?.lastModifiedAt ?? Date.now()
  const nextItems = sortVocabularyItems(parseVocabularyItems(items))

  await Promise.all([
    storage.setItem(`local:${VOCABULARY_ITEMS_STORAGE_KEY}`, nextItems),
    storage.setMeta(`local:${VOCABULARY_ITEMS_STORAGE_KEY}`, {
      schemaVersion: meta?.schemaVersion ?? VOCABULARY_SCHEMA_VERSION,
      lastModifiedAt,
    } satisfies VocabularyItemsMeta),
  ])
}

export async function getLastSyncedVocabularyItemsAndMeta(): Promise<LastSyncedVocabularyItemsValueAndMeta | null> {
  const [value, meta] = await Promise.all([
    storage.getItem<unknown>(`local:${LAST_SYNCED_VOCABULARY_ITEMS_STORAGE_KEY}`),
    storage.getMeta<LastSyncedVocabularyItemsMeta>(`local:${LAST_SYNCED_VOCABULARY_ITEMS_STORAGE_KEY}`),
  ])

  if (!meta) {
    return null
  }

  return {
    value: sortVocabularyItems(parseVocabularyItems(value)),
    meta,
  }
}

export async function setLastSyncedVocabularyItemsAndMeta(
  items: VocabularyItem[],
  meta: Partial<LastSyncedVocabularyItemsMeta>,
): Promise<void> {
  const nextMeta: LastSyncedVocabularyItemsMeta = {
    schemaVersion: meta.schemaVersion ?? VOCABULARY_SCHEMA_VERSION,
    lastModifiedAt: meta.lastModifiedAt ?? Date.now(),
    lastSyncedAt: meta.lastSyncedAt ?? Date.now(),
    email: meta.email ?? "",
  }

  await Promise.all([
    storage.setItem(`local:${LAST_SYNCED_VOCABULARY_ITEMS_STORAGE_KEY}`, sortVocabularyItems(parseVocabularyItems(items))),
    storage.setMeta(`local:${LAST_SYNCED_VOCABULARY_ITEMS_STORAGE_KEY}`, nextMeta),
  ])
}
