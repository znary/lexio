import type { Browser } from "#imports"
import type { Config } from "@/types/config/config"
import { browser, i18n, storage } from "#imports"
import { ANALYTICS_FEATURE, ANALYTICS_SURFACE } from "@/types/analytics"
import { createFeatureUsageContext } from "@/utils/analytics"
import { CONFIG_STORAGE_KEY } from "@/utils/constants/config"
import { isSelectionToolbarInternalAction } from "@/utils/constants/custom-action"
import { getTranslationStateKey, TRANSLATION_STATE_KEY_PREFIX } from "@/utils/constants/storage-keys"
import { sendMessage } from "@/utils/message"
import { buildCurrentWebPageSummaryRequestPayload } from "@/utils/platform/sidepanel-chat-request"
import { ensureInitializedConfig } from "./config"
import { openSidePanelInWindow, queueSidePanelChatRequest } from "./sidepanel"
import { fireAndForgetTabMessage, requestTabMessageOrNull } from "./tab-message"

export const MENU_ID_ROOT = "read-frog-root"
export const MENU_ID_TRANSLATE = "read-frog-translate"
export const MENU_ID_SUMMARIZE_CURRENT_PAGE = "read-frog-summarize-current-page"
export const MENU_ID_SELECTION_TRANSLATE = "read-frog-selection-translate"
export const MENU_ID_SELECTION_EXPLAIN = "read-frog-selection-explain"
export const MENU_ID_SELECTION_CUSTOM_ACTION_PREFIX = "read-frog-selection-custom-action:"
const PAGE_AND_SELECTION_CONTEXTS: ["page", "selection"] = ["page", "selection"]
const selectionContextMenuStateByTabId = new Map<number, boolean>()

function getSelectionCustomActionMenuId(actionId: string) {
  return `${MENU_ID_SELECTION_CUSTOM_ACTION_PREFIX}${actionId}`
}

function getEnabledCustomActions(config: Config) {
  return config.selectionToolbar.customActions
    .filter(action => action.enabled !== false && !isSelectionToolbarInternalAction(action))
}

function getContextMenuSelectionState(tabId: number) {
  return selectionContextMenuStateByTabId.get(tabId) ?? false
}

async function updateSelectionSubmenuVisibility(config: Config, hasSelection: boolean) {
  const enabledCustomActions = getEnabledCustomActions(config)

  await browser.contextMenus.update(MENU_ID_TRANSLATE, {
    visible: true,
  })
  await browser.contextMenus.update(MENU_ID_SUMMARIZE_CURRENT_PAGE, {
    visible: true,
  })
  await browser.contextMenus.update(MENU_ID_SELECTION_TRANSLATE, {
    visible: hasSelection,
  })

  await browser.contextMenus.update(MENU_ID_SELECTION_EXPLAIN, {
    visible: hasSelection,
  })

  await Promise.all(enabledCustomActions.map(async (action) => {
    await browser.contextMenus.update(getSelectionCustomActionMenuId(action.id), {
      visible: hasSelection,
    })
  }))
}

async function syncSelectionContextMenuStateForTab(tabId: number, config?: Config | null) {
  const resolvedConfig = config ?? await ensureInitializedConfig()
  if (!resolvedConfig?.contextMenu.enabled) {
    return
  }

  await updateSelectionSubmenuVisibility(resolvedConfig, getContextMenuSelectionState(tabId))
}

export async function setSelectionContextMenuState(tabId: number, hasSelection: boolean) {
  selectionContextMenuStateByTabId.set(tabId, hasSelection)

  const [activeTab] = await browser.tabs.query({ active: true, currentWindow: true })
  if (activeTab?.id !== tabId) {
    return
  }

  await syncSelectionContextMenuStateForTab(tabId)
}

export async function clearSelectionContextMenuState(tabId: number) {
  selectionContextMenuStateByTabId.delete(tabId)

  const [activeTab] = await browser.tabs.query({ active: true, currentWindow: true })
  if (activeTab?.id !== tabId) {
    return
  }

  await syncSelectionContextMenuStateForTab(tabId)
}

/**
 * Register all context menu event listeners synchronously
 * This must be called during main() execution to ensure listeners are registered
 * before Chrome completes initialization
 */
