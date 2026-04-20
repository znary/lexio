import { describe, expect, it } from "vitest"
import { SEARCH_ITEMS } from "../search-items"

describe("search items", () => {
  it("does not include removed settings sections", () => {
    const sectionIds = SEARCH_ITEMS.map(item => item.sectionId)
    const routes = SEARCH_ITEMS.map(item => item.route)

    expect(sectionIds).not.toContain("request-rate")
    expect(sectionIds).not.toContain("subtitles-request-rate")
    expect(sectionIds).not.toContain("personalized-prompts")
    expect(routes).not.toContain("/config")
  })

  it("points the page language recognition entry to the translation page", () => {
    const languageDetection = SEARCH_ITEMS.find(item => item.sectionId === "page-language-detection")

    expect(languageDetection).toMatchObject({
      route: "/translation",
      pageKey: "options.translation.title",
    })
  })
})
