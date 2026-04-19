import type { SidepanelChatRequestPayload } from "@/utils/platform/sidepanel-chat-request"
import { browser } from "#imports"
import { createSidepanelChatRequest, enqueuePendingSidepanelChatRequest } from "@/utils/platform/sidepanel-chat-request"

interface SidePanelApi {
  setPanelBehavior?: (options: { openPanelOnActionClick: boolean }) => Promise<void>
  open?: (options: { windowId: number }) => Promise<void>
}

function getSidePanelApi(): SidePanelApi | null {
  const value = (browser as typeof browser & { sidePanel?: SidePanelApi }).sidePanel
  return value ?? null
}

async function getActiveWindowId(): Promise<number | null> {
  const [activeTab] = await browser.tabs.query({
    active: true,
    currentWindow: true,
  })

  return activeTab?.windowId ?? null
}

export async function openSidePanelInWindow(windowId: number): Promise<boolean> {
  const sidePanel = getSidePanelApi()
  if (!sidePanel?.open) {
    return false
  }

  await sidePanel.open({ windowId })
  return true
}

export async function setUpSidePanelBehavior(): Promise<void> {
  const sidePanel = getSidePanelApi()
  if (!sidePanel?.setPanelBehavior) {
    return
  }

  await sidePanel.setPanelBehavior({
    openPanelOnActionClick: true,
  })
}

export async function openSidePanelInActiveWindow(): Promise<boolean> {
  const windowId = await getActiveWindowId()
  if (!windowId) {
    return false
  }

  return await openSidePanelInWindow(windowId)
}

export async function queueSidePanelChatRequest(payload: SidepanelChatRequestPayload, windowId: number): Promise<void> {
  await enqueuePendingSidepanelChatRequest(windowId, createSidepanelChatRequest(payload))
}

export async function openSidePanelForChatRequest(payload: SidepanelChatRequestPayload, windowId: number): Promise<boolean> {
  const opened = await openSidePanelInWindow(windowId)
  if (!opened) {
    return false
  }

  await queueSidePanelChatRequest(payload, windowId)
  return true
}
