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
      runtime: typeof browser.runtime & {
        getContexts?: ReturnType<typeof vi.fn>
      }
      sidePanel?: {
        setPanelBehavior: ReturnType<typeof vi.fn>
        open: ReturnType<typeof vi.fn>
        close: ReturnType<typeof vi.fn>
        onOpened: {
          addListener: ReturnType<typeof vi.fn>
        }
        onClosed: {
          addListener: ReturnType<typeof vi.fn>
        }
      }
    }

    browser.tabs.query = vi.fn().mockResolvedValue([
      {
        id: 1,
        windowId: 7,
      },
    ])

    browserWithSidePanel.runtime.getContexts = vi.fn().mockResolvedValue([])
    browserWithSidePanel.sidePanel = {
      setPanelBehavior: vi.fn().mockResolvedValue(undefined),
      open: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
      onOpened: {
        addListener: vi.fn(),
      },
      onClosed: {
        addListener: vi.fn(),
      },
    } as NonNullable<typeof browserWithSidePanel.sidePanel>
  })

  it("enables open-on-action-click when sidePanel is available", async () => {
    const { setUpSidePanelBehavior } = await import("../sidepanel")
    const sidePanel = (browser as typeof browser & {
      sidePanel: {
        setPanelBehavior: ReturnType<typeof vi.fn>
        onOpened: {
          addListener: ReturnType<typeof vi.fn>
        }
        onClosed: {
          addListener: ReturnType<typeof vi.fn>
        }
      }
    }).sidePanel

    await setUpSidePanelBehavior()

    expect(sidePanel.setPanelBehavior).toHaveBeenCalledWith({
      openPanelOnActionClick: true,
    })
    expect(sidePanel.onOpened.addListener).toHaveBeenCalledTimes(1)
    expect(sidePanel.onClosed.addListener).toHaveBeenCalledTimes(1)
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

  it("toggles the side panel open immediately even if side panel seeding is still pending", async () => {
    const seedingPromise = new Promise<never>(() => {})
    const browserWithSidePanel = browser as typeof browser & {
      runtime: typeof browser.runtime & {
        getContexts: ReturnType<typeof vi.fn>
      }
      sidePanel: {
        open: ReturnType<typeof vi.fn>
        close: ReturnType<typeof vi.fn>
      }
    }
    browserWithSidePanel.runtime.getContexts.mockReturnValue(seedingPromise)
    const { setUpSidePanelBehavior, toggleSidePanelInWindow } = await import("../sidepanel")

    await setUpSidePanelBehavior()

    await expect(toggleSidePanelInWindow(9)).resolves.toBe(true)

    expect(browserWithSidePanel.runtime.getContexts).toHaveBeenCalledWith({
      contextTypes: ["SIDE_PANEL"],
    })
    expect(browserWithSidePanel.sidePanel.open).toHaveBeenCalledWith({
      windowId: 9,
    })
    expect(browserWithSidePanel.sidePanel.close).not.toHaveBeenCalled()
  })

  it("toggles the side panel closed when the window is marked open by the side panel event", async () => {
    const browserWithSidePanel = browser as typeof browser & {
      sidePanel: {
        open: ReturnType<typeof vi.fn>
        close: ReturnType<typeof vi.fn>
        onOpened: {
          addListener: ReturnType<typeof vi.fn>
        }
      }
    }
    const { setUpSidePanelBehavior, toggleSidePanelInWindow } = await import("../sidepanel")

    await setUpSidePanelBehavior()
    const handleOpened = browserWithSidePanel.sidePanel.onOpened.addListener.mock.calls[0]?.[0] as ((info: { windowId: number }) => void) | undefined
    handleOpened?.({ windowId: 9 })

    await expect(toggleSidePanelInWindow(9)).resolves.toBe(false)

    expect(browserWithSidePanel.sidePanel.close).toHaveBeenCalledWith({
      windowId: 9,
    })
    expect(browserWithSidePanel.sidePanel.open).not.toHaveBeenCalled()
  })

  it("no-ops when the browser does not expose sidePanel", async () => {
    Reflect.deleteProperty(browser as typeof browser & { sidePanel?: unknown }, "sidePanel")
    const { setUpSidePanelBehavior, openSidePanelInActiveWindow, toggleSidePanelInActiveWindow } = await import("../sidepanel")

    await expect(setUpSidePanelBehavior()).resolves.toBeUndefined()
    await expect(openSidePanelInActiveWindow()).resolves.toBe(false)
    await expect(toggleSidePanelInActiveWindow()).resolves.toBe(false)
  })
})
