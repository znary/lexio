import type { Config } from "@/types/config/config"
import type { LLMProviderConfig, ProviderConfig } from "@/types/config/provider"
import type { BatchQueueConfig, RequestQueueConfig } from "@/types/config/translate"
import type { SubtitlePromptContext, WebPagePromptContext } from "@/types/content"
import type { PromptResolver } from "@/utils/host/translate/api/ai"
import { ISO6393_TO_6391, LANG_CODE_TO_EN_NAME } from "@read-frog/definitions"
import { isLLMProviderConfig } from "@/types/config/provider"
import { putBatchRequestRecord } from "@/utils/batch-request-record"
import { DEFAULT_CONFIG } from "@/utils/constants/config"
import { BATCH_SEPARATOR } from "@/utils/constants/prompt"
import { generateArticleSummary } from "@/utils/content/summary"
import { cleanText } from "@/utils/content/utils"
import { db } from "@/utils/db/dexie/db"
import { Sha256Hex } from "@/utils/hash"
import { normalizePromptContextValue } from "@/utils/host/translate/translate-text"
import { logger } from "@/utils/logger"
import { onMessage } from "@/utils/message"
import { translateWithManagedPlatform } from "@/utils/platform/api"
import { getSubtitlesTranslatePrompt } from "@/utils/prompts/subtitles"
import { getTranslatePrompt } from "@/utils/prompts/translate"
import { BatchCountMismatchError, BatchQueue } from "@/utils/request/batch-queue"
import { RequestQueue } from "@/utils/request/request-queue"
import { ensureInitializedConfig } from "./config"
import { getManagedTranslationTaskScope } from "./managed-translation-tasks"

export const MANAGED_TRANSLATION_MAX_CONCURRENCY = 10
export const MANAGED_TRANSLATION_QUEUE_TIMEOUT_MS = 3 * 60_000

export function parseBatchResult(result: string): string[] {
  return result.split(BATCH_SEPARATOR).map(t => t.trim())
}

export function shouldUseBatchQueue(providerConfig: ProviderConfig): boolean {
  return isLLMProviderConfig(providerConfig)
}

export async function executeBatchTranslation<TContext>(
  dataList: TranslateBatchData<TContext>[],
  promptResolver: PromptResolver<TContext>,
  scene?: string,
  signal?: AbortSignal,
): Promise<string[]> {
  const { langConfig, providerConfig, context, tabId } = dataList[0]
  const texts = dataList.map(d => d.text)

  const batchText = texts.join(`\n\n${BATCH_SEPARATOR}\n\n`)
  const result = await executeManagedTranslation(batchText, langConfig, providerConfig, promptResolver, {
    isBatch: true,
    context,
    scene,
    signal,
    tabId,
  })

  if (!result) {
    return dataList.map(() => "")
  }

  return parseBatchResult(result)
}

async function getOrGenerateWebPageSummary(
  webTitle: string,
  webContent: string,
  providerConfig: LLMProviderConfig,
  requestQueue: RequestQueue,
): Promise<string | null> {
  const preparedText = cleanText(webContent)
  if (!preparedText) {
    return null
  }

  const textHash = Sha256Hex(preparedText)
  const cacheKey = Sha256Hex(webTitle, textHash, JSON.stringify(providerConfig))

  const cached = await db.articleSummaryCache.get(cacheKey)
  if (cached) {
    logger.info("Using cached summary")
    return cached.summary
  }

  const thunk = async () => {
    const cachedAgain = await db.articleSummaryCache.get(cacheKey)
    if (cachedAgain) {
      return cachedAgain.summary
    }

    const summary = await generateArticleSummary(webTitle, webContent, providerConfig)
    if (!summary) {
      return ""
    }

    await db.articleSummaryCache.put({
      key: cacheKey,
      summary,
      createdAt: new Date(),
    })

    logger.info("Generated and cached new summary")
    return summary
  }

  try {
    const summary = await requestQueue.enqueue(thunk, Date.now(), cacheKey)
    return summary || null
  }
  catch (error) {
    logger.warn("Failed to get/generate summary:", error)
    return null
  }
}

async function getOrGenerateSubtitleSummary(
  videoTitle: string,
  subtitlesContext: string,
  providerConfig: LLMProviderConfig,
  requestQueue: RequestQueue,
): Promise<string | null> {
  const preparedText = cleanText(subtitlesContext)
  if (!preparedText) {
    return null
  }

  const textHash = Sha256Hex(preparedText)
  const cacheKey = Sha256Hex(textHash, JSON.stringify(providerConfig))

  const cached = await db.articleSummaryCache.get(cacheKey)
  if (cached) {
    logger.info("Using cached summary")
    return cached.summary
  }

  const thunk = async () => {
    const cachedAgain = await db.articleSummaryCache.get(cacheKey)
    if (cachedAgain) {
      return cachedAgain.summary
    }

    const summary = await generateArticleSummary(videoTitle, subtitlesContext, providerConfig)
    if (!summary) {
      return ""
    }

    await db.articleSummaryCache.put({
      key: cacheKey,
      summary,
      createdAt: new Date(),
    })

    logger.info("Generated and cached new summary")
    return summary
  }

  try {
    const summary = await requestQueue.enqueue(thunk, Date.now(), cacheKey)
    return summary || null
  }
  catch (error) {
    logger.warn("Failed to get/generate summary:", error)
    return null
  }
}