export function registerContextMenuListeners() {
  // Listen for config changes to update context menu
  storage.watch<Config>(`local:${CONFIG_STORAGE_KEY}`, async (newConfig) => {
    if (newConfig) {
      await updateContextMenuItems(newConfig)
    }
  })

  // Listen for tab activation to update menu title
  browser.tabs.onActivated.addListener(async (activeInfo) => {
    await updateTranslateMenuTitle(activeInfo.tabId)
    await syncSelectionContextMenuStateForTab(activeInfo.tabId)
  })

  // Listen for tab updates (e.g., navigation)
  browser.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
    if (changeInfo.status === "complete") {
      selectionContextMenuStateByTabId.delete(tabId)
      await updateTranslateMenuTitle(tabId)
      await syncSelectionContextMenuStateForTab(tabId)
    }
  })

  // Listen for translation state changes in storage
  // This ensures menu updates when translation is toggled from any UI
  // (floating button, auto-translate, etc.) without interfering with
  // the translation logic in translation-signal.ts
  browser.storage.session.onChanged.addListener(async (changes) => {
    for (const [key, change] of Object.entries(changes)) {
      // Check if this is a translation state change
      if (key.startsWith(TRANSLATION_STATE_KEY_PREFIX.replace("session:", ""))) {
        // Extract tabId from key (format: "translationState.{tabId}")
        const parts = key.split(".")
        const tabId = Number.parseInt(parts[1])

        if (!Number.isNaN(tabId)) {
          // Only update menu if this is the active tab
          const [activeTab] = await browser.tabs.query({ active: true, currentWindow: true })
          if (activeTab?.id === tabId) {
            const newValue = change.newValue as { enabled: boolean } | undefined
            await updateTranslateMenuTitle(tabId, newValue?.enabled)
          }
        }
      }
    }
  })

  // Handle menu item clicks
  browser.contextMenus.onClicked.addListener(handleContextMenuClick)
}

/**
 * Initialize context menu items based on config
 * This can be called asynchronously after listeners are registered
 */
export async function initializeContextMenu() {
  // Ensure config is initialized before setting up context menu
  const config = await ensureInitializedConfig()
  if (!config) {
    return
  }

  await updateContextMenuItems(config)
}

/**
 * Update context menu items based on config
 */
async function updateContextMenuItems(config: Config) {
  // Remove all existing menu items first
  await browser.contextMenus.removeAll()

  const { enabled: contextMenuEnabled } = config.contextMenu
  const enabledCustomActions = getEnabledCustomActions(config)

  if (contextMenuEnabled) {
    browser.contextMenus.create({
      id: MENU_ID_ROOT,
      title: i18n.t("name"),
      contexts: PAGE_AND_SELECTION_CONTEXTS,
    })

    browser.contextMenus.create({
      id: MENU_ID_TRANSLATE,
      title: i18n.t("contextMenu.translate"),
      contexts: PAGE_AND_SELECTION_CONTEXTS,
      parentId: MENU_ID_ROOT,
      visible: true,
    })

    browser.contextMenus.create({
      id: MENU_ID_SUMMARIZE_CURRENT_PAGE,
      title: i18n.t("contextMenu.summarizeCurrentPage"),
      contexts: PAGE_AND_SELECTION_CONTEXTS,
      parentId: MENU_ID_ROOT,
      visible: true,
    })

    browser.contextMenus.create({
      id: MENU_ID_SELECTION_TRANSLATE,
      title: i18n.t("contextMenu.translateSelection"),
      contexts: PAGE_AND_SELECTION_CONTEXTS,
      parentId: MENU_ID_ROOT,
      visible: false,
    })
  }

  if (contextMenuEnabled) {
    browser.contextMenus.create({
      id: MENU_ID_SELECTION_EXPLAIN,
      title: i18n.t("contextMenu.explainSelection"),
      contexts: PAGE_AND_SELECTION_CONTEXTS,
      parentId: MENU_ID_ROOT,
      visible: false,
    })
  }

  if (contextMenuEnabled && enabledCustomActions.length > 0) {
    enabledCustomActions.forEach((action) => {
      browser.contextMenus.create({
        id: getSelectionCustomActionMenuId(action.id),
        title: action.name,
        contexts: PAGE_AND_SELECTION_CONTEXTS,
        parentId: MENU_ID_ROOT,
        visible: false,
      })
    })
  }

  // Update translate menu title for current tab
  const [activeTab] = await browser.tabs.query({ active: true, currentWindow: true })
  if (activeTab?.id) {
    await updateTranslateMenuTitle(activeTab.id)
    await syncSelectionContextMenuStateForTab(activeTab.id, config)
  }
}

/**
 * Update translate menu title based on current translation state
 * @param tabId - The tab ID to check translation state for
 * @param enabled - Optional: if provided, use this value instead of reading from storage
 */
async function updateTranslateMenuTitle(tabId: number, enabled?: boolean) {
  const config = await ensureInitializedConfig()
  if (!config?.contextMenu.enabled) {
    return
  }

  try {
    let isTranslated: boolean
    if (enabled !== undefined) {
      isTranslated = enabled
    }
    else {
      const state = await storage.getItem<{ enabled: boolean }>(
        getTranslationStateKey(tabId),
      )
      isTranslated = state?.enabled ?? false
    }

    await browser.contextMenus.update(MENU_ID_TRANSLATE, {
      title: isTranslated
        ? i18n.t("contextMenu.showOriginal")
        : i18n.t("contextMenu.translate"),
    })
  }
  catch {
    // Menu item might not exist if translateEnabled is false
  }
}

