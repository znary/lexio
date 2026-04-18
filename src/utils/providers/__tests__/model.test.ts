import { beforeEach, describe, expect, it, vi } from "vitest"
import { DEFAULT_CONFIG } from "@/utils/constants/config"

const {
  clearPlatformAuthSessionMock,
  createOpenAICompatibleMock,
  getPlatformAuthSessionMock,
  refreshPlatformSessionFromResponseMock,
  storageGetItemMock,
} = vi.hoisted(() => {
  return {
    clearPlatformAuthSessionMock: vi.fn(),
    createOpenAICompatibleMock: vi.fn(() => ({
      languageModel: vi.fn((modelId: string) => `managed:${modelId}`),
    })),
    getPlatformAuthSessionMock: vi.fn(),
    refreshPlatformSessionFromResponseMock: vi.fn(),
    storageGetItemMock: vi.fn(),
  }
})

vi.mock("@ai-sdk/openai-compatible", () => ({
  createOpenAICompatible: createOpenAICompatibleMock,
}))

vi.mock("@/utils/platform/storage", () => ({
  clearPlatformAuthSession: clearPlatformAuthSessionMock,
  getPlatformAuthSession: getPlatformAuthSessionMock,
}))

vi.mock("@/utils/platform/api", () => ({
  refreshPlatformSessionFromResponse: (...args: unknown[]) => refreshPlatformSessionFromResponseMock(...args),
}))

vi.mock("#imports", () => ({
  storage: {
    getItem: storageGetItemMock,
  },
}))

describe("managed cloud model routing", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    storageGetItemMock.mockResolvedValue(DEFAULT_CONFIG)
  })

  it("wraps managed cloud requests so 401 clears the local platform session", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", {
      status: 401,
      statusText: "Unauthorized",
      headers: {
        "Content-Type": "application/json",
      },
    }))

    vi.stubGlobal("fetch", fetchMock)
    const { fetchManagedCloudWithSessionGuard } = await import("../model")

    const guardedResponse = await fetchManagedCloudWithSessionGuard("https://example.com/v1/llm/chat/completions", {
      method: "POST",
    })

    expect(fetchMock).toHaveBeenCalledWith("https://example.com/v1/llm/chat/completions", {
      method: "POST",
    })
    expect(clearPlatformAuthSessionMock).toHaveBeenCalledTimes(1)
    expect(refreshPlatformSessionFromResponseMock).not.toHaveBeenCalled()
    await expect(guardedResponse.json()).resolves.toEqual({
      error: {
        message: "Platform session expired. Sign in again.",
      },
    })
  })

  it("refreshes the local session when the platform returns a renewed token", async () => {
    const response = new Response("{}", {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "x-lexio-platform-token": "renewed-token",
      },
    })
    const fetchMock = vi.fn().mockResolvedValue(response)

    vi.stubGlobal("fetch", fetchMock)
    const { fetchManagedCloudWithSessionGuard } = await import("../model")

    const guardedResponse = await fetchManagedCloudWithSessionGuard("https://example.com/v1/llm/chat/completions")

    expect(guardedResponse).toBe(response)
    expect(refreshPlatformSessionFromResponseMock).toHaveBeenCalledWith(response)
    expect(clearPlatformAuthSessionMock).not.toHaveBeenCalled()
  })
})
