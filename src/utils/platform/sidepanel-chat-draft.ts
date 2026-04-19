import { storage } from "#imports"
import { z } from "zod"

const sidepanelChatDraftSchema = z.object({
  sessionKey: z.string().trim().min(1),
  createdAt: z.number().int().nonnegative(),
})

export type SidepanelChatDraft = z.infer<typeof sidepanelChatDraftSchema>

const SIDEPANEL_CHAT_DRAFT_STORAGE_KEY_PREFIX = "__sidepanelChatDraft:"

function getDraftStorageKey(accountKey: string): `local:${string}` {
  return `local:${SIDEPANEL_CHAT_DRAFT_STORAGE_KEY_PREFIX}${encodeURIComponent(accountKey)}`
}

export async function getSidepanelChatDraft(accountKey: string): Promise<SidepanelChatDraft | null> {
  const storageKey = getDraftStorageKey(accountKey)
  const value = await storage.getItem<unknown>(storageKey)
  const parsed = sidepanelChatDraftSchema.safeParse(value)

  if (parsed.success) {
    return parsed.data
  }

  if (value != null) {
    await storage.removeItem(storageKey)
  }

  return null
}

export async function setSidepanelChatDraft(accountKey: string, draft: SidepanelChatDraft): Promise<void> {
  const parsed = sidepanelChatDraftSchema.parse(draft)
  await storage.setItem(getDraftStorageKey(accountKey), parsed)
}

export async function clearSidepanelChatDraft(accountKey: string): Promise<void> {
  await storage.removeItem(getDraftStorageKey(accountKey))
}
