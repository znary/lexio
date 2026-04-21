// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { setVocabularyItemMasteredMock } = vi.hoisted(() => ({
  setVocabularyItemMasteredMock: vi.fn(),
}))

describe("vocabulary hover card", () => {
  beforeEach(() => {
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => window.setTimeout(() => callback(performance.now()), 0))
    vi.stubGlobal("cancelAnimationFrame", (handle: number) => window.clearTimeout(handle))
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(180)
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(72)
    setVocabularyItemMasteredMock.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("shows labeled source details and keeps only the meaning line at the bottom", async () => {
    vi.resetModules()
    vi.doMock("#imports", () => ({
      i18n: {
        t: (key: string) => {
          const messages: Record<string, string> = {
            "options.vocabulary.hoverCard.source": "原文",
            "options.vocabulary.hoverCard.root": "词根",
            "options.vocabulary.hoverCard.meaning": "释义",
            "options.vocabulary.hoverCard.translation": "译文",
            "options.vocabulary.hoverCard.details": "信息",
            "options.vocabulary.hoverCard.markMastered": "标记为已掌握",
            "options.vocabulary.hoverCard.unmarkMastered": "标记为学习中",
          }

          return messages[key] ?? key
        },
      },
    }))
    vi.doMock("@/utils/vocabulary/service", () => ({
      setVocabularyItemMastered: (...args: unknown[]) => setVocabularyItemMasteredMock(...args),
    }))
    vi.doMock("@/components/ui/base-ui/tooltip", () => ({
      Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
      TooltipTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
      TooltipContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    }))
    vi.doMock("../selection-toolbar/atoms", async () => {
      const actual = await vi.importActual<typeof import("jotai")>("jotai")
      return {
        selectionToolbarRectAtom: actual.atom(null),
      }
    })

    const { VocabularyHoverCard } = await import("../components/vocabulary-hover-card")

    render(
      <VocabularyHoverCard
        preview={{
          anchorRect: {
            top: 120,
            right: 220,
            bottom: 140,
            left: 180,
            width: 40,
            height: 20,
          },
          item: {
            id: "voc_1",
            sourceText: "comes",
            lemma: "come",
            normalizedText: "come",
            translatedText: "来到",
            partOfSpeech: "verb",
            phonetic: "/kʌmz/",
            definition: "arrives",
            sourceLang: "en",
            targetLang: "zh-CN",
            kind: "word",
            wordCount: 1,
            createdAt: 1,
            lastSeenAt: 2,
            hitCount: 3,
            updatedAt: 4,
            deletedAt: null,
          },
        }}
      />,
    )

    expect(screen.getByText(/(原文|options\.vocabulary\.hoverCard\.source)：comes/)).toBeInTheDocument()
    expect(screen.getByText(/(词根|options\.vocabulary\.hoverCard\.root)：come/)).toBeInTheDocument()
    expect(screen.getByText(/(信息|options\.vocabulary\.hoverCard\.details)：verb · \/kʌmz\//)).toBeInTheDocument()
    expect(screen.getByText(/(释义|options\.vocabulary\.hoverCard\.meaning)：arrives/)).toBeInTheDocument()
    expect(screen.queryByText(/(译文|options\.vocabulary\.hoverCard\.translation)：来到/)).not.toBeInTheDocument()
    expect(screen.queryByText(/->/)).not.toBeInTheDocument()

    const markMasteredButton = screen.getByRole("button", { name: "options.vocabulary.hoverCard.markMastered" })
    const sourceLine = screen.getByText(/(原文|options\.vocabulary\.hoverCard\.source)：comes/)
    expect(markMasteredButton).toHaveAttribute("data-mastery-state", "learning")
    expect(markMasteredButton).not.toHaveAttribute("title")
    expect(markMasteredButton.parentElement).toContainElement(sourceLine)
    expect(markMasteredButton.parentElement).toHaveClass("items-start")

    fireEvent.click(markMasteredButton)
    expect(setVocabularyItemMasteredMock).toHaveBeenCalledTimes(1)
    expect(setVocabularyItemMasteredMock).toHaveBeenCalledWith("voc_1", true)
  })

  it("shows a distinct mastered state and lets the user mark the word as learning again", async () => {
    vi.resetModules()
    vi.doMock("#imports", () => ({
      i18n: {
        t: (key: string) => {
          const messages: Record<string, string> = {
            "options.vocabulary.hoverCard.source": "原文",
            "options.vocabulary.hoverCard.root": "词根",
            "options.vocabulary.hoverCard.meaning": "释义",
            "options.vocabulary.hoverCard.translation": "译文",
            "options.vocabulary.hoverCard.details": "信息",
            "options.vocabulary.hoverCard.markMastered": "标记为已掌握",
            "options.vocabulary.hoverCard.unmarkMastered": "标记为学习中",
          }

          return messages[key] ?? key
        },
      },
    }))
    vi.doMock("@/utils/vocabulary/service", () => ({
      setVocabularyItemMastered: (...args: unknown[]) => setVocabularyItemMasteredMock(...args),
    }))
    vi.doMock("@/components/ui/base-ui/tooltip", () => ({
      Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
      TooltipTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
      TooltipContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    }))
    vi.doMock("../selection-toolbar/atoms", async () => {
      const actual = await vi.importActual<typeof import("jotai")>("jotai")
      return {
        selectionToolbarRectAtom: actual.atom(null),
      }
    })

    const { VocabularyHoverCard } = await import("../components/vocabulary-hover-card")

    render(
      <VocabularyHoverCard
        preview={{
          anchorRect: {
            top: 120,
            right: 220,
            bottom: 140,
            left: 180,
            width: 40,
            height: 20,
          },
          item: {
            id: "voc_1",
            sourceText: "comes",
            lemma: "come",
            normalizedText: "come",
            translatedText: "来到",
            partOfSpeech: "verb",
            phonetic: "/kʌmz/",
            definition: "arrives",
            sourceLang: "en",
            targetLang: "zh-CN",
            kind: "word",
            wordCount: 1,
            createdAt: 1,
            lastSeenAt: 2,
            hitCount: 3,
            updatedAt: 4,
            deletedAt: null,
            masteredAt: 5,
          },
        }}
      />,
    )

    const unmarkMasteredButton = screen.getByRole("button", { name: "options.vocabulary.hoverCard.unmarkMastered" })
    expect(unmarkMasteredButton).toHaveAttribute("data-mastery-state", "mastered")

    fireEvent.click(unmarkMasteredButton)
    expect(setVocabularyItemMasteredMock).toHaveBeenCalledTimes(1)
    expect(setVocabularyItemMasteredMock).toHaveBeenCalledWith("voc_1", false)
  })

  it("reports its measured card rect to the hover controller", async () => {
    vi.resetModules()
    vi.doMock("#imports", () => ({
      i18n: {
        t: (key: string) => key,
      },
    }))
    vi.doMock("@/utils/vocabulary/service", () => ({
      setVocabularyItemMastered: (...args: unknown[]) => setVocabularyItemMasteredMock(...args),
    }))
    vi.doMock("@/components/ui/base-ui/tooltip", () => ({
      Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
      TooltipTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
      TooltipContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    }))
    vi.doMock("../selection-toolbar/atoms", async () => {
      const actual = await vi.importActual<typeof import("jotai")>("jotai")
      return {
        selectionToolbarRectAtom: actual.atom(null),
      }
    })

    const { VocabularyHoverCard } = await import("../components/vocabulary-hover-card")
    const onCardRectChange = vi.fn()

    render(
      <VocabularyHoverCard
        preview={{
          anchorRect: {
            top: 160,
            right: 240,
            bottom: 180,
            left: 200,
            width: 40,
            height: 20,
          },
          item: {
            id: "voc_1",
            sourceText: "comes",
            lemma: "come",
            normalizedText: "come",
            translatedText: "来到",
            partOfSpeech: "verb",
            phonetic: "/kʌmz/",
            definition: "arrives",
            sourceLang: "en",
            targetLang: "zh-CN",
            kind: "word",
            wordCount: 1,
            createdAt: 1,
            lastSeenAt: 2,
            hitCount: 3,
            updatedAt: 4,
            deletedAt: null,
          },
        }}
        onCardRectChange={onCardRectChange}
      />,
    )

    await screen.findByText(/comes/)

    await waitFor(() => {
      expect(onCardRectChange).toHaveBeenCalledWith({
        left: 130,
        top: 76,
        right: 310,
        bottom: 148,
        width: 180,
        height: 72,
      })
    })
  })
})
