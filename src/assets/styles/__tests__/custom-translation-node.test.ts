import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const customTranslationNodeCss = readFileSync(new URL("../custom-translation-node.css", import.meta.url), "utf8")

describe("custom-translation-node.css", () => {
  it("uses the surrounding paragraph color instead of a fixed theme accent", () => {
    expect(customTranslationNodeCss).toContain("[data-read-frog-custom-translation-style=\"textColor\"]")
    expect(customTranslationNodeCss).toContain("currentColor")
    expect(customTranslationNodeCss).not.toContain("color: var(--read-frog-primary)")
    expect(customTranslationNodeCss).not.toContain("border-left: 4px solid var(--read-frog-primary)")
    expect(customTranslationNodeCss).not.toContain("text-decoration: underline dashed var(--read-frog-primary) !important;")
    expect(customTranslationNodeCss).not.toContain("border: 1px solid var(--read-frog-primary);")
    expect(customTranslationNodeCss).not.toContain("background-color: color-mix(in srgb, var(--read-frog-primary) 15%, transparent);")
  })
})
