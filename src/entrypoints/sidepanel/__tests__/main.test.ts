import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const testDir = dirname(fileURLToPath(import.meta.url))
const mainEntryPath = resolve(testDir, "../main.tsx")
const sidepanelStylesPath = resolve(testDir, "../styles.css")
const chatWorkspacePath = resolve(testDir, "../components/chat-workspace.tsx")

describe("sidepanel main entry", () => {
  it("loads assistant-ui markdown styles for markdown message parts", () => {
    const source = readFileSync(mainEntryPath, "utf8")

    expect(source).toContain("@assistant-ui/react-ui/styles/index.css")
    expect(source).toContain("@assistant-ui/react-ui/styles/markdown.css")
  })

  it("adds top padding inside markdown code blocks", () => {
    const source = readFileSync(sidepanelStylesPath, "utf8")

    expect(source).toContain("padding: 0.75rem 1rem 1rem;")
  })

  it("enables math plugins and katex styles for markdown formulas", () => {
    const mainSource = readFileSync(mainEntryPath, "utf8")
    const chatWorkspaceSource = readFileSync(chatWorkspacePath, "utf8")

    expect(mainSource).toContain("katex/dist/katex.min.css")
    expect(chatWorkspaceSource).toContain("remarkMath")
    expect(chatWorkspaceSource).toContain("rehypeKatex")
  })
})
