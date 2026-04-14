// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react"
import * as React from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { PlatformQuickAccess } from "@/components/platform/platform-quick-access"

const getPlatformAuthSessionMock = vi.fn()
const watchPlatformAuthSessionMock = vi.fn()
const openPlatformExtensionSyncTabMock = vi.fn()
const openPlatformPricingTabMock = vi.fn()

vi.mock("@/components/ui/base-ui/button", () => ({
  Button: ({
    children,
    type = "button",
  }: React.ComponentProps<"button">) => (
    <button type={type}>
      {children}
    </button>
  ),
}))

vi.mock("@/components/ui/base-ui/badge", () => ({
  Badge: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}))

vi.mock("@/utils/platform/storage", () => ({
  getPlatformAuthSession: (...args: unknown[]) => getPlatformAuthSessionMock(...args),
  watchPlatformAuthSession: (...args: unknown[]) => watchPlatformAuthSessionMock(...args),
}))

vi.mock("@/utils/platform/navigation", () => ({
  openPlatformExtensionSyncTab: (...args: unknown[]) => openPlatformExtensionSyncTabMock(...args),
  openPlatformPricingTab: (...args: unknown[]) => openPlatformPricingTabMock(...args),
}))

afterEach(() => {
  vi.clearAllMocks()
})

describe("platformQuickAccess", () => {
  it("shows a visible sign in entry when there is no platform session", async () => {
    getPlatformAuthSessionMock.mockResolvedValue(null)
    watchPlatformAuthSessionMock.mockReturnValue(() => {})

    render(<PlatformQuickAccess size="sm" />)

    await waitFor(() => {
      expect(screen.getByText("Not signed in")).toBeInTheDocument()
    })

    expect(screen.getByRole("button", { name: "Sign in" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Plans" })).toBeInTheDocument()
  })

  it("shows the connected email when a platform session already exists", async () => {
    getPlatformAuthSessionMock.mockResolvedValue({
      token: "token",
      user: {
        email: "user@example.com",
      },
      updatedAt: Date.now(),
    })
    watchPlatformAuthSessionMock.mockReturnValue(() => {})

    render(<PlatformQuickAccess />)

    await waitFor(() => {
      expect(screen.getByText("user@example.com")).toBeInTheDocument()
    })

    expect(screen.getByText("Signed in")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Reconnect" })).toBeInTheDocument()
  })

  it("still shows a connected state when the session has no email", async () => {
    getPlatformAuthSessionMock.mockResolvedValue({
      token: "token",
      user: {},
      updatedAt: Date.now(),
    })
    watchPlatformAuthSessionMock.mockReturnValue(() => {})

    render(<PlatformQuickAccess />)

    await waitFor(() => {
      expect(screen.getByText("Signed in")).toBeInTheDocument()
    })

    expect(screen.getByRole("button", { name: "Reconnect" })).toBeInTheDocument()
  })
})
