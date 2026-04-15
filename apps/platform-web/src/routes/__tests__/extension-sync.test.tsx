// @vitest-environment jsdom

import type { ReactNode } from "react"
import { render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

const syncPlatformAuthToExtensionMock = vi.fn()
const toastSuccessMock = vi.fn()
const toastErrorMock = vi.fn()
const useAuthMock = vi.fn()
const useUserMock = vi.fn()

vi.mock("@clerk/clerk-react", () => ({
  SignInButton: ({ children }: { children: ReactNode }) => <>{children}</>,
  useAuth: () => useAuthMock(),
  useUser: () => useUserMock(),
}))

vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccessMock(...args),
    error: (...args: unknown[]) => toastErrorMock(...args),
  },
}))

vi.mock("../../app/platform-auth", () => ({
  syncPlatformAuthToExtension: (...args: unknown[]) => syncPlatformAuthToExtensionMock(...args),
}))

afterEach(() => {
  vi.clearAllMocks()
})

describe("extension sync page", () => {
  it("syncs the token and shows a toast without rendering an extension id", async () => {
    useAuthMock.mockReturnValue({
      isSignedIn: true,
      getToken: vi.fn().mockResolvedValue("token-1"),
    })
    useUserMock.mockReturnValue({
      user: {
        id: "user-1",
        primaryEmailAddress: {
          emailAddress: "user@example.com",
        },
        fullName: "User One",
        username: "userone",
        imageUrl: null,
      },
    })

    syncPlatformAuthToExtensionMock.mockResolvedValue(undefined)

    const { ExtensionSyncPage } = await import("../extension-sync")
    render(<ExtensionSyncPage />)

    await waitFor(() => {
      expect(syncPlatformAuthToExtensionMock).toHaveBeenCalledWith("token-1", {
        id: "user-1",
        email: "user@example.com",
        name: "User One",
        imageUrl: null,
      })
    })

    expect(toastSuccessMock).toHaveBeenCalledWith("Lexio account connected.")
    expect(screen.queryByText(/extension id/i)).toBeNull()
  })

  it("shows a concise error when token sync fails", async () => {
    useAuthMock.mockReturnValue({
      isSignedIn: true,
      getToken: vi.fn().mockResolvedValue("token-1"),
    })
    useUserMock.mockReturnValue({
      user: {
        id: "user-1",
        primaryEmailAddress: {
          emailAddress: "user@example.com",
        },
        fullName: "User One",
        username: "userone",
        imageUrl: null,
      },
    })

    syncPlatformAuthToExtensionMock.mockRejectedValue(new Error("No token"))

    const { ExtensionSyncPage } = await import("../extension-sync")
    render(<ExtensionSyncPage />)

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith("No token")
    })
  })
})