/**
 * Handle context menu item click
 */
async function handleContextMenuClick(
  info: Browser.contextMenus.OnClickData,
  tab?: Browser.tabs.Tab,
) {
  if (!tab?.id) {
    return
  }

  if (info.menuItemId === MENU_ID_TRANSLATE) {
    await handleTranslateClick(tab.id)
    return
  }

  if (info.menuItemId === MENU_ID_SUMMARIZE_CURRENT_PAGE) {
    await handleCurrentWebPageSummaryClick(tab)
    return
  }

  if (info.menuItemId === MENU_ID_SELECTION_TRANSLATE) {
    await handleSelectionTranslateClick(info, tab.id)
    return
  }

  if (info.menuItemId === MENU_ID_SELECTION_EXPLAIN) {
    await handleSelectionExplainClick(info, tab.id)
    return
  }

  if (typeof info.menuItemId === "string" && info.menuItemId.startsWith(MENU_ID_SELECTION_CUSTOM_ACTION_PREFIX)) {
    const actionId = info.menuItemId.slice(MENU_ID_SELECTION_CUSTOM_ACTION_PREFIX.length)
    if (!actionId) {
      return
    }

    await handleSelectionCustomActionClick(info, tab.id, actionId)
  }
}

/**
 * Handle translate menu click - toggle page translation
 */
async function handleTranslateClick(tabId: number) {
  const state = await storage.getItem<{ enabled: boolean }>(
    getTranslationStateKey(tabId),
  )
  const isCurrentlyTranslated = state?.enabled ?? false
  const newState = !isCurrentlyTranslated

  // Update storage directly (instead of sending message to self)
  await storage.setItem(getTranslationStateKey(tabId), { enabled: newState })

  // Notify content script in that specific tab
  fireAndForgetTabMessage(
    sendMessage("askManagerToTogglePageTranslation", {
      enabled: newState,
      analyticsContext: newState
        ? createFeatureUsageContext(ANALYTICS_FEATURE.PAGE_TRANSLATION, ANALYTICS_SURFACE.CONTEXT_MENU)
        : undefined,
    }, tabId),
    "askManagerToTogglePageTranslation",
  )

  // Update menu title immediately
  await updateTranslateMenuTitle(tabId)
}

async function handleSelectionTranslateClick(
  info: Browser.contextMenus.OnClickData,
  tabId: number,
) {
  const selectionText = info.selectionText?.trim()
  if (!selectionText) {
    return
  }

  const target = typeof info.frameId === "number"
    ? { tabId, frameId: info.frameId }
    : tabId

  fireAndForgetTabMessage(
    sendMessage("openSelectionTranslationFromContextMenu", {
      selectionText,
    }, target),
    "openSelectionTranslationFromContextMenu",
  )
}

async function handleSelectionExplainClick(
  info: Browser.contextMenus.OnClickData,
  tabId: number,
) {
  const selectionText = info.selectionText?.trim()
  if (!selectionText) {
    return
  }

  const target = typeof info.frameId === "number"
    ? { tabId, frameId: info.frameId }
    : tabId

  fireAndForgetTabMessage(
    sendMessage("openSelectionExplainFromContextMenu", {
      selectionText,
    }, target),
    "openSelectionExplainFromContextMenu",
  )
}

async function handleSelectionCustomActionClick(
  info: Browser.contextMenus.OnClickData,
  tabId: number,
  actionId: string,
) {
  const selectionText = info.selectionText?.trim()
  if (!selectionText) {
    return
  }

  const target = typeof info.frameId === "number"
    ? { tabId, frameId: info.frameId }
    : tabId

  fireAndForgetTabMessage(
    sendMessage("openSelectionCustomActionFromContextMenu", {
      actionId,
      selectionText,
    }, target),
    "openSelectionCustomActionFromContextMenu",
  )
}

async function handleCurrentWebPageSummaryClick(tab: Browser.tabs.Tab) {
  if (!tab.id || tab.windowId == null) {
    return
  }

  const opened = await openSidePanelInWindow(tab.windowId)
  if (!opened) {
    return
  }

  const webPageContext = await requestTabMessageOrNull(
    sendMessage("getCurrentWebPageContext", undefined, tab.id),
    "getCurrentWebPageContext",
  )
  const pageUrl = webPageContext?.url?.trim() || tab.url?.trim()
  if (!pageUrl) {
    return
  }

  const request = buildCurrentWebPageSummaryRequestPayload({
    fallbackPageTitle: tab.title,
    fallbackPageUrl: pageUrl,
    webPageContext,
  })
  if (!request) {
    return
  }

  await queueSidePanelChatRequest(request, tab.windowId)
}
