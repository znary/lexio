// @vitest-environment jsdom

import type { ReactNode } from "react"
import { fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { SitePreferencesProvider } from "../../app/site-preferences"

const useAuthMock = vi.fn()
const getPlatformPracticeSessionMock = vi.fn()
const submitPlatformPracticeResultMock = vi.fn()

vi.mock("@clerk/clerk-react", () => ({
  useAuth: () => useAuthMock(),
}))

vi.mock("../../app/platform-api", () => ({
  getPlatformPracticeSession: (...args: unknown[]) => getPlatformPracticeSessionMock(...args),
  submitPlatformPracticeResult: (...args: unknown[]) => submitPlatformPracticeResultMock(...args),
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

function typeTarget(input: HTMLElement, target: string) {
  for (const character of target) {
    fireEvent.keyDown(input, { key: character })
  }
}

afterEach(() => {
  vi.clearAllMocks()
  window.history.replaceState({}, "", "/practice")
})

describe("practice page", () => {
  it("shows the confirmation state after word and sentence practice, then accepts keyboard 1 to mark mastered", async () => {
    useAuthMock.mockReturnValue({
      isLoaded: true,
      isSignedIn: true,
      getToken: vi.fn().mockResolvedValue("token-1"),
    })

    getPlatformPracticeSessionMock.mockResolvedValue({
      items: [
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
      ],
      practiceStates: [],
    })

    submitPlatformPracticeResultMock.mockResolvedValue({
      ok: true,
      masteredAt: 1234,
      practiceState: {
        itemId: "item-1",
        lastPracticedAt: 1234,
        lastDecision: "mastered",
        reviewAgainCount: 0,
        updatedAt: 1234,
      },
    })

    const { PracticePage } = await import("../practice")
    renderWithSitePreferences(<PracticePage />)

    expect(await screen.findByText("collide")).toBeTruthy()
    const input = screen.getByLabelText("Current Word")
    typeTarget(input, "collide")

    expect(await screen.findByLabelText("Two cars collide on the road.")).toBeTruthy()
    typeTarget(input, "collide")

    expect(await screen.findByText("Mastered this word?")).toBeTruthy()
    expect(screen.getByText("Accuracy")).toBeTruthy()

    fireEvent.keyDown(input, { key: "1" })

    expect(await screen.findByText("Practice complete.")).toBeTruthy()
    expect(submitPlatformPracticeResultMock).toHaveBeenCalledWith(
      "token-1",
      "item-1",
      expect.objectContaining({
        decision: "mastered",
      }),
    )
  })

  it("requeues review-again words to the bank queue tail and advances to the next word", async () => {
    useAuthMock.mockReturnValue({
      isLoaded: true,
      isSignedIn: true,
      getToken: vi.fn().mockResolvedValue("token-2"),
    })

    getPlatformPracticeSessionMock.mockResolvedValue({
      items: [
        {
          id: "item-a",
          sourceText: "alpha",
          normalizedText: "alpha",
          translatedText: "阿尔法",
          definition: "the first item",
          sourceLang: "en",
          targetLang: "zh",
          kind: "word",
          wordCount: 1,
          createdAt: 1,
          lastSeenAt: 10,
          hitCount: 1,
          updatedAt: 10,
          deletedAt: null,
        },
        {
          id: "item-b",
          sourceText: "beta",
          normalizedText: "beta",
          translatedText: "贝塔",
          definition: "the second item",
          sourceLang: "en",
          targetLang: "zh",
          kind: "word",
          wordCount: 1,
          createdAt: 2,
          lastSeenAt: 9,
          hitCount: 1,
          updatedAt: 9,
          deletedAt: null,
        },
      ],
      practiceStates: [],
    })

    submitPlatformPracticeResultMock.mockResolvedValue({
      ok: true,
      masteredAt: null,
      practiceState: {
        itemId: "item-a",
        lastPracticedAt: 2222,
        lastDecision: "review-again",
        reviewAgainCount: 1,
        updatedAt: 2222,
      },
    })

    const { PracticePage } = await import("../practice")
    renderWithSitePreferences(<PracticePage />)

    expect(await screen.findByText("alpha")).toBeTruthy()
    const input = screen.getByLabelText("Current Word")
    typeTarget(input, "alpha")

    expect(await screen.findByText("Mastered this word?")).toBeTruthy()
    fireEvent.keyDown(input, { key: "2" })

    expect(await screen.findByText("beta")).toBeTruthy()
    expect(submitPlatformPracticeResultMock).toHaveBeenCalledWith(
      "token-2",
      "item-a",
      expect.objectContaining({
        decision: "review-again",
      }),
    )
  })
})
