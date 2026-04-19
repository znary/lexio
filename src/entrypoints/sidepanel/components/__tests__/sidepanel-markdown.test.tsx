// @vitest-environment jsdom
import type { ComponentPropsWithoutRef, ReactElement } from "react"
import { render } from "@testing-library/react"
import ReactMarkdown from "react-markdown"
import { describe, expect, it, vi } from "vitest"
import { ThemeContext } from "@/components/providers/theme-provider"
import {
  normalizeSupportedMathSyntax,
  SIDEPANEL_REHYPE_PLUGINS,
  SIDEPANEL_REMARK_PLUGINS,
  SidepanelCodeSyntaxHighlighter,
} from "../sidepanel-markdown"

function TestPre(props: ComponentPropsWithoutRef<"pre">) {
  return <pre {...props} />
}

function TestCode(props: ComponentPropsWithoutRef<"code">) {
  return <code {...props} />
}

function renderWithLightTheme(ui: ReactElement) {
  return render(
    <ThemeContext
      value={{
        theme: "light",
        themeMode: "light",
        setThemeMode: vi.fn(),
      }}
    >
      {ui}
    </ThemeContext>,
  )
}

describe("sidepanel markdown", () => {
  it("renders highlighted token spans for fenced code blocks", () => {
    const { container } = renderWithLightTheme(
      <SidepanelCodeSyntaxHighlighter
        components={{
          Pre: TestPre,
          Code: TestCode,
        }}
        language="ts"
        code="const answer = 42"
      />,
    )

    const preElement = container.querySelector("pre")

    expect(preElement?.style.padding).toBe("0.75rem 1rem 1rem")
    expect(preElement?.style.borderRadius).toBe("0 0 1.25rem 1.25rem")
    expect(container.querySelector("pre code")?.textContent).toContain("const answer = 42")
    expect(container.querySelectorAll("code span").length).toBeGreaterThan(0)
  })

  it("renders soft line breaks and display formulas through the shared markdown plugins", () => {
    const { container } = render(
      <ReactMarkdown
        remarkPlugins={SIDEPANEL_REMARK_PLUGINS}
        rehypePlugins={SIDEPANEL_REHYPE_PLUGINS}
      >
        {"第一行\n第二行\n\n$$\nx^2\n$$"}
      </ReactMarkdown>,
    )

    expect(container.querySelector("br")).not.toBeNull()
    expect(container.querySelector(".katex-display")).not.toBeNull()
  })

  it("normalizes latex delimiter formulas before markdown parsing", () => {
    const { container } = render(
      <ReactMarkdown
        remarkPlugins={SIDEPANEL_REMARK_PLUGINS}
        rehypePlugins={SIDEPANEL_REHYPE_PLUGINS}
      >
        {normalizeSupportedMathSyntax("行内：\\(x^2 + y^2\\)\n\n块级：\n\\[\nx^2 + y^2\n\\]")}
      </ReactMarkdown>,
    )

    expect(container.querySelector(".katex")).not.toBeNull()
    expect(container.querySelector(".katex-display")).not.toBeNull()
  })
})
