import type { ProviderConfig } from "@/types/config/provider"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { DEFAULT_CONFIG } from "@/utils/constants/config"

const onMessageMock = vi.fn()
const sendMessageMock = vi.fn()
const ensureInitializedConfigMock = vi.fn()
const translateWithManagedPlatformMock = vi.fn()
const generateArticleSummaryMock = vi.fn()
const putBatchRequestRecordMock = vi.fn()
const articleSummaryCacheGetMock = vi.fn()
const articleSummaryCachePutMock = vi.fn()
const translationCacheGetMock = vi.fn()
const translationCachePutMock = vi.fn()
const getManagedTranslationTaskScopeMock = vi.fn()
const getTranslatePromptMock = vi.fn()
const getSubtitlesTranslatePromptMock = vi.fn()

vi.mock("@/utils/message", () => ({
  onMessage: onMessageMock,
  sendMessage: sendMessageMock,
}))

vi.mock("../config", () => ({
  ensureInitializedConfig: ensureInitializedConfigMock,
}))

vi.mock("@/utils/platform/api", () => ({
  translateWithManagedPlatform: translateWithManagedPlatformMock,
}))

vi.mock("@/utils/content/summary", () => ({
  generateArticleSummary: generateArticleSummaryMock,
}))

vi.mock("@/utils/prompts/translate", () => ({
  getTranslatePrompt: getTranslatePromptMock,
}))

vi.mock("@/utils/prompts/subtitles", () => ({
  getSubtitlesTranslatePrompt: getSubtitlesTranslatePromptMock,
}))

vi.mock("@/utils/batch-request-record", () => ({
  putBatchRequestRecord: putBatchRequestRecordMock,
}))

vi.mock("@/utils/db/dexie/db", () => ({
  db: {
    articleSummaryCache: {
      get: articleSummaryCacheGetMock,
      put: articleSummaryCachePutMock,
    },
    translationCache: {
      get: translationCacheGetMock,
      put: translationCachePutMock,
    },
  },
}))

vi.mock("../managed-translation-tasks", () => ({
  getManagedTranslationTaskScope: getManagedTranslationTaskScopeMock,
}))

function getRegisteredMessageHandler(name: string) {
  const registration = onMessageMock.mock.calls.find(call => call[0] === name)
  if (!registration) {
    throw new Error(`Message handler not registered: ${name}`)
  }
  return registration[1] as (message: { data: Record<string, unknown> }) => Promise<unknown>
}

const llmProvider: ProviderConfig = {
  id: "openai-default",
  name: "OpenAI",
  provider: "openai",
  enabled: true,
  apiKey: "sk-test",
  model: { model: "gpt-5-mini", isCustomModel: false, customModel: null },
}

