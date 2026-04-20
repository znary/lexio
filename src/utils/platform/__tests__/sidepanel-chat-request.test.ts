import { describe, expect, it } from "vitest"
import {
  buildCurrentWebPageSummaryRequestPayload,
  buildSelectionExplainRequestPayload,
  buildSidepanelChatRequestHiddenContext,
  buildSidepanelChatRequestPrompt,
} from "../sidepanel-chat-request"

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
    expect(prompt).not.toContain("Server migration notes")
    expect(prompt).not.toContain("https://example.com/migration")
  })

  it("keeps webpage details out of the visible current page summary prompt", () => {
    const prompt = buildSidepanelChatRequestPrompt({
      type: "current-webpage-summary",
      pageTitle: "Example article",
      pageUrl: "https://example.com/article",
      pageContent: "A detailed article body.",
    }, "eng")

    expect(prompt).toContain("Answer in English.")
    expect(prompt).toContain("Summarize the current web page in detail.")
    expect(prompt).not.toContain("Example article")
    expect(prompt).not.toContain("https://example.com/article")
    expect(prompt).not.toContain("A detailed article body.")
  })

  it("builds a hidden page context block for prepared page-summary requests", () => {
    const hiddenContext = buildSidepanelChatRequestHiddenContext({
      type: "current-webpage-summary",
      pageTitle: "Example article",
      pageUrl: "https://example.com/article",
      pageContent: "A detailed article body.",
    })

    expect(hiddenContext).toEqual({
      requestType: "current-webpage-summary",
      pageTitle: "Example article",
      pageUrl: "https://example.com/article",
      pageContent: "A detailed article body.",
    })
  })

  it("builds a hidden page context block for prepared explain requests", () => {
    const hiddenContext = buildSidepanelChatRequestHiddenContext({
      type: "selection-explain",
      selectionText: "rsync over SSH",
      pageTitle: "Server migration notes",
      pageUrl: "https://example.com/migration",
    })

    expect(hiddenContext).toEqual({
      requestType: "selection-explain",
      pageTitle: "Server migration notes",
      pageUrl: "https://example.com/migration",
    })
  })

  it("builds current-page summary payloads from the shared sidepanel page context shape", () => {
    const payload = buildCurrentWebPageSummaryRequestPayload({
      fallbackPageTitle: "Fallback title",
      fallbackPageUrl: "https://example.com/fallback",
      webPageContext: {
        url: "https://example.com/article",
        webTitle: "Example article",
        webContent: "Short article body",
        webContextContent: "Longer article body for hidden context",
      },
    })

    expect(payload).toEqual({
      type: "current-webpage-summary",
      pageTitle: "Example article",
      pageUrl: "https://example.com/article",
      pageContent: "Longer article body for hidden context",
    })
  })

  it("builds selection-explain payloads from the same shared sidepanel page context shape", () => {
    const payload = buildSelectionExplainRequestPayload({
      selectionText: "rsync over SSH",
      fallbackPageTitle: "Fallback title",
      fallbackPageUrl: "https://example.com/fallback",
      webPageContext: {
        url: "https://example.com/article",
        webTitle: "Example article",
        webContent: "Short article body",
        webContextContent: "Longer article body for hidden context",
      },
    })

    expect(payload).toEqual({
      type: "selection-explain",
      selectionText: "rsync over SSH",
      pageTitle: "Example article",
      pageUrl: "https://example.com/article",
      pageContent: "Longer article body for hidden context",
    })
  })

  it("returns null for current-page summary payloads when no page url is available", () => {
    const payload = buildCurrentWebPageSummaryRequestPayload({
      fallbackPageTitle: "Fallback title",
      webPageContext: {
        url: "",
        webTitle: "Example article",
        webContent: "Short article body",
        webContextContent: "Longer article body for hidden context",
      },
    })

    expect(payload).toBeNull()
  })
})
