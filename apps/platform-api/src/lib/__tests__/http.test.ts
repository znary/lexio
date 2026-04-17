import { describe, expect, it } from "vitest"
import { noContent, withCors } from "../http"

describe("http cors headers", () => {
  it("allows update and delete requests in preflight responses", () => {
    expect(withCors().get("Access-Control-Allow-Methods")).toBe("GET, POST, PUT, DELETE, OPTIONS")
    expect(noContent().headers.get("Access-Control-Allow-Methods")).toBe("GET, POST, PUT, DELETE, OPTIONS")
  })
})
