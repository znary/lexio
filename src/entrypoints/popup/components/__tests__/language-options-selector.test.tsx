// @vitest-environment jsdom
import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import LanguageOptionsSelector from "../language-options-selector"

const setLanguageMock = vi.fn()

vi.mock("#imports", () => ({
  i18n: {
    t: (key: string) => key,
  },
}))

vi.mock("@read-frog/definitions", () => ({
  LANG_CODE_TO_EN_NAME: {
    eng: "English",
    zho: "Chinese",
  },
  LANG_CODE_TO_LOCALE_NAME: {
    eng: "English",
    zho: "中文",
  },
  langCodeISO6393Schema: {
    options: ["eng", "zho"],
  },
}))

vi.mock("jotai", () => ({
  useAtom: () => [
    {
      sourceCode: "auto",
      targetCode: "zho",
    },
    setLanguageMock,
  ],
  useAtomValue: () => "eng",
}))

vi.mock("@/utils/atoms/config", () => ({
  configFieldsAtomMap: {
    language: Symbol("language"),
  },
}))

vi.mock("@/utils/atoms/detected-code", () => ({
  detectedCodeAtom: Symbol("detectedCode"),
}))

vi.mock("@/components/ui/base-ui/select", () => ({
  Select: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectGroup: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectItem: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectTrigger: ({
    children,
    className,
  }: {
    children: React.ReactNode
    className?: string
  }) => (
    <button type="button" data-testid="language-trigger" className={className}>
      {children}
    </button>
  ),
  SelectValue: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}))

describe("language options selector", () => {
  it("uses full-width triggers so long language names are not clipped", () => {
    render(<LanguageOptionsSelector />)

    const triggers = screen.getAllByTestId("language-trigger")

    expect(triggers).toHaveLength(2)
    for (const trigger of triggers) {
      expect(trigger.className).toContain("w-full")
      expect(trigger.className).not.toContain("w-30")
    }
  })

  it("shows only locale names and keeps auto as a separate marker", () => {
    const { container } = render(<LanguageOptionsSelector />)

    expect(container).toHaveTextContent("English")
    expect(container).toHaveTextContent("中文")
    expect(container).toHaveTextContent("auto")
    expect(container).not.toHaveTextContent("Chinese")
    expect(container).not.toHaveTextContent("English (English)")
    expect(container).not.toHaveTextContent("(auto)")
  })
})
