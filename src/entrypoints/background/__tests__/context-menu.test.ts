import type { Config } from "@/types/config/config"
import { browser, i18n, storage } from "#imports"
import { beforeEach, describe, expect, it, vi } from "vitest"

const sendMessageMock = vi.fn()
const ensureInitializedConfigMock = vi.fn()
const contextMenuClickListeners: Array<(info: any, tab?: any) => Promise<void> | void> = []
const openSidePanelInWindowMock = vi.fn()
const queueSidePanelChatRequestMock = vi.fn()

vi.mock("@/utils/message", () => ({
  sendMessage: sendMessageMock,
}))

vi.mock("../sidepanel", () => ({
  openSidePanelInWindow: (...args: unknown[]) => openSidePanelInWindowMock(...args),
  queueSidePanelChatRequest: (...args: unknown[]) => queueSidePanelChatRequestMock(...args),
}))

vi.mock("../config", () => ({
  ensureInitializedConfig: ensureInitializedConfigMock,
}))

function createConfig(enabled: boolean): Config {
  return ({
    contextMenu: {
      enabled,
    },
    selectionToolbar: {
      enabled: true,
      customActions: [],
      disabledSelectionToolbarPatterns: [],
      opacity: 100,
      features: {
        translate: { enabled: true, providerId: "microsoft-translate-default" },
        speak: { enabled: true },
        explain: { enabled: true, providerId: "microsoft-translate-default" },
      },
    },
  } as unknown) as Config
}

