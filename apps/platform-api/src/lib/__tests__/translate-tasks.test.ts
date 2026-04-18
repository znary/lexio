import type { SessionContext } from "../auth"
import type { Env } from "../env"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { HttpError } from "../http"

const syncUserFromClerkMock = vi.fn()
const createTranslationTaskMock = vi.fn()
const cancelTranslationTaskMock = vi.fn()
const getTranslationTaskByIdMock = vi.fn()
const buildMePayloadMock = vi.fn()
const markTranslationTaskDispatchedMock = vi.fn()
const getTranslationTaskForWorkerMock = vi.fn()
const getPlanForUserMock = vi.fn()
const markTranslationTaskRunningMock = vi.fn()
const completeTranslationTaskMock = vi.fn()
const failTranslationTaskMock = vi.fn()
const recordUsageMock = vi.fn()
const createUsageTaskMock = vi.fn()
const cancelUsageTaskMock = vi.fn()
const streamTranslationTaskMock = vi.fn()
const publishTranslationTaskEventMock = vi.fn()
const assignUsageTaskMock = vi.fn()
const kickUsageTaskMock = vi.fn()
const releaseUsageTaskMock = vi.fn()
const reserveUsageMock = vi.fn()
const completeUsageMock = vi.fn()
const forwardChatCompletionsMock = vi.fn()

vi.mock("../db", () => ({
  syncUserFromClerk: (...args: unknown[]) => syncUserFromClerkMock(...args),
  createTranslationTask: (...args: unknown[]) => createTranslationTaskMock(...args),
  cancelTranslationTask: (...args: unknown[]) => cancelTranslationTaskMock(...args),
  getTranslationTaskById: (...args: unknown[]) => getTranslationTaskByIdMock(...args),
  getTranslationTaskForWorker: (...args: unknown[]) => getTranslationTaskForWorkerMock(...args),
  getPlanForUser: (...args: unknown[]) => getPlanForUserMock(...args),
  markTranslationTaskRunning: (...args: unknown[]) => markTranslationTaskRunningMock(...args),
  completeTranslationTask: (...args: unknown[]) => completeTranslationTaskMock(...args),
  failTranslationTask: (...args: unknown[]) => failTranslationTaskMock(...args),
  recordUsage: (...args: unknown[]) => recordUsageMock(...args),
  buildMePayload: (...args: unknown[]) => buildMePayloadMock(...args),
  markTranslationTaskDispatched: (...args: unknown[]) => markTranslationTaskDispatchedMock(...args),
}))

vi.mock("../usage-gate", () => ({
  createUsageTask: (...args: unknown[]) => createUsageTaskMock(...args),
  cancelUsageTask: (...args: unknown[]) => cancelUsageTaskMock(...args),
  streamTranslationTask: (...args: unknown[]) => streamTranslationTaskMock(...args),
  publishTranslationTaskEvent: (...args: unknown[]) => publishTranslationTaskEventMock(...args),
  reserveUsage: (...args: unknown[]) => reserveUsageMock(...args),
  completeUsage: (...args: unknown[]) => completeUsageMock(...args),
  releaseUsageTask: (...args: unknown[]) => releaseUsageTaskMock(...args),
  assignUsageTask: (...args: unknown[]) => assignUsageTaskMock(...args),
  kickUsageTask: (...args: unknown[]) => kickUsageTaskMock(...args),
}))

vi.mock("../ai", () => ({
  forwardChatCompletions: (...args: unknown[]) => forwardChatCompletionsMock(...args),
}))

function createEnv(overrides: Partial<Env> = {}): Env {
  return {
    DB: {} as D1Database,
    USAGE_GATE: {} as DurableObjectNamespace,
    CLERK_SECRET_KEY: "sk_test_123",
    CLERK_PUBLISHABLE_KEY: "pk_test_123",
    CLERK_JWT_KEY: "jwt-public-key",
    CLERK_AUDIENCE: "",
    CLERK_AUTHORIZED_PARTIES: "https://lexio.example.com",
    AI_GATEWAY_BASE_URL: "https://gateway.example.com",
    AI_GATEWAY_API_KEY: "gateway-key",
    AI_GATEWAY_MODEL_FREE: "free-model",
    AI_GATEWAY_MODEL_PRO: "pro-model",
    PADDLE_WEBHOOK_SECRET: "whsec_123",
    PADDLE_PRO_PRICE_ID: "pri_123",
    ...overrides,
  }
}

const session: SessionContext = {
  clerkUserId: "clerk_user_1",
  sessionId: "session_1",
  tokenType: "clerk",
}

