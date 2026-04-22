// @vitest-environment jsdom

import type { ReactNode } from "react"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { SitePreferencesProvider } from "../../app/site-preferences"

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

function renderWithSitePreferences(children: ReactNode) {
  return render(<SitePreferencesProvider>{children}</SitePreferencesProvider>)
}

describe("extension sync page", () => {
  it("waits for manual confirmation before syncing the token", async () => {
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
    renderWithSitePreferences(<ExtensionSyncPage />)

    expect(syncPlatformAuthToExtensionMock).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole("button", { name: "Authorize Access" }))

    await waitFor(() => {
      expect(syncPlatformAuthToExtensionMock).toHaveBeenCalledWith("token-1", {
        id: "user-1",
        email: "user@example.com",
        name: "User One",
        imageUrl: null,
      })
    })

    expect(toastSuccessMock).toHaveBeenCalledWith("Extension connected.")
    expect(screen.queryByRole("heading", { name: "Extension Connected" })).not.toBeNull()
    expect(screen.queryByRole("heading", { name: "Authorize Extension" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Close This Page" })).not.toBeNull()
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
    renderWithSitePreferences(<ExtensionSyncPage />)

    fireEvent.click(screen.getByRole("button", { name: "Authorize Access" }))

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith("No token")
    })
  })

  it("closes the page from the success state", async () => {
    const closeMock = vi.spyOn(window, "close").mockImplementation(() => {})

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
    renderWithSitePreferences(<ExtensionSyncPage />)

    fireEvent.click(screen.getByRole("button", { name: "Authorize Access" }))

    await screen.findByRole("button", { name: "Close This Page" })
    fireEvent.click(screen.getByRole("button", { name: "Close This Page" }))

    expect(closeMock).toHaveBeenCalledTimes(1)
    closeMock.mockRestore()
  })
})
