import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const handleManagedTranslationQueueMessageMock = vi.fn()

vi.mock("../durable-objects/usage-gate", () => ({
  UsageGate: class {},
}))

vi.mock("../lib/auth", () => ({
  mintExtensionToken: vi.fn(),
  requireSession: vi.fn(),
}))

vi.mock("../lib/http", () => ({
  handleRouteError: vi.fn(),
  noContent: vi.fn(),
}))

vi.mock("../routes/ai", () => ({
  handleAiGenerate: vi.fn(),
  handleAiStream: vi.fn(),
  handleOpenAiChatCompletions: vi.fn(),
}))

vi.mock("../routes/auth", () => ({
  handleExchangeExtensionToken: vi.fn(),
}))

vi.mock("../routes/health", () => ({
  handleHealthCheck: vi.fn(),
}))

vi.mock("../routes/me", () => ({
  handleMe: vi.fn(),
}))

vi.mock("../routes/paddle", () => ({
  handlePaddleWebhook: vi.fn(),
}))

vi.mock("../routes/sync", () => ({
  handleSyncPull: vi.fn(),
  handleSyncPush: vi.fn(),
}))

vi.mock("../routes/translate", () => ({
  handleManagedTranslationQueueMessage: handleManagedTranslationQueueMessageMock,
  handleTranslateStream: vi.fn(),
  handleTranslateTaskCancel: vi.fn(),
  handleTranslateTasksCreate: vi.fn(),
  handleTranslateTaskStream: vi.fn(),
  handleTranslateText: vi.fn(),
}))

vi.mock("../routes/vocabulary", () => ({
  handleVocabularyClear: vi.fn(),
  handleVocabularyCreate: vi.fn(),
  handleVocabularyDelete: vi.fn(),
  handleVocabularyList: vi.fn(),
  handleVocabularyUpdate: vi.fn(),
}))

function flushMicrotasks() {
  return new Promise(resolve => setTimeout(resolve, 0))
}

describe("platform queue handler", () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    vi.spyOn(console, "warn").mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it("starts later queue messages without waiting for earlier messages to finish", async () => {
    let resolveFirst!: () => void
    let resolveSecond!: () => void

    handleManagedTranslationQueueMessageMock
      .mockImplementationOnce(() => new Promise<void>((resolve) => {
        resolveFirst = resolve
      }))
      .mockImplementationOnce(() => new Promise<void>((resolve) => {
        resolveSecond = resolve
      }))

    const { default: handler } = await import("../index")
    const queuePromise = handler.queue?.({
      messages: [
        { body: { taskId: "task-1" } },
        { body: { taskId: "task-2" } },
      ],
    } as any, {} as any)

    await flushMicrotasks()

    expect(handleManagedTranslationQueueMessageMock).toHaveBeenCalledTimes(2)

    resolveFirst()
    resolveSecond()
    await expect(queuePromise).resolves.toBeUndefined()
  })

  it("emits a queue batch summary with duplicate task counts", async () => {
    handleManagedTranslationQueueMessageMock.mockResolvedValue(undefined)

    const { default: handler } = await import("../index")
    await handler.queue?.({
      messages: [
        { body: { taskId: "task-1" } },
        { body: { taskId: "task-1" } },
        { body: { taskId: "task-2" } },
      ],
    } as any, {} as any)

    expect(console.warn).toHaveBeenCalledWith(expect.objectContaining({
      namespace: "usage-gate-queue-batch",
      event: "complete",
      messageCount: 3,
      uniqueTaskCount: 2,
      duplicateMessageCount: 1,
      failedCount: 0,
    }))
  })
})
