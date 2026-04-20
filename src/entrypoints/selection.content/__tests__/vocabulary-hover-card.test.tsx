// @vitest-environment jsdom
import { render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

describe("vocabulary hover card", () => {
  beforeEach(() => {
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => window.setTimeout(() => callback(performance.now()), 0))
    vi.stubGlobal("cancelAnimationFrame", (handle: number) => window.clearTimeout(handle))
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
          }

          return messages[key] ?? key
        },
      },
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
  })
})
