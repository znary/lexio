// @vitest-environment jsdom

import type { ReactNode } from "react"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { SitePreferencesProvider } from "../../app/site-preferences"

const useAuthMock = vi.fn()
const getPlatformPracticeSessionMock = vi.fn()
const submitPlatformPracticeResultMock = vi.fn()
const synthesizeEdgeTTSMock = vi.fn()
const audioInstances: MockAudio[] = []

class MockAudio {
  onended: (() => void) | null = null
  onerror: (() => void) | null = null
  pause = vi.fn()
  play = vi.fn(async () => {})
  preload = "auto"
  src = ""

  constructor(src: string) {
    this.src = src
    audioInstances.push(this)
  }
}

vi.mock("@clerk/clerk-react", () => ({
  useAuth: () => useAuthMock(),
}))

vi.mock("../../app/platform-api", () => ({
  getPlatformPracticeSession: (...args: unknown[]) => getPlatformPracticeSessionMock(...args),
  submitPlatformPracticeResult: (...args: unknown[]) => submitPlatformPracticeResultMock(...args),
}))

vi.mock("@/utils/server/edge-tts/api", () => ({
  synthesizeEdgeTTS: (...args: unknown[]) => synthesizeEdgeTTSMock(...args),
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

function submitTarget(input: HTMLElement, target: string, submitKey: "Enter" | " " = "Enter") {
  fireEvent.change(input, { target: { value: target } })
  fireEvent.keyDown(input, { key: submitKey })
}

beforeEach(() => {
  audioInstances.length = 0
  vi.stubGlobal("Audio", MockAudio)
  Object.defineProperty(URL, "createObjectURL", {
    value: vi.fn(() => "blob:tts-audio"),
    configurable: true,
    writable: true,
  })
  Object.defineProperty(URL, "revokeObjectURL", {
    value: vi.fn(),
    configurable: true,
    writable: true,
  })
  synthesizeEdgeTTSMock.mockResolvedValue({
    ok: true,
    audio: new Uint8Array([1, 2, 3]).buffer,
    contentType: "audio/mpeg",
  })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
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
              translatedSentence: "两辆车在路上相撞。",
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
    submitTarget(screen.getByLabelText("Current Word"), "collide", " ")

    expect(await screen.findByLabelText("Two cars collide on the road.")).toBeTruthy()
    expect(screen.getByText("两辆车在路上相撞。")).toBeTruthy()
    submitTarget(screen.getByLabelText("Current Word"), "collide")

    expect(await screen.findByText("Mastered this word?")).toBeTruthy()
    expect(screen.getByText("Accuracy")).toBeTruthy()

    fireEvent.click(screen.getByRole("button", { name: /Mastered/ }))

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
    submitTarget(screen.getByLabelText("Current Word"), "alpha", " ")

    expect(await screen.findByText("Mastered this word?")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: /Review Again/ }))

    expect(await screen.findByText("beta")).toBeTruthy()
    expect(submitPlatformPracticeResultMock).toHaveBeenCalledWith(
      "token-2",
      "item-a",
      expect.objectContaining({
        decision: "review-again",
      }),
    )
  })

  it("falls back to the word definition when the sentence has no chinese translation", async () => {
    useAuthMock.mockReturnValue({
      isLoaded: true,
      isSignedIn: true,
      getToken: vi.fn().mockResolvedValue("token-3"),
    })

    getPlatformPracticeSessionMock.mockResolvedValue({
      items: [
        {
          id: "item-2",
          sourceText: "repair",
          normalizedText: "repair",
          translatedText: "修理",
          definition: "to fix something broken",
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
              sentence: "They repair the bridge every spring.",
            },
          ],
        },
      ],
      practiceStates: [],
    })

    const { PracticePage } = await import("../practice")
    renderWithSitePreferences(<PracticePage />)

    expect(await screen.findByText("repair")).toBeTruthy()
    submitTarget(screen.getByLabelText("Current Word"), "repair")

    expect(await screen.findByLabelText("They repair the bridge every spring.")).toBeTruthy()
    expect(screen.getByText("to fix something broken")).toBeTruthy()
  })

  it("advances phrase practice by word when space is pressed", async () => {
    useAuthMock.mockReturnValue({
      isLoaded: true,
      isSignedIn: true,
      getToken: vi.fn().mockResolvedValue("token-4"),
    })

    getPlatformPracticeSessionMock.mockResolvedValue({
      items: [
        {
          id: "item-phrase",
          sourceText: "excuse me",
          normalizedText: "excuse me",
          translatedText: "打扰一下",
          definition: "a polite phrase for getting attention",
          sourceLang: "en",
          targetLang: "zh",
          kind: "phrase",
          wordCount: 2,
          createdAt: 1,
          lastSeenAt: 1,
          hitCount: 1,
          updatedAt: 1,
          deletedAt: null,
        },
      ],
      practiceStates: [],
    })

    const { PracticePage } = await import("../practice")
    renderWithSitePreferences(<PracticePage />)

    const input = await screen.findByLabelText("Current Phrase")
    submitTarget(input, "excuse", " ")

    expect((input as HTMLInputElement).value).toBe("excuse ")

    const slots = document.querySelectorAll(".practice-target-composer__slots .practice-target-composer__slot")
    expect(slots[0]?.className).toContain("is-complete")
    expect(slots[1]?.className).toContain("is-active")

    submitTarget(input, "excuse me", " ")

    expect(await screen.findByText("Mastered this word?")).toBeTruthy()
  })

  it("pre-measures phrase slot widths from the target text before typing", async () => {
    useAuthMock.mockReturnValue({
      isLoaded: true,
      isSignedIn: true,
      getToken: vi.fn().mockResolvedValue("token-width"),
    })

    getPlatformPracticeSessionMock.mockResolvedValue({
      items: [
        {
          id: "item-width",
          sourceText: "excuse me",
          normalizedText: "excuse me",
          translatedText: "打扰一下",
          definition: "a polite phrase for getting attention",
          sourceLang: "en",
          targetLang: "zh",
          kind: "phrase",
          wordCount: 2,
          createdAt: 1,
          lastSeenAt: 1,
          hitCount: 1,
          updatedAt: 1,
          deletedAt: null,
        },
      ],
      practiceStates: [],
    })

    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      if (this.classList.contains("practice-target-composer__slot--measure")) {
        const text = this.dataset.measureText?.trim() ?? ""
        const width = text === "excuse" ? 184 : text === "me" ? 96 : 112

        return {
          width,
          height: 48,
          top: 0,
          left: 0,
          right: width,
          bottom: 48,
          x: 0,
          y: 0,
          toJSON: () => ({}),
        } as DOMRect
      }

      return {
        width: 0,
        height: 0,
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      } as DOMRect
    })

    const { PracticePage } = await import("../practice")
    renderWithSitePreferences(<PracticePage />)

    await screen.findByLabelText("Current Phrase")

    await waitFor(() => {
      const visibleSlots = document.querySelectorAll<HTMLElement>(".practice-target-composer__slots .practice-target-composer__slot")
      expect(visibleSlots[0]?.style.width).toBe("184px")
      expect(visibleSlots[1]?.style.width).toBe("96px")
    })
  })

  it("auto plays speech for the visible word and sentence when sound is enabled", async () => {
    useAuthMock.mockReturnValue({
      isLoaded: true,
      isSignedIn: true,
      getToken: vi.fn().mockResolvedValue("token-5"),
    })

    getPlatformPracticeSessionMock.mockResolvedValue({
      items: [
        {
          id: "item-speech",
          sourceText: "collide",
          normalizedText: "collide",
          translatedText: "碰撞",
          definition: "to hit something",
          sourceLang: "eng",
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
              translatedSentence: "两辆车在路上相撞。",
            },
          ],
        },
      ],
      practiceStates: [],
    })

    const { PracticePage } = await import("../practice")
    renderWithSitePreferences(<PracticePage />)

    await waitFor(() => {
      expect(audioInstances).toHaveLength(1)
    })
    expect(synthesizeEdgeTTSMock).toHaveBeenCalledWith(expect.objectContaining({
      text: "collide",
      voice: "en-US-DavisNeural",
    }))

    submitTarget(await screen.findByLabelText("Current Word"), "collide", " ")

    expect(await screen.findByLabelText("Two cars collide on the road.")).toBeTruthy()
    await waitFor(() => {
      expect(audioInstances).toHaveLength(2)
    })
    expect(synthesizeEdgeTTSMock).toHaveBeenCalledWith(expect.objectContaining({
      text: "Two cars collide on the road.",
      voice: "en-US-DavisNeural",
    }))
    expect(synthesizeEdgeTTSMock).toHaveBeenCalledTimes(2)
  })
})
