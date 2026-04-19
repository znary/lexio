// @vitest-environment jsdom
import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

vi.mock("@/utils/platform/use-platform-auth-session", () => ({
  usePlatformAuthSession: () => ({
    session: {
      user: {
        email: "user@example.com",
      },
    },
    isLoading: false,
    isSignedIn: true,
  }),
}))

vi.mock("../components/chat-workspace", () => ({
  ChatWorkspace: ({
    isSignedIn,
    isSessionLoading,
    sessionAccountKey,
  }: {
    isSignedIn: boolean
    isSessionLoading: boolean
    sessionAccountKey: string | null
  }) => (
    <div>
      chat workspace
      {String(isSignedIn)}
      {String(isSessionLoading)}
      {String(sessionAccountKey)}
    </div>
  ),
}))

describe("sidepanel app", () => {
  it("passes the auth state into chat workspace", async () => {
    const { default: App } = await import("../app")

    render(<App />)

    expect(screen.getByText("chat workspacetruefalseuser@example.com")).toBeInTheDocument()
  })
})
