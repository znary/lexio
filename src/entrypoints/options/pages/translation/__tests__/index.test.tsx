// @vitest-environment jsdom
import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { TranslationPage } from "../index"

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

vi.mock("../translation-quick-controls", () => ({
  TranslationQuickControls: () => <div data-testid="translation-quick-controls">Quick controls</div>,
}))

vi.mock("../translation-mode", () => ({
  TranslationMode: () => <div data-testid="translation-mode">Translation mode</div>,
}))

vi.mock("../translate-range", () => ({
  TranslateRange: () => null,
}))

vi.mock("../page-translation-shortcut", () => ({
  PageTranslationShortcut: () => null,
}))

vi.mock("../node-translation-hotkey", () => ({
  NodeTranslationHotkey: () => null,
}))

vi.mock("../custom-translation-style", () => ({
  CustomTranslationStyle: () => null,
}))

vi.mock("../ai-content-aware", () => ({
  AIContentAware: () => null,
}))

vi.mock("../personalized-prompt", () => ({
  PersonalizedPrompts: () => null,
}))

vi.mock("../auto-translate-website-patterns", () => ({
  AutoTranslateWebsitePatterns: () => null,
}))

vi.mock("../auto-translate-languages", () => ({
  AutoTranslateLanguages: () => null,
}))

vi.mock("../skip-languages", () => ({
  SkipLanguages: () => null,
}))

vi.mock("../request-batch", () => ({
  RequestBatch: () => null,
}))

vi.mock("../preload-config", () => ({
  PreloadConfig: () => null,
}))

vi.mock("../small-paragraph-filter", () => ({
  SmallParagraphFilter: () => null,
}))

vi.mock("../clear-cache-config", () => ({
  ClearCacheConfig: () => null,
}))

vi.mock("../language-detection-config", () => ({
  default: () => <div data-testid="page-language-detection">Language detection config</div>,
}))

describe("translation page", () => {
  it("puts quick translation controls before the rest of the translation settings", () => {
    render(<TranslationPage />)

    const quickControls = screen.getByTestId("translation-quick-controls")
    const languageDetection = screen.getByTestId("page-language-detection")
    const translationMode = screen.getByTestId("translation-mode")

    expect(screen.getByRole("heading", { name: "options.translation.title" })).toBeInTheDocument()
    expect(quickControls).toBeInTheDocument()
    expect(languageDetection).toBeInTheDocument()
    expect(translationMode).toBeInTheDocument()
    expect(quickControls.compareDocumentPosition(languageDetection) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(languageDetection.compareDocumentPosition(translationMode) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})
