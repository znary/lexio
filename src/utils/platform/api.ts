import type { BackgroundTextStreamSnapshot, ThinkingSnapshot } from "@/types/background-stream"
import type { Config } from "@/types/config/config"
import type { VocabularyItem } from "@/types/vocabulary"
import { Sha256Hex } from "@/utils/hash"
import { logger } from "@/utils/logger"
import { buildPlatformApiUrl } from "../constants/platform"
import { clearPlatformAuthSession, getPlatformAuthSession, setPlatformAuthSession } from "./storage"

export const PLATFORM_TOKEN_REFRESH_HEADER = "x-lexio-platform-token"
export const PLATFORM_TOKEN_EXPIRES_AT_HEADER = "x-lexio-platform-token-expires-at"

export interface PlatformUserPayload {
  id: string
  clerkUserId: string
  email: string
  name: string
  avatarUrl: string | null
}

export interface PlatformMeResponse {
  user: PlatformUserPayload
  subscription: {
    plan: "free" | "pro"
    status: string
  }
  entitlements: {
    plan: "free" | "pro"
    monthlyRequestLimit: number
    monthlyTokenLimit: number
    concurrentRequestLimit: number
  }
  sync: {
    lastPushAt: string | null
    lastPullAt: string | null
    lastStatus: string
    updatedAt: string
  }
}

export interface PlatformPullResponse {
  settings: Record<string, unknown> | null
  vocabularyItems: VocabularyItem[]
}

export interface ManagedTranslateRequest {
  scene?: string
  text: string
  sourceLanguage?: string
  targetLanguage?: string
  systemPrompt: string
  prompt: string
  temperature?: number
  isBatch?: boolean
}

export interface ManagedTranslationTaskCreatedResponse {
  taskId: string
}

export interface ManagedTranslationTaskExecutionOptions {
  signal?: AbortSignal
  onTaskCreated?: (taskId: string) => void
  onChunk?: (snapshot: BackgroundTextStreamSnapshot) => void
  onStatusChange?: (update: ManagedTranslationTaskStatusUpdate) => void
  clientRequestKey?: string
  ownerTabId?: number
}

interface ManagedTranslationTaskStreamOptions {
  signal?: AbortSignal
  onChunk?: (snapshot: BackgroundTextStreamSnapshot) => void
  onStatusChange?: (update: ManagedTranslationTaskStatusUpdate) => void
}

interface ManagedTranslationTaskResult {
  text: string
}

export type ManagedTranslationTaskState = "queued" | "running" | "completed" | "failed" | "canceled"

export interface ManagedTranslationTaskStatusUpdate {
  taskId: string
  state: ManagedTranslationTaskState
}

function logManagedTranslationEvent(level: "info" | "warn" | "error", event: string, details: Record<string, unknown>) {
  const payload = {
    event,
    ...details,
  }

  if (level === "warn") {
    logger.warn("[ManagedTranslationAPI]", payload)
    return
  }

  if (level === "error") {
    logger.error("[ManagedTranslationAPI]", payload)
    return
  }

  logger.info("[ManagedTranslationAPI]", payload)
}

const MANAGED_TRANSLATION_LOOP_GUARD_WINDOW_MS = 20_000
const MANAGED_TRANSLATION_LOOP_GUARD_MAX_ATTEMPTS = 3
const managedTranslationAttemptHistory = new Map<string, number[]>()

export class PlatformAPIError extends Error {
  statusCode: number

  constructor(statusCode: number, message: string) {
    super(message)
    this.name = "PlatformAPIError"
    this.statusCode = statusCode
  }
}

async function getAccessTokenOrThrow(): Promise<string> {
  const session = await getPlatformAuthSession()
  if (!session?.token) {
    throw new Error("No platform token found. Sign in again.")
  }

  return session.token
}

async function getPlatformErrorMessage(response: Response): Promise<string> {
  const payload = await response.text()
  if (!payload) {
    return `Platform request failed with status ${response.status}`
  }

  try {
    const parsed = JSON.parse(payload) as { error?: string }
    if (typeof parsed.error === "string" && parsed.error.trim()) {
      return parsed.error
    }
  }
  catch {
    // Fall back to the raw response text below.
  }

  return payload
}

