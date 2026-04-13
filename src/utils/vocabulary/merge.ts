import type { VocabularyItem } from "@/types/vocabulary"
import { sortVocabularyItems } from "./storage"

function getChangeTimestamp(item: VocabularyItem | null | undefined): number {
  if (!item) {
    return 0
  }

  return item.deletedAt ?? item.updatedAt
}

function getLatestItem(...items: Array<VocabularyItem | null | undefined>): VocabularyItem | null {
  return items
    .filter((item): item is VocabularyItem => Boolean(item))
    .sort((left, right) => getChangeTimestamp(right) - getChangeTimestamp(left))[0] ?? null
}

function mergeWithoutBase(localItem: VocabularyItem | undefined, remoteItem: VocabularyItem | undefined): VocabularyItem | null {
  if (!localItem && !remoteItem) {
    return null
  }

  if (!localItem) {
    return remoteItem ?? null
  }

  if (!remoteItem) {
    return localItem
  }

  const latestItem = getLatestItem(localItem, remoteItem) ?? localItem
  const latestDeletedAt = [localItem.deletedAt, remoteItem.deletedAt]
    .filter((value): value is number => typeof value === "number")
    .sort((left, right) => right - left)[0] ?? null

  return {
    ...latestItem,
    createdAt: Math.min(localItem.createdAt, remoteItem.createdAt),
    lastSeenAt: Math.max(localItem.lastSeenAt, remoteItem.lastSeenAt),
    hitCount: localItem.hitCount + remoteItem.hitCount,
    updatedAt: Math.max(localItem.updatedAt, remoteItem.updatedAt),
    deletedAt: latestDeletedAt && latestDeletedAt >= latestItem.updatedAt ? latestDeletedAt : null,
  }
}

function mergeWithBase(
  baseItem: VocabularyItem,
  localItem: VocabularyItem | undefined,
  remoteItem: VocabularyItem | undefined,
): VocabularyItem {
  const latestItem = getLatestItem(localItem, remoteItem, baseItem) ?? baseItem
  const localHitDelta = localItem ? Math.max(0, localItem.hitCount - baseItem.hitCount) : 0
  const remoteHitDelta = remoteItem ? Math.max(0, remoteItem.hitCount - baseItem.hitCount) : 0
  const candidateDeletedAt = [
    baseItem.deletedAt,
    localItem?.deletedAt,
    remoteItem?.deletedAt,
  ]
    .filter((value): value is number => typeof value === "number")
    .sort((left, right) => right - left)[0] ?? null

  return {
    ...latestItem,
    createdAt: Math.min(
      baseItem.createdAt,
      localItem?.createdAt ?? baseItem.createdAt,
      remoteItem?.createdAt ?? baseItem.createdAt,
    ),
    lastSeenAt: Math.max(
      baseItem.lastSeenAt,
      localItem?.lastSeenAt ?? baseItem.lastSeenAt,
      remoteItem?.lastSeenAt ?? baseItem.lastSeenAt,
    ),
    hitCount: Math.max(1, baseItem.hitCount + localHitDelta + remoteHitDelta),
    updatedAt: Math.max(
      baseItem.updatedAt,
      localItem?.updatedAt ?? baseItem.updatedAt,
      remoteItem?.updatedAt ?? baseItem.updatedAt,
    ),
    deletedAt: candidateDeletedAt && candidateDeletedAt >= getChangeTimestamp(latestItem) ? candidateDeletedAt : null,
  }
}

export function mergeVocabularyItems({
  baseItems,
  localItems,
  remoteItems,
}: {
  baseItems: VocabularyItem[]
  localItems: VocabularyItem[]
  remoteItems: VocabularyItem[]
}): VocabularyItem[] {
  const baseMap = new Map(baseItems.map(item => [item.normalizedText, item]))
  const localMap = new Map(localItems.map(item => [item.normalizedText, item]))
  const remoteMap = new Map(remoteItems.map(item => [item.normalizedText, item]))

  const allKeys = new Set([
    ...baseMap.keys(),
    ...localMap.keys(),
    ...remoteMap.keys(),
  ])

  const mergedItems: VocabularyItem[] = []

  for (const key of allKeys) {
    const baseItem = baseMap.get(key)
    const localItem = localMap.get(key)
    const remoteItem = remoteMap.get(key)

    const mergedItem = baseItem
      ? mergeWithBase(baseItem, localItem, remoteItem)
      : mergeWithoutBase(localItem, remoteItem)

    if (mergedItem) {
      mergedItems.push(mergedItem)
    }
  }

  return sortVocabularyItems(mergedItems)
}
