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
import { onMessage, sendMessage } from "@/utils/message"
import { translateWithManagedPlatform } from "@/utils/platform/api"
import { getSubtitlesTranslatePrompt } from "@/utils/prompts/subtitles"
import { getTranslatePrompt } from "@/utils/prompts/translate"
import { BatchCountMismatchError, BatchQueue } from "@/utils/request/batch-queue"
import { RequestQueue } from "@/utils/request/request-queue"
import { ensureInitializedConfig } from "./config"

export const MANAGED_TRANSLATION_MAX_CONCURRENCY = 100
export const MANAGED_TRANSLATION_QUEUE_TIMEOUT_MS = 3 * 60_000

interface ManagedTranslationStatusNotification {
  state: "queued" | "running" | "completed" | "failed" | "canceled"
}

interface LocalManagedTranslationStatusState {
  activeRequestCount: number
  phase: "queued" | "running"
}

const localManagedTranslationStatusByTabId = new Map<number, Map<string, LocalManagedTranslationStatusState>>()

function logTranslationPerf(level: "info" | "warn" | "error", event: string, details: Record<string, unknown>) {
  const payload = {
    event,
    ...details,
  }

  if (level === "warn") {
    logger.warn("[TranslationPerf]", payload)
    return
  }

  if (level === "error") {
    logger.error("[TranslationPerf]", payload)
    return
  }

  logger.info("[TranslationPerf]", payload)
}

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
    statusKeys: dataList.map(data => data.statusKey ?? data.hash),
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
  const startedAt = Date.now()
  const preparedText = cleanText(webContent)
  if (!preparedText) {
    logTranslationPerf("info", "summary-skip", {
      summaryType: "webpage",
      providerId: providerConfig.id,
      reason: "empty-content",
    })
    return null
  }

  const textHash = Sha256Hex(preparedText)
  const cacheKey = Sha256Hex(webTitle, textHash, JSON.stringify(providerConfig))

  const cached = await db.articleSummaryCache.get(cacheKey)
  if (cached) {
    logTranslationPerf("info", "summary-cache-hit", {
      summaryType: "webpage",
      providerId: providerConfig.id,
      cacheKey,
      totalMs: Date.now() - startedAt,
    })
    return cached.summary
  }

  logTranslationPerf("info", "summary-cache-miss", {
    summaryType: "webpage",
    providerId: providerConfig.id,
    cacheKey,
    contentLength: preparedText.length,
  })

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

    logTranslationPerf("info", "summary-generated", {
      summaryType: "webpage",
      providerId: providerConfig.id,
      cacheKey,
      summaryLength: summary.length,
    })
    return summary
  }

  try {
    const summary = await requestQueue.enqueue(thunk, Date.now(), cacheKey)
    logTranslationPerf("info", "summary-complete", {
      summaryType: "webpage",
      providerId: providerConfig.id,
      cacheKey,
      totalMs: Date.now() - startedAt,
      summaryLength: summary?.length ?? 0,
    })
    return summary || null
  }
  catch (error) {
    logTranslationPerf("warn", "summary-failed", {
      summaryType: "webpage",
      providerId: providerConfig.id,
      cacheKey,
      totalMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

async function getOrGenerateSubtitleSummary(
  videoTitle: string,
  subtitlesContext: string,
  providerConfig: LLMProviderConfig,
  requestQueue: RequestQueue,
): Promise<string | null> {
  const startedAt = Date.now()
  const preparedText = cleanText(subtitlesContext)
  if (!preparedText) {
    logTranslationPerf("info", "summary-skip", {
      summaryType: "subtitle",
      providerId: providerConfig.id,
      reason: "empty-content",
    })
    return null
  }

  const textHash = Sha256Hex(preparedText)
  const cacheKey = Sha256Hex(textHash, JSON.stringify(providerConfig))

  const cached = await db.articleSummaryCache.get(cacheKey)
  if (cached) {
    logTranslationPerf("info", "summary-cache-hit", {
      summaryType: "subtitle",
      providerId: providerConfig.id,
      cacheKey,
      totalMs: Date.now() - startedAt,
    })
    return cached.summary
  }

  logTranslationPerf("info", "summary-cache-miss", {
    summaryType: "subtitle",
    providerId: providerConfig.id,
    cacheKey,
    contentLength: preparedText.length,
  })

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

    logTranslationPerf("info", "summary-generated", {
      summaryType: "subtitle",
      providerId: providerConfig.id,
      cacheKey,
      summaryLength: summary.length,
    })
    return summary
  }

  try {
    const summary = await requestQueue.enqueue(thunk, Date.now(), cacheKey)
    logTranslationPerf("info", "summary-complete", {
      summaryType: "subtitle",
      providerId: providerConfig.id,
      cacheKey,
      totalMs: Date.now() - startedAt,
      summaryLength: summary?.length ?? 0,
    })
    return summary || null
  }
  catch (error) {
    logTranslationPerf("warn", "summary-failed", {
      summaryType: "subtitle",
      providerId: providerConfig.id,
      cacheKey,
      totalMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

export interface TranslateBatchData<TContext = unknown> {
  text: string
  langConfig: Config["language"]
  providerConfig: ProviderConfig
  hash: string
  statusKey?: string
  scheduleAt: number
  scene?: string
  context?: TContext
  tabId?: number
}

function notifyManagedTranslationStatus(
  tabId: number | undefined,
  statusKeys: string[] | undefined,
  update: ManagedTranslationStatusNotification,
) {
  if (typeof tabId !== "number" || !statusKeys?.length) {
    return
  }

  const uniqueStatusKeys = [...new Set(statusKeys.map(key => key.trim()).filter(Boolean))]
  for (const statusKey of uniqueStatusKeys) {
    void sendMessage("notifyManagedTranslationStatus", {
      statusKey,
      state: update.state,
    }, tabId)
  }
}

function getLocalManagedTranslationStatusMap(tabId: number) {
  const currentMap = localManagedTranslationStatusByTabId.get(tabId)
  if (currentMap) {
    return currentMap
  }

  const nextMap = new Map<string, LocalManagedTranslationStatusState>()
  localManagedTranslationStatusByTabId.set(tabId, nextMap)
  return nextMap
}

function beginManagedTranslationStatus(
  tabId: number | undefined,
  statusKeys: string[] | undefined,
) {
  if (typeof tabId !== "number" || !statusKeys?.length) {
    return
  }

  const statusMap = getLocalManagedTranslationStatusMap(tabId)
  const uniqueStatusKeys = [...new Set(statusKeys.map(key => key.trim()).filter(Boolean))]
  for (const statusKey of uniqueStatusKeys) {
    const currentState = statusMap.get(statusKey)
    if (currentState) {
      currentState.activeRequestCount += 1
      notifyManagedTranslationStatus(tabId, [statusKey], {
        state: currentState.phase,
      })
      continue
    }

    statusMap.set(statusKey, {
      activeRequestCount: 1,
      phase: "queued",
    })
    notifyManagedTranslationStatus(tabId, [statusKey], {
      state: "queued",
    })
  }
}

function markManagedTranslationStatusRunning(
  tabId: number | undefined,
  statusKeys: string[] | undefined,
) {
  if (typeof tabId !== "number" || !statusKeys?.length) {
    return
  }

  const statusMap = getLocalManagedTranslationStatusMap(tabId)
  const uniqueStatusKeys = [...new Set(statusKeys.map(key => key.trim()).filter(Boolean))]
  for (const statusKey of uniqueStatusKeys) {
    const currentState = statusMap.get(statusKey)
    if (currentState) {
      currentState.phase = "running"
    }
    else {
      statusMap.set(statusKey, {
        activeRequestCount: 1,
        phase: "running",
      })
    }

    notifyManagedTranslationStatus(tabId, [statusKey], {
      state: "running",
    })
  }
}

function finishManagedTranslationStatus(
  tabId: number | undefined,
  statusKeys: string[] | undefined,
  terminalState: Exclude<ManagedTranslationStatusNotification["state"], "queued" | "running">,
) {
  if (typeof tabId !== "number" || !statusKeys?.length) {
    return
  }

  const statusMap = localManagedTranslationStatusByTabId.get(tabId)
  if (!statusMap) {
    return
  }

  const uniqueStatusKeys = [...new Set(statusKeys.map(key => key.trim()).filter(Boolean))]
  for (const statusKey of uniqueStatusKeys) {
    const currentState = statusMap.get(statusKey)
    if (!currentState) {
      continue
    }

    currentState.activeRequestCount = Math.max(0, currentState.activeRequestCount - 1)
    if (currentState.activeRequestCount === 0) {
      statusMap.delete(statusKey)
      notifyManagedTranslationStatus(tabId, [statusKey], {
        state: terminalState,
      })
      continue
    }

    notifyManagedTranslationStatus(tabId, [statusKey], {
      state: currentState.phase,
    })
  }

  if (statusMap.size === 0) {
    localManagedTranslationStatusByTabId.delete(tabId)
  }
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
    statusKeys?: string[]
  },
): Promise<string> {
  const startedAt = Date.now()
  const preparedText = cleanText(text)
  if (!preparedText) {
    logTranslationPerf("info", "managed-translation-skip", {
      providerId: providerConfig.id,
      scene: options?.scene ?? null,
      reason: "empty-text",
    })
    return ""
  }

  const sourceLang = langConfig.sourceCode === "auto" ? "auto" : (ISO6393_TO_6391[langConfig.sourceCode] ?? "auto")
  const targetLang = ISO6393_TO_6391[langConfig.targetCode]
  if (!targetLang) {
    throw new Error(`Invalid target language code: ${langConfig.targetCode}`)
  }

  const targetLangName = LANG_CODE_TO_EN_NAME[langConfig.targetCode]
  const promptStartedAt = Date.now()
  const { systemPrompt, prompt } = await promptResolver(targetLangName, preparedText, {
    isBatch: options?.isBatch,
    context: options?.context,
  })
  const promptMs = Date.now() - promptStartedAt

  logTranslationPerf("info", "managed-translation-start", {
    providerId: providerConfig.id,
    scene: options?.scene ?? null,
    tabId: options?.tabId ?? null,
    isBatch: Boolean(options?.isBatch),
    textLength: preparedText.length,
    promptMs,
    promptLength: prompt.length,
    systemPromptLength: systemPrompt.length,
  })

  markManagedTranslationStatusRunning(options?.tabId, options?.statusKeys)

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
      signal: options?.signal,
    })

    logTranslationPerf("info", "managed-translation-complete", {
      providerId: providerConfig.id,
      scene: options?.scene ?? null,
      tabId: options?.tabId ?? null,
      isBatch: Boolean(options?.isBatch),
      totalMs: Date.now() - startedAt,
      resultLength: translatedText.length,
    })

    return translatedText.trim()
  }
  catch (error) {
    if (isAbortError(error)) {
      logger.info("[ManagedTranslationStatus]", {
        tabId: options?.tabId ?? null,
        scene: options?.scene ?? null,
        action: "execute",
        event: "aborted",
      })
      if (isManagedTranslationQueueTimeout(options?.signal)) {
        throw resolveAbortError(options?.signal, error)
      }
      return ""
    }
    logTranslationPerf("error", "managed-translation-failed", {
      providerId: providerConfig.id,
      scene: options?.scene ?? null,
      tabId: options?.tabId ?? null,
      isBatch: Boolean(options?.isBatch),
      totalMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    })
    throw error
  }
}

async function createTranslationQueues<TContext>(config: TranslationQueueSetupConfig<TContext>) {
  const { rate, capacity } = config.requestQueueConfig
  const { maxCharactersPerBatch, maxItemsPerBatch } = config.batchQueueConfig
  const { promptResolver, scene } = config

  const requestQueue = new RequestQueue({
    name: `${scene}-request-queue`,
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
    name: `${scene}-batch-queue`,
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
            statusKeys: [data.statusKey ?? hash],
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
    const startedAt = Date.now()
    const { data: { text, langConfig, providerConfig, scheduleAt, hash: cacheHash, scene, webTitle, webContent, webSummary } } = message
    const tabId = message.sender?.tab?.id
    const queueHash = buildManagedTranslationQueueHash(cacheHash, tabId)

    logTranslationPerf("info", "enqueue-translate-request", {
      scene: scene ?? "page",
      tabId: tabId ?? null,
      providerId: providerConfig.id,
      textLength: text.length,
      cacheHash,
      queueHash,
      usesBatchQueue: shouldUseBatchQueue(providerConfig),
    })

    // Check cache first
    if (cacheHash) {
      const cached = await db.translationCache.get(cacheHash)
      if (cached) {
        logTranslationPerf("info", "translation-cache-hit", {
          scene: scene ?? "page",
          tabId: tabId ?? null,
          providerId: providerConfig.id,
          cacheHash,
          totalMs: Date.now() - startedAt,
        })
        return cached.translation
      }
    }

    let result = ""
    const context: WebPagePromptContext = {
      webTitle: normalizePromptContextValue(webTitle),
      webContent: normalizePromptContextValue(webContent),
      webSummary: normalizePromptContextValue(webSummary),
    }
    const statusKeys = [cacheHash || queueHash]
    beginManagedTranslationStatus(tabId, statusKeys)
    let terminalState: Exclude<ManagedTranslationStatusNotification["state"], "queued" | "running"> = "completed"

    try {
      if (shouldUseBatchQueue(providerConfig)) {
        const data = { text, langConfig, providerConfig, hash: queueHash, statusKey: cacheHash || queueHash, scheduleAt, scene, context, tabId }
        result = await batchQueue.enqueue(data)
      }
      else {
        const thunk = (signal: AbortSignal) => executeManagedTranslation(text, langConfig, providerConfig, getTranslatePrompt, {
          scene: scene ?? "page",
          signal,
          tabId,
          statusKeys,
        })
        result = await requestQueue.enqueue(thunk, scheduleAt, queueHash)
      }
    }
    catch (error) {
      terminalState = isAbortError(error) ? "canceled" : "failed"
      throw error
    }
    finally {
      finishManagedTranslationStatus(tabId, statusKeys, terminalState)
    }

    // Cache the translation result if successful
    if (result && cacheHash) {
      await db.translationCache.put({
        key: cacheHash,
        translation: result,
        createdAt: new Date(),
      })
    }

    logTranslationPerf("info", "translation-request-complete", {
      scene: scene ?? "page",
      tabId: tabId ?? null,
      providerId: providerConfig.id,
      cacheHash,
      queueHash,
      totalMs: Date.now() - startedAt,
      resultLength: result.length,
    })

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
    const startedAt = Date.now()
    const { data: { text, langConfig, providerConfig, scheduleAt, hash: cacheHash, videoTitle, summary } } = message
    const tabId = message.sender?.tab?.id
    const queueHash = buildManagedTranslationQueueHash(cacheHash, tabId)

    logTranslationPerf("info", "enqueue-subtitles-request", {
      scene: "subtitles",
      tabId: tabId ?? null,
      providerId: providerConfig.id,
      textLength: text.length,
      cacheHash,
      queueHash,
      usesBatchQueue: shouldUseBatchQueue(providerConfig),
    })

    if (cacheHash) {
      const cached = await db.translationCache.get(cacheHash)
      if (cached) {
        logTranslationPerf("info", "translation-cache-hit", {
          scene: "subtitles",
          tabId: tabId ?? null,
          providerId: providerConfig.id,
          cacheHash,
          totalMs: Date.now() - startedAt,
        })
        return cached.translation
      }
    }

    let result = ""
    const context: SubtitlePromptContext = {
      videoTitle: normalizePromptContextValue(videoTitle),
      videoSummary: normalizePromptContextValue(summary),
    }
    const statusKeys = [cacheHash || queueHash]
    beginManagedTranslationStatus(tabId, statusKeys)
    let terminalState: Exclude<ManagedTranslationStatusNotification["state"], "queued" | "running"> = "completed"

    try {
      if (shouldUseBatchQueue(providerConfig)) {
        const data = { text, langConfig, providerConfig, hash: queueHash, statusKey: cacheHash || queueHash, scheduleAt, context, tabId }
        result = await batchQueue.enqueue(data)
      }
      else {
        const thunk = (signal: AbortSignal) => executeManagedTranslation(text, langConfig, providerConfig, getSubtitlesTranslatePrompt, {
          scene: "subtitles",
          signal,
          tabId,
          statusKeys,
        })
        result = await requestQueue.enqueue(thunk, scheduleAt, queueHash)
      }
    }
    catch (error) {
      terminalState = isAbortError(error) ? "canceled" : "failed"
      throw error
    }
    finally {
      finishManagedTranslationStatus(tabId, statusKeys, terminalState)
    }

    if (result && cacheHash) {
      await db.translationCache.put({
        key: cacheHash,
        translation: result,
        createdAt: new Date(),
      })
    }

    logTranslationPerf("info", "translation-request-complete", {
      scene: "subtitles",
      tabId: tabId ?? null,
      providerId: providerConfig.id,
      cacheHash,
      queueHash,
      totalMs: Date.now() - startedAt,
      resultLength: result.length,
    })

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
