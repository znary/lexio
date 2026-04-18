import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const {
  clearPlatformAuthSessionMock,
  getPlatformAuthSessionMock,
  setPlatformAuthSessionMock,
} = vi.hoisted(() => ({
  clearPlatformAuthSessionMock: vi.fn(),
  getPlatformAuthSessionMock: vi.fn(),
  setPlatformAuthSessionMock: vi.fn(),
}))

vi.mock("../storage", () => ({
  clearPlatformAuthSession: (...args: unknown[]) => clearPlatformAuthSessionMock(...args),
  getPlatformAuthSession: (...args: unknown[]) => getPlatformAuthSessionMock(...args),
  setPlatformAuthSession: (...args: unknown[]) => setPlatformAuthSessionMock(...args),
}))

vi.mock("../../constants/platform", () => ({
  buildPlatformApiUrl: (path: string) => `https://platform.example.com${path}`,
}))

describe("platform api helpers", () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("stores the renewed platform token from the response headers", async () => {
    const { refreshPlatformSessionFromResponse } = await import("../api")
    getPlatformAuthSessionMock.mockResolvedValue({
      token: "old-token",
      user: {
        email: "user@example.com",
      },
      updatedAt: Date.now(),
    })

    await refreshPlatformSessionFromResponse(new Response("{}", {
      headers: {
        "x-lexio-platform-token": "new-token",
      },
    }))

    expect(setPlatformAuthSessionMock).toHaveBeenCalledWith({
      token: "new-token",
      user: {
        email: "user@example.com",
      },
    })
  })

  it("refreshes the stored token before returning a successful platform response", async () => {
    const { platformFetch } = await import("../api")
    getPlatformAuthSessionMock
      .mockResolvedValueOnce({
        token: "old-token",
        user: {
          email: "user@example.com",
        },
        updatedAt: Date.now(),
      })
      .mockResolvedValueOnce({
        token: "old-token",
        user: {
          email: "user@example.com",
        },
        updatedAt: Date.now(),
      })

    const response = new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "x-lexio-platform-token": "new-token",
      },
    })
    const fetchMock = vi.fn().mockResolvedValue(response)
    vi.stubGlobal("fetch", fetchMock)

    const resolved = await platformFetch("/v1/me")

    expect(fetchMock).toHaveBeenCalledWith("https://platform.example.com/v1/me", {
      headers: expect.any(Headers),
    })
    expect(setPlatformAuthSessionMock).toHaveBeenCalledWith({
      token: "new-token",
      user: {
        email: "user@example.com",
      },
    })
    expect(resolved).toBe(response)
  })

  it("clears the local session when the platform returns 401", async () => {
    const { platformFetch } = await import("../api")
    getPlatformAuthSessionMock.mockResolvedValue({
      token: "old-token",
      user: {
        email: "user@example.com",
      },
      updatedAt: Date.now(),
    })

    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "expired" }), {
      status: 401,
      headers: {
        "Content-Type": "application/json",
      },
    }))
    vi.stubGlobal("fetch", fetchMock)

    await expect(platformFetch("/v1/me")).rejects.toThrow("Platform session expired. Sign in again.")
    expect(clearPlatformAuthSessionMock).toHaveBeenCalledTimes(1)
  })

  it("preserves the platform status code on request failures", async () => {
    const { PlatformAPIError, platformFetch } = await import("../api")
    getPlatformAuthSessionMock.mockResolvedValue({
      token: "old-token",
      user: {
        email: "user@example.com",
      },
      updatedAt: Date.now(),
    })

    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "Too Many Requests" }), {
      status: 429,
      headers: {
        "Content-Type": "application/json",
      },
    }))
    vi.stubGlobal("fetch", fetchMock)

    let error: unknown
    try {
      await platformFetch("/v1/translate")
    }
    catch (caught) {
      error = caught
    }

    expect(error).toMatchObject({
      name: "PlatformAPIError",
      message: "Too Many Requests",
      statusCode: 429,
    })
    expect(error).toBeInstanceOf(PlatformAPIError)
    expect((error as { statusCode: number }).statusCode).toBe(429)
  })

  it("posts a direct managed translation request and resolves the final text", async () => {
    const { translateWithManagedPlatform } = await import("../api")
    getPlatformAuthSessionMock.mockResolvedValue({
      token: "platform-token",
      user: {
        email: "user@example.com",
      },
      updatedAt: Date.now(),
    })

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        text: "AB",
      }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      }))
    vi.stubGlobal("fetch", fetchMock)

    const result = await translateWithManagedPlatform(
      {
        scene: "page",
        text: "hello",
        sourceLanguage: "en",
        targetLanguage: "zh",
        systemPrompt: "system",
        prompt: "prompt",
      },
    )

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith("https://platform.example.com/v1/translate", expect.objectContaining({
      method: "POST",
      body: expect.stringContaining("\"prompt\":\"prompt\""),
    }))
    expect(result).toBe("AB")
  })

  it("reports queued and running translation states before completion", async () => {
    const { translateWithManagedPlatform } = await import("../api")
    getPlatformAuthSessionMock.mockResolvedValue({
      token: "platform-token",
      user: {
        email: "user@example.com",
      },
      updatedAt: Date.now(),
    })

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        text: "done",
      }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      }))
    vi.stubGlobal("fetch", fetchMock)

    const statusChanges: string[] = []
    const result = await translateWithManagedPlatform(
      {
        scene: "page",
        text: "hello",
        sourceLanguage: "en",
        targetLanguage: "zh",
        systemPrompt: "system",
        prompt: "prompt",
      },
      {
        onStatusChange(update) {
          statusChanges.push(update.state)
        },
      },
    )

    expect(result).toBe("done")
    expect(statusChanges).toEqual(["queued", "running", "completed"])
  })

  it("streams managed translation through the direct translate endpoint", async () => {
    const { streamManagedTranslation } = await import("../api")
    getPlatformAuthSessionMock.mockResolvedValue({
      token: "platform-token",
      user: {
        email: "user@example.com",
      },
      updatedAt: Date.now(),
    })

    const encoder = new TextEncoder()
    const fetchMock = vi.fn().mockResolvedValue(new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode("data: {\"choices\":[{\"delta\":{\"content\":\"A\"}}]}\n\n"))
        controller.enqueue(encoder.encode("data: {\"choices\":[{\"delta\":{\"content\":\"B\"}}]}\n\n"))
        controller.enqueue(encoder.encode("data: [DONE]\n\n"))
        controller.close()
      },
    }), {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream",
      },
    }))
    vi.stubGlobal("fetch", fetchMock)

    const chunks: string[] = []
    const result = await streamManagedTranslation(
      {
        scene: "selection",
        text: "hello",
        sourceLanguage: "en",
        targetLanguage: "zh",
        systemPrompt: "system",
        prompt: "prompt",
      },
      {
        onChunk(snapshot) {
          chunks.push(snapshot.output)
        },
      },
    )

    expect(fetchMock).toHaveBeenCalledWith("https://platform.example.com/v1/translate", expect.objectContaining({
      method: "POST",
      body: expect.stringContaining("\"stream\":true"),
    }))
    expect(chunks).toEqual(["A", "AB"])
    expect(result).toEqual({
      output: "AB",
      thinking: {
        status: "complete",
        text: "",
      },
    })
  })

  it("blocks repeated identical managed translation requests before they can loop", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-04-17T08:00:00.000Z"))

    const { translateWithManagedPlatform } = await import("../api")
    getPlatformAuthSessionMock.mockResolvedValue({
      token: "platform-token",
      user: {
        email: "user@example.com",
      },
      updatedAt: Date.now(),
    })

    const fetchMock = vi.fn(async () => {
      return new Response(JSON.stringify({
        text: "AB",
      }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      })
    })
    vi.stubGlobal("fetch", fetchMock)

    const payload = {
      scene: "page",
      text: "hello",
      sourceLanguage: "en",
      targetLanguage: "zh",
      systemPrompt: "system",
      prompt: "prompt",
    } as const

    await expect(translateWithManagedPlatform(payload)).resolves.toBe("AB")
    await expect(translateWithManagedPlatform(payload)).resolves.toBe("AB")
    await expect(translateWithManagedPlatform(payload)).resolves.toBe("AB")
    await expect(translateWithManagedPlatform(payload)).rejects.toThrow(
      "Blocked repeated managed translation request to prevent a retry loop.",
    )
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })
})
