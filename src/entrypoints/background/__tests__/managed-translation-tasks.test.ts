import { browser } from "#imports"
import { beforeEach, describe, expect, it, vi } from "vitest"

describe("managed translation task cleanup", () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()

    browser.tabs.onRemoved.addListener = vi.fn()
    browser.webNavigation.onCommitted.addListener = vi.fn()
  })

  it("cancels active managed translation tasks on main-frame navigation and tab removal", async () => {
    const {
      cancelManagedTranslationTasksForTab,
      getManagedTranslationTaskScope,
      setupManagedTranslationTaskCleanup,
    } = await import("../managed-translation-tasks")

    setupManagedTranslationTaskCleanup()

    const scope = getManagedTranslationTaskScope(12)
    scope.registerTaskId("task-1")
    scope.registerTaskId("task-2")

    const onCommitted = vi.mocked(browser.webNavigation.onCommitted.addListener).mock.calls.at(-1)?.[0] as
      | ((details: { frameId: number, tabId: number }) => Promise<void>)
      | undefined
    const onRemoved = vi.mocked(browser.tabs.onRemoved.addListener).mock.calls.at(-1)?.[0] as
      | ((tabId: number) => Promise<void>)
      | undefined

    if (!onCommitted || !onRemoved) {
      throw new Error("Expected managed translation cleanup listeners to be registered")
    }

    await onCommitted({
      frameId: 0,
      tabId: 12,
    })

    expect(scope.signal.aborted).toBe(true)

    const nextScope = getManagedTranslationTaskScope(12)
    expect(nextScope.signal.aborted).toBe(false)

    await onRemoved(12)
    expect(nextScope.signal.aborted).toBe(true)

    cancelManagedTranslationTasksForTab(12)
    expect(nextScope.signal.aborted).toBe(true)
  })
})
