/* eslint-disable no-console */

export type TranslationTaskLane = "interactive" | "background"

export type TranslationTaskStatus
  = | "queued"
    | "dispatched"
    | "running"
    | "completed"
    | "failed"
    | "canceled"

export interface TranslationTaskLogEntry {
  requestId: string | null
  taskId: string
  userId: string
  scene: string | null
  lane: TranslationTaskLane
  status: TranslationTaskStatus
  ownerTabId: number | null
  queuePosition: number | null
  queueWaitMs: number | null
  runMs: number | null
  upstreamStatus: number | null
  cancelReason: string | null
  releaseReason: string | null
  errorCode?: string | null
  errorMessage?: string | null
}

function write(level: "info" | "warn" | "error", entry: TranslationTaskLogEntry): void {
  console[level](entry)
}

export function logTranslationTaskInfo(entry: TranslationTaskLogEntry): void {
  write("info", entry)
}

export function logTranslationTaskWarn(entry: TranslationTaskLogEntry): void {
  write("warn", entry)
}

export function logTranslationTaskError(entry: TranslationTaskLogEntry): void {
  write("error", entry)
}
