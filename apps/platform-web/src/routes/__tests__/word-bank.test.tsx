// @vitest-environment jsdom

import type { ReactNode } from "react"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { SitePreferencesProvider } from "../../app/site-preferences"

const useAuthMock = vi.fn()
const getPlatformVocabularyItemsMock = vi.fn()
const synthesizeEdgeTTSMock = vi.fn()
const toastErrorMock = vi.fn()
const audioInstances: MockAudio[] = []

class MockAudio {
  onended: (() => void) | null = null
  onerror: (() => void) | null = null
  pause = vi.fn()
  play = vi.fn(async () => {})
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
  getPlatformVocabularyItems: (...args: unknown[]) => getPlatformVocabularyItemsMock(...args),
}))

vi.mock("@/utils/server/edge-tts/api", () => ({
  synthesizeEdgeTTS: (...args: unknown[]) => synthesizeEdgeTTSMock(...args),
}))

vi.mock("sonner", () => ({
  toast: {
    error: (...args: unknown[]) => toastErrorMock(...args),
  },
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

beforeEach(() => {
  audioInstances.length = 0
  window.sessionStorage.clear()
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
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.unstubAllGlobals()
  window.sessionStorage.clear()
})

describe("word bank page speech controls", () => {
  it("renders the word family panel when the selected item has generated word family data", async () => {
    useAuthMock.mockReturnValue({
      isSignedIn: true,
      getToken: vi.fn().mockResolvedValue("token-1"),
    })
    getPlatformVocabularyItemsMock.mockResolvedValue([
      {
        id: "item-1",
        sourceText: "independent",
        normalizedText: "independent",
        translatedText: "独立的",
        definition: "独立的，不依赖他人的",
        nuance: "强调不受他人控制，也可表示彼此没有关联。",
        partOfSpeech: "adjective",
        phonetic: "/ˌɪndɪˈpendənt/",
        sourceLang: "eng",
        targetLang: "zho",
        kind: "word",
        wordCount: 1,
        createdAt: 1,
        lastSeenAt: 1,
        hitCount: 1,
        updatedAt: 1,
        deletedAt: null,
        wordFamily: {
          core: [
            {
              term: "independence",
              partOfSpeech: "noun",
              definition: "独立，自主",
            },
            {
              term: "independently",
              partOfSpeech: "adverb",
              definition: "独立地，不受支配地",
            },
          ],
          contrast: [
            {
              term: "dependent",
              partOfSpeech: "adjective",
              definition: "依赖的",
            },
          ],
          related: [
            {
              term: "depend",
              partOfSpeech: "verb",
              definition: "依靠，取决于",
            },
          ],
        },
        contextEntries: [
          {
            sentence: "The team worked independently across three tracks.",
          },
        ],
      },
    ])

    const { WordBankPage } = await import("../word-bank")
    const { container } = renderWithSitePreferences(<WordBankPage />)

    expect(await screen.findByLabelText("Word Family")).toBeTruthy()
    const practiceButton = screen.getByRole("link", { name: "Practice Now" })
    expect(container.querySelector(".word-bank-family-column")?.contains(practiceButton)).toBe(true)
    expect(container.querySelector(".word-bank-detail__header")?.contains(practiceButton)).toBe(false)
    expect(screen.queryByRole("button", { name: "independently adverb" })).toBeNull()
    expect(screen.getByText("独立地，不受支配地")).toBeTruthy()
  })

  it("does not render the word family panel or reserve empty space when the selected item has no word family", async () => {
    useAuthMock.mockReturnValue({
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
        sourceLang: "eng",
        targetLang: "zho",
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

    const { WordBankPage } = await import("../word-bank")
    const { container } = renderWithSitePreferences(<WordBankPage />)

    await screen.findByRole("button", { name: "Speak word" })

    expect(screen.queryByLabelText("Word Family")).toBeNull()
    expect(container.querySelector(".word-bank-detail__layout.has-family")).toBeNull()
  })

  it("removes the top practice entry point, hides nuance copy, and starts practice from the current word onward", async () => {
    useAuthMock.mockReturnValue({
      isSignedIn: true,
      userId: "user-1",
      getToken: vi.fn().mockResolvedValue("token-1"),
    })
    getPlatformVocabularyItemsMock.mockResolvedValue([
      {
        id: "item-1",
        sourceText: "independent",
        normalizedText: "independent",
        translatedText: "独立的",
        definition: "独立的，不依赖他人的",
        nuance: "强调不受他人控制，也可表示彼此没有关联。",
        sourceLang: "eng",
        targetLang: "zho",
        kind: "word",
        wordCount: 1,
        createdAt: 1,
        lastSeenAt: 1,
        hitCount: 1,
        updatedAt: 1,
        deletedAt: null,
        contextEntries: [
          {
            sentence: "The team worked independently across three tracks.",
          },
        ],
      },
    ])

    const { WordBankPage } = await import("../word-bank")
    renderWithSitePreferences(<WordBankPage />)

    const practiceButton = (await screen.findAllByRole("link", { name: "Practice Now" }))[0]

    expect(practiceButton?.getAttribute("href")).toBe("/practice?start=item-1")
    expect(screen.queryByRole("link", { name: "Start Practice" })).toBeNull()
    expect(screen.queryByText("Recently Added")).toBeNull()
    expect(screen.queryByText("Nuance")).toBeNull()
    expect(screen.queryByText("Source / Added")).toBeNull()
  })

  it("shows cached words immediately before the background refresh finishes", async () => {
    useAuthMock.mockReturnValue({
      isSignedIn: true,
      userId: "user-cache",
      getToken: vi.fn().mockResolvedValue("token-cache"),
    })

    window.sessionStorage.setItem("lexio.platform.word-bank.v1:user-cache", JSON.stringify({
      cachedAt: 1,
      items: [
        {
          id: "cached-item",
          sourceText: "cached",
          normalizedText: "cached",
          translatedText: "缓存",
          definition: "saved locally",
          sourceLang: "eng",
          targetLang: "zho",
          kind: "word",
          wordCount: 1,
          createdAt: 1,
          lastSeenAt: 1,
          hitCount: 1,
          updatedAt: 1,
          deletedAt: null,
        },
      ],
    }))

    let resolveItems: ((items: unknown[]) => void) | undefined
    getPlatformVocabularyItemsMock.mockReturnValue(new Promise((resolve) => {
      resolveItems = resolve
    }))

    const { WordBankPage } = await import("../word-bank")
    renderWithSitePreferences(<WordBankPage />)

    expect(await screen.findByRole("heading", { name: "cached" })).toBeTruthy()

    resolveItems?.([
      {
        id: "fresh-item",
        sourceText: "fresh",
        normalizedText: "fresh",
        translatedText: "新的",
        definition: "just fetched",
        sourceLang: "eng",
        targetLang: "zho",
        kind: "word",
        wordCount: 1,
        createdAt: 2,
        lastSeenAt: 2,
        hitCount: 1,
        updatedAt: 2,
        deletedAt: null,
      },
    ])

    expect(await screen.findByRole("heading", { name: "fresh" })).toBeTruthy()
  })

  it("plays the saved word and a context sentence through shared Edge TTS", async () => {
    useAuthMock.mockReturnValue({
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
        sourceLang: "eng",
        targetLang: "zho",
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
    synthesizeEdgeTTSMock.mockResolvedValue({
      ok: true,
      audio: new Uint8Array([1, 2, 3]).buffer,
      contentType: "audio/mpeg",
    })

    const { WordBankPage } = await import("../word-bank")
    renderWithSitePreferences(<WordBankPage />)

    const wordButton = await screen.findByRole("button", { name: "Speak word" })
    fireEvent.click(wordButton)

    await waitFor(() => {
      expect(synthesizeEdgeTTSMock).toHaveBeenCalledWith(expect.objectContaining({
        text: "collide",
        voice: "en-US-DavisNeural",
        rate: "+0%",
        pitch: "+0Hz",
        volume: "+0%",
      }))
    })

    const sentenceButton = screen.getByRole("button", { name: "Speak sentence" })
    fireEvent.click(sentenceButton)

    await waitFor(() => {
      expect(synthesizeEdgeTTSMock).toHaveBeenLastCalledWith(expect.objectContaining({
        text: "Two cars collide on the road.",
        voice: "en-US-DavisNeural",
      }))
    })

    expect(audioInstances).toHaveLength(2)
    expect(toastErrorMock).not.toHaveBeenCalled()
  })

  it("stops the current playback when the active button is clicked again", async () => {
    useAuthMock.mockReturnValue({
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
        sourceLang: "eng",
        targetLang: "zho",
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
    synthesizeEdgeTTSMock.mockResolvedValue({
      ok: true,
      audio: new Uint8Array([1, 2, 3]).buffer,
      contentType: "audio/mpeg",
    })

    const { WordBankPage } = await import("../word-bank")
    renderWithSitePreferences(<WordBankPage />)

    const wordButton = await screen.findByRole("button", { name: "Speak word" })
    fireEvent.click(wordButton)

    const stopButton = await screen.findByRole("button", { name: "Stop audio" })
    fireEvent.click(stopButton)

    expect(synthesizeEdgeTTSMock).toHaveBeenCalledTimes(1)
    expect(audioInstances[0]?.pause).toHaveBeenCalledTimes(1)
  })
})
