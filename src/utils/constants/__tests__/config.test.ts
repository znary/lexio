import { afterEach, describe, expect, it, vi } from "vitest"

describe("dEFAULT_CONFIG", () => {
  const originalCrypto = globalThis.crypto

  afterEach(() => {
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: originalCrypto,
    })
    vi.resetModules()
  })

  it("initializes when crypto.randomUUID is unavailable but crypto.getRandomValues exists", async () => {
    const getRandomValues = vi.fn((array: Uint8Array<ArrayBuffer>) => originalCrypto.getRandomValues(array))

    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: {
        getRandomValues,
      } as unknown as Crypto,
    })
    vi.resetModules()

    const { DEFAULT_CONFIG } = await import("../config")
    expect(DEFAULT_CONFIG.selectionToolbar.customActions).toEqual([])
    expect(getRandomValues).not.toHaveBeenCalled()
  })

  it("uses the panel as the default floating button click action", async () => {
    const { DEFAULT_CONFIG } = await import("../config")

    expect(DEFAULT_CONFIG.floatingButton.clickAction).toBe("panel")
  })
})
