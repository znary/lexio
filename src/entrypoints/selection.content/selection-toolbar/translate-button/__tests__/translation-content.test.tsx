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

vi.mock("../../../components/selection-toolbar-error-alert", () => ({
  SelectionToolbarErrorAlert: ({ error }: { error: { description: string } | null }) =>
    error ? <div>{error.description}</div> : null,
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
          error: null,
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

  it("renders inline detailed explanation errors without a toggle shell", () => {
    render(
      <TranslationContent
        detailedExplanation={{
          error: { title: "Error", description: "missing provider" },
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
    expect(screen.getByText("missing provider")).toBeInTheDocument()
  })
})
