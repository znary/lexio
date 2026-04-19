import type { ComponentPropsWithoutRef, ComponentType } from "react"
import { makeMarkdownText } from "@assistant-ui/react-ui"
import { Prism as ReactSyntaxHighlighter } from "react-syntax-highlighter"
import { oneDark, oneLight } from "react-syntax-highlighter/dist/esm/styles/prism"
import rehypeKatex from "rehype-katex"
import remarkBreaks from "remark-breaks"
import remarkGfm from "remark-gfm"
import remarkMath from "remark-math"
import { useTheme } from "@/components/providers/theme-provider"

const LANGUAGE_ALIASES: Record<string, string> = {
  js: "javascript",
  md: "markdown",
  sh: "bash",
  ts: "typescript",
  yml: "yaml",
}

const SUPPORTED_LANGUAGES = new Set(
  ((ReactSyntaxHighlighter as typeof ReactSyntaxHighlighter & {
    supportedLanguages?: string[]
  }).supportedLanguages ?? []),
)

type SidepanelPreComponent = ComponentType<ComponentPropsWithoutRef<"pre">>
type SidepanelCodeComponent = ComponentType<ComponentPropsWithoutRef<"code">>

interface SidepanelSyntaxHighlighterProps {
  components: {
    Pre: SidepanelPreComponent
    Code: SidepanelCodeComponent
  }
  language: string
  code: string
}

const PROTECTED_MARKDOWN_SEGMENT_PATTERN = /```[\s\S]*?```|`[^`\n]+`/g
const DISPLAY_MATH_DELIMITER_PATTERN = /\\\[((?:.|\n)*?)\\\]/g
const INLINE_MATH_DELIMITER_PATTERN = /\\\((.+?)\\\)/g

function resolveCodeLanguage(language: string): string {
  const normalizedLanguage = LANGUAGE_ALIASES[language] ?? language
  return SUPPORTED_LANGUAGES.has(normalizedLanguage) ? normalizedLanguage : "text"
}

function normalizeMathDelimitersInSegment(segment: string): string {
  return segment
    .replace(DISPLAY_MATH_DELIMITER_PATTERN, (_match, expression: string) => `$$\n${expression.trim()}\n$$`)
    .replace(INLINE_MATH_DELIMITER_PATTERN, (_match, expression: string) => `$${expression}$`)
}

export function normalizeSupportedMathSyntax(markdown: string): string {
  let normalizedMarkdown = ""
  let currentIndex = 0

  for (const match of markdown.matchAll(PROTECTED_MARKDOWN_SEGMENT_PATTERN)) {
    const protectedSegment = match[0]
    const protectedSegmentStart = match.index ?? 0

    normalizedMarkdown += normalizeMathDelimitersInSegment(markdown.slice(currentIndex, protectedSegmentStart))
    normalizedMarkdown += protectedSegment
    currentIndex = protectedSegmentStart + protectedSegment.length
  }

  normalizedMarkdown += normalizeMathDelimitersInSegment(markdown.slice(currentIndex))

  return normalizedMarkdown
}

export function SidepanelCodeSyntaxHighlighter({
  components: { Pre, Code },
  language,
  code,
}: SidepanelSyntaxHighlighterProps) {
  const { theme } = useTheme()

  return (
    <ReactSyntaxHighlighter
      language={resolveCodeLanguage(language)}
      style={theme === "dark" ? oneDark : oneLight}
      PreTag={Pre}
      CodeTag={Code}
      customStyle={{
        background: "transparent",
        borderRadius: "0 0 1.25rem 1.25rem",
        margin: "0 0 0.9rem",
        padding: "0.75rem 1rem 1rem",
      }}
      codeTagProps={{
        style: {
          background: "transparent",
          fontFamily: "inherit",
          lineHeight: "inherit",
        },
      }}
      wrapLongLines
    >
      {code}
    </ReactSyntaxHighlighter>
  )
}

export const SIDEPANEL_REMARK_PLUGINS = [
  remarkGfm,
  remarkBreaks,
  remarkMath,
]

export const SIDEPANEL_REHYPE_PLUGINS = [
  rehypeKatex,
]

export const SIDEPANEL_MARKDOWN_TEXT = makeMarkdownText({
  remarkPlugins: SIDEPANEL_REMARK_PLUGINS,
  rehypePlugins: SIDEPANEL_REHYPE_PLUGINS,
  preprocess: normalizeSupportedMathSyntax,
  components: {
    SyntaxHighlighter: SidepanelCodeSyntaxHighlighter,
  },
})
