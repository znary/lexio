// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest"

const onMessageMock = vi.fn()

vi.mock("#imports", () => ({
  i18n: {
    t: (key: string) => {
      if (key === "translation.loadingStatus.queued") {
        return "Queued for translation"
      }
      if (key === "translation.loadingStatus.translating") {
        return "Translating"
      }
      return key
    },
  },
}))

vi.mock("@/utils/message", () => ({
  onMessage: onMessageMock,
}))

describe("managedTranslationStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    document.body.innerHTML = ""
  })

  it("updates spinner hover text when the managed task state changes", async () => {
    const spinner = document.createElement("span")
    document.body.appendChild(spinner)

    const { bindSpinnerToManagedTranslationStatus } = await import("../managed-translation-status")
    const cleanup = bindSpinnerToManagedTranslationStatus(spinner, "hash-1")

    const handler = onMessageMock.mock.calls[0]?.[1] as ((message: { data: { statusKey: string, state: string } }) => void)
    expect(spinner.title).toBe("Queued for translation")

    handler({
      data: {
        statusKey: "hash-1",
        state: "running",
      },
    })

    expect(spinner.title).toBe("Translating")
    expect(spinner.getAttribute("aria-label")).toBe("Translating")

    cleanup()
  })
})