describe("background context menu", () => {
  beforeEach(() => {
    vi.resetModules()
    contextMenuClickListeners.length = 0
    vi.clearAllMocks()

    browser.contextMenus.create = vi.fn()
    browser.contextMenus.removeAll = vi.fn().mockResolvedValue(undefined)
    browser.contextMenus.update = vi.fn().mockResolvedValue(undefined)
    browser.contextMenus.onClicked.addListener = vi.fn((listener) => {
      contextMenuClickListeners.push(listener as (info: any, tab?: any) => Promise<void> | void)
    })

    browser.tabs.query = vi.fn().mockResolvedValue([{ id: 1, windowId: 2 }])
    browser.tabs.onActivated.addListener = vi.fn()
    browser.tabs.onUpdated.addListener = vi.fn()
    browser.storage.session.onChanged.addListener = vi.fn()

    storage.watch = vi.fn()
    storage.getItem = vi.fn().mockResolvedValue({ enabled: true })
    storage.setItem = vi.fn().mockResolvedValue(undefined)
    openSidePanelInWindowMock.mockResolvedValue(true)
    queueSidePanelChatRequestMock.mockResolvedValue(undefined)

    i18n.t = vi.fn((key: string) => ({
      "name": "Lexio",
      "contextMenu.translate": "Translate this page",
      "contextMenu.summarizeCurrentPage": "Summarize this page",
      "contextMenu.translateSelection": "Translate selected text",
      "contextMenu.explainSelection": "Explain selected text",
      "contextMenu.showOriginal": "Show Original",
    })[key] ?? key) as typeof i18n.t
  })

  it("creates one Lexio submenu and toggles child items by context later", async () => {
    ensureInitializedConfigMock.mockResolvedValue(createConfig(true))

    const {
      initializeContextMenu,
      MENU_ID_ROOT,
      MENU_ID_SELECTION_EXPLAIN,
      MENU_ID_SELECTION_TRANSLATE,
      MENU_ID_SUMMARIZE_CURRENT_PAGE,
      MENU_ID_TRANSLATE,
    } = await import("../context-menu")

    await initializeContextMenu()

    expect(browser.contextMenus.removeAll).toHaveBeenCalledOnce()
    expect(browser.contextMenus.create).toHaveBeenNthCalledWith(1, {
      id: MENU_ID_ROOT,
      title: "Lexio",
      contexts: ["page", "selection"],
    })
    expect(browser.contextMenus.create).toHaveBeenNthCalledWith(2, {
      id: MENU_ID_TRANSLATE,
      title: "Translate this page",
      contexts: ["page", "selection"],
      parentId: MENU_ID_ROOT,
      visible: true,
    })
    expect(browser.contextMenus.create).toHaveBeenNthCalledWith(3, {
      id: MENU_ID_SUMMARIZE_CURRENT_PAGE,
      title: "Summarize this page",
      contexts: ["page", "selection"],
      parentId: MENU_ID_ROOT,
      visible: true,
    })
    expect(browser.contextMenus.create).toHaveBeenNthCalledWith(4, {
      id: MENU_ID_SELECTION_TRANSLATE,
      title: "Translate selected text",
      contexts: ["page", "selection"],
      parentId: MENU_ID_ROOT,
      visible: false,
    })
    expect(browser.contextMenus.create).toHaveBeenNthCalledWith(5, {
      id: MENU_ID_SELECTION_EXPLAIN,
      title: "Explain selected text",
      contexts: ["page", "selection"],
      parentId: MENU_ID_ROOT,
      visible: false,
    })
    expect(browser.contextMenus.update).toHaveBeenCalledWith(MENU_ID_TRANSLATE, {
      title: "Show Original",
    })
  })

  it("creates custom action items inline for enabled custom actions", async () => {
    const config = createConfig(true)
    config.selectionToolbar.customActions = [
      { id: "dictionary", name: "Dictionary", enabled: true },
      { id: "disabled", name: "Disabled", enabled: false },
      { id: "rewrite", name: "Rewrite", enabled: true },
    ] as Config["selectionToolbar"]["customActions"]
    ensureInitializedConfigMock.mockResolvedValue(config)

    const {
      initializeContextMenu,
      MENU_ID_ROOT,
      MENU_ID_SELECTION_CUSTOM_ACTION_PREFIX,
    } = await import("../context-menu")

    await initializeContextMenu()

    expect(browser.contextMenus.create).toHaveBeenNthCalledWith(6, {
      id: `${MENU_ID_SELECTION_CUSTOM_ACTION_PREFIX}dictionary`,
      title: "Dictionary",
      contexts: ["page", "selection"],
      parentId: MENU_ID_ROOT,
      visible: false,
    })
    expect(browser.contextMenus.create).toHaveBeenNthCalledWith(7, {
      id: `${MENU_ID_SELECTION_CUSTOM_ACTION_PREFIX}rewrite`,
      title: "Rewrite",
      contexts: ["page", "selection"],
      parentId: MENU_ID_ROOT,
      visible: false,
    })
  })

  it("removes menu items without recreating them when the context menu is disabled", async () => {
    ensureInitializedConfigMock.mockResolvedValue(createConfig(false))

    const { initializeContextMenu } = await import("../context-menu")

    await initializeContextMenu()

    expect(browser.contextMenus.removeAll).toHaveBeenCalledOnce()
    expect(browser.contextMenus.create).not.toHaveBeenCalled()
    expect(browser.contextMenus.update).not.toHaveBeenCalled()
  })

  it("shows page actions without a selection for the active tab", async () => {
    ensureInitializedConfigMock.mockResolvedValue(createConfig(true))
    const {
      clearSelectionContextMenuState,
      initializeContextMenu,
      MENU_ID_SELECTION_EXPLAIN,
      MENU_ID_SELECTION_TRANSLATE,
      MENU_ID_SUMMARIZE_CURRENT_PAGE,
      MENU_ID_TRANSLATE,
    } = await import("../context-menu")

    await initializeContextMenu()
    await clearSelectionContextMenuState(1)

    expect(browser.contextMenus.update).toHaveBeenCalledWith(MENU_ID_TRANSLATE, expect.objectContaining({ visible: true }))
    expect(browser.contextMenus.update).toHaveBeenCalledWith(MENU_ID_SUMMARIZE_CURRENT_PAGE, { visible: true })
    expect(browser.contextMenus.update).toHaveBeenCalledWith(MENU_ID_SELECTION_TRANSLATE, { visible: false })
    expect(browser.contextMenus.update).toHaveBeenCalledWith(MENU_ID_SELECTION_EXPLAIN, { visible: false })
  })

  it("shows both page and selection actions when the active tab reports a selection", async () => {
    ensureInitializedConfigMock.mockResolvedValue(createConfig(true))
    const {
      initializeContextMenu,
      MENU_ID_SELECTION_EXPLAIN,
      MENU_ID_SELECTION_TRANSLATE,
      MENU_ID_SUMMARIZE_CURRENT_PAGE,
      MENU_ID_TRANSLATE,
      setSelectionContextMenuState,
    } = await import("../context-menu")

    await initializeContextMenu()
    await setSelectionContextMenuState(1, true)

    const getLastVisibilityUpdate = (menuId: string) => {
      const visibilityCalls = vi.mocked(browser.contextMenus.update).mock.calls.filter(
        ([calledMenuId, payload]) => calledMenuId === menuId && "visible" in (payload ?? {}),
      )
      return visibilityCalls.at(-1)?.[1]
    }

    expect(getLastVisibilityUpdate(MENU_ID_TRANSLATE)).toEqual({ visible: true })
    expect(getLastVisibilityUpdate(MENU_ID_SUMMARIZE_CURRENT_PAGE)).toEqual({ visible: true })
    expect(getLastVisibilityUpdate(MENU_ID_SELECTION_TRANSLATE)).toEqual({ visible: true })
    expect(getLastVisibilityUpdate(MENU_ID_SELECTION_EXPLAIN)).toEqual({ visible: true })
  })

  it("still creates and shows explain in the context menu when the toolbar explain toggle is off", async () => {
    const config = createConfig(true)
    config.selectionToolbar.features.explain.enabled = false
    ensureInitializedConfigMock.mockResolvedValue(config)

    const {
      initializeContextMenu,
      MENU_ID_SELECTION_EXPLAIN,
      setSelectionContextMenuState,
    } = await import("../context-menu")

    await initializeContextMenu()

    expect(browser.contextMenus.create).toHaveBeenCalledWith(expect.objectContaining({
      id: MENU_ID_SELECTION_EXPLAIN,
    }))

    await setSelectionContextMenuState(1, true)

    expect(browser.contextMenus.update).toHaveBeenCalledWith(MENU_ID_SELECTION_EXPLAIN, { visible: true })
  })

  it("routes selection menu clicks to the matching tab and frame", async () => {
    const { MENU_ID_SELECTION_TRANSLATE, registerContextMenuListeners } = await import("../context-menu")

    registerContextMenuListeners()

    const clickHandler = contextMenuClickListeners[0]
    if (!clickHandler) {
      throw new Error("Context menu click listener was not registered")
    }

    await clickHandler({
      menuItemId: MENU_ID_SELECTION_TRANSLATE,
      selectionText: "Selected text",
      frameId: 7,
    }, {
      id: 5,
    })

    expect(sendMessageMock).toHaveBeenCalledWith(
      "openSelectionTranslationFromContextMenu",
      { selectionText: "Selected text" },
      { tabId: 5, frameId: 7 },
    )
  })

  it("routes explain menu clicks to the matching tab and frame", async () => {
    const { MENU_ID_SELECTION_EXPLAIN, registerContextMenuListeners } = await import("../context-menu")

    registerContextMenuListeners()

    const clickHandler = contextMenuClickListeners[0]
    if (!clickHandler) {
      throw new Error("Context menu click listener was not registered")
    }

    await clickHandler({
      menuItemId: MENU_ID_SELECTION_EXPLAIN,
      selectionText: "Selected text",
      frameId: 7,
    }, {
      id: 5,
    })

    expect(sendMessageMock).toHaveBeenCalledWith(
      "openSelectionExplainFromContextMenu",
      { selectionText: "Selected text" },
      { tabId: 5, frameId: 7 },
    )
  })

  it("opens sidepanel summary from the context menu before fetching page context", async () => {
    sendMessageMock.mockResolvedValue({
      url: "https://example.com/article",
      webTitle: "Example article",
      webContent: "A detailed article body.",
    })

    const { MENU_ID_SUMMARIZE_CURRENT_PAGE, registerContextMenuListeners } = await import("../context-menu")

    registerContextMenuListeners()

    const clickHandler = contextMenuClickListeners[0]
    if (!clickHandler) {
      throw new Error("Context menu click listener was not registered")
    }

    await clickHandler({
      menuItemId: MENU_ID_SUMMARIZE_CURRENT_PAGE,
    }, {
      id: 5,
      windowId: 2,
      title: "Example article",
      url: "https://example.com/article",
    })

    expect(openSidePanelInWindowMock).toHaveBeenCalledWith(2)
    expect(sendMessageMock).toHaveBeenCalledWith("getCurrentWebPageContext", undefined, 5)
    expect(queueSidePanelChatRequestMock).toHaveBeenCalledWith({
      type: "current-webpage-summary",
      pageTitle: "Example article",
      pageUrl: "https://example.com/article",
      pageContent: "A detailed article body.",
    }, 2)

    const openCallOrder = openSidePanelInWindowMock.mock.invocationCallOrder[0]
    const sendCallOrder = sendMessageMock.mock.invocationCallOrder[0]
    expect(openCallOrder).toBeLessThan(sendCallOrder)
  })

  it("routes custom action menu clicks to the matching tab and frame", async () => {
    const {
      MENU_ID_SELECTION_CUSTOM_ACTION_PREFIX,
      registerContextMenuListeners,
    } = await import("../context-menu")

    registerContextMenuListeners()

    const clickHandler = contextMenuClickListeners[0]
    if (!clickHandler) {
      throw new Error("Context menu click listener was not registered")
    }

    await clickHandler({
      menuItemId: `${MENU_ID_SELECTION_CUSTOM_ACTION_PREFIX}dictionary`,
      selectionText: "Selected text",
      frameId: 7,
    }, {
      id: 5,
    })

    expect(sendMessageMock).toHaveBeenCalledWith(
      "openSelectionCustomActionFromContextMenu",
      { actionId: "dictionary", selectionText: "Selected text" },
      { tabId: 5, frameId: 7 },
    )
  })
})
