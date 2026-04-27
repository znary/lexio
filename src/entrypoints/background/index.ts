import "@/utils/zod-config"
import { browser, defineBackground } from "#imports"
import { WEBSITE_URL } from "@/utils/constants/url"
import { logger } from "@/utils/logger"
import { onMessage } from "@/utils/message"
import { openPlatformExtensionSyncTab } from "@/utils/platform/navigation"
import { clearPlatformAuthSession, setPlatformAuthSession } from "@/utils/platform/storage"
import { SessionCacheGroupRegistry } from "@/utils/session-cache/session-cache-group-registry"
import { runAiSegmentSubtitles } from "./ai-segmentation"
import { setupAnalyticsMessageHandlers } from "./analytics"
import { dispatchBackgroundStreamPort } from "./background-stream"
import { ensureInitializedConfig } from "./config"
import { setUpConfigBackup } from "./config-backup"
import { clearSelectionContextMenuState, initializeContextMenu, registerContextMenuListeners, setSelectionContextMenuState } from "./context-menu"
import { cleanupAllAiSegmentationCache, cleanupAllSummaryCache, cleanupAllTranslationCache, setUpDatabaseCleanup } from "./db-cleanup"
import { setupEdgeTTSMessageHandlers } from "./edge-tts"
import { setupIframeInjection } from "./iframe-injection"
import { setupLLMGenerateTextMessageHandlers } from "./llm-generate-text"
import { initMockData } from "./mock-data"
import { newUserGuide } from "./new-user-guide"
import { handlePlatformAuthExternalMessage } from "./platform-auth"
import { proxyFetch } from "./proxy-fetch"
import { reinjectOpenTabsContentScripts } from "./reinject-open-tabs"
import {
  openSidePanelForChatRequest,
  openSidePanelInActiveWindow,
  openSidePanelInWindow,
  setUpSidePanelBehavior,
  toggleSidePanelInActiveWindow,
  toggleSidePanelInWindow,
} from "./sidepanel"
import { setUpSubtitlesTranslationQueue, setUpWebPageTranslationQueue } from "./translation-queues"
import { translationMessage } from "./translation-signal"
import { setupTTSPlaybackMessageHandlers } from "./tts-playback"
import { setupUninstallSurvey } from "./uninstall-survey"

function getWebsiteOrigin(): string | null {
  try {
    return new URL(WEBSITE_URL).origin
  }
  catch {
    return null
  }
}

export default defineBackground({
  type: "module",
  main: () => {
    logger.info("Hello background!", { id: browser.runtime.id })
    const websiteOrigin = getWebsiteOrigin()

    browser.runtime.onInstalled.addListener(async (details) => {
      await ensureInitializedConfig()

      if (details.reason === "install" || details.reason === "update") {
        await reinjectOpenTabsContentScripts()
      }

      // Open the authorization page so the site can redirect to sign-in if needed.
      if (details.reason === "install") {
        await openPlatformExtensionSyncTab()
      }

      // Clear blog cache on extension update to fetch latest blog posts
      if (details.reason === "update") {
        logger.info("[Background] Extension updated, clearing blog cache")
        await SessionCacheGroupRegistry.removeCacheGroup("blog-fetch")
      }
    })

    onMessage("openPage", async (message) => {
      const { url, active } = message.data
      logger.info("openPage", { url, active })
      await browser.tabs.create({ url, active: active ?? true })
    })

    onMessage("openOptionsPage", () => {
      logger.info("openOptionsPage")
      void browser.runtime.openOptionsPage()
    })

    onMessage("openSidePanel", async (message) => {
      logger.info("openSidePanel")
      const senderWindowId = message.sender?.tab?.windowId
      if (senderWindowId) {
        return await openSidePanelInWindow(senderWindowId)
      }
      return await openSidePanelInActiveWindow()
    })

    onMessage("toggleSidePanel", async (message) => {
      logger.info("toggleSidePanel")
      const senderWindowId = message.sender?.tab?.windowId
      if (senderWindowId) {
        return await toggleSidePanelInWindow(senderWindowId)
      }
      return await toggleSidePanelInActiveWindow()
    })

    onMessage("openSidePanelChatRequest", async (message) => {
      logger.info("openSidePanelChatRequest", { type: message.data.type })
      const senderWindowId = message.sender?.tab?.windowId
      if (!senderWindowId) {
        return false
      }

      return await openSidePanelForChatRequest(message.data, senderWindowId)
    })

    onMessage("notifySelectionContextMenuState", async (message) => {
      const senderTabId = message.sender?.tab?.id
      if (!senderTabId) {
        return
      }

      if (message.data.hasSelection) {
        await setSelectionContextMenuState(senderTabId, true)
        return
      }

      await clearSelectionContextMenuState(senderTabId)
    })

    browser.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
      const handled = handlePlatformAuthExternalMessage({
        message,
        senderUrl: sender.url,
        websiteOrigin,
        setPlatformAuthSession,
        clearPlatformAuthSession,
      })

      void handled.then((response) => {
        if (response) {
          sendResponse(response)
        }
      })

      if (!message || typeof message !== "object") {
        return false
      }

      const type = (message as Record<string, unknown>).type
      return type === "lexio-platform-auth-sync" || type === "lexio-platform-auth-clear"
    })

    onMessage("aiSegmentSubtitles", async (message) => {
      try {
        return await runAiSegmentSubtitles(message.data)
      }
      catch (error) {
        logger.error("[Background] aiSegmentSubtitles failed", error)
        throw error
      }
    })

    browser.runtime.onConnect.addListener((port) => {
      dispatchBackgroundStreamPort(port)
    })

    onMessage("clearAllTranslationRelatedCache", async () => {
      await cleanupAllTranslationCache()
      await cleanupAllSummaryCache()
    })

    onMessage("clearAiSegmentationCache", async () => {
      await cleanupAllAiSegmentationCache()
    })

    newUserGuide()
    setupAnalyticsMessageHandlers()
    translationMessage()

    // Register context menu listeners synchronously
    // This ensures listeners are registered before Chrome completes initialization
    registerContextMenuListeners()

    // Initialize context menu items asynchronously
    void initializeContextMenu()

    void setUpWebPageTranslationQueue()
    void setUpSubtitlesTranslationQueue()
    void setUpDatabaseCleanup()
    void setUpSidePanelBehavior()
    setUpConfigBackup()
    void setupUninstallSurvey()

    proxyFetch()
    setupEdgeTTSMessageHandlers()
    setupLLMGenerateTextMessageHandlers()
    setupTTSPlaybackMessageHandlers()
    void initMockData()

    // Setup programmatic injection for iframes that Chrome's manifest-based all_frames misses
    setupIframeInjection()
  },
})
