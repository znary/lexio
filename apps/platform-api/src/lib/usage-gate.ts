import type { Entitlements, Env } from "./env"
import { HttpError } from "./http"

interface UsageGateTaskResponse {
  taskId: string
  requestId: string
  leaseId: string | null
  requestCount: number
  status: "queued" | "running" | "released" | "canceled" | "expired"
  lane: "interactive" | "background"
  queuePosition: number | null
  queueWaitMs: number | null
  runMs: number | null
  upstreamStatus: number | null
  cancelReason: string | null
  releaseReason: string | null
}

interface TranslationTaskStreamPayload {
  taskId: string
  snapshot: Record<string, unknown>
}

interface TranslationTaskPublishPayload {
  taskId: string
  event: "queued" | "running" | "completed" | "failed" | "canceled"
  data: Record<string, unknown>
}

interface ReserveLease {
  taskId: string
  requestId: string
  leaseId: string
  requestCount: number
}

interface UsageGateTaskOptions {
  requestId?: string
  taskId?: string
  scene?: string | null
  ownerTabId?: number | null
  lane?: "interactive" | "background"
}

type UsageGateClientEnv = Pick<Env, "USAGE_GATE">

const TASK_POLL_INTERVAL_MS = 50
const TASK_POLL_TIMEOUT_MS = 30_000

async function postUsageGate<T>(
  env: UsageGateClientEnv,
  userId: string,
  path: string,
  body: Record<string, unknown>,
): Promise<T> {
  const id = env.USAGE_GATE.idFromName(userId)
  const stub = env.USAGE_GATE.get(id)
  const response = await stub.fetch(`https://usage-gate.internal${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })

  const data = await response.json() as T & { error?: string }
  if (!response.ok) {
    throw new HttpError(response.status, data.error ?? "Usage gate request failed")
  }

  return data
}

function normalizeTaskResponse(response: UsageGateTaskResponse): ReserveLease {
  if (response.status !== "running" || !response.leaseId) {
    throw new HttpError(429, response.status === "canceled"
      ? "Usage task was canceled"
      : response.status === "expired"
        ? "Usage task expired"
        : "Usage task is still queued")
  }

  return {
    taskId: response.taskId,
    requestId: response.requestId,
    leaseId: response.leaseId,
    requestCount: response.requestCount,
  }
}

async function waitForTaskLease(env: UsageGateClientEnv, userId: string, taskId: string): Promise<ReserveLease> {
  const startedAt = Date.now()

  while (Date.now() - startedAt < TASK_POLL_TIMEOUT_MS) {
    const response = await assignUsageTask(env, userId, { taskId })
    if (response.status === "running" && response.leaseId) {
      return normalizeTaskResponse(response)
    }

    if (response.status === "canceled") {
      throw new HttpError(499, "Usage task was canceled")
    }

    if (response.status === "expired") {
      throw new HttpError(429, "Usage task expired")
    }

    await new Promise<void>(resolve => setTimeout(resolve, TASK_POLL_INTERVAL_MS))
  }

  throw new HttpError(429, "Usage task timed out")
}

export async function createUsageTask(
  env: UsageGateClientEnv,
  userId: string,
  entitlements: Entitlements,
  requestKind: string,
  options: UsageGateTaskOptions = {},
): Promise<UsageGateTaskResponse> {
  return await postUsageGate<UsageGateTaskResponse>(env, userId, "/tasks/create", {
    userId,
    requestKind,
    entitlements,
    requestId: options.requestId ?? crypto.randomUUID(),
    taskId: options.taskId,
    scene: options.scene ?? null,
    ownerTabId: options.ownerTabId ?? null,
    lane: options.lane ?? "interactive",
  })
}

export async function assignUsageTask(
  env: UsageGateClientEnv,
  userId: string,
  options: { taskId: string, requestId?: string } | string,
): Promise<UsageGateTaskResponse> {
  const taskId = typeof options === "string" ? options : options.taskId
  const requestId = typeof options === "string" ? undefined : options.requestId

  return await postUsageGate<UsageGateTaskResponse>(env, userId, "/tasks/assign", {
    taskId,
    requestId,
  })
}

export async function releaseUsageTask(
  env: UsageGateClientEnv,
  userId: string,
  leaseId: string,
  options: { taskId?: string, releaseReason?: string, upstreamStatus?: number, requestId?: string } = {},
): Promise<UsageGateTaskResponse> {
  return await postUsageGate<UsageGateTaskResponse>(env, userId, "/tasks/release", {
    leaseId,
    taskId: options.taskId,
    releaseReason: options.releaseReason,
    upstreamStatus: options.upstreamStatus,
    requestId: options.requestId,
  })
}

export async function cancelUsageTask(
  env: UsageGateClientEnv,
  userId: string,
  taskId: string,
  options: { cancelReason?: string, requestId?: string } = {},
): Promise<UsageGateTaskResponse> {
  return await postUsageGate<UsageGateTaskResponse>(env, userId, "/tasks/cancel", {
    taskId,
    cancelReason: options.cancelReason,
    requestId: options.requestId,
  })
}

export async function expireUsageLease(
  env: UsageGateClientEnv,
  userId: string,
  leaseId: string,
  options: { taskId?: string, requestId?: string } = {},
): Promise<UsageGateTaskResponse> {
  return await postUsageGate<UsageGateTaskResponse>(env, userId, "/tasks/lease-expired", {
    leaseId,
    taskId: options.taskId,
    requestId: options.requestId,
  })
}

export async function streamTranslationTask(
  env: UsageGateClientEnv,
  userId: string,
  payload: TranslationTaskStreamPayload,
): Promise<Response> {
  const id = env.USAGE_GATE.idFromName(userId)
  const stub = env.USAGE_GATE.get(id)
  return await stub.fetch("https://usage-gate.internal/translation-tasks/stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })
}

export async function publishTranslationTaskEvent(
  env: UsageGateClientEnv,
  userId: string,
  payload: TranslationTaskPublishPayload,
): Promise<void> {
  await postUsageGate<Record<string, never>>(
    env,
    userId,
    "/translation-tasks/publish",
    payload as unknown as Record<string, unknown>,
  )
}

export async function reserveUsage(
  env: UsageGateClientEnv,
  userId: string,
  entitlements: Entitlements,
  requestKind: string,
  options: UsageGateTaskOptions = {},
): Promise<ReserveLease> {
  const created = await createUsageTask(env, userId, entitlements, requestKind, options)
  if (created.status === "running" && created.leaseId) {
    return normalizeTaskResponse(created)
  }

  if (created.status === "canceled") {
    throw new HttpError(499, "Usage task was canceled")
  }

  if (created.status === "expired") {
    throw new HttpError(429, "Usage task expired")
  }

  return await waitForTaskLease(env, userId, created.taskId)
}

export async function completeUsage(
  env: UsageGateClientEnv,
  userId: string,
  leaseId: string,
  options: { taskId?: string, releaseReason?: string, upstreamStatus?: number, requestId?: string } = {},
): Promise<void> {
  await releaseUsageTask(env, userId, leaseId, options)
}
