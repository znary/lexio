// @vitest-environment jsdom

import { render, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

const clearPlatformAuthSessionInExtensionMock = vi.fn()
const useAuthMock = vi.fn()

vi.mock("@clerk/clerk-react", () => ({
  useAuth: () => useAuthMock(),
}))

vi.mock("../platform-auth", () => ({
  clearPlatformAuthSessionInExtension: (...args: unknown[]) => clearPlatformAuthSessionInExtensionMock(...args),
}))

describe("platform auth bridge", () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it("clears the extension session when the website signs out", async () => {
    useAuthMock.mockReturnValue({
      isLoaded: true,
      isSignedIn: true,
    })

    const { PlatformAuthBridge } = await import("../platform-auth-bridge")

    const { rerender } = render(<PlatformAuthBridge />)

    useAuthMock.mockReturnValue({
      isLoaded: true,
      isSignedIn: false,
    })
    rerender(<PlatformAuthBridge />)

    await waitFor(() => {
      expect(clearPlatformAuthSessionInExtensionMock).toHaveBeenCalledTimes(1)
    })
  })

  it("does not clear anything on the initial signed out state", async () => {
    useAuthMock.mockReturnValue({
      isLoaded: true,
      isSignedIn: false,
    })

    const { PlatformAuthBridge } = await import("../platform-auth-bridge")
    render(<PlatformAuthBridge />)

    expect(clearPlatformAuthSessionInExtensionMock).not.toHaveBeenCalled()
  })
})
