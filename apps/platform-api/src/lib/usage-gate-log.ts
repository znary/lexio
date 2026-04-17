export type UsageGateLane = "interactive" | "background"
export type UsageGateStatus = "queued" | "running" | "released" | "canceled" | "expired"

export interface UsageGateLogEntry {
  requestId: string
  taskId: string
  userId: string
  scene: string | null
  lane: UsageGateLane | null
  status: UsageGateStatus | string
  ownerTabId: number | null
  queuePosition: number | null
  queueWaitMs: number | null
  runMs: number | null
  upstreamStatus: number | null
  cancelReason: string | null
  releaseReason: string | null
}

export function logUsageGateEvent(entry: UsageGateLogEntry): void {
  console.warn(entry)
}
