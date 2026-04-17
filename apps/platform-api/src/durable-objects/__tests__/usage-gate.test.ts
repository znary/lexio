import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { UsageGate } from "../usage-gate"

type UsageLane = "interactive" | "background"
type UsageTaskStatus = "queued" | "running" | "released" | "canceled" | "expired"

interface StoredUsageTask {
  taskId: string
  requestId: string
  userId: string
  scene: string | null
  lane: UsageLane
  status: UsageTaskStatus
  ownerTabId: number | null
  requestKind: string
  concurrentRequestLimit: number
  createdAt: number
  queuedAt: number | null
  startedAt: number | null
  releasedAt: number | null
  canceledAt: number | null
  leaseId: string | null
  cancelReason: string | null
  releaseReason: string | null
  upstreamStatus: number | null
}

interface StoredUsageState {
  monthKey: string
  requestCount: number
  activeCount: number
  interactiveActiveCount: number
  backgroundActiveCount: number
  queueOrder: string[]
  tasks: Record<string, StoredUsageTask>
  leases: Record<string, number>
}

function createTask(taskId: string, lane: UsageLane, status: UsageTaskStatus, startedAt: number): StoredUsageTask {
  return {
    taskId,
    requestId: `${taskId}-request`,
    userId: "user_123",
    scene: "translation-hub",
    lane,
    status,
    ownerTabId: 12,
    requestKind: "generate",
    concurrentRequestLimit: 4,
    createdAt: startedAt,
    queuedAt: status === "queued" ? startedAt : null,
    startedAt: status === "running" ? startedAt : null,
    releasedAt: null,
    canceledAt: null,
    leaseId: status === "running" ? `${taskId}-lease` : null,
    cancelReason: null,
    releaseReason: null,
    upstreamStatus: null,
  }
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

  const queue = {
    send: vi.fn(async () => undefined),
  }

  const ctx = { storage } as unknown as DurableObjectState
  const env = {
    USAGE_GATE_BACKGROUND_QUEUE: queue,
  } as unknown as { USAGE_GATE_BACKGROUND_QUEUE: typeof queue }

  return {
    ctx,
    env,
    queue,
    readState: () => store.get("usage-state"),
  }
}

