// @vitest-environment jsdom
import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { TooltipProvider } from "@/components/ui/base-ui/tooltip"
import { TranslationContent } from "../translation-content"

vi.mock("#imports", () => ({
  i18n: {
    t: (key: string) => key,
  },
}))

vi.mock("@/components/thinking", () => ({
  Thinking: ({ content }: { content: string }) => <div>{content}</div>,
}))

vi.mock("../../../components/copy-button", () => ({
  CopyButton: ({ text }: { text: string | undefined }) => (
    <button type="button" aria-label="copy" data-copy-text={text} />
  ),
}))

vi.mock("../../../components/speak-button", () => ({
  SpeakButton: ({ text }: { text: string | undefined }) => (
    <button type="button" aria-label="speak" data-speak-text={text} />
  ),
}))

describe("translationContent", () => {
  it("renders translation as a vocabulary card with dictionary details and extra visible fields", () => {
    render(
      <TooltipProvider>
        <TranslationContent
          detailedExplanation={{
            isLoading: false,
            outputSchema: [
              { id: "dictionary-phonetic", name: "phonetic", type: "string", description: "", speaking: false },
              { id: "dictionary-part-of-speech", name: "partOfSpeech", type: "string", description: "", speaking: false },
              { id: "dictionary-definition", name: "definition", type: "string", description: "", speaking: false },
              { id: "dictionary-context-sentence-translation", name: "contextSentenceTranslation", type: "string", description: "", speaking: false, hidden: true },
              { id: "dictionary-word-family-core", name: "wordFamilyCore", type: "string", description: "", speaking: false, hidden: true },
              { id: "custom-register", name: "Register", type: "string", description: "", speaking: false },
            ],
            result: {
              phonetic: "/ˌɪləˈstreɪʃn/",
              partOfSpeech: "noun",
              definition: "插图；图解",
              contextSentenceTranslation: "这是一张插图。",
              wordFamilyCore: "illustrate || verb || 说明，给……加插图\nvisual example || 视觉例子",
              Register: "formal writing",
            },
          }}
          contextSentence="This is an illustration."
          selectionContent="illustration"
          translatedText="插画"
          isTranslating={false}
        />
      </TooltipProvider>,
    )

    expect(screen.getByTestId("selection-translation-vocabulary-card")).toBeInTheDocument()
    expect(screen.getAllByText("illustration").length).toBeGreaterThan(0)
    expect(screen.queryByText("插画")).toBeNull()
    expect(screen.getAllByText("插图；图解").length).toBeGreaterThan(0)
    expect(screen.getByText("这是一张插图。")).toHaveClass("context-block__translation")
    expect(screen.getByText("illustrate")).toBeInTheDocument()
    expect(screen.getByText("visual example")).toBeInTheDocument()
    expect(screen.getByText(/formal writing/)).toBeInTheDocument()
    expect(screen.getAllByRole("button", { name: "copy" }).length).toBeGreaterThan(0)
    expect(screen.getAllByRole("button", { name: "speak" }).length).toBeGreaterThan(0)
  })

  it("renders skeleton panes while dictionary details are still loading", () => {
    const { container } = render(
      <TooltipProvider>
        <TranslationContent
          detailedExplanation={{
            isLoading: true,
            outputSchema: [],
            result: null,
          }}
          selectionContent="illustration"
          translatedText="插画"
          isTranslating={false}
        />
      </TooltipProvider>,
    )

    expect(screen.queryByText("插画")).toBeNull()
    expect(screen.queryByText("translation.loadingStatus.translating")).toBeNull()
    expect(container.querySelectorAll("[data-slot='skeleton']").length).toBeGreaterThan(6)
    expect(container.querySelector(".word-bank-family")).toBeInTheDocument()
  })

  it("renders arrived dictionary fields while the remaining fields keep loading", () => {
    const { container } = render(
      <TooltipProvider>
        <TranslationContent
          detailedExplanation={{
            isLoading: true,
            outputSchema: [
              { id: "dictionary-definition", name: "definition", type: "string", description: "", speaking: false },
              { id: "dictionary-context-sentence-translation", name: "contextSentenceTranslation", type: "string", description: "", speaking: false, hidden: true },
              { id: "dictionary-word-family-core", name: "wordFamilyCore", type: "string", description: "", speaking: false, hidden: true },
            ],
            result: {
              definition: "插图；图解",
            },
          }}
          contextSentence="This is an illustration."
          selectionContent="illustration"
          translatedText={undefined}
          isTranslating={false}
        />
      </TooltipProvider>,
    )

    expect(screen.getAllByText("插图；图解").length).toBeGreaterThan(0)
    expect(container.querySelector(".vocabulary-detail-card__definition-skeleton")).toBeNull()
    expect(container.querySelector(".context-block__translation-skeleton")).toBeInTheDocument()
    expect(container.querySelector(".word-bank-family--skeleton")).toBeInTheDocument()
  })

  it("renders a translated context sentence under the quoted source in the same block", () => {
    render(
      <TooltipProvider>
        <TranslationContent
          selectionContent="by default"
          translatedText="默认情况下"
          isTranslating={false}
          vocabularyItem={{
            id: "voc-1",
            sourceText: "by default",
            normalizedText: "by default",
            translatedText: "默认情况下",
            contextEntries: [
              {
                sentence: "They run in a single region by default.",
                translatedSentence: "它们默认在单一区域运行。",
              },
            ],
            sourceLang: "en",
            targetLang: "zh-CN",
            kind: "phrase",
            wordCount: 2,
            createdAt: 1,
            lastSeenAt: 1,
            hitCount: 1,
            updatedAt: 1,
            deletedAt: null,
          }}
        />
      </TooltipProvider>,
    )

    const sourceQuote = screen.getByText(/They run in a single region by default/)
    const translatedQuote = screen.getByText("它们默认在单一区域运行。")

    expect(sourceQuote.closest(".context-block")).toBe(translatedQuote.closest(".context-block"))
    expect(translatedQuote).toHaveClass("context-block__translation")
  })
})