export async function refreshPlatformSessionFromResponse(response: Response): Promise<void> {
  const nextToken = response.headers.get(PLATFORM_TOKEN_REFRESH_HEADER)
    ?? response.headers.get("X-Lexio-Platform-Token")
  if (!nextToken?.trim()) {
    return
  }

  const currentSession = await getPlatformAuthSession()
  await setPlatformAuthSession({
    token: nextToken.trim(),
    user: currentSession?.user,
  })
}

export async function platformFetch(path: string, init?: RequestInit): Promise<Response> {
  const token = await getAccessTokenOrThrow()
  const headers = new Headers(init?.headers)
  headers.set("Authorization", `Bearer ${token}`)

  const response = await fetch(buildPlatformApiUrl(path), {
    ...init,
    headers,
  })
  await refreshPlatformSessionFromResponse(response)

  if (response.status === 401) {
    await clearPlatformAuthSession()
    throw new Error("Platform session expired. Sign in again.")
  }

  if (!response.ok) {
    throw new PlatformAPIError(response.status, await getPlatformErrorMessage(response))
  }

  return response
}

export async function getPlatformMe(): Promise<PlatformMeResponse> {
  const response = await platformFetch("/v1/me")
  return await response.json() as PlatformMeResponse
}

export async function pullPlatformSync(): Promise<PlatformPullResponse> {
  const response = await platformFetch("/v1/sync/pull", {
    method: "POST",
  })
  return await response.json() as PlatformPullResponse
}

export async function pushPlatformSync(payload: {
  settings: Config
  vocabularyItems?: VocabularyItem[]
}): Promise<{ ok: true, syncedAt: string }> {
  const response = await platformFetch("/v1/sync/push", {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(payload),
  })

  return await response.json() as { ok: true, syncedAt: string }
}

const STREAM_THINKING_PENDING: ThinkingSnapshot = {
  status: "thinking",
  text: "",
}

const STREAM_THINKING_COMPLETE: ThinkingSnapshot = {
  status: "complete",
  text: "",
}

const STREAM_LINE_SPLIT_RE = /\r?\n/
const LEADING_SPACE_RE = /^\s/

function extractManagedTranslationText(payload: unknown): string {
  if (typeof payload === "string") {
    return payload
  }

  if (!payload || typeof payload !== "object") {
    return ""
  }

  const record = payload as {
    text?: unknown
    output?: unknown
    result?: unknown
  }

  if (typeof record.text === "string") {
    return record.text
  }

  if (typeof record.output === "string") {
    return record.output
  }

  if (typeof record.result === "string") {
    return record.result
  }

  return ""
}

function parseManagedTranslationEventData(payloadText: string): unknown {
  try {
    return JSON.parse(payloadText)
  }
  catch {
    return payloadText
  }
}

function extractManagedTranslationTaskState(eventName: string, payload: unknown): ManagedTranslationTaskState | null {
  if (eventName === "completed" || eventName === "failed" || eventName === "canceled") {
    return eventName
  }

  if (!payload || typeof payload !== "object") {
    return null
  }

  const rawStatus = (payload as { status?: unknown }).status
  if (rawStatus === "queued" || rawStatus === "dispatched") {
    return "queued"
  }
  if (rawStatus === "running") {
    return "running"
  }
  if (rawStatus === "completed" || rawStatus === "failed" || rawStatus === "canceled") {
    return rawStatus
  }

  return null
}

function buildManagedTranslationClientRequestKey(
  payload: ManagedTranslateRequest,
  ownerTabId?: number,
  explicitClientRequestKey?: string,
): string {
  if (explicitClientRequestKey?.trim()) {
    return explicitClientRequestKey.trim()
  }

  return [
    payload.scene?.trim() || "translate",
    ownerTabId ?? "shared",
    Sha256Hex(JSON.stringify({
      scene: payload.scene ?? null,
      ownerTabId: ownerTabId ?? null,
      text: payload.text,
      sourceLanguage: payload.sourceLanguage ?? null,
      targetLanguage: payload.targetLanguage ?? null,
      systemPrompt: payload.systemPrompt,
      prompt: payload.prompt,
      temperature: payload.temperature ?? null,
      isBatch: Boolean(payload.isBatch),
    })),
  ].join(":")
}

