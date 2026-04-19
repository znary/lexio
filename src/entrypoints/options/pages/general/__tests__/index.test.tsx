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

vi.mock("../../../../popup/components/language-options-selector", () => ({
  default: () => <div>Language options selector</div>,
}))

vi.mock("../../../../popup/components/translation-mode-selector", () => ({
  default: () => <div>Translation mode selector</div>,
}))

vi.mock("../../../../popup/components/translate-prompt-selector", () => ({
  default: () => <div>Translate prompt selector</div>,
}))

vi.mock("../../../../popup/components/node-translation-hotkey-selector", () => ({
  default: () => <div>Hotkey selector</div>,
}))

vi.mock("../../../../popup/components/ai-smart-context", () => ({
  AISmartContext: () => <div>AI smart context</div>,
}))

vi.mock("../language-detection-config", () => ({
  default: () => <div data-testid="language-detection">Language detection config</div>,
}))

vi.mock("../site-control-mode", () => ({
  default: () => <div data-testid="site-control-mode">Site control mode</div>,
}))

vi.mock("../appearance-settings", () => ({
  default: () => <div data-testid="appearance-settings">Appearance settings</div>,
}))

describe("general page", () => {
  it("shows the moved quick settings blocks before the existing general sections", () => {
    render(<GeneralPage />)

    const lexioCloud = screen.getByRole("heading", { name: "options.general.quickSettings.cloud.title" })
    const reading = screen.getByRole("heading", { name: "options.general.quickSettings.reading.title" })
    const shortcuts = screen.getByRole("heading", { name: "options.general.quickSettings.shortcuts.title" })
    const languageDetection = screen.getByTestId("language-detection")

    expect(lexioCloud).toBeInTheDocument()
    expect(reading).toBeInTheDocument()
    expect(shortcuts).toBeInTheDocument()
    expect(screen.getByText("options.general.quickSettings.cloud.description")).toBeInTheDocument()
    expect(screen.getByText("options.general.quickSettings.reading.description")).toBeInTheDocument()
    expect(screen.getByText("options.general.quickSettings.shortcuts.description")).toBeInTheDocument()
    expect(lexioCloud.compareDocumentPosition(languageDetection) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(reading.compareDocumentPosition(languageDetection) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(shortcuts.compareDocumentPosition(languageDetection) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})
