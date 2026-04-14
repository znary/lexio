import type { Entitlements } from "../lib/env"

interface UsageState {
  monthKey: string
  requestCount: number
  activeCount: number
  leases: Record<string, number>
}

interface ReserveRequest {
  userId: string
  requestKind: string
  entitlements: Entitlements
}

function currentMonthKey() {
  const now = new Date()
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`
}

export class UsageGate {
  private readonly ctx: DurableObjectState

  constructor(ctx: DurableObjectState, _env: unknown) {
    this.ctx = ctx
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const state = await this.loadState()

    if (url.pathname === "/reserve") {
      const payload = await request.json() as ReserveRequest

      if (state.activeCount >= payload.entitlements.concurrentRequestLimit) {
        return Response.json({ error: "Too many concurrent requests" }, { status: 429 })
      }

      if (state.requestCount >= payload.entitlements.monthlyRequestLimit) {
        return Response.json({ error: "Monthly request limit reached" }, { status: 402 })
      }

      const leaseId = crypto.randomUUID()
      state.activeCount += 1
      state.requestCount += 1
      state.leases[leaseId] = Date.now()
      await this.persistState(state)

      return Response.json({
        leaseId,
        requestCount: 1,
      })
    }

    if (url.pathname === "/complete") {
      const payload = await request.json() as { leaseId?: string }
      if (payload.leaseId && state.leases[payload.leaseId]) {
        delete state.leases[payload.leaseId]
        state.activeCount = Math.max(0, state.activeCount - 1)
        await this.persistState(state)
      }

      return Response.json({ ok: true })
    }

    return Response.json({ error: "Not found" }, { status: 404 })
  }

  private async loadState(): Promise<UsageState> {
    const monthKey = currentMonthKey()
    const stored = await this.ctx.storage.get<UsageState>("usage-state")
    if (!stored || stored.monthKey !== monthKey) {
      return {
        monthKey,
        requestCount: 0,
        activeCount: 0,
        leases: {},
      }
    }
    return stored
  }

  private async persistState(state: UsageState): Promise<void> {
    await this.ctx.storage.put("usage-state", state)
  }
}