function pruneManagedTranslationAttempts(requestKey: string, now: number) {
  const attempts = managedTranslationAttemptHistory.get(requestKey) ?? []
  const recentAttempts = attempts.filter(timestamp => now - timestamp < MANAGED_TRANSLATION_LOOP_GUARD_WINDOW_MS)

  if (recentAttempts.length === 0) {
    managedTranslationAttemptHistory.delete(requestKey)
    return recentAttempts
  }

  managedTranslationAttemptHistory.set(requestKey, recentAttempts)
  return recentAttempts
}

function registerManagedTranslationAttempt(requestKey: string) {
  const now = Date.now()
  const recentAttempts = pruneManagedTranslationAttempts(requestKey, now)
  if (recentAttempts.length >= MANAGED_TRANSLATION_LOOP_GUARD_MAX_ATTEMPTS) {
    throw new Error("Blocked repeated managed translation request to prevent a retry loop.")
  }

  recentAttempts.push(now)
  managedTranslationAttemptHistory.set(requestKey, recentAttempts)
}

function extractStreamTextPart(payloadText: string): string {
  const payload = JSON.parse(payloadText) as {
    choices?: Array<{
      delta?: {
        content?: string | Array<{ text?: string }>
      }
    }>
  }
  const content = payload.choices?.[0]?.delta?.content

  if (typeof content === "string") {
    return content
  }

  if (!Array.isArray(content)) {
    return ""
  }

  return content
    .map(part => typeof part?.text === "string" ? part.text : "")
    .join("")
}

async function createManagedTranslationTask(
  payload: ManagedTranslateRequest,
  options: {
    clientRequestKey?: string
    ownerTabId?: number
  } = {},
): Promise<ManagedTranslationTaskCreatedResponse> {
  const startedAt = Date.now()
  const response = await platformFetch("/v1/translate/tasks", {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({
      ...payload,
      clientRequestKey: buildManagedTranslationClientRequestKey(payload, options.ownerTabId, options.clientRequestKey),
      ownerTabId: options.ownerTabId,
    }),
  })

  const data = await response.json() as Partial<ManagedTranslationTaskCreatedResponse> & { id?: string }
  const taskId = data.taskId?.trim() || data.id?.trim()
  if (!taskId) {
    throw new Error("Managed translation task id is missing")
  }

  logManagedTranslationEvent("info", "create-task", {
    taskId,
    scene: payload.scene ?? null,
    ownerTabId: options.ownerTabId ?? null,
    isBatch: Boolean(payload.isBatch),
    textLength: payload.text.length,
    promptLength: payload.prompt.length,
    systemPromptLength: payload.systemPrompt.length,
    createMs: Date.now() - startedAt,
  })

  return {
    taskId,
  }
}

