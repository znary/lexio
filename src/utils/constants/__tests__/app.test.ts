import { kebabCase } from "case-anything"
import { describe, expect, it, vi } from "vitest"

import { APP_NAME, APP_SIDE_CONTENT_HOST_NAME } from "../app"

vi.mock("#imports", () => ({
  browser: {
    runtime: {
      getManifest: () => ({ version: "test-version" }),
    },
  },
}))

describe("aPP_SIDE_CONTENT_HOST_NAME", () => {
  it("keeps the side-content host name hyphenated", () => {
    expect(APP_SIDE_CONTENT_HOST_NAME).toBe(`${kebabCase(APP_NAME)}-side`)
    expect(APP_SIDE_CONTENT_HOST_NAME).toContain("-")
  })
})
