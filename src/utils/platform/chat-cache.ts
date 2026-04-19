import type { PlatformChatMessage, PlatformChatThreadSummary } from "./api"
import { storage } from "#imports"
import { z } from "zod"

const threadSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  lastMessageAt: z.string().nullable(),
})

const chatMessageSchema = z.object({
  id: z.string(),
  role: z.union([z.literal("user"), z.literal("assistant")]),
  contentText: z.string(),
  createdAt: z.string(),
})

export const sidepanelChatSnapshotSchema = z.object({
  threads: z.array(threadSummarySchema),
  currentThreadId: z.string().nullable(),
  currentThreadSummary: threadSummarySchema.nullable(),
  currentThreadMessages: z.array(chatMessageSchema),
  cachedAt: z.number().int().nonnegative(),
})

export interface SidepanelChatSnapshot {
  threads: PlatformChatThreadSummary[]
  currentThreadId: string | null
  currentThreadSummary: PlatformChatThreadSummary | null
  currentThreadMessages: PlatformChatMessage[]
  cachedAt: number
}

const SIDEPANEL_CHAT_SNAPSHOT_KEY_PREFIX = "__sidepanelChatSnapshot:"

function getSnapshotStorageKey(accountKey: string): string {
  return `local:${SIDEPANEL_CHAT_SNAPSHOT_KEY_PREFIX}${encodeURIComponent(accountKey)}`
}

export async function getSidepanelChatSnapshot(accountKey: string): Promise<SidepanelChatSnapshot | null> {
  const storageKey = getSnapshotStorageKey(accountKey)
  const value = await storage.getItem<unknown>(storageKey)
  const parsed = sidepanelChatSnapshotSchema.safeParse(value)

  if (parsed.success) {
    return parsed.data
  }

  if (value != null) {
    await storage.removeItem(storageKey)
  }

  return null
}

export async function setSidepanelChatSnapshot(accountKey: string, snapshot: SidepanelChatSnapshot): Promise<void> {
  const parsed = sidepanelChatSnapshotSchema.parse(snapshot)
  await storage.setItem(getSnapshotStorageKey(accountKey), parsed)
}
