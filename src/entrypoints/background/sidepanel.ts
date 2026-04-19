import { browser } from "#imports"

interface SidePanelApi {
  setPanelBehavior?: (options: { openPanelOnActionClick: boolean }) => Promise<void>
  open?: (options: { windowId: number }) => Promise<void>
}

function getSidePanelApi(): SidePanelApi | null {
  const value = (browser as typeof browser & { sidePanel?: SidePanelApi }).sidePanel
  return value ?? null
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
  const sidePanel = getSidePanelApi()
  if (!sidePanel?.open) {
    return false
  }

  const [activeTab] = await browser.tabs.query({
    active: true,
    currentWindow: true,
  })

  if (!activeTab?.windowId) {
    return false
  }

  await sidePanel.open({
    windowId: activeTab.windowId,
  })
  return true
}
