import type { SessionContext } from "../lib/auth"
import type { TranslationTaskInput, TranslationTaskRecord } from "../lib/db"
import type { Env } from "../lib/env"
import type { TranslationTaskLane, TranslationTaskStatus } from "../lib/translation-task-log"
import { forwardChatCompletions } from "../lib/ai"
import {
  buildMePayload,
  cancelTranslationTask,
  completeTranslationTask,
  createTranslationTask,
  failTranslationTask,
  getPlanForUser,
  getTranslationTaskById,
  getTranslationTaskForWorker,
  markTranslationTaskDispatched,
  markTranslationTaskRunning,
  recordUsage,
  syncUserFromClerk,
} from "../lib/db"
import { buildEntitlements } from "../lib/env"
import { HttpError, json, readJson, withCors } from "../lib/http"
import {
  logTranslationTaskError,
  logTranslationTaskInfo,
  logTranslationTaskStreamInfo,
  logTranslationTaskWarn,
} from "../lib/translation-task-log"
import {
  assignUsageTask,
  cancelUsageTask,
  completeUsage,
  createUsageTask,
  kickUsageTask,
  publishTranslationTaskEvent,
  releaseUsageTask,
  reserveUsage,
  streamTranslationTask,
} from "../lib/usage-gate"

const SUPPORTED_TRANSLATION_ENGINES = [
  "ark",
  "google-translate",
  "microsoft-translate",
  "deepl",
  "deeplx",
] as const

type SupportedTranslationEngine = (typeof SUPPORTED_TRANSLATION_ENGINES)[number]

interface ManagedTranslateRequest {
  scene?: string
  text: string
  sourceLanguage?: string
  targetLanguage?: string
  systemPrompt: string
  prompt: string
  temperature?: number
  isBatch?: boolean
}

interface ManagedTranslateTaskRequest extends ManagedTranslateRequest {
  clientRequestKey?: string
  ownerTabId?: number | null
}

interface ChatCompletionChunkChoice {
  delta?: {
    content?: string | Array<{ type?: string, text?: string }>
  }
}

interface ChatCompletionChoice {
  message?: {
    content?: string | Array<{ type?: string, text?: string }>
  }
}

interface ChatCompletionResponsePayload {
  choices?: ChatCompletionChoice[]
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
  }
}

interface ManagedTranslationQueueMessage {
  taskId: string
  requestId: string
  userId: string
  scene: string | null
  lane: TranslationTaskLane
  ownerTabId: number | null
}

interface BackgroundUsageTaskAssignment {
  taskId: string
  requestId: string
  leaseId: string | null
  requestCount: number
  status: "queued" | "dispatched" | "running" | "released" | "canceled" | "expired"
  queuePosition: number | null
  queueWaitMs: number | null
  cancelReason: string | null
  releaseReason: string | null
  skipReason?: "usage-task-missing" | null
  taskStatus?: TranslationTaskStatus | null
  recoveredStatus?: "queued" | "dispatched" | "running" | "released" | "canceled" | "expired" | null
  recoveryAction?: "recreated" | "ignored" | null
}

const activeManagedTranslationControllers = new Map<string, AbortController>()

function logTranslationTaskPerf(event: string, details: Record<string, unknown>): void {
  console.warn({
    namespace: "translation-task-perf",
    event,
    ...details,
  })
}

function resolveManagedTranslationEngine(env: Env): SupportedTranslationEngine {
  const rawValue = env.MANAGED_TRANSLATION_ENGINE?.trim()
  if (!rawValue) {
    return "ark"
  }

  if (SUPPORTED_TRANSLATION_ENGINES.includes(rawValue as SupportedTranslationEngine)) {
    return rawValue as SupportedTranslationEngine
  }

  throw new HttpError(500, `Unsupported managed translation engine: ${rawValue}`)
}

function assertTranslationEngineImplemented(engine: SupportedTranslationEngine): void {
  if (engine === "ark") {
    return
  }

  throw new HttpError(501, `Managed translation engine "${engine}" is not implemented yet`)
}

function normalizeTemperature(temperature?: number | null): number | null {
  return typeof temperature === "number" && Number.isFinite(temperature) ? temperature : null
}

function normalizeOwnerTabId(ownerTabId?: number | null): number | null {
  return typeof ownerTabId === "number" && Number.isFinite(ownerTabId) ? ownerTabId : null
}