export interface TranslateBatchData<TContext = unknown> {
  text: string
  langConfig: Config["language"]
  providerConfig: ProviderConfig
  hash: string
  scheduleAt: number
  scene?: string
  context?: TContext
  tabId?: number
}

interface TranslationQueueSetupConfig<TContext = unknown> {
  requestQueueConfig: RequestQueueConfig
  batchQueueConfig: BatchQueueConfig
  promptResolver: PromptResolver<TContext>
  scene: string
}

function buildManagedTranslationQueueHash(hash: string | undefined, tabId: number | undefined): string {
  if (!hash) {
    return tabId === undefined ? Sha256Hex("managed-translation") : Sha256Hex("managed-translation", String(tabId))
  }

  return tabId === undefined ? hash : `${tabId}:${hash}`
}

function isAbortError(error: unknown): boolean {
  return (error instanceof DOMException && error.name === "AbortError")
    || (error instanceof Error && error.name === "AbortError")
}

export function isManagedTranslationQueueTimeout(signal: AbortSignal | undefined): boolean {
  if (!signal?.aborted) {
    return false
  }

  const reason = signal.reason
  return reason instanceof Error && reason.message.includes("timed out")
}

function resolveAbortError(signal: AbortSignal | undefined, error: unknown): unknown {
  if (isManagedTranslationQueueTimeout(signal) && signal?.reason instanceof Error) {
    return signal.reason
  }

  return error
}

function combineAbortSignals(...signals: Array<AbortSignal | undefined>): {
  signal: AbortSignal | undefined
  cleanup: () => void
} {
  const activeSignals = signals.filter((signal): signal is AbortSignal => Boolean(signal))
  if (activeSignals.length === 0) {
    return {
      signal: undefined,
      cleanup: () => {},
    }
  }

  if (activeSignals.length === 1) {
    return {
      signal: activeSignals[0],
      cleanup: () => {},
    }
  }

  const controller = new AbortController()
  const cleanupList: Array<() => void> = []

  for (const signal of activeSignals) {
    if (signal.aborted) {
      controller.abort(signal.reason)
      continue
    }

    const onAbort = () => {
      if (!controller.signal.aborted) {
        controller.abort(signal.reason)
      }
    }

    signal.addEventListener("abort", onAbort, { once: true })
    cleanupList.push(() => signal.removeEventListener("abort", onAbort))
  }

  return {
    signal: controller.signal,
    cleanup: () => cleanupList.forEach(cleanup => cleanup()),
  }
}

async function executeManagedTranslation<TContext>(
  text: string,
  langConfig: Config["language"],
  providerConfig: ProviderConfig,
  promptResolver: PromptResolver<TContext>,
  options?: {
    isBatch?: boolean
    context?: TContext
    scene?: string
    signal?: AbortSignal
    tabId?: number
  },
): Promise<string> {
  const preparedText = cleanText(text)
  if (!preparedText) {
    return ""
  }

  const sourceLang = langConfig.sourceCode === "auto" ? "auto" : (ISO6393_TO_6391[langConfig.sourceCode] ?? "auto")
  const targetLang = ISO6393_TO_6391[langConfig.targetCode]
  if (!targetLang) {
    throw new Error(`Invalid target language code: ${langConfig.targetCode}`)
  }

  const targetLangName = LANG_CODE_TO_EN_NAME[langConfig.targetCode]
  const { systemPrompt, prompt } = await promptResolver(targetLangName, preparedText, {
    isBatch: options?.isBatch,
    context: options?.context,
  })
  const tabScope = typeof options?.tabId === "number"
    ? getManagedTranslationTaskScope(options.tabId)
    : null
  const managedSignal = combineAbortSignals(tabScope?.signal, options?.signal)

  let taskId: string | null = null

  try {
    const translatedText = await translateWithManagedPlatform({
      scene: options?.scene,
      text: preparedText,
      sourceLanguage: sourceLang,
      targetLanguage: targetLang,
      systemPrompt,
      prompt,
      temperature: isLLMProviderConfig(providerConfig) ? providerConfig.temperature : undefined,
      isBatch: options?.isBatch,
    }, {
      signal: managedSignal.signal,
      clientRequestKey: buildManagedTranslationQueueHash(
        Sha256Hex(
          options?.scene ?? "translate",
          preparedText,
          sourceLang,
          targetLang,
          systemPrompt,
          prompt,
          String(Boolean(options?.isBatch)),
        ),
        options?.tabId,
      ),
      ownerTabId: options?.tabId,
      onTaskCreated(createdTaskId) {
        taskId = createdTaskId
        tabScope?.registerTaskId(createdTaskId)
        logger.info("[ManagedTranslationTask]", {
          taskId: createdTaskId,
          tabId: options?.tabId ?? null,
          scene: options?.scene ?? null,
          action: "create",
          event: "created",
        })
      },
    })

    return translatedText.trim()
  }
  catch (error) {
    if (isAbortError(error)) {
      logger.info("[ManagedTranslationTask]", {
        taskId,
        tabId: options?.tabId ?? null,
        scene: options?.scene ?? null,
        action: "execute",
        event: "aborted",
      })
      if (isManagedTranslationQueueTimeout(managedSignal.signal)) {
        throw resolveAbortError(managedSignal.signal, error)
      }
      return ""
    }
    throw error
  }
  finally {
    managedSignal.cleanup()
    if (taskId) {
      tabScope?.completeTask(taskId)
    }
    else if (tabScope) {
      tabScope.completeTask("__cleanup__")
    }
  }
}

