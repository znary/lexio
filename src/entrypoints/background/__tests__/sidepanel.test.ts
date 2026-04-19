import { browser } from "#imports"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/utils/platform/sidepanel-chat-request", () => ({
  createSidepanelChatRequest: vi.fn((payload: unknown) => ({ id: "request-1", payload })),
  enqueuePendingSidepanelChatRequest: vi.fn(),
}))

describe("background sidepanel helpers", () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    const browserWithSidePanel = browser as typeof browser & {
      sidePanel?: {
        setPanelBehavior: ReturnType<typeof vi.fn>
        open: ReturnType<typeof vi.fn>
      }
    }

    browser.tabs.query = vi.fn().mockResolvedValue([
      {
        id: 1,
        windowId: 7,
      },
    ])

    browserWithSidePanel.sidePanel = {
      setPanelBehavior: vi.fn().mockResolvedValue(undefined),
      open: vi.fn().mockResolvedValue(undefined),
    } as NonNullable<typeof browserWithSidePanel.sidePanel>
  })

  it("enables open-on-action-click when sidePanel is available", async () => {
    const { setUpSidePanelBehavior } = await import("../sidepanel")
    const sidePanel = (browser as typeof browser & {
      sidePanel: {
        setPanelBehavior: ReturnType<typeof vi.fn>
      }
    }).sidePanel

    await setUpSidePanelBehavior()

    expect(sidePanel.setPanelBehavior).toHaveBeenCalledWith({
      openPanelOnActionClick: true,
    })
  })

  it("opens the side panel in the active window", async () => {
    const { openSidePanelInActiveWindow } = await import("../sidepanel")
    const sidePanel = (browser as typeof browser & {
      sidePanel: {
        open: ReturnType<typeof vi.fn>
      }
    }).sidePanel

    await openSidePanelInActiveWindow()

    expect(browser.tabs.query).toHaveBeenCalledWith({
      active: true,
      currentWindow: true,
    })
    expect(sidePanel.open).toHaveBeenCalledWith({
      windowId: 7,
    })
  })

  it("opens the side panel for a known window without querying tabs first", async () => {
    const { openSidePanelInWindow } = await import("../sidepanel")
    const sidePanel = (browser as typeof browser & {
      sidePanel: {
        open: ReturnType<typeof vi.fn>
      }
    }).sidePanel

    await openSidePanelInWindow(9)

    expect(browser.tabs.query).not.toHaveBeenCalled()
    expect(sidePanel.open).toHaveBeenCalledWith({
      windowId: 9,
    })
  })

  it("no-ops when the browser does not expose sidePanel", async () => {
    Reflect.deleteProperty(browser as typeof browser & { sidePanel?: unknown }, "sidePanel")
    const { setUpSidePanelBehavior, openSidePanelInActiveWindow } = await import("../sidepanel")

    await expect(setUpSidePanelBehavior()).resolves.toBeUndefined()
    await expect(openSidePanelInActiveWindow()).resolves.toBe(false)
  })
})
