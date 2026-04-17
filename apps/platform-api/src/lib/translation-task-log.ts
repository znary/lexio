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

export interface TranslationTaskStreamLogEntry {
  event: "attach-immediate" | "attach-live"
  taskId: string
  userId: string
  status: TranslationTaskStatus
}

function write(level: "info" | "warn" | "error", entry: TranslationTaskLogEntry): void {
  console[level]({
    namespace: "translation-task",
    ...entry,
  })
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

export function logTranslationTaskStreamInfo(entry: TranslationTaskStreamLogEntry): void {
  console.info({
    namespace: "translation-task-stream",
    ...entry,
  })
}
