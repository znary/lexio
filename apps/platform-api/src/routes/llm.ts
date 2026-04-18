import type { SessionContext } from "../lib/auth"
import type { Env } from "../lib/env"
import { forwardChatCompletions } from "../lib/ai"
import { getPlanForUser, recordUsage, syncUserFromClerk } from "../lib/db"
import { HttpError, readJson, withCors } from "../lib/http"

function logManagedChatPerf(event: string, details: Record<string, unknown>): void {
  console.warn({
    namespace: "managed-chat-perf",
    event,
    ...details,
  })
}

async function streamWithMetrics(
  response: Response,
  options: {
    requestId: string
    userId: string
    startedAt: number
    upstreamMs: number
    onFinish: () => Promise<void>
  },
): Promise<Response> {
  if (!response.body) {
    await options.onFinish()
    logManagedChatPerf("request-complete", {
      requestId: options.requestId,
      userId: options.userId,
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
          logManagedChatPerf("stream-first-chunk", {
            requestId: options.requestId,
            userId: options.userId,
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
      logManagedChatPerf("stream-copy-failed", {
        requestId: options.requestId,
        userId: options.userId,
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
        logManagedChatPerf("request-finish-failed", {
          requestId: options.requestId,
          userId: options.userId,
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

      logManagedChatPerf("request-complete", {
        requestId: options.requestId,
        userId: options.userId,
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

async function handleManagedChat(
  request: Request,
  env: Env,
  session: SessionContext,
  forceStream?: boolean,
): Promise<Response> {
  const requestId = crypto.randomUUID()
  const startedAt = Date.now()
  const body = await readJson<Record<string, unknown>>(request)
  const stream = forceStream ?? body.stream === true
  const user = await syncUserFromClerk(env, session)
  const plan = await getPlanForUser(env, user.id)

  logManagedChatPerf("request-start", {
    requestId,
    userId: user.id,
    stream,
  })

  try {
    const upstreamStartedAt = Date.now()
    const upstream = await forwardChatCompletions(env, {
      ...body,
      stream,
    }, plan, request.signal)
    const upstreamMs = Date.now() - upstreamStartedAt

    if (stream) {
      return await streamWithMetrics(upstream, {
        requestId,
        userId: user.id,
        startedAt,
        upstreamMs,
        onFinish: async () => {
          await recordUsage(env, user.id, "managed-chat", "stream", 1)
        },
      })
    }

    const payload = await upstream.text()

    let usage = { inputTokens: 0, outputTokens: 0 }
    try {
      const parsed = JSON.parse(payload) as { usage?: { prompt_tokens?: number, completion_tokens?: number } }
      usage = {
        inputTokens: parsed.usage?.prompt_tokens ?? 0,
        outputTokens: parsed.usage?.completion_tokens ?? 0,
      }
    }
    catch {
      usage = { inputTokens: 0, outputTokens: 0 }
    }

    await recordUsage(env, user.id, "managed-chat", "generate", 1, usage.inputTokens, usage.outputTokens)

    logManagedChatPerf("request-complete", {
      requestId,
      userId: user.id,
      stream: false,
      upstreamMs,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      totalMs: Date.now() - startedAt,
    })

    return new Response(payload, {
      status: 200,
      headers: withCors({ "Content-Type": "application/json; charset=utf-8" }),
    })
  }
  catch (error) {
    logManagedChatPerf("request-failed", {
      requestId,
      userId: user.id,
      stream,
      totalMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    })

    if (error instanceof HttpError) {
      throw error
    }

    throw new HttpError(500, error instanceof Error ? error.message : "Managed AI request failed")
  }
}

export async function handleLlmChatCompletions(request: Request, env: Env, session: SessionContext) {
  return await handleManagedChat(request, env, session)
}
