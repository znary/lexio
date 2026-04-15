// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const getExtensionIdFromLocationMock = vi.fn()
const sendMessageMock = vi.fn()

vi.mock("../env", () => ({
  getExtensionIdFromLocation: () => getExtensionIdFromLocationMock(),
}))

describe("platform auth helpers", () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    Object.defineProperty(window, "chrome", {
      configurable: true,
      value: {
        runtime: {
          sendMessage: sendMessageMock,
        },
      },
    })
  })

  afterEach(() => {
    delete (window as typeof window & { chrome?: unknown }).chrome
  })

  it("sends the token and user to the extension", async () => {
    getExtensionIdFromLocationMock.mockReturnValue("extension-1")
    sendMessageMock.mockImplementation((extensionId: string, message: unknown, callback?: (response?: unknown) => void) => {
      expect(extensionId).toBe("extension-1")
      expect(message).toEqual({
        type: "lexio-platform-auth-sync",
        token: "token-1",
        user: {
          id: "user-1",
          email: "user@example.com",
          name: "User One",
          imageUrl: null,
        },
      })
      callback?.({ ok: true })
    })

    const { syncPlatformAuthToExtension } = await import("../platform-auth")
    await expect(syncPlatformAuthToExtension("token-1", {
      id: "user-1",
      email: "user@example.com",
      name: "User One",
      imageUrl: null,
    })).resolves.toBeUndefined()
  })

  it("rejects when the extension response is not ok", async () => {
    getExtensionIdFromLocationMock.mockReturnValue("extension-1")
    sendMessageMock.mockImplementation((extensionId: string, _message: unknown, callback?: (response?: unknown) => void) => {
      expect(extensionId).toBe("extension-1")
      callback?.({ ok: false, error: "No token" })
    })

    const { syncPlatformAuthToExtension } = await import("../platform-auth")
    await expect(syncPlatformAuthToExtension("token-1", null)).rejects.toThrow("No token")
  })

  it("sends a clear message when signing out", async () => {
    getExtensionIdFromLocationMock.mockReturnValue("extension-1")
    sendMessageMock.mockImplementation((_extensionId: string, message: unknown, callback?: (response?: unknown) => void) => {
      expect(message).toEqual({ type: "lexio-platform-auth-clear" })
      callback?.({ ok: true })
    })

    const { clearPlatformAuthSessionInExtension } = await import("../platform-auth")
    await expect(clearPlatformAuthSessionInExtension()).resolves.toBe(true)
  })
})
