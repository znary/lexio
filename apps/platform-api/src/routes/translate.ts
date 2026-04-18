import type { SessionContext } from "../lib/auth"
import type { Env } from "../lib/env"
import { forwardChatCompletions } from "../lib/ai"
import { getPlanForUser, recordUsage, syncUserFromClerk } from "../lib/db"
import { HttpError, json, readJson, withCors } from "../lib/http"

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
  stream?: boolean
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

function logManagedTranslatePerf(event: string, details: Record<string, unknown>): void {
  console.warn({
    namespace: "managed-translate-perf",
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

function buildManagedTranslateBody(
  requestBody: ManagedTranslateRequest,
  stream: boolean,
): Record<string, unknown> {
  const temperature = normalizeTemperature(requestBody.temperature)

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

function buildTranslationFeatureName(scene?: string | null): string {
  const normalizedScene = scene?.trim()
  return normalizedScene ? `managed-translate:${normalizedScene}` : "managed-translate"
}

async function streamWithMetrics(
  response: Response,
  options: {
    requestId: string
    userId: string
    scene: string | null
    isBatch: boolean
    startedAt: number
    upstreamMs: number
    onFinish: () => Promise<void>
  },
): Promise<Response> {
  if (!response.body) {
    await options.onFinish()
    logManagedTranslatePerf("request-complete", {
      requestId: options.requestId,
      userId: options.userId,
      scene: options.scene,
      isBatch: options.isBatch,
      stream: true,
      upstreamMs: options.upstreamMs,
      firstChunkMs: null,
      chunkCount: 0,
      byteLength: 0,
      totalMs: Date.now() - options.startedAt,
    })

    return new Response(response.body, {
      status: response.status,
      headers: withCors(response.headers),
    })
  }

  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>()
  const reader = response.body.getReader()
  const writer = writable.getWriter()
  let chunkCount = 0
  let byteLength = 0
  let firstChunkMs: number | null = null

  void (async () => {
    let streamError: unknown = null

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) {
          break
        }

        if (firstChunkMs === null) {
          firstChunkMs = Date.now() - options.startedAt
          logManagedTranslatePerf("stream-first-chunk", {
            requestId: options.requestId,
            userId: options.userId,
            scene: options.scene,
            isBatch: options.isBatch,
            upstreamMs: options.upstreamMs,
            firstChunkMs,
          })
        }

        chunkCount += 1
        byteLength += value.byteLength
        await writer.write(value)
      }
    }
    catch (error) {
      streamError = error
      logManagedTranslatePerf("stream-copy-failed", {
        requestId: options.requestId,
        userId: options.userId,
        scene: options.scene,
        isBatch: options.isBatch,
        totalMs: Date.now() - options.startedAt,
        error: error instanceof Error ? error.message : String(error),
      })
    }
    finally {
      reader.releaseLock()

      try {
        await options.onFinish()
      }
      catch (error) {
        if (!streamError) {
          streamError = error
        }
        logManagedTranslatePerf("request-finish-failed", {
          requestId: options.requestId,
          userId: options.userId,
          scene: options.scene,
          isBatch: options.isBatch,
          totalMs: Date.now() - options.startedAt,
          error: error instanceof Error ? error.message : String(error),
        })
      }

      if (streamError) {
        await writer.abort(streamError)
      }
      else {
        await writer.close()
      }

      logManagedTranslatePerf("request-complete", {
        requestId: options.requestId,
        userId: options.userId,
        scene: options.scene,
        isBatch: options.isBatch,
        stream: true,
        upstreamMs: options.upstreamMs,
        firstChunkMs,
        chunkCount,
        byteLength,
        totalMs: Date.now() - options.startedAt,
      })
    }
  })()

  return new Response(readable, {
    status: response.status,
    headers: withCors(response.headers),
  })
}

async function handleManagedTranslate(
  request: Request,
  env: Env,
  session: SessionContext,
  body: ManagedTranslateRequest,
  stream: boolean,
): Promise<Response> {
  const requestId = crypto.randomUUID()
  const startedAt = Date.now()
  const engine = resolveManagedTranslationEngine(env)
  assertTranslationEngineImplemented(engine)

  if (!body.text?.trim()) {
    throw new HttpError(400, "Translation text is required")
  }

  if (!body.systemPrompt?.trim() || !body.prompt?.trim()) {
    throw new HttpError(400, "Translation prompt is required")
  }

  const user = await syncUserFromClerk(env, session)
  const plan = await getPlanForUser(env, user.id)
  const feature = buildTranslationFeatureName(body.scene)
  const scene = body.scene?.trim() || null

  logManagedTranslatePerf("request-start", {
    requestId,
    userId: user.id,
    scene,
    isBatch: Boolean(body.isBatch),
    stream,
    textLength: body.text.length,
  })

  try {
    const upstreamStartedAt = Date.now()
    const upstream = await forwardChatCompletions(
      env,
      buildManagedTranslateBody(body, stream),
      plan,
      request.signal,
    )
    const upstreamMs = Date.now() - upstreamStartedAt

    if (stream) {
      return await streamWithMetrics(upstream, {
        requestId,
        userId: user.id,
        scene,
        isBatch: Boolean(body.isBatch),
        startedAt,
        upstreamMs,
        onFinish: async () => {
          await recordUsage(env, user.id, feature, "stream", 1)
        },
      })
    }

    const parseStartedAt = Date.now()
    const payloadText = await upstream.text()
    const payload = extractTranslatedText(payloadText)
    await recordUsage(
      env,
      user.id,
      feature,
      "generate",
      1,
      payload.inputTokens,
      payload.outputTokens,
    )

    logManagedTranslatePerf("request-complete", {
      requestId,
      userId: user.id,
      scene,
      isBatch: Boolean(body.isBatch),
      stream: false,
      upstreamMs,
      parseMs: Date.now() - parseStartedAt,
      inputTokens: payload.inputTokens,
      outputTokens: payload.outputTokens,
      resultLength: payload.text.length,
      totalMs: Date.now() - startedAt,
    })

    return json({ text: payload.text })
  }
  catch (error) {
    logManagedTranslatePerf("request-failed", {
      requestId,
      userId: user.id,
      scene,
      isBatch: Boolean(body.isBatch),
      stream,
      totalMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    })

    if (error instanceof HttpError) {
      throw error
    }

    throw new HttpError(500, error instanceof Error ? error.message : "Managed translation failed")
  }
}

export async function handleTranslateText(request: Request, env: Env, session: SessionContext): Promise<Response> {
  const body = await readJson<ManagedTranslateRequest>(request)
  return await handleManagedTranslate(request, env, session, body, body.stream === true)
}