async function createTranslationQueues<TContext>(config: TranslationQueueSetupConfig<TContext>) {
  const { rate, capacity } = config.requestQueueConfig
  const { maxCharactersPerBatch, maxItemsPerBatch } = config.batchQueueConfig
  const { promptResolver, scene } = config

  const requestQueue = new RequestQueue({
    rate,
    capacity,
    timeoutMs: MANAGED_TRANSLATION_QUEUE_TIMEOUT_MS,
    maxRetries: 2,
    baseRetryDelayMs: 1_000,
    // Keep the client queue at the free-tier platform limit so requests can flow
    // through without hitting an avoidable lower local cap first.
    maxConcurrency: MANAGED_TRANSLATION_MAX_CONCURRENCY,
  })

  const batchQueue = new BatchQueue<TranslateBatchData<TContext>, string>({
    maxCharactersPerBatch,
    maxItemsPerBatch,
    batchDelay: 100,
    maxRetries: 3,
    enableFallbackToIndividual: true,
    shouldFallbackToIndividual: error => error instanceof BatchCountMismatchError,
    getBatchKey: (data) => {
      return Sha256Hex(`${data.tabId ?? "shared"}-${data.langConfig.sourceCode}-${data.langConfig.targetCode}-${data.providerConfig.id}`)
    },
    getCharacters: data => data.text.length,
    executeBatch: async (dataList) => {
      const { providerConfig } = dataList[0]
      const hash = Sha256Hex(...dataList.map(d => d.hash))
      const earliestScheduleAt = Math.min(...dataList.map(d => d.scheduleAt))

      const batchScene = dataList[0]?.scene ?? scene

      const batchThunk = async (signal: AbortSignal): Promise<string[]> => {
        await putBatchRequestRecord({ originalRequestCount: dataList.length, providerConfig })
        try {
          return await executeBatchTranslation(dataList, promptResolver, batchScene, signal)
        }
        catch (error) {
          if (isAbortError(error)) {
            if (isManagedTranslationQueueTimeout(signal)) {
              throw resolveAbortError(signal, error)
            }
            return dataList.map(() => "")
          }
          throw error
        }
      }

      return requestQueue.enqueue(batchThunk, earliestScheduleAt, hash)
    },
    executeIndividual: async (data) => {
      const { text, langConfig, providerConfig, hash, scheduleAt, context } = data
      const thunk = async (signal: AbortSignal) => {
        await putBatchRequestRecord({ originalRequestCount: 1, providerConfig })
        try {
          return await executeManagedTranslation(text, langConfig, providerConfig, promptResolver, {
            context,
            scene: data.scene ?? scene,
            signal,
            tabId: data.tabId,
          })
        }
        catch (error) {
          if (isAbortError(error)) {
            if (isManagedTranslationQueueTimeout(signal)) {
              throw resolveAbortError(signal, error)
            }
            return ""
          }
          throw error
        }
      }
      return requestQueue.enqueue(thunk, scheduleAt, hash)
    },
    onError: (error, context) => {
      const errorType = context.isFallback ? "Individual request" : "Batch request"
      logger.error(
        `${errorType} failed (batchKey: ${context.batchKey}, retry: ${context.retryCount}):`,
        error.message,
      )
    },
  })

  return { requestQueue, batchQueue }
}

