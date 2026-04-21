import type { SidepanelChatRequestPayload } from "@/utils/platform/sidepanel-chat-request"
import { browser } from "#imports"
import { createSidepanelChatRequest, enqueuePendingSidepanelChatRequest } from "@/utils/platform/sidepanel-chat-request"

interface SidePanelApi {
  setPanelBehavior?: (options: { openPanelOnActionClick: boolean }) => Promise<void>
  open?: (options: { windowId: number }) => Promise<void>
  close?: (options: { windowId: number }) => Promise<void>
  onOpened?: {
    addListener: (callback: (info: { windowId: number }) => void) => void
  }
  onClosed?: {
    addListener: (callback: (info: { windowId: number }) => void) => void
  }
}

interface RuntimeApi {
  getContexts?: (filter: {
    contextTypes?: string[]
    windowIds?: number[]
  }) => Promise<Array<{
    contextType?: string
    windowId?: number
  }>>
}

function getSidePanelApi(): SidePanelApi | null {
  const value = (browser as typeof browser & { sidePanel?: SidePanelApi }).sidePanel
  return value ?? null
}

function getRuntimeApi(): RuntimeApi | null {
  const value = (browser as typeof browser & { runtime?: RuntimeApi }).runtime
  return value ?? null
}

const openSidePanelWindowIds = new Set<number>()
let hasRegisteredSidePanelStateListeners = false
let hasStartedSidePanelStateSeed = false

function markSidePanelWindow(windowId: number | undefined, isOpen: boolean) {
  if (!windowId || windowId < 0) {
    return
  }

  if (isOpen) {
    openSidePanelWindowIds.add(windowId)
    return
  }

  openSidePanelWindowIds.delete(windowId)
}

async function seedOpenSidePanelWindows(): Promise<void> {
  const runtime = getRuntimeApi()
  if (!runtime?.getContexts) {
    return
  }

  try {
    const contexts = await runtime.getContexts({
      contextTypes: ["SIDE_PANEL"],
    })

    openSidePanelWindowIds.clear()
    contexts.forEach((context) => {
      markSidePanelWindow(context.windowId, true)
    })
  }
  catch {
    // Ignore state seeding failures and fall back to open events.
  }
}

function setUpSidePanelStateTracking(): void {
  const sidePanel = getSidePanelApi()
  if (!sidePanel) {
    return
  }

  if (!hasRegisteredSidePanelStateListeners) {
    sidePanel.onOpened?.addListener((info) => {
      markSidePanelWindow(info.windowId, true)
    })
    sidePanel.onClosed?.addListener((info) => {
      markSidePanelWindow(info.windowId, false)
    })
    hasRegisteredSidePanelStateListeners = true
  }

  if (!hasStartedSidePanelStateSeed) {
    hasStartedSidePanelStateSeed = true
    void seedOpenSidePanelWindows()
  }
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

  setUpSidePanelStateTracking()
  await sidePanel.open({ windowId })
  markSidePanelWindow(windowId, true)
  return true
}

export async function setUpSidePanelBehavior(): Promise<void> {
  const sidePanel = getSidePanelApi()
  if (!sidePanel) {
    return
  }

  setUpSidePanelStateTracking()
  if (!sidePanel.setPanelBehavior) {
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

export async function toggleSidePanelInWindow(windowId: number): Promise<boolean> {
  const sidePanel = getSidePanelApi()
  if (!sidePanel?.open) {
    return false
  }

  setUpSidePanelStateTracking()
  const isOpen = openSidePanelWindowIds.has(windowId)
  if (isOpen && sidePanel.close) {
    await sidePanel.close({ windowId })
    markSidePanelWindow(windowId, false)
    return false
  }

  if (isOpen) {
    return true
  }

  await sidePanel.open({ windowId })
  markSidePanelWindow(windowId, true)
  return true
}

export async function toggleSidePanelInActiveWindow(): Promise<boolean> {
  const windowId = await getActiveWindowId()
  if (!windowId) {
    return false
  }

  return await toggleSidePanelInWindow(windowId)
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
