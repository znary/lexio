// @vitest-environment jsdom
import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { GeneralPage } from "../index"

vi.mock("#imports", () => ({
  i18n: {
    t: (key: string) => key,
  },
}))

vi.mock("../../../components/page-layout", () => ({
  PageLayout: ({ children, title }: { children: React.ReactNode, title: React.ReactNode }) => (
    <div>
      <h1>{title}</h1>
      <div>{children}</div>
    </div>
  ),
}))

vi.mock("@/components/platform/platform-quick-access", () => ({
  PlatformQuickAccess: () => <div>Lexio Cloud</div>,
}))

vi.mock("../../../../popup/components/node-translation-hotkey-selector", () => ({
  default: () => <div>Hotkey selector</div>,
}))

vi.mock("../../../../popup/components/ai-smart-context", () => ({
  AISmartContext: () => <div>AI smart context</div>,
}))

vi.mock("../../config/vocabulary-settings", () => ({
  VocabularySettingsCard: () => <div data-testid="vocabulary-settings">Vocabulary settings</div>,
}))

vi.mock("../site-control-mode", () => ({
  default: () => <div data-testid="site-control-mode">Site control mode</div>,
}))

vi.mock("../appearance-settings", () => ({
  default: () => <div data-testid="appearance-settings">Appearance settings</div>,
}))

describe("general page", () => {
  it("keeps only cloud and shortcut quick settings on the general page", () => {
    render(<GeneralPage />)

    const lexioCloud = screen.getByRole("heading", { name: "options.general.quickSettings.cloud.title" })
    const shortcuts = screen.getByRole("heading", { name: "options.general.quickSettings.shortcuts.title" })

    expect(lexioCloud).toBeInTheDocument()
    expect(shortcuts).toBeInTheDocument()
    expect(screen.getByText("options.general.quickSettings.cloud.description")).toBeInTheDocument()
    expect(screen.getByText("options.general.quickSettings.shortcuts.description")).toBeInTheDocument()
    expect(screen.queryByRole("heading", { name: "options.general.quickSettings.reading.title" })).not.toBeInTheDocument()
  })

  it("does not render the page language recognition block anymore", () => {
    render(<GeneralPage />)

    expect(screen.queryByTestId("language-detection")).not.toBeInTheDocument()
  })
})
