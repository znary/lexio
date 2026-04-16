import type { SessionContext } from "../lib/auth"
import type { Env } from "../lib/env"
import { forwardChatCompletions } from "../lib/ai"
import { buildMePayload, recordUsage, syncUserFromClerk } from "../lib/db"
import { HttpError, json, readJson, withCors } from "../lib/http"
import { completeUsage, reserveUsage } from "../lib/usage-gate"

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

function buildManagedTranslateBody(
  requestBody: ManagedTranslateRequest,
  stream: boolean,
): Record<string, unknown> {
  const temperature = typeof requestBody.temperature === "number" && Number.isFinite(requestBody.temperature)
    ? requestBody.temperature
    : undefined

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
    ...(temperature !== undefined ? { temperature } : {}),
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

async function streamWithLeaseCleanup(
  response: Response,
  onFinish: () => Promise<void>,
): Promise<Response> {
  if (!response.body) {
    await onFinish()
    return response
  }

  const { readable, writable } = new TransformStream()
  const reader = response.body.getReader()
  const writer = writable.getWriter()

  void (async () => {
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) {
          break
        }
        await writer.write(value)
      }
    }
    finally {
      try {
        await writer.close()
      }
      finally {
        await onFinish()
      }
    }
  })()

  return new Response(readable, {
    status: response.status,
    headers: withCors(response.headers),
  })
}

function buildTranslationFeatureName(scene?: string): string {
  const normalizedScene = scene?.trim()
  return normalizedScene ? `managed-translate:${normalizedScene}` : "managed-translate"
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
  )

  try {
    const upstream = await forwardChatCompletions(
      env,
      buildManagedTranslateBody(body, stream),
      me.subscription.plan,
    )

    const feature = buildTranslationFeatureName(body.scene)

    if (stream) {
      return await streamWithLeaseCleanup(upstream, async () => {
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

export async function handleTranslateText(request: Request, env: Env, session: SessionContext) {
  return handleManagedTranslate(request, env, session, false)
}

export async function handleTranslateStream(request: Request, env: Env, session: SessionContext) {
  return handleManagedTranslate(request, env, session, true)
}

export function extractDeltaText(payloadText: string): string {
  const payload = JSON.parse(payloadText) as { choices?: ChatCompletionChunkChoice[] }
  return extractTextContent(payload.choices?.[0]?.delta?.content)
}