const queuedTask = {
  id: "task_1",
  userId: "user_1",
  clientRequestKey: "client_key_1",
  scene: "page",
  lane: "background" as const,
  mode: "generate" as const,
  ownerTabId: 12,
  text: "hello",
  sourceLanguage: "en",
  targetLanguage: "zh",
  systemPrompt: "system",
  prompt: "prompt",
  temperature: null,
  isBatch: false,
  status: "queued" as const,
  resultText: null,
  errorCode: null,
  errorMessage: null,
  createdAt: "2026-04-16T00:00:00.000Z",
  updatedAt: "2026-04-16T00:00:00.000Z",
  startedAt: null,
  finishedAt: null,
  canceledAt: null,
}

describe("translation task routes", () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("creates a translation task and returns dispatched status after enqueuing background work", async () => {
    syncUserFromClerkMock.mockResolvedValue({
      id: "user_1",
      clerkUserId: "clerk_user_1",
      email: "user@example.com",
      name: "User",
      avatarUrl: null,
    })
    buildMePayloadMock.mockResolvedValue({
      entitlements: {
        plan: "free",
        monthlyRequestLimit: 500,
        monthlyTokenLimit: 500000,
        concurrentRequestLimit: 10,
      },
    })
    createTranslationTaskMock.mockResolvedValue({
      created: true,
      task: queuedTask,
    })
    createUsageTaskMock.mockResolvedValue({
      taskId: "task_1",
      requestId: "request_1",
      leaseId: null,
      requestCount: 1,
      status: "dispatched",
      lane: "background",
      queuePosition: null,
    })
    markTranslationTaskDispatchedMock.mockResolvedValue({
      ...queuedTask,
      status: "dispatched",
    })

    const { handleTranslateTasksCreate } = await import("../../routes/translate")
    const response = await handleTranslateTasksCreate(new Request("https://example.com/v1/translate/tasks", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text: "hello",
        systemPrompt: "system",
        prompt: "prompt",
        targetLanguage: "zh",
        ownerTabId: 12,
      }),
    }), createEnv(), session)

    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toEqual({
      taskId: "task_1",
      status: "dispatched",
      lane: "background",
    })
    expect(createUsageTaskMock).toHaveBeenCalledWith(
      expect.anything(),
      "user_1",
      expect.objectContaining({
        concurrentRequestLimit: 10,
      }),
      "generate",
      expect.objectContaining({
        taskId: "task_1",
        ownerTabId: 12,
        lane: "background",
      }),
    )
  })

  it("cancels a translation task and returns ok", async () => {
    syncUserFromClerkMock.mockResolvedValue({
      id: "user_1",
      clerkUserId: "clerk_user_1",
      email: "user@example.com",
      name: "User",
      avatarUrl: null,
    })
    cancelTranslationTaskMock.mockResolvedValue({
      ...queuedTask,
      status: "canceled",
      errorCode: "canceled",
      errorMessage: "Translation task was canceled",
      canceledAt: "2026-04-16T00:01:00.000Z",
      finishedAt: "2026-04-16T00:01:00.000Z",
    })

    const { handleTranslateTaskCancel } = await import("../../routes/translate")
    const response = await handleTranslateTaskCancel(new Request("https://example.com/v1/translate/tasks/task_1/cancel", {
      method: "POST",
    }), createEnv(), session, "task_1")

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      ok: true,
      taskId: "task_1",
    })
    expect(cancelUsageTaskMock).toHaveBeenCalledWith(
      expect.anything(),
      "user_1",
      "task_1",
      expect.objectContaining({
        cancelReason: "client-canceled",
      }),
    )
    expect(publishTranslationTaskEventMock).toHaveBeenCalled()
  })

  it("subscribes to the managed task SSE stream for queued tasks", async () => {
    syncUserFromClerkMock.mockResolvedValue({
      id: "user_1",
      clerkUserId: "clerk_user_1",
      email: "user@example.com",
      name: "User",
      avatarUrl: null,
    })
    getTranslationTaskByIdMock.mockResolvedValue({
      ...queuedTask,
      status: "queued",
    })
    kickUsageTaskMock.mockResolvedValue({
      ok: true,
      enqueued: true,
      status: "queued",
    })
    streamTranslationTaskMock.mockResolvedValue(new Response("event: snapshot\ndata: {}\n\n", {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream",
      },
    }))

    const { handleTranslateTaskStream } = await import("../../routes/translate")
    const response = await handleTranslateTaskStream(new Request("https://example.com/v1/translate/tasks/task_1/stream", {
      method: "GET",
    }), createEnv(), session, "task_1")

    expect(response.status).toBe(200)
    expect(response.headers.get("Content-Type")).toContain("text/event-stream")
    expect(streamTranslationTaskMock).toHaveBeenCalledWith(
      expect.anything(),
      "user_1",
      expect.objectContaining({
        taskId: "task_1",
      }),
    )
    expect(kickUsageTaskMock).toHaveBeenCalledWith(
      expect.anything(),
      "user_1",
      {
        taskId: "task_1",
        requestId: "task_1",
      },
    )
  })

  it("does not re-kick dispatched background tasks before attaching SSE", async () => {
    syncUserFromClerkMock.mockResolvedValue({
      id: "user_1",
      clerkUserId: "clerk_user_1",
      email: "user@example.com",
      name: "User",
      avatarUrl: null,
    })
    getTranslationTaskByIdMock.mockResolvedValue({
      ...queuedTask,
      status: "dispatched",
    })
    kickUsageTaskMock.mockResolvedValue({
      ok: true,
      enqueued: true,
      status: "running",
    })
    streamTranslationTaskMock.mockResolvedValue(new Response("event: snapshot\ndata: {}\n\n", {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream",
      },
    }))

    const { handleTranslateTaskStream } = await import("../../routes/translate")
    const response = await handleTranslateTaskStream(new Request("https://example.com/v1/translate/tasks/task_1/stream", {
      method: "GET",
    }), createEnv(), session, "task_1")

    expect(response.status).toBe(200)
    expect(kickUsageTaskMock).toHaveBeenCalledWith(
      expect.anything(),
      "user_1",
      {
        taskId: "task_1",
        requestId: "task_1",
      },
    )
    expect(createUsageTaskMock).not.toHaveBeenCalled()
  })

  it("recreates orphaned dispatched background tasks when usage gate forgets them", async () => {
    syncUserFromClerkMock.mockResolvedValue({
      id: "user_1",
      clerkUserId: "clerk_user_1",
      email: "user@example.com",
      name: "User",
      avatarUrl: null,
    })
    getTranslationTaskByIdMock.mockResolvedValue({
      ...queuedTask,
      status: "dispatched",
    })
    getPlanForUserMock.mockResolvedValue("free")
    kickUsageTaskMock.mockResolvedValue({
      ok: true,
      enqueued: false,
    })
    createUsageTaskMock.mockResolvedValue({
      taskId: "task_1",
      requestId: "task_1",
      leaseId: null,
      requestCount: 1,
      status: "dispatched",
      lane: "background",
      queuePosition: 1,
      queueWaitMs: null,
      runMs: null,
      upstreamStatus: null,
      cancelReason: null,
      releaseReason: null,
    })
    streamTranslationTaskMock.mockResolvedValue(new Response("event: snapshot\ndata: {}\n\n", {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream",
      },
    }))

    const { handleTranslateTaskStream } = await import("../../routes/translate")
    const response = await handleTranslateTaskStream(new Request("https://example.com/v1/translate/tasks/task_1/stream", {
      method: "GET",
    }), createEnv(), session, "task_1")

    expect(response.status).toBe(200)
    expect(kickUsageTaskMock).toHaveBeenCalledWith(
      expect.anything(),
      "user_1",
      {
        taskId: "task_1",
        requestId: "task_1",
      },
    )
    expect(createUsageTaskMock).toHaveBeenCalledWith(
      expect.anything(),
      "user_1",
      expect.objectContaining({
        plan: "free",
      }),
      "generate",
      {
        requestId: "task_1",
        taskId: "task_1",
        scene: "page",
        ownerTabId: 12,
        lane: "background",
      },
    )
  })

  it("recreates orphaned queued background tasks when kick cannot enqueue them", async () => {
    syncUserFromClerkMock.mockResolvedValue({
      id: "user_1",
      clerkUserId: "clerk_user_1",
      email: "user@example.com",
      name: "User",
      avatarUrl: null,
    })
    getTranslationTaskByIdMock.mockResolvedValue({
      ...queuedTask,
      status: "queued",
    })
    getPlanForUserMock.mockResolvedValue("free")
    kickUsageTaskMock.mockResolvedValue({
      ok: true,
      enqueued: false,
      status: "queued",
    })
    buildMePayloadMock.mockResolvedValue({
      entitlements: {
        plan: "free",
        monthlyRequestLimit: 500,
        monthlyTokenLimit: 500000,
        concurrentRequestLimit: 10,
      },
    })
    createUsageTaskMock.mockResolvedValue({
      taskId: "task_1",
      requestId: "task_1",
      leaseId: null,
      requestCount: 1,
      status: "queued",
      lane: "background",
      queuePosition: 1,
      queueWaitMs: null,
      runMs: null,
      upstreamStatus: null,
      cancelReason: null,
      releaseReason: null,
    })
    streamTranslationTaskMock.mockResolvedValue(new Response("event: snapshot\ndata: {}\n\n", {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream",
      },
    }))

    const { handleTranslateTaskStream } = await import("../../routes/translate")
    const response = await handleTranslateTaskStream(new Request("https://example.com/v1/translate/tasks/task_1/stream", {
      method: "GET",
    }), createEnv(), session, "task_1")

    expect(response.status).toBe(200)
    expect(createUsageTaskMock).toHaveBeenCalledWith(
      expect.anything(),
      "user_1",
      expect.objectContaining({
        plan: "free",
      }),
      "generate",
      {
        requestId: "task_1",
        taskId: "task_1",
        scene: "page",
        ownerTabId: 12,
        lane: "background",
      },
    )
  })

  it("fails queued background tasks immediately when recovery hits the monthly request limit", async () => {
    syncUserFromClerkMock.mockResolvedValue({
      id: "user_1",
      clerkUserId: "clerk_user_1",
      email: "user@example.com",
      name: "User",
      avatarUrl: null,
    })
    getTranslationTaskByIdMock.mockResolvedValue({
      ...queuedTask,
      status: "queued",
    })
    kickUsageTaskMock.mockResolvedValue({
      ok: true,
      enqueued: false,
      status: "queued",
    })
    buildMePayloadMock.mockResolvedValue({
      entitlements: {
        plan: "free",
        monthlyRequestLimit: 500,
        monthlyTokenLimit: 500000,
        concurrentRequestLimit: 10,
      },
    })
    createUsageTaskMock.mockRejectedValue(new Error("Monthly request limit reached"))
    cancelUsageTaskMock.mockResolvedValue({
      taskId: "task_1",
      requestId: "task_1",
      leaseId: null,
      requestCount: 1,
      status: "canceled",
      lane: "background",
      queuePosition: null,
      queueWaitMs: null,
      runMs: null,
      upstreamStatus: null,
      cancelReason: "monthly-request-limit",
      releaseReason: null,
    })
    failTranslationTaskMock.mockResolvedValue({
      ...queuedTask,
      status: "failed",
      errorCode: "monthly_request_limit",
      errorMessage: "Monthly request limit reached",
      finishedAt: "2026-04-16T00:01:00.000Z",
      updatedAt: "2026-04-16T00:01:00.000Z",
    })

    const { handleTranslateTaskStream } = await import("../../routes/translate")
    const response = await handleTranslateTaskStream(new Request("https://example.com/v1/translate/tasks/task_1/stream", {
      method: "GET",
    }), createEnv(), session, "task_1")

    expect(response.status).toBe(200)
    await expect(response.text()).resolves.toContain("event: failed")
    expect(streamTranslationTaskMock).not.toHaveBeenCalled()
    expect(cancelUsageTaskMock).toHaveBeenCalledWith(
      expect.anything(),
      "user_1",
      "task_1",
      {
        cancelReason: "monthly-request-limit",
        requestId: "task_1",
      },
    )
    expect(failTranslationTaskMock).toHaveBeenCalledWith(
      expect.anything(),
      "user_1",
      "task_1",
      "Monthly request limit reached",
      "monthly_request_limit",
    )
    expect(publishTranslationTaskEventMock).toHaveBeenCalledWith(
      expect.anything(),
      "user_1",
      expect.objectContaining({
        taskId: "task_1",
        event: "failed",
        data: expect.objectContaining({
          taskId: "task_1",
          status: "failed",
          errorCode: "monthly_request_limit",
          errorMessage: "Monthly request limit reached",
        }),
      }),
    )
  })

  it("re-publishes a terminal task event if the task finishes while the SSE stream is attaching", async () => {
    syncUserFromClerkMock.mockResolvedValue({
      id: "user_1",
      clerkUserId: "clerk_user_1",
      email: "user@example.com",
      name: "User",
      avatarUrl: null,
    })
    getTranslationTaskByIdMock
      .mockResolvedValueOnce({
        ...queuedTask,
        status: "running",
      })
      .mockResolvedValueOnce({
        ...queuedTask,
        status: "completed",
        resultText: "translated",
        finishedAt: "2026-04-16T00:01:00.000Z",
      })
    streamTranslationTaskMock.mockResolvedValue(new Response("event: snapshot\ndata: {}\n\n", {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream",
      },
    }))

    const { handleTranslateTaskStream } = await import("../../routes/translate")
    const response = await handleTranslateTaskStream(new Request("https://example.com/v1/translate/tasks/task_1/stream", {
      method: "GET",
    }), createEnv(), session, "task_1")

    expect(response.status).toBe(200)
    expect(getTranslationTaskByIdMock).toHaveBeenCalledTimes(2)
    expect(publishTranslationTaskEventMock).toHaveBeenCalledWith(
      expect.anything(),
      "user_1",
      expect.objectContaining({
        taskId: "task_1",
        event: "completed",
        data: expect.objectContaining({
          taskId: "task_1",
          status: "completed",
          text: "translated",
        }),
      }),
    )
  })

  it("recreates missing usage-gate background tasks instead of failing the whole queue batch", async () => {
    assignUsageTaskMock.mockRejectedValue(new HttpError(404, "Task not found"))
    getTranslationTaskForWorkerMock.mockResolvedValue({
      ...queuedTask,
      status: "dispatched",
    })
    getPlanForUserMock.mockResolvedValue("free")
    createUsageTaskMock.mockResolvedValue({
      taskId: "task_1",
      requestId: "task_1",
      leaseId: null,
      requestCount: 1,
      status: "dispatched",
      lane: "background",
      queuePosition: 1,
      queueWaitMs: null,
      runMs: null,
      upstreamStatus: null,
      cancelReason: null,
      releaseReason: null,
    })

    const { handleManagedTranslationQueueMessage } = await import("../../routes/translate")

    await expect(handleManagedTranslationQueueMessage(createEnv(), {
      taskId: "task_1",
      requestId: "task_1",
      userId: "user_1",
      scene: "page",
      lane: "background",
      ownerTabId: 12,
    })).resolves.toBeUndefined()

    expect(createUsageTaskMock).toHaveBeenCalledWith(
      expect.anything(),
      "user_1",
      expect.objectContaining({
        plan: "free",
      }),
      "generate",
      {
        requestId: "task_1",
        taskId: "task_1",
        scene: "page",
        ownerTabId: 12,
        lane: "background",
      },
    )
    expect(forwardChatCompletionsMock).not.toHaveBeenCalled()
  })

  it("returns final SSE immediately for completed tasks", async () => {
    syncUserFromClerkMock.mockResolvedValue({
      id: "user_1",
      clerkUserId: "clerk_user_1",
      email: "user@example.com",
      name: "User",
      avatarUrl: null,
    })
    getTranslationTaskByIdMock.mockResolvedValue({
      ...queuedTask,
      status: "completed",
      resultText: "translated",
      finishedAt: "2026-04-16T00:01:00.000Z",
    })

    const { handleTranslateTaskStream } = await import("../../routes/translate")
    const response = await handleTranslateTaskStream(new Request("https://example.com/v1/translate/tasks/task_1/stream", {
      method: "GET",
    }), createEnv(), session, "task_1")

    expect(response.status).toBe(200)
    const text = await response.text()
    expect(text).toContain("event: completed")
    expect(text).toContain("\"taskId\":\"task_1\"")
    expect(text).toContain("\"status\":\"completed\"")
  })

  it("keeps the legacy sync translate handler available", async () => {
    syncUserFromClerkMock.mockResolvedValue({
      id: "user_1",
      clerkUserId: "clerk_user_1",
      email: "user@example.com",
      name: "User",
      avatarUrl: null,
    })
    buildMePayloadMock.mockResolvedValue({
      entitlements: {
        plan: "free",
        monthlyRequestLimit: 500,
        monthlyTokenLimit: 500000,
        concurrentRequestLimit: 10,
      },
      subscription: {
        plan: "free",
      },
    })
    reserveUsageMock.mockResolvedValue({
      leaseId: "lease_1",
      requestCount: 1,
    })
    completeUsageMock.mockResolvedValue(undefined)
    recordUsageMock.mockResolvedValue(undefined)
    forwardChatCompletionsMock.mockResolvedValue(new Response(JSON.stringify({
      choices: [
        {
          message: {
            content: "translated",
          },
        },
      ],
      usage: {
        prompt_tokens: 3,
        completion_tokens: 2,
      },
    })))

    const { handleTranslateText } = await import("../../routes/translate")
    const response = await handleTranslateText(new Request("https://example.com/v1/translate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text: "hello",
        systemPrompt: "system",
        prompt: "prompt",
        scene: "page",
      }),
    }), createEnv(), session)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      text: "translated",
    })
  })
})
