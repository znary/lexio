// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react"
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

vi.mock("../../../components/copy-button", () => ({
  CopyButton: () => <button type="button">copy</button>,
}))

vi.mock("../../../components/speak-button", () => ({
  SpeakButton: () => <button type="button">speak</button>,
}))

vi.mock("../../custom-action-button/structured-object-renderer", () => ({
  StructuredObjectRenderer: ({ value }: { value: Record<string, unknown> | null }) => (
    <pre>{JSON.stringify(value)}</pre>
  ),
}))

describe("translationContent", () => {
  it("shows the detailed explanation trigger after translation appears", () => {
    const onToggle = vi.fn()

    render(
      <TranslationContent
        detailedExplanation={{
          error: null,
          isExpanded: false,
          isLoading: false,
          onToggle,
          outputSchema: [],
          result: null,
          thinking: null,
        }}
        selectionContent="illustration"
        translatedText="插画"
        isTranslating={false}
        thinking={null}
      />,
    )

    fireEvent.click(screen.getByRole("button", { name: "action.viewDetailedExplanation" }))

    expect(onToggle).toHaveBeenCalledOnce()
    expect(screen.getByText("action.viewDetailedExplanationHint")).toBeInTheDocument()
  })

  it("renders the inline detailed explanation block when expanded", () => {
    render(
      <TranslationContent
        detailedExplanation={{
          error: { title: "Error", description: "missing provider" },
          isExpanded: true,
          isLoading: false,
          onToggle: vi.fn(),
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

    expect(screen.getByRole("button", { name: "action.hideDetailedExplanation" })).toBeInTheDocument()
    expect(screen.getByText("action.hideDetailedExplanationHint")).toBeInTheDocument()
    expect(screen.getByText("{\"Definition\":\"插图\"}")).toBeInTheDocument()
    expect(screen.getByText("missing provider")).toBeInTheDocument()
  })
})
