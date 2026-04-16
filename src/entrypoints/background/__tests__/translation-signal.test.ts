import { browser, storage } from "#imports"
import { beforeEach, describe, expect, it, vi } from "vitest"

const sendMessageMock = vi.fn()
const onMessageMock = vi.fn()
const shouldEnableAutoTranslationMock = vi.fn()
const loggerErrorMock = vi.fn()
const loggerInfoMock = vi.fn()

vi.mock("@/utils/message", () => ({
  onMessage: onMessageMock,
  sendMessage: sendMessageMock,
}))

vi.mock("@/utils/host/translate/auto-translation", () => ({
  shouldEnableAutoTranslation: shouldEnableAutoTranslationMock,
}))

vi.mock("@/utils/logger", () => ({
  logger: {
    error: loggerErrorMock,
    info: loggerInfoMock,
  },
}))

describe("translationMessage", () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()

    browser.tabs.onRemoved.addListener = vi.fn()
    browser.webNavigation.onCommitted.addListener = vi.fn()

    storage.getItem = vi.fn().mockResolvedValue(undefined)
    storage.setItem = vi.fn().mockResolvedValue(undefined)
    storage.removeItem = vi.fn().mockResolvedValue(undefined)

    onMessageMock.mockReturnValue(() => {})
    shouldEnableAutoTranslationMock.mockResolvedValue(false)
  })

  it("broadcasts a disabled translation state after clearing it on main-frame navigation", async () => {
    const { translationMessage } = await import("../translation-signal")

    translationMessage()

    const onCommitted = vi.mocked(browser.webNavigation.onCommitted.addListener).mock.calls.at(-1)?.[0] as
      | ((details: { frameId: number, tabId: number }) => Promise<void>)
      | undefined

    if (!onCommitted) {
      throw new Error("Expected webNavigation.onCommitted listener to be registered")
    }

    await onCommitted({
      frameId: 0,
      tabId: 12,
    })

    expect(storage.removeItem).toHaveBeenCalledWith("session:translationState.12")
    expect(sendMessageMock).toHaveBeenCalledWith(
      "notifyTranslationStateChanged",
      { enabled: false },
      12,
    )
  })
})
