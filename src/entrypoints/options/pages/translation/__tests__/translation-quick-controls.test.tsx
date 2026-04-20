// @vitest-environment jsdom
import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { TranslationQuickControls } from "../translation-quick-controls"

vi.mock("#imports", () => ({
  i18n: {
    t: (key: string) => key,
  },
}))

vi.mock("../../../components/config-card", () => ({
  ConfigCard: ({ children, title, description }: { children: React.ReactNode, title: React.ReactNode, description: React.ReactNode }) => (
    <section>
      <h2>{title}</h2>
      <p>{description}</p>
      <div>{children}</div>
    </section>
  ),
}))

vi.mock("../../../../popup/components/language-options-selector", () => ({
  default: () => <div data-testid="language-options">Language options</div>,
}))

vi.mock("../../../../popup/components/translation-mode-selector", () => ({
  default: () => <div data-testid="translation-mode-selector">Translation mode selector</div>,
}))

vi.mock("../../../../popup/components/translate-prompt-selector", () => ({
  default: () => <div data-testid="translate-prompt-selector">Translate prompt selector</div>,
}))

describe("translation quick controls", () => {
  it("only keeps the language selector", () => {
    render(<TranslationQuickControls />)

    expect(screen.getByRole("heading", { name: "options.general.quickSettings.reading.title" })).toBeInTheDocument()
    expect(screen.getByText("options.general.quickSettings.reading.description")).toBeInTheDocument()
    expect(screen.getByTestId("language-options")).toBeInTheDocument()
    expect(screen.queryByTestId("translation-mode-selector")).not.toBeInTheDocument()
    expect(screen.queryByTestId("translate-prompt-selector")).not.toBeInTheDocument()
  })
})
