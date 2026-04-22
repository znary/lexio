// @vitest-environment jsdom

import type { ReactNode } from "react"
import { render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { SitePreferencesProvider } from "../../app/site-preferences"

const useAuthMock = vi.fn()
const getPlatformVocabularyItemsMock = vi.fn()

vi.mock("@clerk/clerk-react", () => ({
  useAuth: () => useAuthMock(),
}))

vi.mock("../../app/platform-api", () => ({
  getPlatformVocabularyItems: (...args: unknown[]) => getPlatformVocabularyItemsMock(...args),
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

function renderWithSitePreferences(children: ReactNode) {
  return render(<SitePreferencesProvider>{children}</SitePreferencesProvider>)
}

afterEach(() => {
  vi.clearAllMocks()
  window.history.replaceState({}, "", "/practice")
})

describe("practice page", () => {
  it("renders the practice session when a saved word uses auto as sourceLang", async () => {
    useAuthMock.mockReturnValue({
      isLoaded: true,
      isSignedIn: true,
      getToken: vi.fn().mockResolvedValue("token-1"),
    })

    getPlatformVocabularyItemsMock.mockResolvedValue([
      {
        id: "item-1",
        sourceText: "collide",
        normalizedText: "collide",
        translatedText: "碰撞",
        definition: "to hit something",
        sourceLang: "auto",
        targetLang: "zh",
        kind: "word",
        wordCount: 1,
        createdAt: 1,
        lastSeenAt: 1,
        hitCount: 1,
        updatedAt: 1,
        deletedAt: null,
        contextEntries: [
          {
            sentence: "Two cars collide on the road.",
          },
        ],
      },
    ])

    const { PracticePage } = await import("../practice")
    renderWithSitePreferences(<PracticePage />)

    expect(await screen.findByText("collide")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Restart" })).toBeTruthy()
  })
})
