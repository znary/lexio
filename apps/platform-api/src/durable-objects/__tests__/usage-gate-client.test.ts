import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import handler from "../../index"
import { completeUsage, reserveUsage } from "../../lib/usage-gate"

function createEnv(fetchMock: ReturnType<typeof vi.fn>) {
  const stub = {
    fetch: fetchMock,
  }

  const namespace = {
    idFromName: vi.fn(() => "usage-gate-id"),
    get: vi.fn(() => stub),
  }

  return {
    USAGE_GATE: namespace as unknown as DurableObjectNamespace,
  }
}

describe("usage-gate client helpers", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-04-16T12:00:00.000Z"))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it("waits for a queued task to be assigned before returning a lease", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const path = new URL(String(input)).pathname

      if (path === "/tasks/create") {
        return Response.json({
          taskId: "task-1",
          requestId: "request-1",
          status: "queued",
          lane: "interactive",
          queuePosition: 1,
          queueWaitMs: null,
          leaseId: null,
          requestCount: 1,
        })
      }

      if (path === "/tasks/assign") {
        const attempts = fetchMock.mock.calls.filter(call => new URL(String(call[0])).pathname === "/tasks/assign").length
        if (attempts === 1) {
          return Response.json({
            taskId: "task-1",
            requestId: "request-1",
            status: "queued",
            lane: "interactive",
            queuePosition: 1,
            queueWaitMs: null,
            leaseId: null,
            requestCount: 1,
          })
        }

        return Response.json({
          taskId: "task-1",
          requestId: "request-1",
          status: "running",
          lane: "interactive",
          queuePosition: null,
          queueWaitMs: 120,
          leaseId: "lease-1",
          requestCount: 1,
        })
      }

      throw new Error(`Unexpected path: ${path}`)
    })
    const env = createEnv(fetchMock) as unknown as Parameters<typeof reserveUsage>[0]

    const promise = reserveUsage(env, "user_123", {
      plan: "free",
      monthlyRequestLimit: 100,
      monthlyTokenLimit: 1000,
      concurrentRequestLimit: 4,
    }, "generate", {
      scene: "translation-hub",
      ownerTabId: 12,
    })

    await vi.runAllTimersAsync()
    const lease = await promise

    expect(lease).toEqual({
      taskId: "task-1",
      requestId: "request-1",
      leaseId: "lease-1",
      requestCount: 1,
    })
    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        method: "POST",
      }),
    )
  })

  it("releases a lease through the new release endpoint", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(String(input)).pathname
      expect(path).toBe("/tasks/release")
      return Response.json({ ok: true, status: "released" })
    })
    const env = createEnv(fetchMock) as unknown as Parameters<typeof completeUsage>[0]

    await completeUsage(env, "user_123", "lease-1", {
      releaseReason: "completed",
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe("usage-gate queue consumer", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-04-16T12:00:00.000Z"))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it("re-checks cancel status before starting a queued task", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input))
      expect(url.pathname).toBe("/tasks/assign")
      return Response.json({
        taskId: "task-queued",
        requestId: "request-queued",
        status: "canceled",
        lane: "interactive",
        queuePosition: null,
        queueWaitMs: null,
        leaseId: null,
        requestCount: 1,
      })
    })

    const env = createEnv(fetchMock) as any

    await expect(handler.queue?.({
      queue: "usage-gate-background",
      messages: [
        {
          body: {
            taskId: "task-queued",
            requestId: "request-queued",
            userId: "user_123",
            scene: "translation-hub",
            lane: "interactive",
            ownerTabId: 12,
          },
        },
      ],
    } as never, env, {} as never)).resolves.toBeUndefined()

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("does not fail the whole queue batch when a task is still queued", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input))
      expect(url.pathname).toBe("/tasks/assign")
      return Response.json({
        taskId: "task-queued",
        requestId: "request-queued",
        status: "queued",
        lane: "background",
        queuePosition: 3,
        queueWaitMs: null,
        leaseId: null,
        requestCount: 1,
      })
    })

    const env = createEnv(fetchMock) as any

    await expect(handler.queue?.({
      queue: "usage-gate-background",
      messages: [
        {
          body: {
            taskId: "task-queued",
            requestId: "request-queued",
            userId: "user_123",
            scene: "translation-hub",
            lane: "background",
            ownerTabId: 12,
          },
        },
      ],
    } as never, env, {} as never)).resolves.toBeUndefined()

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