async function sha256Hex(value: string): Promise<string> {
  const data = new TextEncoder().encode(value)
  const digest = await crypto.subtle.digest("SHA-256", data)
  return Array.from(new Uint8Array(digest))
    .map(byte => byte.toString(16).padStart(2, "0"))
    .join("")
}

async function resolveClientRequestKey(body: ManagedTranslateTaskRequest): Promise<string> {
  if (body.clientRequestKey?.trim()) {
    return body.clientRequestKey.trim()
  }

  const ownerTabId = normalizeOwnerTabId(body.ownerTabId)
  const hash = await sha256Hex(JSON.stringify({
    scene: body.scene?.trim() ?? null,
    ownerTabId,
    text: body.text,
    sourceLanguage: body.sourceLanguage ?? null,
    targetLanguage: body.targetLanguage ?? null,
    systemPrompt: body.systemPrompt,
    prompt: body.prompt,
    temperature: normalizeTemperature(body.temperature),
    isBatch: Boolean(body.isBatch),
  }))

  return [body.scene?.trim() || "translate", ownerTabId ?? "shared", hash].join(":")
}

function buildTaskLogEntry(
  task: TranslationTaskRecord,
  overrides: Partial<{
    requestId: string | null
    status: TranslationTaskStatus
    queuePosition: number | null
    queueWaitMs: number | null
    runMs: number | null
    upstreamStatus: number | null
    cancelReason: string | null
    releaseReason: string | null
    errorCode: string | null
    errorMessage: string | null
  }> = {},
) {
  const queueWaitMs = task.startedAt && task.createdAt
    ? Date.parse(task.startedAt) - Date.parse(task.createdAt)
    : null
  const runMs = task.startedAt && task.finishedAt
    ? Date.parse(task.finishedAt) - Date.parse(task.startedAt)
    : null

  return {
    requestId: overrides.requestId ?? null,
    taskId: task.id,
    userId: task.userId,
    scene: task.scene,
    lane: task.lane,
    status: overrides.status ?? task.status,
    ownerTabId: task.ownerTabId,
    queuePosition: overrides.queuePosition ?? null,
    queueWaitMs: overrides.queueWaitMs ?? queueWaitMs,
    runMs: overrides.runMs ?? runMs,
    upstreamStatus: overrides.upstreamStatus ?? null,
    cancelReason: overrides.cancelReason ?? (task.errorCode === "canceled" ? task.errorMessage : null),
    releaseReason: overrides.releaseReason ?? null,
    errorCode: overrides.errorCode ?? task.errorCode,
    errorMessage: overrides.errorMessage ?? task.errorMessage,
  }
}

function buildTaskEventData(task: TranslationTaskRecord): Record<string, unknown> {
  return {
    taskId: task.id,
    status: task.status,
    lane: task.lane,
    scene: task.scene,
    ownerTabId: task.ownerTabId,
    text: task.resultText,
    errorCode: task.errorCode,
    errorMessage: task.errorMessage,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    startedAt: task.startedAt,
    finishedAt: task.finishedAt,
    canceledAt: task.canceledAt,
  }
}

function isMonthlyRequestLimitError(error: unknown): boolean {
  if (error instanceof HttpError && error.status === 402) {
    return true
  }

  const message = error instanceof Error ? error.message : String(error)
  return message.includes("Monthly request limit reached")
}

function isUsageTaskMissingError(error: unknown): error is HttpError {
  return typeof error === "object"
    && error !== null
    && "status" in error
    && Number((error as { status?: unknown }).status) === 404
}

async function recreateBackgroundUsageTask(
  env: Env,
  task: TranslationTaskRecord,
  requestId: string,
) {
  return await createUsageTask(
    env,
    task.userId,
    buildEntitlements(await getPlanForUser(env, task.userId)),
    task.mode,
    {
      requestId,
      taskId: task.id,
      scene: task.scene,
      ownerTabId: task.ownerTabId,
      lane: "background",
    },
  )
}

async function publishManagedTaskEvent(
  env: Env,
  task: TranslationTaskRecord,
  event: "queued" | "running" | "completed" | "failed" | "canceled",
): Promise<void> {
  await publishTranslationTaskEvent(env, task.userId, {
    taskId: task.id,
    event,
    data: buildTaskEventData(task),
  })
}

