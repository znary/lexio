// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest"
import { DEFAULT_EXTENSION_ID, getExtensionIdFromLocation } from "../env"

describe("platform web env helpers", () => {
  beforeEach(() => {
    window.sessionStorage.clear()
    window.history.replaceState({}, "", "/extension-sync")
  })

  it("returns the extension id from the URL and stores it for the same tab", () => {
    window.history.replaceState({}, "", "/extension-sync?extensionId=ext-from-query")

    expect(getExtensionIdFromLocation()).toBe("ext-from-query")
    expect(window.sessionStorage.getItem("lexio.platform.extensionId")).toBe("ext-from-query")
  })

  it("falls back to the stored extension id when the redirect loses the query string", () => {
    window.sessionStorage.setItem("lexio.platform.extensionId", "ext-from-session")

    expect(getExtensionIdFromLocation()).toBe("ext-from-session")
  })

  it("falls back to the default extension id when nothing else is available", () => {
    expect(getExtensionIdFromLocation()).toBe(DEFAULT_EXTENSION_ID)
  })
})
