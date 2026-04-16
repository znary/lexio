import { describe, expect, it } from "vitest"
import { buildEntitlements } from "../env"

describe("buildEntitlements", () => {
  it("uses the updated free and pro concurrency limits", () => {
    expect(buildEntitlements("free")).toMatchObject({
      concurrentRequestLimit: 10,
    })

    expect(buildEntitlements("pro")).toMatchObject({
      concurrentRequestLimit: 20,
    })
  })
})