export async function setUpWebPageTranslationQueue() {
  const config = await ensureInitializedConfig()

  const { translate: { requestQueueConfig, batchQueueConfig } } = config ?? DEFAULT_CONFIG

  const { requestQueue, batchQueue } = await createTranslationQueues({
    requestQueueConfig,
    batchQueueConfig,
    promptResolver: getTranslatePrompt,
    scene: "page",
  })

  onMessage("enqueueTranslateRequest", async (message) => {
    const { data: { text, langConfig, providerConfig, scheduleAt, hash: cacheHash, scene, webTitle, webContent, webSummary } } = message
    const tabId = message.sender?.tab?.id
    const queueHash = buildManagedTranslationQueueHash(cacheHash, tabId)

    // Check cache first
    if (cacheHash) {
      const cached = await db.translationCache.get(cacheHash)
      if (cached) {
        return cached.translation
      }
    }

    let result = ""
    const context: WebPagePromptContext = {
      webTitle: normalizePromptContextValue(webTitle),
      webContent: normalizePromptContextValue(webContent),
      webSummary: normalizePromptContextValue(webSummary),
    }

    if (shouldUseBatchQueue(providerConfig)) {
      const data = { text, langConfig, providerConfig, hash: queueHash, scheduleAt, scene, context, tabId }
      result = await batchQueue.enqueue(data)
    }
    else {
      const thunk = (signal: AbortSignal) => executeManagedTranslation(text, langConfig, providerConfig, getTranslatePrompt, {
        scene: scene ?? "page",
        signal,
        tabId,
      })
      result = await requestQueue.enqueue(thunk, scheduleAt, queueHash)
    }

    // Cache the translation result if successful
    if (result && cacheHash) {
      await db.translationCache.put({
        key: cacheHash,
        translation: result,
        createdAt: new Date(),
      })
    }

    return result
  })

  onMessage("getOrGenerateWebPageSummary", async (message) => {
    const { webTitle, webContent, providerConfig } = message.data

    if (!isLLMProviderConfig(providerConfig) || !webTitle || !webContent) {
      return null
    }

    return await getOrGenerateWebPageSummary(webTitle, webContent, providerConfig, requestQueue)
  })

  onMessage("setTranslateRequestQueueConfig", (message) => {
    const { data } = message
    requestQueue.setQueueOptions(data)
  })

  onMessage("setTranslateBatchQueueConfig", (message) => {
    const { data } = message
    batchQueue.setBatchConfig(data)
  })
}

/**
 * Set up subtitles translation queue and message handlers
 */
export async function setUpSubtitlesTranslationQueue() {
  const config = await ensureInitializedConfig()
  const { videoSubtitles: { requestQueueConfig, batchQueueConfig } } = config ?? DEFAULT_CONFIG

  const { requestQueue, batchQueue } = await createTranslationQueues({
    requestQueueConfig,
    batchQueueConfig,
    promptResolver: getSubtitlesTranslatePrompt,
    scene: "subtitles",
  })

  onMessage("enqueueSubtitlesTranslateRequest", async (message) => {
    const { data: { text, langConfig, providerConfig, scheduleAt, hash: cacheHash, videoTitle, summary } } = message
    const tabId = message.sender?.tab?.id
    const queueHash = buildManagedTranslationQueueHash(cacheHash, tabId)

    if (cacheHash) {
      const cached = await db.translationCache.get(cacheHash)
      if (cached) {
        return cached.translation
      }
    }

    let result = ""
    const context: SubtitlePromptContext = {
      videoTitle: normalizePromptContextValue(videoTitle),
      videoSummary: normalizePromptContextValue(summary),
    }

    if (shouldUseBatchQueue(providerConfig)) {
      const data = { text, langConfig, providerConfig, hash: queueHash, scheduleAt, context, tabId }
      result = await batchQueue.enqueue(data)
    }
    else {
      const thunk = (signal: AbortSignal) => executeManagedTranslation(text, langConfig, providerConfig, getSubtitlesTranslatePrompt, {
        scene: "subtitles",
        signal,
        tabId,
      })
      result = await requestQueue.enqueue(thunk, scheduleAt, queueHash)
    }

    if (result && cacheHash) {
      await db.translationCache.put({
        key: cacheHash,
        translation: result,
        createdAt: new Date(),
      })
    }

    return result
  })

  onMessage("getSubtitlesSummary", async (message) => {
    const { videoTitle, subtitlesContext, providerConfig } = message.data

    if (!isLLMProviderConfig(providerConfig) || !videoTitle || !subtitlesContext) {
      return null
    }

    return await getOrGenerateSubtitleSummary(videoTitle, subtitlesContext, providerConfig, requestQueue)
  })

  onMessage("setSubtitlesRequestQueueConfig", (message) => {
    const { data } = message
    requestQueue.setQueueOptions(data)
  })

  onMessage("setSubtitlesBatchQueueConfig", (message) => {
    const { data } = message
    batchQueue.setBatchConfig(data)
  })
}
