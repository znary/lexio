import { storage } from "#imports"
import { beforeEach, describe, expect, it, vi } from "vitest"

function createSnapshot() {
  return {
    threads: [
      {
        id: "thread-1",
        title: "Saved thread",
        createdAt: "2026-04-19T10:00:00.000Z",
        updatedAt: "2026-04-19T10:10:00.000Z",
        lastMessageAt: "2026-04-19T10:10:00.000Z",
      },
    ],
    currentThreadId: "thread-1",
    currentThreadSummary: {
      id: "thread-1",
      title: "Saved thread",
      createdAt: "2026-04-19T10:00:00.000Z",
      updatedAt: "2026-04-19T10:10:00.000Z",
      lastMessageAt: "2026-04-19T10:10:00.000Z",
    },
    currentThreadMessages: [
      {
        id: "message-1",
        role: "assistant" as const,
        contentText: "Cached hello",
        createdAt: "2026-04-19T10:10:00.000Z",
      },
    ],
    cachedAt: 123,
  }
}

describe("chat cache", () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    storage.getItem = vi.fn().mockResolvedValue(undefined)
    storage.removeItem = vi.fn().mockResolvedValue(undefined)
    storage.setItem = vi.fn().mockResolvedValue(undefined)
  })

  it("returns null and clears invalid snapshots", async () => {
    storage.getItem = vi.fn().mockResolvedValue({
      threads: "bad-data",
    })

    const { getSidepanelChatSnapshot } = await import("../chat-cache")
    const snapshot = await getSidepanelChatSnapshot("user-1")

    expect(snapshot).toBeNull()
    expect(storage.removeItem).toHaveBeenCalledWith("local:__sidepanelChatSnapshot:user-1")
  })

  it("stores snapshots under account-specific keys", async () => {
    const snapshot = createSnapshot()
    const { setSidepanelChatSnapshot } = await import("../chat-cache")

    await setSidepanelChatSnapshot("user-1", snapshot)
    await setSidepanelChatSnapshot("user-2", snapshot)

    expect(storage.setItem).toHaveBeenNthCalledWith(1, "local:__sidepanelChatSnapshot:user-1", snapshot)
    expect(storage.setItem).toHaveBeenNthCalledWith(2, "local:__sidepanelChatSnapshot:user-2", snapshot)
  })

  it("reads a valid snapshot for the requested account", async () => {
    const snapshot = createSnapshot()
    storage.getItem = vi.fn().mockResolvedValue(snapshot)

    const { getSidepanelChatSnapshot } = await import("../chat-cache")
    const result = await getSidepanelChatSnapshot("user-2")

    expect(storage.getItem).toHaveBeenCalledWith("local:__sidepanelChatSnapshot:user-2")
    expect(result).toEqual(snapshot)
  })
})