function buildManagedTaskImmediateStream(
  task: TranslationTaskRecord,
  event: "completed" | "failed" | "canceled",
): Response {
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(`event: snapshot\ndata: ${JSON.stringify(buildTaskEventData(task))}\n\n`))
      controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(buildTaskEventData(task))}\n\n`))
      controller.close()
    },
  })

  return new Response(stream, {
    status: 200,
    headers: withCors({
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
    }),
  })
}

function beginManagedTaskExecution(taskId: string): AbortController {
  const controller = new AbortController()
  activeManagedTranslationControllers.set(taskId, controller)
  return controller
}

function finishManagedTaskExecution(taskId: string): void {
  activeManagedTranslationControllers.delete(taskId)
}

export function abortManagedTranslationTask(taskId: string): void {
  const controller = activeManagedTranslationControllers.get(taskId)
  if (!controller) {
    return
  }

  controller.abort()
  activeManagedTranslationControllers.delete(taskId)
}

function buildManagedTranslateBody(
  requestBody: ManagedTranslateRequest | TranslationTaskRecord,
  stream: boolean,
): Record<string, unknown> {
  const temperature = "temperature" in requestBody
    ? normalizeTemperature(requestBody.temperature)
    : null

  return {
    messages: [
      {
        role: "system",
        content: requestBody.systemPrompt,
      },
      {
        role: "user",
        content: requestBody.prompt,
      },
    ],
    ...(temperature !== null ? { temperature } : {}),
    stream,
  }
}

function extractTextContent(
  content: string | Array<{ type?: string, text?: string }> | undefined,
): string {
  if (typeof content === "string") {
    return content
  }

  if (!Array.isArray(content)) {
    return ""
  }

  return content
    .map((part) => {
      if (typeof part?.text === "string") {
        return part.text
      }
      return ""
    })
    .join("")
}

export function extractTranslatedText(payloadText: string): {
  text: string
  inputTokens: number
  outputTokens: number
} {
  const payload = JSON.parse(payloadText) as ChatCompletionResponsePayload
  const firstChoice = payload.choices?.[0]
  const text = extractTextContent(firstChoice?.message?.content).trim()

  if (!text) {
    throw new HttpError(502, "Managed translation returned empty text")
  }

  return {
    text,
    inputTokens: payload.usage?.prompt_tokens ?? 0,
    outputTokens: payload.usage?.completion_tokens ?? 0,
  }
}

export function extractDeltaText(payloadText: string): string {
  const payload = JSON.parse(payloadText) as { choices?: ChatCompletionChunkChoice[] }
  return extractTextContent(payload.choices?.[0]?.delta?.content)
}

async function streamWithCleanup(
  response: Response,
  onFinish: () => Promise<void>,
  onTextChunk?: (text: string) => void,
): Promise<Response> {
  if (!response.body) {
    await onFinish()
    return response
  }

  const { readable, writable } = new TransformStream()
  const reader = response.body.getReader()
  const writer = writable.getWriter()
  const decoder = new TextDecoder()

  void (async () => {
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) {
          break
        }

        const chunkText = decoder.decode(value, { stream: true })
        if (chunkText) {
          onTextChunk?.(chunkText)
        }
        await writer.write(value)
      }

      const tail = decoder.decode()
      if (tail) {
        onTextChunk?.(tail)
      }
    }
    finally {
      try {
        await onFinish()
      }
      finally {
        await writer.close()
      }
    }
  })()

  return new Response(readable, {
    status: response.status,
    headers: withCors(response.headers),
  })
}

function buildTranslationFeatureName(scene?: string | null): string {
  const normalizedScene = scene?.trim()
  return normalizedScene ? `managed-translate:${normalizedScene}` : "managed-translate"
}

async function normalizeTaskInput(body: ManagedTranslateTaskRequest): Promise<TranslationTaskInput> {
  return {
    clientRequestKey: await resolveClientRequestKey(body),
    scene: body.scene?.trim() || undefined,
    lane: "background",
    mode: "generate",
    ownerTabId: normalizeOwnerTabId(body.ownerTabId),
    text: body.text,
    sourceLanguage: body.sourceLanguage?.trim() || undefined,
    targetLanguage: body.targetLanguage?.trim() || undefined,
    systemPrompt: body.systemPrompt,
    prompt: body.prompt,
    temperature: normalizeTemperature(body.temperature) ?? undefined,
    isBatch: Boolean(body.isBatch),
  }
}

async function handleManagedTranslate(
  request: Request,
  env: Env,
  session: SessionContext,
  stream: boolean,
) {
  const body = await readJson<ManagedTranslateRequest>(request)
  const engine = resolveManagedTranslationEngine(env)
  assertTranslationEngineImplemented(engine)

  if (!body.text?.trim()) {
    throw new HttpError(400, "Translation text is required")
  }

  if (!body.systemPrompt?.trim() || !body.prompt?.trim()) {
    throw new HttpError(400, "Translation prompt is required")
  }

  const user = await syncUserFromClerk(env, session)
  const me = await buildMePayload(env, user)
  const lease = await reserveUsage(
    env,
    user.id,
    me.entitlements,
    stream ? "stream" : "generate",
    {
      scene: body.scene?.trim() || null,
      lane: "interactive",
    },
  )

  try {
    const upstream = await forwardChatCompletions(
      env,
      buildManagedTranslateBody(body, stream),
      me.subscription.plan,
    )

    const feature = buildTranslationFeatureName(body.scene)

    if (stream) {
      return await streamWithCleanup(upstream, async () => {
        await completeUsage(env, user.id, lease.leaseId)
        await recordUsage(env, user.id, feature, "stream", lease.requestCount)
      })
    }

    const payloadText = await upstream.text()
    await completeUsage(env, user.id, lease.leaseId)
    const payload = extractTranslatedText(payloadText)
    await recordUsage(
      env,
      user.id,
      feature,
      "generate",
      lease.requestCount,
      payload.inputTokens,
      payload.outputTokens,
    )

    return json({ text: payload.text })
  }
  catch (error) {
    await completeUsage(env, user.id, lease.leaseId)
    if (error instanceof HttpError) {
      throw error
    }
    throw new HttpError(500, error instanceof Error ? error.message : "Managed translation failed")
  }
}

export async function handleTranslateText(request: Request, env: Env, session: SessionContext): Promise<Response> {
  return handleManagedTranslate(request, env, session, false)
}

export async function handleTranslateStream(request: Request, env: Env, session: SessionContext) {
  return handleManagedTranslate(request, env, session, true)
}

export async function handleTranslateTasksCreate(request: Request, env: Env, session: SessionContext) {
  const startedAt = Date.now()
  const body = await readJson<ManagedTranslateTaskRequest>(request)
  const engine = resolveManagedTranslationEngine(env)
  assertTranslationEngineImplemented(engine)

  if (!body.text?.trim()) {
    throw new HttpError(400, "Translation text is required")
  }

  if (!body.systemPrompt?.trim() || !body.prompt?.trim()) {
    throw new HttpError(400, "Translation prompt is required")
  }

  const user = await syncUserFromClerk(env, session)
  const me = await buildMePayload(env, user)
  const result = await createTranslationTask(env, user.id, await normalizeTaskInput(body))

  let task = result.task
  if (result.created) {
    const usageTaskStartedAt = Date.now()
    const usageTask = await createUsageTask(
      env,
      user.id,
      me.entitlements,
      "generate",
      {
        requestId: task.id,
        taskId: task.id,
        scene: task.scene,
        ownerTabId: task.ownerTabId,
        lane: "background",
      },
    )

    if (usageTask.status === "running" || usageTask.status === "dispatched") {
      task = await markTranslationTaskDispatched(env, task.id) ?? task
      logTranslationTaskInfo(buildTaskLogEntry(task, {
        requestId: usageTask.requestId,
        status: "dispatched",
        queuePosition: usageTask.queuePosition,
        releaseReason: null,
      }))
    }
    else {
      logTranslationTaskInfo(buildTaskLogEntry(task, {
        requestId: usageTask.requestId,
        status: "queued",
        queuePosition: usageTask.queuePosition,
      }))
    }

    logTranslationTaskPerf("task-create", {
      taskId: task.id,
      userId: user.id,
      scene: task.scene,
      lane: task.lane,
      ownerTabId: task.ownerTabId,
      usageTaskStatus: usageTask.status,
      queuePosition: usageTask.queuePosition,
      createUsageTaskMs: Date.now() - usageTaskStartedAt,
      totalMs: Date.now() - startedAt,
    })
  }
  else {
    logTranslationTaskWarn(buildTaskLogEntry(task, {
      status: task.status,
      errorCode: "duplicate_client_request_key",
      errorMessage: "Reused existing translation task",
    }))
  }

  return json({
    taskId: task.id,
    status: task.status,
    lane: task.lane,
  }, { status: result.created ? 201 : 200 })
}

export async function handleTranslateTaskStream(
  _request: Request,
  env: Env,
  session: SessionContext,
  taskId: string,
) {
  const user = await syncUserFromClerk(env, session)
  const task = await getTranslationTaskById(env, user.id, taskId)

  if (!task) {
    throw new HttpError(404, "Translation task not found")
  }

  if (task.status === "completed") {
    logTranslationTaskStreamInfo({
      event: "attach-immediate",
      taskId,
      userId: user.id,
      status: task.status,
    })
    return buildManagedTaskImmediateStream(task, "completed")
  }

  if (task.status === "canceled") {
    logTranslationTaskStreamInfo({
      event: "attach-immediate",
      taskId,
      userId: user.id,
      status: task.status,
    })
    return buildManagedTaskImmediateStream(task, "canceled")
  }

  if (task.status === "failed") {
    logTranslationTaskStreamInfo({
      event: "attach-immediate",
      taskId,
      userId: user.id,
      status: task.status,
    })
    return buildManagedTaskImmediateStream(task, "failed")
  }

  if (task.status !== "queued" && task.status !== "dispatched" && task.status !== "running") {
    throw new HttpError(409, `Translation task cannot be streamed from status "${task.status}"`)
  }

  logTranslationTaskStreamInfo({
    event: "attach-live",
    taskId,
    userId: user.id,
    status: task.status,
  })

  if (task.lane === "background" && task.status === "queued") {
    logTranslationTaskPerf("task-stream-kick-decision", {
      taskId,
      userId: user.id,
      taskStatus: task.status,
      action: "kick",
      ownerTabId: task.ownerTabId,
    })
    try {
      const kickResult = await kickUsageTask(env, user.id, {
        taskId: task.id,
        requestId: task.id,
      })

      logTranslationTaskPerf("task-stream-kick-result", {
        taskId,
        userId: user.id,
        taskStatus: task.status,
        kickStatus: kickResult.status ?? null,
        enqueued: kickResult.enqueued,
        ownerTabId: task.ownerTabId,
      })

      if (!kickResult.enqueued) {
        const recovered = await recreateBackgroundUsageTask(env, task, task.id)
        console.warn({
          namespace: "translation-task-stream",
          event: "recreated-background-task",
          taskId,
          userId: user.id,
          previousStatus: task.status,
          recoveredStatus: recovered.status,
          ownerTabId: task.ownerTabId,
        })
      }
    }
    catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      console.warn({
        namespace: "translation-task-stream",
        event: "kick-failed",
        taskId,
        userId: user.id,
        status: task.status,
        error: errorMessage,
      })

      if (isMonthlyRequestLimitError(error)) {
        await cancelUsageTask(env, user.id, task.id, {
          cancelReason: "monthly-request-limit",
          requestId: task.id,
        }).catch(() => undefined)

        const failedTask = await failTranslationTask(
          env,
          user.id,
          task.id,
          errorMessage,
          "monthly_request_limit",
        )

        if (failedTask?.status === "failed") {
          logTranslationTaskWarn(buildTaskLogEntry(failedTask, {
            status: "failed",
            errorCode: "monthly_request_limit",
            errorMessage,
            releaseReason: "failed",
          }))
          await publishManagedTaskEvent(env, failedTask, "failed")
          return buildManagedTaskImmediateStream(failedTask, "failed")
        }

        if (failedTask?.status === "canceled") {
          await publishManagedTaskEvent(env, failedTask, "canceled")
          return buildManagedTaskImmediateStream(failedTask, "canceled")
        }
      }
    }
  }
  else if (task.lane === "background" && task.status === "dispatched") {
    logTranslationTaskPerf("task-stream-kick-decision", {
      taskId,
      userId: user.id,
      taskStatus: task.status,
      action: "verify-dispatch",
      ownerTabId: task.ownerTabId,
    })

    const kickResult = await kickUsageTask(env, user.id, {
      taskId: task.id,
      requestId: task.id,
    })
    logTranslationTaskPerf("task-stream-kick-result", {
      taskId,
      userId: user.id,
      taskStatus: task.status,
      kickStatus: kickResult.status ?? null,
      enqueued: kickResult.enqueued,
      ownerTabId: task.ownerTabId,
    })

    if (!kickResult.enqueued && kickResult.status !== "dispatched" && kickResult.status !== "running") {
      const recovered = await recreateBackgroundUsageTask(env, task, task.id)
      console.warn({
        namespace: "translation-task-stream",
        event: "recreated-dispatched-background-task",
        taskId,
        userId: user.id,
        previousStatus: task.status,
        recoveredStatus: recovered.status,
        ownerTabId: task.ownerTabId,
      })
    }
  }

  const response = await streamTranslationTask(env, user.id, {
    taskId,
    snapshot: buildTaskEventData(task),
  })

  const latestTask = await getTranslationTaskById(env, user.id, taskId)
  if (latestTask?.status === "completed" || latestTask?.status === "failed" || latestTask?.status === "canceled") {
    await publishManagedTaskEvent(env, latestTask, latestTask.status)
  }

  return new Response(response.body, {
    status: response.status,
    headers: withCors(response.headers),
  })
}

export async function handleTranslateTaskCancel(
  _request: Request,
  env: Env,
  session: SessionContext,
  taskId: string,
) {
  const user = await syncUserFromClerk(env, session)
  const task = await cancelTranslationTask(env, user.id, taskId, "canceled", "Translation task was canceled")

  if (!task) {
    throw new HttpError(404, "Translation task not found")
  }

  abortManagedTranslationTask(taskId)
  try {
    await cancelUsageTask(env, user.id, taskId, {
      cancelReason: "client-canceled",
    })
  }
  catch {
    // The platform task has already been marked canceled in D1.
  }
  await publishManagedTaskEvent(env, task, "canceled")
  logTranslationTaskInfo(buildTaskLogEntry(task, {
    status: "canceled",
    cancelReason: "client-canceled",
  }))

  return json({ ok: true, taskId })
}

export async function handleManagedTranslationQueueMessage(
  env: Env,
  message: ManagedTranslationQueueMessage,
): Promise<void> {
  const startedAt = Date.now()
  const usageTask = await createOrAssignBackgroundUsageTask(env, message)
  if (usageTask.skipReason) {
    logTranslationTaskPerf("queue-message-skipped", {
      taskId: message.taskId,
      requestId: message.requestId,
      userId: message.userId,
      scene: message.scene,
      lane: message.lane,
      ownerTabId: message.ownerTabId,
      reason: usageTask.skipReason,
      taskStatus: usageTask.taskStatus ?? null,
      recoveredStatus: usageTask.recoveredStatus ?? null,
      recoveryAction: usageTask.recoveryAction ?? null,
      queuePosition: usageTask.queuePosition,
      totalMs: Date.now() - startedAt,
    })
    return
  }

  if (!usageTask.leaseId) {
    logTranslationTaskPerf("queue-message-skipped", {
      taskId: message.taskId,
      requestId: message.requestId,
      userId: message.userId,
      scene: message.scene,
      lane: message.lane,
      ownerTabId: message.ownerTabId,
      reason: "no-lease",
      usageTaskStatus: usageTask.status,
      queuePosition: usageTask.queuePosition,
      queueWaitMs: usageTask.queueWaitMs,
      cancelReason: usageTask.cancelReason,
      releaseReason: usageTask.releaseReason,
      totalMs: Date.now() - startedAt,
    })
    return
  }

  const task = await getTranslationTaskForWorker(env, message.taskId)
  if (!task) {
    await releaseUsageTask(env, message.userId, usageTask.leaseId, {
      taskId: message.taskId,
      releaseReason: "task-missing",
    })
    logTranslationTaskPerf("queue-message-skipped", {
      taskId: message.taskId,
      requestId: usageTask.requestId,
      userId: message.userId,
      scene: message.scene,
      lane: message.lane,
      ownerTabId: message.ownerTabId,
      reason: "task-missing",
      usageTaskStatus: usageTask.status,
      totalMs: Date.now() - startedAt,
    })
    return
  }

  if (task.status === "completed" || task.status === "failed" || task.status === "canceled") {
    await releaseUsageTask(env, task.userId, usageTask.leaseId, {
      taskId: task.id,
      releaseReason: task.status,
    })
    if (task.status === "canceled") {
      await publishManagedTaskEvent(env, task, "canceled")
    }
    logTranslationTaskPerf("queue-message-skipped", {
      taskId: task.id,
      requestId: usageTask.requestId,
      userId: task.userId,
      scene: task.scene,
      lane: task.lane,
      ownerTabId: task.ownerTabId,
      reason: "terminal-task",
      taskStatus: task.status,
      usageTaskStatus: usageTask.status,
      totalMs: Date.now() - startedAt,
    })
    return
  }

  if (task.status === "running") {
    logTranslationTaskWarn(buildTaskLogEntry(task, {
      requestId: usageTask.requestId,
      status: "running",
      errorCode: "duplicate_queue_delivery",
      errorMessage: "Skipped duplicate queue delivery for running task",
    }))
    logTranslationTaskPerf("queue-message-skipped", {
      taskId: task.id,
      requestId: usageTask.requestId,
      userId: task.userId,
      scene: task.scene,
      lane: task.lane,
      ownerTabId: task.ownerTabId,
      reason: "duplicate-running-task",
      taskStatus: task.status,
      usageTaskStatus: usageTask.status,
      totalMs: Date.now() - startedAt,
    })
    return
  }

  const runningTask = await markTranslationTaskRunning(env, task.userId, task.id) ?? task
  await publishManagedTaskEvent(env, runningTask, "running")
  logTranslationTaskInfo(buildTaskLogEntry(runningTask, {
    requestId: usageTask.requestId,
    status: "running",
  }))

  const controller = beginManagedTaskExecution(task.id)
  const upstreamStartedAt = Date.now()

  try {
    const upstream = await forwardChatCompletions(
      env,
      buildManagedTranslateBody(runningTask, false),
      await getPlanForUser(env, runningTask.userId),
      controller.signal,
    )
    const payloadText = await upstream.text()
    const upstreamMs = Date.now() - upstreamStartedAt

    const latestTask = await getTranslationTaskForWorker(env, task.id)
    if (latestTask?.status === "canceled") {
      await releaseUsageTask(env, task.userId, usageTask.leaseId, {
        taskId: task.id,
        releaseReason: "canceled",
        upstreamStatus: upstream.status,
      })
      return
    }

    const parseStartedAt = Date.now()
    const payload = extractTranslatedText(payloadText)
    const parseMs = Date.now() - parseStartedAt
    const completeStartedAt = Date.now()
    const completedTask = await completeTranslationTask(env, task.userId, task.id, payload.text)
    if (!completedTask) {
      throw new Error("Translation task disappeared before completion")
    }
    const completeMs = Date.now() - completeStartedAt

    const publishStartedAt = Date.now()
    await publishManagedTaskEvent(env, completedTask, "completed")
    const publishMs = Date.now() - publishStartedAt
    const releaseStartedAt = Date.now()
    await releaseUsageTask(env, task.userId, usageTask.leaseId, {
      taskId: task.id,
      releaseReason: "completed",
      upstreamStatus: upstream.status,
    })
    const releaseMs = Date.now() - releaseStartedAt
    const recordUsageStartedAt = Date.now()
    await recordUsage(
      env,
      task.userId,
      buildTranslationFeatureName(task.scene),
      "generate",
      usageTask.requestCount,
      payload.inputTokens,
      payload.outputTokens,
    )
    const recordUsageMs = Date.now() - recordUsageStartedAt
    logTranslationTaskInfo(buildTaskLogEntry(completedTask, {
      requestId: usageTask.requestId,
      status: "completed",
      upstreamStatus: upstream.status,
      releaseReason: "completed",
    }))
    logTranslationTaskPerf("queue-message-complete", {
      taskId: task.id,
      requestId: usageTask.requestId,
      userId: task.userId,
      scene: task.scene,
      lane: task.lane,
      ownerTabId: task.ownerTabId,
      upstreamStatus: upstream.status,
      upstreamMs,
      parseMs,
      completeMs,
      publishMs,
      releaseMs,
      recordUsageMs,
      totalMs: Date.now() - startedAt,
    })
  }
  catch (error) {
    const latestTask = await getTranslationTaskForWorker(env, task.id)
    const isCanceled = controller.signal.aborted || latestTask?.status === "canceled"
    if (isCanceled) {
      const canceledTask = latestTask?.status === "canceled"
        ? latestTask
        : await cancelTranslationTask(env, task.userId, task.id, "canceled", "Translation task was canceled")

      if (canceledTask) {
        await publishManagedTaskEvent(env, canceledTask, "canceled")
        logTranslationTaskWarn(buildTaskLogEntry(canceledTask, {
          requestId: usageTask.requestId,
          status: "canceled",
          cancelReason: "abort-signal",
        }))
      }

      await releaseUsageTask(env, task.userId, usageTask.leaseId, {
        taskId: task.id,
        releaseReason: "canceled",
      })
      logTranslationTaskPerf("queue-message-canceled", {
        taskId: task.id,
        requestId: usageTask.requestId,
        userId: task.userId,
        scene: task.scene,
        lane: task.lane,
        ownerTabId: task.ownerTabId,
        totalMs: Date.now() - startedAt,
      })
      return
    }

    const errorMessage = error instanceof HttpError
      ? error.message
      : error instanceof Error
        ? error.message
        : "Managed translation task failed"
    const errorCode = error instanceof HttpError ? `upstream_${error.status}` : "upstream_error"
    const failedTask = await failTranslationTask(env, task.userId, task.id, errorMessage, errorCode)

    if (failedTask) {
      await publishManagedTaskEvent(env, failedTask, "failed")
      logTranslationTaskError(buildTaskLogEntry(failedTask, {
        requestId: usageTask.requestId,
        status: "failed",
        releaseReason: "failed",
        errorCode,
        errorMessage,
      }))
    }

    await releaseUsageTask(env, task.userId, usageTask.leaseId, {
      taskId: task.id,
      releaseReason: "failed",
      upstreamStatus: error instanceof HttpError ? error.status : undefined,
    })
    logTranslationTaskPerf("queue-message-failed", {
      taskId: task.id,
      requestId: usageTask.requestId,
      userId: task.userId,
      scene: task.scene,
      lane: task.lane,
      ownerTabId: task.ownerTabId,
      errorCode,
      errorMessage,
      totalMs: Date.now() - startedAt,
    })
  }
  finally {
    finishManagedTaskExecution(task.id)
  }
}

async function createOrAssignBackgroundUsageTask(
  env: Env,
  message: ManagedTranslationQueueMessage,
): Promise<BackgroundUsageTaskAssignment> {
  try {
    const usageTask = await assignUsageTask(env, message.userId, {
      taskId: message.taskId,
      requestId: message.requestId,
    })

    return {
      taskId: usageTask.taskId,
      requestId: usageTask.requestId,
      leaseId: usageTask.leaseId,
      requestCount: usageTask.requestCount,
      status: usageTask.status,
      queuePosition: usageTask.queuePosition,
      queueWaitMs: usageTask.queueWaitMs,
      cancelReason: usageTask.cancelReason,
      releaseReason: usageTask.releaseReason,
    }
  }
  catch (error) {
    if (!isUsageTaskMissingError(error)) {
      throw error
    }

    const task = await getTranslationTaskForWorker(env, message.taskId)
    if (task && (task.status === "queued" || task.status === "dispatched")) {
      const recovered = await recreateBackgroundUsageTask(env, task, message.requestId)
      return {
        taskId: message.taskId,
        requestId: message.requestId,
        leaseId: null,
        requestCount: 1,
        status: recovered.status,
        queuePosition: recovered.queuePosition,
        queueWaitMs: recovered.queueWaitMs,
        cancelReason: recovered.cancelReason,
        releaseReason: recovered.releaseReason,
        skipReason: "usage-task-missing",
        taskStatus: task.status,
        recoveredStatus: recovered.status,
        recoveryAction: "recreated",
      }
    }

    return {
      taskId: message.taskId,
      requestId: message.requestId,
      leaseId: null,
      requestCount: 1,
      status: "released",
      queuePosition: null,
      queueWaitMs: null,
      cancelReason: null,
      releaseReason: null,
      skipReason: "usage-task-missing",
      taskStatus: task?.status ?? null,
      recoveredStatus: null,
      recoveryAction: "ignored",
    }
  }
}
