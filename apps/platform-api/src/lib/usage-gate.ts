import type { Entitlements, Env } from "./env"
import { HttpError } from "./http"

interface ReserveLease {
  leaseId: string
  requestCount: number
}

export async function reserveUsage(
  env: Env,
  userId: string,
  entitlements: Entitlements,
  requestKind: string,
): Promise<ReserveLease> {
  const id = env.USAGE_GATE.idFromName(userId)
  const stub = env.USAGE_GATE.get(id)
  const response = await stub.fetch("https://usage-gate.internal/reserve", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      userId,
      requestKind,
      entitlements,
    }),
  })

  const data = await response.json<{ leaseId?: string, requestCount?: number, error?: string }>()
  if (!response.ok || !data.leaseId || !data.requestCount) {
    throw new HttpError(response.status, data.error ?? "Usage reservation failed")
  }

  return {
    leaseId: data.leaseId,
    requestCount: data.requestCount,
  }
}

export async function completeUsage(env: Env, userId: string, leaseId: string): Promise<void> {
  const id = env.USAGE_GATE.idFromName(userId)
  const stub = env.USAGE_GATE.get(id)
  await stub.fetch("https://usage-gate.internal/complete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ leaseId }),
  })
}