function createRequest(path: string, body: Record<string, unknown>) {
  return new Request(`https://usage-gate.internal${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

function createTaskRequest(taskId?: string, lane: UsageLane = "interactive") {
  return createRequest("/tasks/create", {
    taskId,
    userId: "user_123",
    requestId: `${taskId ?? "task"}-request`,
    requestKind: "generate",
    scene: "translation-hub",
    ownerTabId: 12,
    lane,
    entitlements: {
      plan: "free",
      monthlyRequestLimit: 100,
      monthlyTokenLimit: 1000,
      concurrentRequestLimit: 4,
    },
  })
}

describe("usageGate scheduler", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-04-16T12:00:00.000Z"))
    vi.spyOn(console, "warn").mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it("assigns an interactive task immediately when a slot is open", async () => {
    const { ctx, env, queue, readState } = createContext()
    const gate = new UsageGate(ctx, env)

    const response = await gate.fetch(createTaskRequest("task-1"))
    const payload = await response.json() as {
      taskId: string
      requestId: string
      leaseId: string
      lane: UsageLane
      status: UsageTaskStatus
      queuePosition: number | null
      queueWaitMs: number | null
    }

    expect(response.status).toBe(200)
    expect(payload.status).toBe("running")
    expect(payload.lane).toBe("interactive")
    expect(payload.queuePosition).toBeNull()
    expect(payload.queueWaitMs).toBe(0)
    expect(payload.leaseId).toBeTruthy()
    expect(queue.send).not.toHaveBeenCalled()
    expect(readState()).toMatchObject({
      monthKey: "2026-04",
      requestCount: 1,
      activeCount: 1,
      interactiveActiveCount: 1,
      backgroundActiveCount: 0,
    })
    expect(console.warn).toHaveBeenCalledWith(expect.objectContaining({
      requestId: payload.requestId,
      taskId: payload.taskId,
      userId: "user_123",
      scene: "translation-hub",
      lane: "interactive",
      status: "running",
      ownerTabId: 12,
      queuePosition: null,
      queueWaitMs: 0,
      runMs: null,
      upstreamStatus: null,
      cancelReason: null,
      releaseReason: null,
    }))
  })

  it("queues a task when both lanes are full and emits a queue message", async () => {
    const now = Date.now()
    const { ctx, env, queue, readState } = createContext({
      monthKey: "2026-04",
      requestCount: 4,
      activeCount: 4,
      interactiveActiveCount: 2,
      backgroundActiveCount: 2,
      queueOrder: [],
      tasks: {
        interactive_1: createTask("interactive_1", "interactive", "running", now - 1000),
        interactive_2: createTask("interactive_2", "interactive", "running", now - 900),
        background_1: createTask("background_1", "background", "running", now - 800),
        background_2: createTask("background_2", "background", "running", now - 700),
      },
      leases: {
        interactive_1_lease: now - 1000,
        interactive_2_lease: now - 900,
        background_1_lease: now - 800,
        background_2_lease: now - 700,
      },
    })
    const gate = new UsageGate(ctx, env)

    const response = await gate.fetch(createTaskRequest("task-queued", "background"))
    const payload = await response.json() as {
      taskId: string
      status: UsageTaskStatus
      lane: UsageLane
      queuePosition: number | null
    }

    expect(response.status).toBe(200)
    expect(payload.status).toBe("queued")
    expect(payload.lane).toBe("background")
    expect(payload.queuePosition).toBe(1)
    expect(queue.send).toHaveBeenCalledTimes(1)
    expect(queue.send).toHaveBeenCalledWith(expect.objectContaining({
      taskId: payload.taskId,
      requestId: "task-queued-request",
      userId: "user_123",
      scene: "translation-hub",
      lane: "background",
      ownerTabId: 12,
    }))
    expect(readState()).toMatchObject({
      requestCount: 5,
      activeCount: 4,
      interactiveActiveCount: 2,
      backgroundActiveCount: 2,
      queueOrder: [payload.taskId],
    })
  })

  it("falls back to queued when a background task cannot be enqueued", async () => {
    const { ctx, env, queue, readState } = createContext()
    queue.send.mockRejectedValueOnce(new Error("queue unavailable"))
    vi.spyOn(console, "error").mockImplementation(() => undefined)
    const gate = new UsageGate(ctx, env)

    const response = await gate.fetch(createTaskRequest("task-enqueue-failed", "background"))
    const payload = await response.json() as {
      taskId: string
      status: UsageTaskStatus
      lane: UsageLane
      queuePosition: number | null
      leaseId: string | null
    }

    expect(response.status).toBe(200)
    expect(payload).toMatchObject({
      taskId: "task-enqueue-failed",
      status: "queued",
      lane: "background",
      queuePosition: 1,
      leaseId: null,
    })
    expect(readState()).toMatchObject({
      activeCount: 0,
      interactiveActiveCount: 0,
      backgroundActiveCount: 0,
      queueOrder: ["task-enqueue-failed"],
    })
  })

  it("does not let a background task take an interactive slot", async () => {
    const now = Date.now()
    const { ctx, env, queue, readState } = createContext({
      monthKey: "2026-04",
      requestCount: 3,
      activeCount: 3,
      interactiveActiveCount: 1,
      backgroundActiveCount: 2,
      queueOrder: [],
      tasks: {
        interactive_1: createTask("interactive_1", "interactive", "running", now - 1000),
        background_1: createTask("background_1", "background", "running", now - 900),
        background_2: createTask("background_2", "background", "running", now - 800),
      },
      leases: {
        "interactive_1-lease": now - 1000,
        "background_1-lease": now - 900,
        "background_2-lease": now - 800,
      },
    })
    const gate = new UsageGate(ctx, env)

    const response = await gate.fetch(createTaskRequest("task-background", "background"))
    const payload = await response.json() as {
      taskId: string
      status: UsageTaskStatus
      lane: UsageLane
      queuePosition: number | null
      leaseId: string | null
    }

    expect(response.status).toBe(200)
    expect(payload).toMatchObject({
      taskId: "task-background",
      status: "queued",
      lane: "background",
      queuePosition: 1,
      leaseId: null,
    })
    expect(queue.send).toHaveBeenCalledTimes(1)
    expect(readState()).toMatchObject({
      activeCount: 3,
      interactiveActiveCount: 1,
      backgroundActiveCount: 2,
      queueOrder: ["task-background"],
    })
  })

  it("does not let an interactive task take a background slot", async () => {
    const now = Date.now()
    const { ctx, env, queue, readState } = createContext({
      monthKey: "2026-04",
      requestCount: 3,
      activeCount: 3,
      interactiveActiveCount: 2,
      backgroundActiveCount: 1,
      queueOrder: [],
      tasks: {
        interactive_1: createTask("interactive_1", "interactive", "running", now - 1000),
        interactive_2: createTask("interactive_2", "interactive", "running", now - 900),
        background_1: createTask("background_1", "background", "running", now - 800),
      },
      leases: {
        "interactive_1-lease": now - 1000,
        "interactive_2-lease": now - 900,
        "background_1-lease": now - 800,
      },
    })
    const gate = new UsageGate(ctx, env)

    const response = await gate.fetch(createTaskRequest("task-interactive", "interactive"))
    const payload = await response.json() as {
      taskId: string
      status: UsageTaskStatus
      lane: UsageLane
      queuePosition: number | null
      leaseId: string | null
    }

    expect(response.status).toBe(200)
    expect(payload).toMatchObject({
      taskId: "task-interactive",
      status: "queued",
      lane: "interactive",
      queuePosition: 1,
      leaseId: null,
    })
    expect(queue.send).not.toHaveBeenCalled()
    expect(readState()).toMatchObject({
      activeCount: 3,
      interactiveActiveCount: 2,
      backgroundActiveCount: 1,
      queueOrder: ["task-interactive"],
    })
  })

  it("returns 429 when the queue is already full", async () => {
    const now = Date.now()
    const queuedTaskIds = Array.from({ length: 100 }, (_, index) => `queued_${index + 1}`)
    const runningTasks = {
      interactive_1: createTask("interactive_1", "interactive", "running", now - 1000),
      interactive_2: createTask("interactive_2", "interactive", "running", now - 900),
      background_1: createTask("background_1", "background", "running", now - 800),
      background_2: createTask("background_2", "background", "running", now - 700),
    }

    const tasks = Object.fromEntries(queuedTaskIds.map((taskId, index) => [
      taskId,
      {
        taskId,
        requestId: `${taskId}-request`,
        userId: "user_123",
        scene: "translation-hub",
        lane: "interactive" as const,
        status: "queued" as const,
        ownerTabId: 12,
        requestKind: "generate",
        concurrentRequestLimit: 4,
        createdAt: now - index,
        queuedAt: now - index,
        startedAt: null,
        releasedAt: null,
        canceledAt: null,
        leaseId: null,
        cancelReason: null,
        releaseReason: null,
        upstreamStatus: null,
      },
    ]))

    const { ctx, env, queue } = createContext({
      monthKey: "2026-04",
      requestCount: 4,
      activeCount: 4,
      interactiveActiveCount: 2,
      backgroundActiveCount: 2,
      queueOrder: queuedTaskIds,
      tasks: {
        ...runningTasks,
        ...(tasks as Record<string, StoredUsageTask>),
      },
      leases: {
        "interactive_1-lease": now - 1000,
        "interactive_2-lease": now - 900,
        "background_1-lease": now - 800,
        "background_2-lease": now - 700,
      },
    })
    const gate = new UsageGate(ctx, env)

    const response = await gate.fetch(createTaskRequest("task-overflow"))
    const payload = await response.json() as { error: string }

    expect(response.status).toBe(429)
    expect(payload.error).toBe("Background queue is full")
    expect(queue.send).not.toHaveBeenCalled()
  })

  it("releases a task and lets the next queued task take the slot", async () => {
    const now = Date.now()
    const { ctx, env, readState } = createContext({
      monthKey: "2026-04",
      requestCount: 2,
      activeCount: 2,
      interactiveActiveCount: 2,
      backgroundActiveCount: 0,
      queueOrder: ["queued_1"],
      tasks: {
        running_1: createTask("running_1", "interactive", "running", now - 1000),
        running_2: createTask("running_2", "interactive", "running", now - 900),
        queued_1: {
          ...createTask("queued_1", "interactive", "queued", now - 500),
          leaseId: null,
        },
      },
      leases: {
        "running_1-lease": now - 1000,
        "running_2-lease": now - 900,
      },
    })
    const gate = new UsageGate(ctx, env)

    const releaseResponse = await gate.fetch(createRequest("/tasks/release", {
      leaseId: "running_1-lease",
      releaseReason: "completed",
    }))

    expect(releaseResponse.status).toBe(200)
    expect(readState()).toMatchObject({
      activeCount: 1,
      interactiveActiveCount: 1,
    })

    const assignResponse = await gate.fetch(createRequest("/tasks/assign", {
      taskId: "queued_1",
    }))
    const assignPayload = await assignResponse.json() as {
      taskId: string
      leaseId: string
      lane: UsageLane
      status: UsageTaskStatus
      queueWaitMs: number | null
    }

    expect(assignResponse.status).toBe(200)
    expect(assignPayload).toMatchObject({
      taskId: "queued_1",
      lane: "interactive",
      status: "running",
      queueWaitMs: 500,
    })
  })

  it("wakes the next queued background task when a background slot is released", async () => {
    const now = Date.now()
    const { ctx, env, queue, readState } = createContext({
      monthKey: "2026-04",
      requestCount: 2,
      activeCount: 1,
      interactiveActiveCount: 0,
      backgroundActiveCount: 1,
      queueOrder: ["queued_background"],
      tasks: {
        running_background: createTask("running_background", "background", "running", now - 1000),
        queued_background: {
          ...createTask("queued_background", "background", "queued", now - 500),
          leaseId: null,
        },
      },
      leases: {
        "running_background-lease": now - 1000,
      },
    })
    const gate = new UsageGate(ctx, env)

    const response = await gate.fetch(createRequest("/tasks/release", {
      leaseId: "running_background-lease",
      releaseReason: "completed",
    }))
    const payload = await response.json() as { status: UsageTaskStatus }

    expect(response.status).toBe(200)
    expect(payload.status).toBe("released")
    expect(queue.send).toHaveBeenCalledTimes(1)
    expect(queue.send).toHaveBeenCalledWith(expect.objectContaining({
      taskId: "queued_background",
      requestId: "queued_background-request",
      userId: "user_123",
      lane: "background",
      ownerTabId: 12,
    }))
    expect(readState()).toMatchObject({
      activeCount: 0,
      interactiveActiveCount: 0,
      backgroundActiveCount: 0,
      queueOrder: ["queued_background"],
    })
  })

  it("expires a lease and frees the slot for another queued task", async () => {
    const now = Date.now()
    const { ctx, env, readState } = createContext({
      monthKey: "2026-04",
      requestCount: 2,
      activeCount: 2,
      interactiveActiveCount: 2,
      backgroundActiveCount: 0,
      queueOrder: ["queued_1"],
      tasks: {
        running_1: createTask("running_1", "interactive", "running", now - 3 * 60 * 1000),
        running_2: createTask("running_2", "interactive", "running", now - 900),
        queued_1: {
          ...createTask("queued_1", "interactive", "queued", now - 500),
          leaseId: null,
        },
      },
      leases: {
        "running_1-lease": now - 3 * 60 * 1000,
        "running_2-lease": now - 900,
      },
    })
    const gate = new UsageGate(ctx, env)

    const expireResponse = await gate.fetch(createRequest("/tasks/lease-expired", {
      leaseId: "running_1-lease",
    }))

    const expirePayload = await expireResponse.json() as { status: UsageTaskStatus }

    expect(expireResponse.status).toBe(200)
    expect(expirePayload.status).toBe("expired")
    expect(readState()).toMatchObject({
      activeCount: 1,
      interactiveActiveCount: 1,
    })
  })
})
