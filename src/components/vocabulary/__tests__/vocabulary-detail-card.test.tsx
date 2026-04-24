// @vitest-environment jsdom
import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { VocabularyDetailCard } from "../vocabulary-detail-card"

const copy = {
  definition: "Definition",
  inContext: "In Context",
  mastered: "Mastered",
  missingContext: "No context captured yet.",
  practiceNow: "Practice Now",
  wordFamily: "Word Family",
  wordFamilyContrast: "Contrast",
  wordFamilyCore: "Core",
  wordFamilyRelated: "Related",
}

describe("vocabularyDetailCard", () => {
  it("renders the generated word family groups without making entries interactive", () => {
    render(
      <VocabularyDetailCard
        variant="page"
        copy={copy}
        item={{
          id: "item-1",
          sourceText: "independent",
          translatedText: "独立的",
          definition: "独立的，不依赖他人的",
          partOfSpeech: "adjective",
          phonetic: "/ˌɪndɪˈpendənt/",
          wordFamily: {
            core: [
              { term: "independence", partOfSpeech: "noun", definition: "独立，自主" },
            ],
            contrast: [
              { term: "dependent", partOfSpeech: "adjective", definition: "依赖的" },
            ],
            related: [
              { term: "depend", partOfSpeech: "verb", definition: "依靠，取决于" },
            ],
          },
          contextEntries: [
            { sentence: "The team worked independently across three groups." },
          ],
        }}
        practiceHref="/practice?start=item-1"
      />,
    )

    expect(screen.getByLabelText("Word Family")).toBeInTheDocument()
    expect(screen.getByText("Core")).toBeInTheDocument()
    expect(screen.getByText("Contrast")).toBeInTheDocument()
    expect(screen.getByText("Related")).toBeInTheDocument()
    expect(screen.getByText("independence")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "independence noun" })).not.toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Practice Now" })).toHaveAttribute("href", "/practice?start=item-1")
  })

  it("does not reserve the word family column when there is no word family", () => {
    const { container } = render(
      <VocabularyDetailCard
        variant="page"
        copy={copy}
        item={{
          id: "item-1",
          sourceText: "collide",
          translatedText: "碰撞",
          definition: "to hit something",
          partOfSpeech: "verb",
        }}
      />,
    )

    expect(screen.queryByLabelText("Word Family")).toBeNull()
    expect(container.querySelector(".word-bank-detail__layout.has-family")).toBeNull()
  })

  it("marks long text fields with wrapping classes and exposes page and popover variants", () => {
    const longText = "translated-without-breaks.example/".repeat(4)
    const { rerender } = render(
      <VocabularyDetailCard
        variant="popover"
        copy={copy}
        item={{
          sourceText: "source-without-breaks.example/".repeat(4),
          translatedText: longText,
          definition: longText,
          contextEntries: [{ sentence: longText }],
        }}
      />,
    )

    expect(screen.getByTestId("vocabulary-detail-card")).toHaveAttribute("data-variant", "popover")
    expect(screen.getByTestId("vocabulary-detail-card")).toHaveClass("word-bank-detail")
    expect(screen.getByText(longText)).toHaveClass("vocabulary-detail-card__wrap")

    rerender(
      <VocabularyDetailCard
        variant="page"
        copy={copy}
        item={{
          sourceText: "source",
          translatedText: "译文",
          definition: "释义",
        }}
      />,
    )

    expect(screen.getByTestId("vocabulary-detail-card")).toHaveAttribute("data-variant", "page")
  })
})