async function consumeManagedTranslationTaskStream(
  taskId: string,
  options: ManagedTranslationTaskStreamOptions = {},
): Promise<ManagedTranslationTaskResult> {
  const startedAt = Date.now()
  const response = await platformFetch(`/v1/translate/tasks/${encodeURIComponent(taskId)}/stream`, {
    method: "GET",
    signal: options.signal,
  })

  if (!response.body) {
    throw new Error("Managed translation stream is unavailable")
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  let streamedText = ""
  let completedText = ""
  let firstChunkMs: number | null = null
  let lastTaskState: ManagedTranslationTaskState | null = null
  let currentEventName = "message"
  let currentDataLines: string[] = []

  const emitCurrentEvent = () => {
    if (!currentDataLines.length) {
      currentEventName = "message"
      return
    }

    const payloadText = currentDataLines.join("\n").trim()
    currentDataLines = []
    const eventName = currentEventName
    currentEventName = "message"

    if (!payloadText) {
      return
    }

    const eventPayload = parseManagedTranslationEventData(payloadText)
    const nextTaskState = extractManagedTranslationTaskState(eventName, eventPayload)
    if (nextTaskState && nextTaskState !== lastTaskState) {
      lastTaskState = nextTaskState
      options.onStatusChange?.({
        taskId,
        state: nextTaskState,
      })
      logManagedTranslationEvent("info", "task-state", {
        taskId,
        state: nextTaskState,
        streamMs: Date.now() - startedAt,
      })
    }

    if (eventName === "completed") {
      completedText = extractManagedTranslationText(eventPayload)
      return
    }

    if (eventName === "failed") {
      const errorMessage = extractManagedTranslationText(eventPayload) || "Managed translation failed"
      logManagedTranslationEvent("error", "stream-failed", {
        taskId,
        streamMs: Date.now() - startedAt,
        error: errorMessage,
      })
      throw new Error(errorMessage)
    }

    if (eventName === "canceled") {
      const errorMessage = extractManagedTranslationText(eventPayload) || "Managed translation task was canceled"
      logManagedTranslationEvent("warn", "stream-canceled", {
        taskId,
        streamMs: Date.now() - startedAt,
        error: errorMessage,
      })
      throw new DOMException(errorMessage, "AbortError")
    }

    if (eventName === "snapshot" || eventName === "running" || eventName === "keepalive") {
      return
    }

    if (eventName !== "progress" && eventName !== "chunk" && eventName !== "delta") {
      return
    }

    const chunkText = extractManagedTranslationText(eventPayload)
    if (!chunkText) {
      return
    }

    streamedText += chunkText
    if (firstChunkMs === null) {
      firstChunkMs = Date.now() - startedAt
      logManagedTranslationEvent("info", "stream-first-chunk", {
        taskId,
        firstChunkMs,
      })
    }
    options.onChunk?.({
      output: streamedText,
      thinking: STREAM_THINKING_PENDING,
    })
  }

  const processLine = (line: string) => {
    if (!line.trim()) {
      emitCurrentEvent()
      return
    }

    if (line.startsWith("event:")) {
      currentEventName = line.slice(6).trim() || "message"
      return
    }

    if (line.startsWith("data:")) {
      currentDataLines.push(line.slice(5).replace(LEADING_SPACE_RE, ""))
    }
  }

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) {
        break
      }

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split(STREAM_LINE_SPLIT_RE)
      buffer = lines.pop() ?? ""

      for (const line of lines) {
        processLine(line)
      }
    }

    buffer += decoder.decode()
    if (buffer.trim()) {
      for (const line of buffer.split(STREAM_LINE_SPLIT_RE)) {
        processLine(line)
      }
    }

    emitCurrentEvent()
  }
  finally {
    reader.releaseLock()
  }

  logManagedTranslationEvent("info", "stream-complete", {
    taskId,
    streamMs: Date.now() - startedAt,
    firstChunkMs,
    streamedLength: streamedText.length,
    completedLength: completedText.length,
  })

  return {
    text: completedText || streamedText,
  }
}

