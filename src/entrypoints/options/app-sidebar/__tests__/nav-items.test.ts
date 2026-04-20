import { describe, expect, it } from "vitest"
import { ROUTE_DEFS } from "../nav-items"

describe("route defs", () => {
  it("does not expose the custom actions settings route", () => {
    expect(ROUTE_DEFS.map(route => route.path)).not.toContain("/custom-actions")
  })

  it("does not expose the config settings route", () => {
    expect(ROUTE_DEFS.map(route => route.path)).not.toContain("/config")
  })

  it("does not expose the vocabulary settings route", () => {
    expect(ROUTE_DEFS.map(route => route.path)).not.toContain("/vocabulary")
  })
})
