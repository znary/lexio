// @vitest-environment jsdom
import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

vi.mock("@/utils/platform/use-platform-auth-session", () => ({
  usePlatformAuthSession: () => ({
    isLoading: false,
    isSignedIn: true,
  }),
}))

vi.mock("../components/chat-workspace", () => ({
  ChatWorkspace: ({ isSignedIn, isSessionLoading }: { isSignedIn: boolean, isSessionLoading: boolean }) => (
    <div>
      chat workspace
      {String(isSignedIn)}
      {String(isSessionLoading)}
    </div>
  ),
}))

describe("sidepanel app", () => {
  it("passes the auth state into chat workspace", async () => {
    const { default: App } = await import("../app")

    render(<App />)

    expect(screen.getByText("chat workspacetruefalse")).toBeInTheDocument()
  })
})
