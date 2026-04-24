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
              { id: "dictionary-word-family-core", name: "wordFamilyCore", type: "string", description: "", speaking: false, hidden: true },
              { id: "custom-register", name: "Register", type: "string", description: "", speaking: false },
            ],
            result: {
              phonetic: "/ˌɪləˈstreɪʃn/",
              partOfSpeech: "noun",
              definition: "插图；图解",
              wordFamilyCore: "illustrate || verb || 说明，给……加插图\nvisual example || 视觉例子",
              Register: "formal writing",
            },
            thinking: null,
          }}
          selectionContent="illustration"
          translatedText="插画"
          isTranslating={false}
          thinking={null}
        />
      </TooltipProvider>,
    )

    expect(screen.getByTestId("selection-translation-vocabulary-card")).toBeInTheDocument()
    expect(screen.getByText("illustration")).toBeInTheDocument()
    expect(screen.getByText("插画")).toBeInTheDocument()
    expect(screen.getByText("插图；图解")).toBeInTheDocument()
    expect(screen.getByText("illustrate")).toBeInTheDocument()
    expect(screen.getByText("visual example")).toBeInTheDocument()
    expect(screen.getByText(/formal writing/)).toBeInTheDocument()
    expect(screen.getAllByRole("button", { name: "copy" }).length).toBeGreaterThan(0)
    expect(screen.getAllByRole("button", { name: "speak" }).length).toBeGreaterThan(0)
  })

  it("keeps the translation visible while dictionary details are still loading", () => {
    render(
      <TooltipProvider>
        <TranslationContent
          detailedExplanation={{
            isLoading: true,
            outputSchema: [],
            result: null,
            thinking: null,
          }}
          selectionContent="illustration"
          translatedText="插画"
          isTranslating={false}
          thinking={null}
        />
      </TooltipProvider>,
    )

    expect(screen.getByText("插画")).toBeInTheDocument()
    expect(screen.getByText("translation.loadingStatus.translating")).toBeInTheDocument()
  })
})
