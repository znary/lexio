// @vitest-environment jsdom
import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { TranslationContent } from "../translation-content"

vi.mock("#imports", () => ({
  i18n: {
    t: (key: string) => key,
  },
}))

vi.mock("@/components/thinking", () => ({
  Thinking: ({ content }: { content: string }) => <div>{content}</div>,
}))

vi.mock("../../../components/selection-source-content", () => ({
  SelectionSourceContent: ({ text }: { text: string | null | undefined }) => <div>{text}</div>,
}))

vi.mock("../../custom-action-button/structured-object-renderer", () => ({
  StructuredObjectRenderer: ({ value }: { value: Record<string, unknown> | null }) => (
    <pre>{JSON.stringify(value)}</pre>
  ),
}))

describe("translationContent", () => {
  it("renders the detailed explanation inline by default", () => {
    render(
      <TranslationContent
        detailedExplanation={{
          isLoading: false,
          outputSchema: [],
          result: { Definition: "插图" },
          thinking: null,
        }}
        selectionContent="illustration"
        translatedText="插画"
        isTranslating={false}
        thinking={null}
      />,
    )

    expect(screen.getByText("action.translation")).toBeInTheDocument()
    expect(screen.getByText("插画")).toBeInTheDocument()
    expect(screen.getByText("{\"Definition\":\"插图\"}")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "copy" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "speak" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "action.viewDetailedExplanation" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "action.hideDetailedExplanation" })).not.toBeInTheDocument()
  })

  it("keeps detailed explanation errors out of the translation body", () => {
    render(
      <TranslationContent
        detailedExplanation={{
          isLoading: false,
          outputSchema: [],
          result: { Definition: "插图" },
          thinking: null,
        }}
        selectionContent="illustration"
        translatedText="插画"
        isTranslating={false}
        thinking={null}
      />,
    )

    expect(screen.getByText("{\"Definition\":\"插图\"}")).toBeInTheDocument()
    expect(screen.queryByText("missing provider")).toBeNull()
  })
})
