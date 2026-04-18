import { describe, expect, it } from "vitest"
import { buildEntitlements, UNLIMITED_ENTITLEMENT_VALUE } from "../env"

describe("buildEntitlements", () => {
  it("returns the same unlimited entitlements for every plan", () => {
    expect(buildEntitlements("free")).toMatchObject({
      monthlyRequestLimit: UNLIMITED_ENTITLEMENT_VALUE,
      monthlyTokenLimit: UNLIMITED_ENTITLEMENT_VALUE,
      concurrentRequestLimit: UNLIMITED_ENTITLEMENT_VALUE,
    })

    expect(buildEntitlements("pro")).toMatchObject({
      monthlyRequestLimit: UNLIMITED_ENTITLEMENT_VALUE,
      monthlyTokenLimit: UNLIMITED_ENTITLEMENT_VALUE,
      concurrentRequestLimit: UNLIMITED_ENTITLEMENT_VALUE,
    })
  })
})
