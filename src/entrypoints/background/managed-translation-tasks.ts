import { browser } from "#imports"
import { logger } from "@/utils/logger"

interface ManagedTranslationTaskState {
  controller: AbortController
  taskIds: Set<string>
}

export interface ManagedTranslationTaskScope {
  signal: AbortSignal
  registerTaskId: (taskId: string) => void
  completeTask: (taskId: string) => void
}

const managedTranslationTaskStateByTabId = new Map<number, ManagedTranslationTaskState>()
let managedTranslationTaskListenersRegistered = false

function createManagedTranslationTaskState(): ManagedTranslationTaskState {
  return {
    controller: new AbortController(),
    taskIds: new Set<string>(),
  }
}

function getOrCreateManagedTranslationTaskState(tabId: number): ManagedTranslationTaskState {
  const currentState = managedTranslationTaskStateByTabId.get(tabId)
  if (currentState && !currentState.controller.signal.aborted) {
    return currentState
  }

  const nextState = createManagedTranslationTaskState()
  managedTranslationTaskStateByTabId.set(tabId, nextState)
  return nextState
}

function clearManagedTranslationTaskState(tabId: number, state?: ManagedTranslationTaskState) {
  const currentState = state ?? managedTranslationTaskStateByTabId.get(tabId)
  if (!currentState) {
    return
  }

  logger.info("[ManagedTranslationTask]", {
    tabId,
    action: "cleanup",
    event: "abort-controller",
    taskIds: [...currentState.taskIds],
  })

  currentState.taskIds.clear()
  if (!currentState.controller.signal.aborted) {
    currentState.controller.abort()
  }
  managedTranslationTaskStateByTabId.delete(tabId)
}

export function getManagedTranslationTaskScope(tabId: number): ManagedTranslationTaskScope {
  const state = getOrCreateManagedTranslationTaskState(tabId)

  return {
    signal: state.controller.signal,
    registerTaskId(taskId: string) {
      if (!state.controller.signal.aborted) {
        state.taskIds.add(taskId)
        logger.info("[ManagedTranslationTask]", {
          tabId,
          taskId,
          action: "scope",
          event: "register",
        })
      }
    },
    completeTask(taskId: string) {
      state.taskIds.delete(taskId)
      logger.info("[ManagedTranslationTask]", {
        tabId,
        taskId,
        action: "scope",
        event: "complete",
      })
      if (state.taskIds.size === 0) {
        managedTranslationTaskStateByTabId.delete(tabId)
      }
    },
  }
}

export function cancelManagedTranslationTasksForTab(tabId: number) {
  clearManagedTranslationTaskState(tabId)
}

export function setupManagedTranslationTaskCleanup() {
  if (managedTranslationTaskListenersRegistered) {
    return
  }
  managedTranslationTaskListenersRegistered = true

  browser.tabs.onRemoved.addListener((tabId) => {
    cancelManagedTranslationTasksForTab(tabId)
  })

  browser.webNavigation.onCommitted.addListener((details) => {
    if (details.frameId !== 0) {
      return
    }

    cancelManagedTranslationTasksForTab(details.tabId)
  })
}