export async function streamManagedTranslation(
  payload: ManagedTranslateRequest,
  options: {
    signal?: AbortSignal
    onChunk?: (snapshot: BackgroundTextStreamSnapshot) => void
  } = {},
): Promise<BackgroundTextStreamSnapshot> {
  registerManagedTranslationAttempt(
    `stream:${buildManagedTranslationClientRequestKey(payload)}`,
  )

  const response = await platformFetch("/v1/translate/stream", {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(payload),
    signal: options.signal,
  })

  if (!response.body) {
    throw new Error("Managed translation stream is unavailable")
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  let translatedText = ""

  const processLine = (line: string) => {
    const trimmedLine = line.trim()
    if (!trimmedLine.startsWith("data:")) {
      return
    }

    const payloadText = trimmedLine.slice(5).trim()
    if (!payloadText || payloadText === "[DONE]") {
      return
    }

    const chunkText = extractStreamTextPart(payloadText)
    if (!chunkText) {
      return
    }

    translatedText += chunkText
    options.onChunk?.({
      output: translatedText,
      thinking: STREAM_THINKING_PENDING,
    })
  }

  while (true) {
    const { done, value } = await reader.read()
    if (done) {
      break
    }

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split(STREAM_LINE_SPLIT_RE)
    buffer = lines.pop() ?? ""

    for (const line of lines) {
      processLine(line)
    }
  }

  buffer += decoder.decode()
  if (buffer.trim()) {
    for (const line of buffer.split(STREAM_LINE_SPLIT_RE)) {
      processLine(line)
    }
  }

  return {
    output: translatedText,
    thinking: STREAM_THINKING_COMPLETE,
  }
}

export async function translateWithManagedPlatform(
  payload: ManagedTranslateRequest,
  options: ManagedTranslationTaskExecutionOptions = {},
): Promise<string> {
  const startedAt = Date.now()
  registerManagedTranslationAttempt(
    `task:${buildManagedTranslationClientRequestKey(payload, options.ownerTabId, options.clientRequestKey)}`,
  )

  const createdTask = await createManagedTranslationTask(payload, {
    clientRequestKey: options.clientRequestKey,
    ownerTabId: options.ownerTabId,
  })
  options.onTaskCreated?.(createdTask.taskId)

  const handleAbort = () => {
    void cancelManagedTranslationTask(createdTask.taskId).catch(() => undefined)
  }
  options.signal?.addEventListener("abort", handleAbort, { once: true })

  try {
    const result = await consumeManagedTranslationTaskStream(createdTask.taskId, {
      signal: options.signal,
      onChunk: options.onChunk,
      onStatusChange: options.onStatusChange,
    })

    logManagedTranslationEvent("info", "task-complete", {
      taskId: createdTask.taskId,
      scene: payload.scene ?? null,
      ownerTabId: options.ownerTabId ?? null,
      isBatch: Boolean(payload.isBatch),
      totalMs: Date.now() - startedAt,
      resultLength: result.text.length,
    })

    return result.text
  }
  catch (error) {
    logManagedTranslationEvent(
      error instanceof DOMException && error.name === "AbortError" ? "warn" : "error",
      "task-failed",
      {
        taskId: createdTask.taskId,
        scene: payload.scene ?? null,
        ownerTabId: options.ownerTabId ?? null,
        isBatch: Boolean(payload.isBatch),
        totalMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
      },
    )
    throw error
  }
  finally {
    options.signal?.removeEventListener("abort", handleAbort)
  }
}

export async function cancelManagedTranslationTask(taskId: string): Promise<void> {
  await platformFetch(`/v1/translate/tasks/${encodeURIComponent(taskId)}/cancel`, {
    method: "POST",
  })
}

// Vocabulary API
export async function getVocabularyItems(): Promise<VocabularyItem[]> {
  const response = await platformFetch("/v1/vocabulary")
  const data = await response.json() as { items: VocabularyItem[] }
  return data.items
}

export async function createVocabularyItem(item: VocabularyItem): Promise<{ ok: true, id: string }> {
  const response = await platformFetch("/v1/vocabulary", {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(item),
  })
  return await response.json() as { ok: true, id: string }
}

export async function updateVocabularyItem(item: VocabularyItem): Promise<{ ok: true }> {
  const response = await platformFetch("/v1/vocabulary", {
    method: "PUT",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(item),
  })
  return await response.json() as { ok: true }
}

export async function deleteVocabularyItem(itemId: string): Promise<{ ok: true }> {
  const response = await platformFetch(`/v1/vocabulary/${encodeURIComponent(itemId)}`, {
    method: "DELETE",
  })
  return await response.json() as { ok: true }
}

export async function clearVocabularyItems(): Promise<{ ok: true }> {
  const response = await platformFetch("/v1/vocabulary", {
    method: "DELETE",
  })
  return await response.json() as { ok: true }
}
