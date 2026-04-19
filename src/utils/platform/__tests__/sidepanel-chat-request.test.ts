import { describe, expect, it } from "vitest"
import { buildSidepanelChatRequestPrompt } from "../sidepanel-chat-request"

describe("sidepanelChatRequest", () => {
  it("builds a selection explain prompt with the requested output language", () => {
    const prompt = buildSidepanelChatRequestPrompt({
      type: "selection-explain",
      selectionText: "rsync over SSH",
      pageTitle: "Server migration notes",
      pageUrl: "https://example.com/migration",
    }, "cmn")

    expect(prompt).toContain("Answer in Simplified Mandarin Chinese.")
    expect(prompt).toContain("Explain the selected text below.")
    expect(prompt).toContain("> rsync over SSH")
    expect(prompt).toContain("> Title: Server migration notes")
    expect(prompt).toContain("> URL: https://example.com/migration")
  })

  it("builds a current webpage summary prompt with the page reference", () => {
    const prompt = buildSidepanelChatRequestPrompt({
      type: "current-webpage-summary",
      pageTitle: "Example article",
      pageUrl: "https://example.com/article",
      pageContent: "A detailed article body.",
    }, "eng")

    expect(prompt).toContain("Answer in English.")
    expect(prompt).toContain("Summarize the main content of this web page.")
    expect(prompt).toContain("> Title: Example article")
    expect(prompt).toContain("> URL: https://example.com/article")
    expect(prompt).toContain("Page excerpt:")
    expect(prompt).toContain("> A detailed article body.")
  })
})