describe("translation queue helpers", () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()

    ensureInitializedConfigMock.mockResolvedValue({
      ...DEFAULT_CONFIG,
      translate: {
        ...DEFAULT_CONFIG.translate,
        enableAIContentAware: true,
      },
      videoSubtitles: {
        ...DEFAULT_CONFIG.videoSubtitles,
        providerId: llmProvider.id,
        requestQueueConfig: {
          rate: 10,
          capacity: 10,
        },
        batchQueueConfig: {
          maxCharactersPerBatch: 1000,
          maxItemsPerBatch: 1,
        },
      },
    })

    getTranslatePromptMock.mockResolvedValue({
      systemPrompt: "system prompt",
      prompt: "page prompt",
    })
    getSubtitlesTranslatePromptMock.mockResolvedValue({
      systemPrompt: "system prompt",
      prompt: "subtitle prompt",
    })
    translateWithManagedPlatformMock.mockImplementation(async (_payload: unknown, options?: { onTaskCreated?: (taskId: string) => void }) => {
      options?.onTaskCreated?.("task-123")
      return "translated subtitle"
    })
    generateArticleSummaryMock.mockResolvedValue("Generated summary")
    putBatchRequestRecordMock.mockResolvedValue(undefined)
    articleSummaryCacheGetMock.mockResolvedValue(undefined)
    articleSummaryCachePutMock.mockResolvedValue(undefined)
    translationCacheGetMock.mockResolvedValue(undefined)
    translationCachePutMock.mockResolvedValue(undefined)
    getManagedTranslationTaskScopeMock.mockImplementation((tabId: number) => {
      const controller = new AbortController()
      return {
        signal: controller.signal,
        registerTaskId: vi.fn(),
        completeTask: vi.fn(),
        tabId,
      }
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it(
    "routes only llm providers through the batch queue",
    async () => {
      const { shouldUseBatchQueue } = await import("../translation-queues")

      const deeplProvider: ProviderConfig = {
        id: "deepl",
        name: "DeepL",
        provider: "deepl",
        enabled: true,
        apiKey: "key",
      }

      const deeplxProvider: ProviderConfig = {
        id: "deeplx",
        name: "DeepLX",
        provider: "deeplx",
        enabled: true,
        baseURL: "https://api.deeplx.org",
      }

      expect(shouldUseBatchQueue(deeplProvider)).toBe(false)
      expect(shouldUseBatchQueue(deeplxProvider)).toBe(false)
      expect(shouldUseBatchQueue(llmProvider)).toBe(true)
    },
    15_000,
  )

  it("passes subtitle summary through the translation queue without generating a new summary", async () => {
    const { setUpSubtitlesTranslationQueue } = await import("../translation-queues")
    await setUpSubtitlesTranslationQueue()

    const handler = getRegisteredMessageHandler("enqueueSubtitlesTranslateRequest")
    const result = await handler({
      sender: {
        tab: {
          id: 12,
        },
      },
      data: {
        text: "hello",
        langConfig: DEFAULT_CONFIG.language,
        providerConfig: llmProvider,
        scheduleAt: Date.now(),
        hash: "subtitle-hash",
        videoTitle: "Video title",
        summary: "Ready summary",
      },
    } as any)

    expect(result).toBe("translated subtitle")
    expect(generateArticleSummaryMock).not.toHaveBeenCalled()
    expect(translateWithManagedPlatformMock).toHaveBeenCalledWith(
      expect.objectContaining({
        text: "hello",
        scene: "subtitles",
      }),
      expect.objectContaining({
        signal: expect.any(Object),
        onTaskCreated: expect.any(Function),
      }),
    )
  })

  it("passes webpage context through the translation queue without generating a new summary", async () => {
    const { setUpWebPageTranslationQueue } = await import("../translation-queues")
    await setUpWebPageTranslationQueue()

    const handler = getRegisteredMessageHandler("enqueueTranslateRequest")
    const result = await handler({
      sender: {
        tab: {
          id: 12,
        },
      },
      data: {
        text: "hello",
        langConfig: DEFAULT_CONFIG.language,
        providerConfig: llmProvider,
        scheduleAt: Date.now(),
        hash: "webpage-hash",
        webTitle: "Page title",
        webContent: "Page body",
        webSummary: "Ready summary",
      },
    } as any)

    expect(result).toBe("translated subtitle")
    expect(generateArticleSummaryMock).not.toHaveBeenCalled()
    expect(translateWithManagedPlatformMock).toHaveBeenCalledWith(
      expect.objectContaining({
        text: "hello",
        scene: "page",
        isBatch: true,
      }),
      expect.objectContaining({
        signal: expect.any(Object),
        onTaskCreated: expect.any(Function),
      }),
    )
  })

  it("forwards managed task state changes back to the content script", async () => {
    translateWithManagedPlatformMock.mockImplementationOnce(async (_payload: unknown, options?: {
      onTaskCreated?: (taskId: string) => void
      onStatusChange?: (update: { state: string, taskId?: string | null }) => void
    }) => {
      options?.onTaskCreated?.("task-123")
      options?.onStatusChange?.({ state: "queued", taskId: "task-123" })
      options?.onStatusChange?.({ state: "running", taskId: "task-123" })
      options?.onStatusChange?.({ state: "completed", taskId: "task-123" })
      return "translated subtitle"
    })

    const { setUpWebPageTranslationQueue } = await import("../translation-queues")
    await setUpWebPageTranslationQueue()

    const handler = getRegisteredMessageHandler("enqueueTranslateRequest")
    await handler({
      sender: {
        tab: {
          id: 12,
        },
      },
      data: {
        text: "hello",
        langConfig: DEFAULT_CONFIG.language,
        providerConfig: llmProvider,
        scheduleAt: Date.now(),
        hash: "webpage-hash",
        webTitle: "Page title",
        webContent: "Page body",
        webSummary: "Ready summary",
      },
    } as any)

    expect(sendMessageMock).toHaveBeenCalledWith(
      "notifyManagedTranslationTaskStatus",
      {
        statusKey: "webpage-hash",
        state: "queued",
        taskId: "task-123",
      },
      12,
    )
    expect(sendMessageMock).toHaveBeenCalledWith(
      "notifyManagedTranslationTaskStatus",
      {
        statusKey: "webpage-hash",
        state: "running",
        taskId: "task-123",
      },
      12,
    )
    expect(sendMessageMock).toHaveBeenCalledWith(
      "notifyManagedTranslationTaskStatus",
      {
        statusKey: "webpage-hash",
        state: "completed",
        taskId: "task-123",
      },
      12,
    )
  })

  it("keeps the managed translation queue cap at the free-tier limit", async () => {
    const {
      MANAGED_TRANSLATION_MAX_CONCURRENCY,
      MANAGED_TRANSLATION_QUEUE_TIMEOUT_MS,
    } = await import("../translation-queues")

    expect(MANAGED_TRANSLATION_MAX_CONCURRENCY).toBe(100)
    expect(MANAGED_TRANSLATION_QUEUE_TIMEOUT_MS).toBe(180_000)
  })

  it("recognizes local request-queue timeout abort reasons", async () => {
    const {
      MANAGED_TRANSLATION_QUEUE_TIMEOUT_MS,
      isManagedTranslationQueueTimeout,
    } = await import("../translation-queues")

    const timeoutController = new AbortController()
    timeoutController.abort(new Error(`Task timeout-hash timed out after ${MANAGED_TRANSLATION_QUEUE_TIMEOUT_MS}ms`))
    expect(isManagedTranslationQueueTimeout(timeoutController.signal)).toBe(true)

    const manualController = new AbortController()
    manualController.abort(new Error("user canceled task"))
    expect(isManagedTranslationQueueTimeout(manualController.signal)).toBe(false)
  })

  it("keeps same-text translations separate across tabs", async () => {
    const deeplProvider: ProviderConfig = {
      id: "deepl",
      name: "DeepL",
      provider: "deepl",
      enabled: true,
      apiKey: "key",
    }

    ensureInitializedConfigMock.mockResolvedValueOnce({
      ...DEFAULT_CONFIG,
      translate: {
        ...DEFAULT_CONFIG.translate,
        enableAIContentAware: true,
      },
      videoSubtitles: {
        ...DEFAULT_CONFIG.videoSubtitles,
        providerId: deeplProvider.id,
        requestQueueConfig: {
          rate: 10,
          capacity: 10,
        },
        batchQueueConfig: {
          maxCharactersPerBatch: 1000,
          maxItemsPerBatch: 1,
        },
      },
    })

    const { setUpWebPageTranslationQueue } = await import("../translation-queues")
    await setUpWebPageTranslationQueue()

    const handler = getRegisteredMessageHandler("enqueueTranslateRequest")
    const firstRequest = handler({
      sender: {
        tab: {
          id: 101,
        },
      },
      data: {
        text: "hello",
        langConfig: DEFAULT_CONFIG.language,
        providerConfig: deeplProvider,
        scheduleAt: Date.now(),
        hash: "shared-hash",
        webTitle: "Page title",
        webContent: "Page body",
        webSummary: "Ready summary",
      },
    } as any)
    const secondRequest = handler({
      sender: {
        tab: {
          id: 202,
        },
      },
      data: {
        text: "hello",
        langConfig: DEFAULT_CONFIG.language,
        providerConfig: deeplProvider,
        scheduleAt: Date.now(),
        hash: "shared-hash",
        webTitle: "Page title",
        webContent: "Page body",
        webSummary: "Ready summary",
      },
    } as any)

    await expect(Promise.all([firstRequest, secondRequest])).resolves.toEqual([
      "translated subtitle",
      "translated subtitle",
    ])
    expect(translateWithManagedPlatformMock).toHaveBeenCalledTimes(2)
  })

  it("exposes webpage summary generation as a separate background handler", async () => {
    const { setUpWebPageTranslationQueue } = await import("../translation-queues")
    await setUpWebPageTranslationQueue()

    const handler = getRegisteredMessageHandler("getOrGenerateWebPageSummary")
    const result = await handler({
      data: {
        webTitle: "Page title",
        webContent: "page body",
        providerConfig: llmProvider,
      },
    })

    expect(result).toBe("Generated summary")
    expect(generateArticleSummaryMock).toHaveBeenCalledWith(
      "Page title",
      "page body",
      llmProvider,
    )
  })

  it("exposes subtitle summary generation as a separate background handler", async () => {
    const { setUpSubtitlesTranslationQueue } = await import("../translation-queues")
    await setUpSubtitlesTranslationQueue()

    const handler = getRegisteredMessageHandler("getSubtitlesSummary")
    const result = await handler({
      data: {
        videoTitle: "Video title",
        subtitlesContext: "subtitle transcript",
        providerConfig: llmProvider,
      },
    })

    expect(result).toBe("Generated summary")
    expect(generateArticleSummaryMock).toHaveBeenCalledWith(
      "Video title",
      "subtitle transcript",
      llmProvider,
    )
  })

  it("returns null for invalid subtitle summary requests", async () => {
    const { setUpSubtitlesTranslationQueue } = await import("../translation-queues")
    await setUpSubtitlesTranslationQueue()

    const handler = getRegisteredMessageHandler("getSubtitlesSummary")
    const result = await handler({
      data: {
        videoTitle: "",
        subtitlesContext: "subtitle transcript",
        providerConfig: llmProvider,
      },
    })

    expect(result).toBeNull()
    expect(generateArticleSummaryMock).not.toHaveBeenCalled()
  })

  it("returns null when subtitle summary generation has no result", async () => {
    generateArticleSummaryMock.mockResolvedValue(null)

    const { setUpSubtitlesTranslationQueue } = await import("../translation-queues")
    await setUpSubtitlesTranslationQueue()

    const handler = getRegisteredMessageHandler("getSubtitlesSummary")
    const result = await handler({
      data: {
        videoTitle: "Video title",
        subtitlesContext: "subtitle transcript",
        providerConfig: llmProvider,
      },
    })

    expect(result).toBeNull()
  })

  it("deduplicates concurrent subtitle summary generation requests", async () => {
    let resolveSummary!: (summary: string) => void
    generateArticleSummaryMock.mockImplementation(
      () => new Promise((resolve: (summary: string) => void) => {
        resolveSummary = resolve
      }),
    )

    const { setUpSubtitlesTranslationQueue } = await import("../translation-queues")
    await setUpSubtitlesTranslationQueue()

    const handler = getRegisteredMessageHandler("getSubtitlesSummary")
    const firstRequest = handler({
      data: {
        videoTitle: "Video title",
        subtitlesContext: "subtitle transcript",
        providerConfig: llmProvider,
      },
    })
    const secondRequest = handler({
      data: {
        videoTitle: "Video title",
        subtitlesContext: "subtitle transcript",
        providerConfig: llmProvider,
      },
    })

    await Promise.resolve()
    await Promise.resolve()
    resolveSummary("Generated summary")

    await expect(Promise.all([firstRequest, secondRequest])).resolves.toEqual([
      "Generated summary",
      "Generated summary",
    ])
    expect(generateArticleSummaryMock).toHaveBeenCalledTimes(1)
  })
})
