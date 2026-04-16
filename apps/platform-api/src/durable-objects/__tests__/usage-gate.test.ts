import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { UsageGate } from "../usage-gate"

interface StoredUsageState {
  monthKey: string
  requestCount: number
  activeCount: number
  leases: Record<string, number>
}

function createContext(initialState?: StoredUsageState) {
  const store = new Map<string, StoredUsageState>()
  if (initialState) {
    store.set("usage-state", structuredClone(initialState))
  }

  const storage = {
    get: vi.fn(async (key: string) => store.get(key)),
    put: vi.fn(async (key: string, value: StoredUsageState) => {
      store.set(key, structuredClone(value))
    }),
  }

  const ctx = { storage } as unknown as DurableObjectState

  return {
    ctx,
    storage,
    readState: () => store.get("usage-state"),
  }
}

function createReserveRequest() {
  return new Request("https://usage-gate.internal/reserve", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      userId: "user_123",
      requestKind: "generate",
      entitlements: {
        plan: "free",
        monthlyRequestLimit: 100,
        monthlyTokenLimit: 1000,
        concurrentRequestLimit: 10,
      },
    }),
  })
}

describe("usageGate", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-04-16T12:00:00.000Z"))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("drops expired leases before checking the concurrency limit", async () => {
    const { ctx, readState } = createContext({
      monthKey: "2026-04",
      requestCount: 4,
      activeCount: 2,
      leases: {
        stale_1: Date.now() - (10 * 60 * 1000),
        stale_2: Date.now() - (3 * 60 * 1000),
      },
    })
    const gate = new UsageGate(ctx, {})

    const response = await gate.fetch(createReserveRequest())
    const payload = await response.json<{ leaseId: string, requestCount: number }>()

    expect(response.status).toBe(200)
    expect(payload.requestCount).toBe(1)

    const state = readState()
    expect(state).toMatchObject({
      monthKey: "2026-04",
      requestCount: 5,
      activeCount: 1,
    })
    expect(Object.keys(state?.leases ?? {})).toHaveLength(1)
  })

  it("keeps active leases and returns 429 when the limit is reached", async () => {
    const { ctx, readState } = createContext({
      monthKey: "2026-04",
      requestCount: 4,
      activeCount: 10,
      leases: {
        active_1: Date.now() - 1000,
        active_2: Date.now() - 500,
        active_3: Date.now() - 400,
        active_4: Date.now() - 300,
        active_5: Date.now() - 200,
        active_6: Date.now() - 100,
        active_7: Date.now() - 90,
        active_8: Date.now() - 80,
        active_9: Date.now() - 70,
        active_10: Date.now() - 60,
      },
    })
    const gate = new UsageGate(ctx, {})

    const response = await gate.fetch(createReserveRequest())
    const payload = await response.json<{ error: string }>()

    expect(response.status).toBe(429)
    expect(payload.error).toBe("Too many concurrent requests")
    expect(readState()).toMatchObject({
      requestCount: 4,
      activeCount: 10,
    })
  })

  it("recomputes activeCount from the remaining leases on complete", async () => {
    const { ctx, readState } = createContext({
      monthKey: "2026-04",
      requestCount: 4,
      activeCount: 2,
      leases: {
        keep_me: Date.now() - 1000,
        remove_me: Date.now() - 500,
      },
    })
    const gate = new UsageGate(ctx, {})

    const response = await gate.fetch(new Request("https://usage-gate.internal/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ leaseId: "remove_me" }),
    }))

    expect(response.status).toBe(200)
    expect(readState()).toEqual({
      monthKey: "2026-04",
      requestCount: 4,
      activeCount: 1,
      leases: {
        keep_me: Date.now() - 1000,
      },
    })
  })
})
