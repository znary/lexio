/* eslint-disable import/first */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { DEFAULT_CONFIG } from "@/utils/constants/config"

const {
  clearPlatformAuthSessionMock,
  refreshPlatformSessionFromResponseMock,
} = vi.hoisted(() => {
  return {
    clearPlatformAuthSessionMock: vi.fn(),
    refreshPlatformSessionFromResponseMock: vi.fn(),
  }
})

vi.mock("@/utils/platform/storage", () => ({
  clearPlatformAuthSession: clearPlatformAuthSessionMock,
}))

vi.mock("@/utils/platform/api", () => ({
  refreshPlatformSessionFromResponse: (...args: unknown[]) => refreshPlatformSessionFromResponseMock(...args),
}))

vi.mock("#imports", () => ({
  storage: {
    getItem: vi.fn().mockResolvedValue(DEFAULT_CONFIG),
  },
}))

import { fetchManagedCloudWithSessionGuard, supportsStructuredOutputsForCustomProvider } from "../model"

describe("supportsStructuredOutputsForCustomProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("disables structured outputs for volcengine", () => {
    expect(supportsStructuredOutputsForCustomProvider("volcengine")).toBe(false)
  })

  it("keeps structured outputs enabled for generic OpenAI-compatible providers", () => {
    expect(supportsStructuredOutputsForCustomProvider("openai-compatible")).toBe(true)
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

    const guardedResponse = await fetchManagedCloudWithSessionGuard("https://example.com/v1/openai/chat/completions", {
      method: "POST",
    })

    expect(fetchMock).toHaveBeenCalledWith("https://example.com/v1/openai/chat/completions", {
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

    const guardedResponse = await fetchManagedCloudWithSessionGuard("https://example.com/v1/openai/chat/completions")

    expect(guardedResponse).toBe(response)
    expect(refreshPlatformSessionFromResponseMock).toHaveBeenCalledWith(response)
    expect(clearPlatformAuthSessionMock).not.toHaveBeenCalled()
  })
})
