import { storage } from "#imports"
import { beforeEach, describe, expect, it, vi } from "vitest"

function createDraft() {
  return {
    sessionKey: "draft-session-1",
    createdAt: 123,
  }
}

describe("sidepanel chat draft", () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    storage.getItem = vi.fn().mockResolvedValue(undefined)
    storage.removeItem = vi.fn().mockResolvedValue(undefined)
    storage.setItem = vi.fn().mockResolvedValue(undefined)
  })

  it("returns null and clears invalid drafts", async () => {
    storage.getItem = vi.fn().mockResolvedValue({
      sessionKey: "",
    })

    const { getSidepanelChatDraft } = await import("../sidepanel-chat-draft")
    const result = await getSidepanelChatDraft("user-1")

    expect(result).toBeNull()
    expect(storage.removeItem).toHaveBeenCalledWith("local:__sidepanelChatDraft:user-1")
  })

  it("stores drafts under account-specific keys", async () => {
    const draft = createDraft()
    const { setSidepanelChatDraft } = await import("../sidepanel-chat-draft")

    await setSidepanelChatDraft("user-1", draft)
    await setSidepanelChatDraft("user-2", draft)

    expect(storage.setItem).toHaveBeenNthCalledWith(1, "local:__sidepanelChatDraft:user-1", draft)
    expect(storage.setItem).toHaveBeenNthCalledWith(2, "local:__sidepanelChatDraft:user-2", draft)
  })

  it("reads a valid draft for the requested account", async () => {
    const draft = createDraft()
    storage.getItem = vi.fn().mockResolvedValue(draft)

    const { getSidepanelChatDraft } = await import("../sidepanel-chat-draft")
    const result = await getSidepanelChatDraft("user-2")

    expect(storage.getItem).toHaveBeenCalledWith("local:__sidepanelChatDraft:user-2")
    expect(result).toEqual(draft)
  })

  it("clears drafts with the matching account key", async () => {
    const { clearSidepanelChatDraft } = await import("../sidepanel-chat-draft")

    await clearSidepanelChatDraft("user-3")

    expect(storage.removeItem).toHaveBeenCalledWith("local:__sidepanelChatDraft:user-3")
  })
})
