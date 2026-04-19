import { describe, expect, it } from "vitest"
import { SEARCH_ITEMS } from "../search-items"

describe("search items", () => {
  it("does not include removed settings sections", () => {
    const sectionIds = SEARCH_ITEMS.map(item => item.sectionId)
    const routes = SEARCH_ITEMS.map(item => item.route)

    expect(sectionIds).not.toContain("request-rate")
    expect(sectionIds).not.toContain("subtitles-request-rate")
    expect(routes).not.toContain("/config")
  })
})
