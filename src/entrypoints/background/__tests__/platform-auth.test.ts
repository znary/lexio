import { describe, expect, it, vi } from "vitest"

describe("platform auth background messaging", () => {
  it("exchanges the website token before saving the extension session", async () => {
    const setPlatformAuthSessionMock = vi.fn().mockResolvedValue(undefined)
    const clearPlatformAuthSessionMock = vi.fn().mockResolvedValue(undefined)
    const exchangeWebsiteTokenMock = vi.fn().mockResolvedValue({
      token: "platform-token-1",
      user: {
        email: "platform@example.com",
      },
    })

    const { handlePlatformAuthExternalMessage } = await import("../platform-auth")

    await expect(handlePlatformAuthExternalMessage({
      message: {
        type: "lexio-platform-auth-sync",
        token: "token-1",
        user: {
          email: "user@example.com",
        },
      },
      senderUrl: "https://lexio.example.com/extension-sync",
      websiteOrigin: "https://lexio.example.com",
      setPlatformAuthSession: setPlatformAuthSessionMock,
      clearPlatformAuthSession: clearPlatformAuthSessionMock,
      exchangeWebsiteToken: exchangeWebsiteTokenMock,
    })).resolves.toEqual({ ok: true })

    expect(exchangeWebsiteTokenMock).toHaveBeenCalledWith("token-1")
    expect(setPlatformAuthSessionMock).toHaveBeenCalledWith({
      token: "platform-token-1",
      user: {
        email: "platform@example.com",
      },
    })
    expect(clearPlatformAuthSessionMock).not.toHaveBeenCalled()
  })

  it("accepts clear messages from the website", async () => {
    const setPlatformAuthSessionMock = vi.fn().mockResolvedValue(undefined)
    const clearPlatformAuthSessionMock = vi.fn().mockResolvedValue(undefined)

    const { handlePlatformAuthExternalMessage } = await import("../platform-auth")
    await expect(handlePlatformAuthExternalMessage({
      message: {
        type: "lexio-platform-auth-clear",
      },
      senderUrl: "https://lexio.example.com/sign-in",
      websiteOrigin: "https://lexio.example.com",
      setPlatformAuthSession: setPlatformAuthSessionMock,
      clearPlatformAuthSession: clearPlatformAuthSessionMock,
    })).resolves.toEqual({ ok: true })

    expect(clearPlatformAuthSessionMock).toHaveBeenCalledTimes(1)
  })

  it("keeps the website user as a fallback when the platform response has no user", async () => {
    const setPlatformAuthSessionMock = vi.fn().mockResolvedValue(undefined)
    const clearPlatformAuthSessionMock = vi.fn().mockResolvedValue(undefined)
    const exchangeWebsiteTokenMock = vi.fn().mockResolvedValue({
      token: "platform-token-2",
    })

    const { handlePlatformAuthExternalMessage } = await import("../platform-auth")
    await expect(handlePlatformAuthExternalMessage({
      message: {
        type: "lexio-platform-auth-sync",
        token: "token-2",
        user: {
          email: "user@example.com",
        },
      },
      senderUrl: "https://lexio.example.com/extension-sync",
      websiteOrigin: "https://lexio.example.com",
      setPlatformAuthSession: setPlatformAuthSessionMock,
      clearPlatformAuthSession: clearPlatformAuthSessionMock,
      exchangeWebsiteToken: exchangeWebsiteTokenMock,
    })).resolves.toEqual({ ok: true })

    expect(setPlatformAuthSessionMock).toHaveBeenCalledWith({
      token: "platform-token-2",
      user: {
        email: "user@example.com",
      },
    })
  })

  it("rejects messages from an unauthorized origin", async () => {
    const setPlatformAuthSessionMock = vi.fn()
    const clearPlatformAuthSessionMock = vi.fn()

    const { handlePlatformAuthExternalMessage } = await import("../platform-auth")
    await expect(handlePlatformAuthExternalMessage({
      message: {
        type: "lexio-platform-auth-clear",
      },
      senderUrl: "https://example.com",
      websiteOrigin: "https://lexio.example.com",
      setPlatformAuthSession: setPlatformAuthSessionMock,
      clearPlatformAuthSession: clearPlatformAuthSessionMock,
    })).resolves.toEqual({
      ok: false,
      error: "Unauthorized sender",
    })

    expect(clearPlatformAuthSessionMock).not.toHaveBeenCalled()
    expect(setPlatformAuthSessionMock).not.toHaveBeenCalled()
  })
})
