// @vitest-environment jsdom

import type { ReactNode } from "react"
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import App from "../app"
import { SitePreferencesProvider } from "../site-preferences"

vi.mock("@clerk/clerk-react", () => ({
  SignIn: (props: { path?: string }) => (
    <div data-testid="clerk-sign-in" data-path={props.path}>
      Clerk Sign In
    </div>
  ),
  SignedIn: () => null,
  SignedOut: ({ children }: { children: ReactNode }) => <>{children}</>,
  UserButton: () => <button type="button">User</button>,
  useAuth: () => ({
    isLoaded: true,
    isSignedIn: false,
  }),
}))

Object.defineProperty(window, "matchMedia", {
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
  configurable: true,
  writable: true,
})

function renderAppAt(path: string) {
  window.history.replaceState({}, "", path)

  return render(
    <SitePreferencesProvider>
      <App />
    </SitePreferencesProvider>,
  )
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  window.history.replaceState({}, "", "/")
})

describe("platform web app routing", () => {
  it("keeps Clerk nested sign-in steps on the sign-in page", () => {
    renderAppAt("/sign-in/factor-one")

    expect(screen.getByTestId("clerk-sign-in").getAttribute("data-path")).toBe("/sign-in")
  })
})
