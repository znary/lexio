import { browser } from "#imports"
import { logger } from "@/utils/logger"
import { SITE_CONTROL_URL_WINDOW_KEY } from "@/utils/site-control"
import { resolveSiteControlUrl } from "./iframe-injection-utils"

const INJECTABLE_TAB_URL_PATTERNS = ["http://*/*", "https://*/*", "file:///*"]

function setInjectedSiteControlUrl(propertyName: string, siteControlUrl: string) {
  ;(globalThis as Record<string, unknown>)[propertyName] = siteControlUrl
}

async function injectContentScriptsIntoFrame(tabId: number, frameId: number, siteControlUrl: string) {
  const target = { tabId, frameIds: [frameId] }

  await browser.scripting.executeScript({
    target,
    func: setInjectedSiteControlUrl,
    args: [SITE_CONTROL_URL_WINDOW_KEY, siteControlUrl],
  })

  await browser.scripting.executeScript({
    target,
    files: ["/content-scripts/host.js"],
  })

  await browser.scripting.executeScript({
    target,
    files: ["/content-scripts/selection.js"],
  })
}

async function injectContentScriptsIntoTab(tabId: number, tabUrl: string) {
  await browser.scripting.executeScript({
    target: { tabId },
    func: setInjectedSiteControlUrl,
    args: [SITE_CONTROL_URL_WINDOW_KEY, tabUrl],
  })

  await browser.scripting.executeScript({
    target: { tabId },
    files: ["/content-scripts/host.js"],
  })

  await browser.scripting.executeScript({
    target: { tabId },
    files: ["/content-scripts/selection.js"],
  })
}

export async function reinjectOpenTabsContentScripts() {
  const tabs = await browser.tabs.query({
    url: INJECTABLE_TAB_URL_PATTERNS,
  })

  await Promise.allSettled(tabs.map(async (tab) => {
    if (!tab.id) {
      return
    }

    try {
      const frames = await browser.webNavigation.getAllFrames({ tabId: tab.id }) ?? []
      if (frames.length === 0) {
        if (tab.url) {
          await injectContentScriptsIntoTab(tab.id, tab.url)
        }
        return
      }

      for (const frame of frames) {
        const siteControlUrl = resolveSiteControlUrl(frame.frameId, frame.url, frames, frame.parentFrameId)
        if (!siteControlUrl) {
          continue
        }

        await injectContentScriptsIntoFrame(tab.id, frame.frameId, siteControlUrl)
      }
    }
    catch (error) {
      logger.warn("[Background] Failed to reinject content scripts into open tab", {
        error,
        tabId: tab.id,
        tabUrl: tab.url,
      })
    }
  }))
}
