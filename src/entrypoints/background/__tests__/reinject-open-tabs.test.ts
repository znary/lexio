import { beforeEach, describe, expect, it, vi } from "vitest"
import { SITE_CONTROL_URL_WINDOW_KEY } from "@/utils/site-control"

const tabsQueryMock = vi.fn()
const getAllFramesMock = vi.fn()
const executeScriptMock = vi.fn()
const loggerWarnMock = vi.fn()

const browserMock = {
  tabs: {
    query: tabsQueryMock,
  },
  webNavigation: {
    getAllFrames: getAllFramesMock,
  },
  scripting: {
    executeScript: executeScriptMock,
  },
}

vi.mock("#imports", () => ({
  browser: browserMock,
}))

vi.mock("wxt/browser", () => ({
  browser: browserMock,
}))

vi.mock("@/utils/logger", () => ({
  logger: {
    warn: loggerWarnMock,
  },
}))

describe("reinjectOpenTabsContentScripts", () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()

    tabsQueryMock.mockResolvedValue([])
    getAllFramesMock.mockResolvedValue([])
    executeScriptMock.mockResolvedValue(undefined)
  })

  it("reinjects host and selection content scripts into open frames", async () => {
    tabsQueryMock.mockResolvedValue([
      { id: 7, url: "https://example.com/article" },
    ])
    getAllFramesMock.mockResolvedValue([
      { frameId: 0, parentFrameId: -1, url: "https://example.com/article" },
      { frameId: 2, parentFrameId: 0, url: "about:blank" },
    ])

    const { reinjectOpenTabsContentScripts } = await import("../reinject-open-tabs")
    await reinjectOpenTabsContentScripts()

    expect(tabsQueryMock).toHaveBeenCalledWith({
      url: ["http://*/*", "https://*/*", "file:///*"],
    })
    expect(executeScriptMock).toHaveBeenCalledTimes(6)
    expect(executeScriptMock).toHaveBeenNthCalledWith(1, {
      target: { tabId: 7, frameIds: [0] },
      func: expect.any(Function),
      args: [SITE_CONTROL_URL_WINDOW_KEY, "https://example.com/article"],
    })
    expect(executeScriptMock).toHaveBeenNthCalledWith(2, {
      target: { tabId: 7, frameIds: [0] },
      files: ["/content-scripts/host.js"],
    })
    expect(executeScriptMock).toHaveBeenNthCalledWith(3, {
      target: { tabId: 7, frameIds: [0] },
      files: ["/content-scripts/selection.js"],
    })
    expect(executeScriptMock).toHaveBeenNthCalledWith(4, {
      target: { tabId: 7, frameIds: [2] },
      func: expect.any(Function),
      args: [SITE_CONTROL_URL_WINDOW_KEY, "https://example.com/article"],
    })
    expect(executeScriptMock).toHaveBeenNthCalledWith(5, {
      target: { tabId: 7, frameIds: [2] },
      files: ["/content-scripts/host.js"],
    })
    expect(executeScriptMock).toHaveBeenNthCalledWith(6, {
      target: { tabId: 7, frameIds: [2] },
      files: ["/content-scripts/selection.js"],
    })
  })

  it("falls back to tab-level injection when frame details are unavailable", async () => {
    tabsQueryMock.mockResolvedValue([
      { id: 9, url: "https://example.com/fallback" },
    ])
    getAllFramesMock.mockResolvedValue([])

    const { reinjectOpenTabsContentScripts } = await import("../reinject-open-tabs")
    await reinjectOpenTabsContentScripts()

    expect(executeScriptMock).toHaveBeenCalledTimes(3)
    expect(executeScriptMock).toHaveBeenNthCalledWith(1, {
      target: { tabId: 9 },
      func: expect.any(Function),
      args: [SITE_CONTROL_URL_WINDOW_KEY, "https://example.com/fallback"],
    })
    expect(executeScriptMock).toHaveBeenNthCalledWith(2, {
      target: { tabId: 9 },
      files: ["/content-scripts/host.js"],
    })
    expect(executeScriptMock).toHaveBeenNthCalledWith(3, {
      target: { tabId: 9 },
      files: ["/content-scripts/selection.js"],
    })
  })

  it("logs and continues when one tab fails to reinject", async () => {
    tabsQueryMock.mockResolvedValue([
      { id: 1, url: "https://broken.example.com" },
      { id: 2, url: "https://ok.example.com" },
    ])
    getAllFramesMock
      .mockRejectedValueOnce(new Error("frame lookup failed"))
      .mockResolvedValueOnce([
        { frameId: 0, parentFrameId: -1, url: "https://ok.example.com" },
      ])

    const { reinjectOpenTabsContentScripts } = await import("../reinject-open-tabs")
    await reinjectOpenTabsContentScripts()

    expect(loggerWarnMock).toHaveBeenCalledWith(
      "[Background] Failed to reinject content scripts into open tab",
      expect.objectContaining({
        tabId: 1,
        tabUrl: "https://broken.example.com",
      }),
    )
    expect(executeScriptMock).toHaveBeenCalledTimes(3)
    expect(executeScriptMock).toHaveBeenLastCalledWith({
      target: { tabId: 2, frameIds: [0] },
      files: ["/content-scripts/selection.js"],
    })
  })
})
