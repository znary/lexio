import type { SessionContext } from "../lib/auth"
import type { Env } from "../lib/env"
import { forwardChatCompletions } from "../lib/ai"
import { buildMePayload, recordUsage, syncUserFromClerk } from "../lib/db"
import { HttpError, readJson, withCors } from "../lib/http"
import { completeUsage, reserveUsage } from "../lib/usage-gate"

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

async function handleManagedChat(request: Request, env: Env, session: SessionContext, forceStream?: boolean) {
  const body = await readJson<Record<string, unknown>>(request)
  const user = await syncUserFromClerk(env, session)
  const me = await buildMePayload(env, user)
  const lease = await reserveUsage(
    env,
    user.id,
    me.entitlements,
    forceStream ?? body.stream === true ? "stream" : "generate",
  )

  try {
    const upstream = await forwardChatCompletions(env, {
      ...body,
      stream: forceStream ?? body.stream === true,
    }, me.subscription.plan)

    if (forceStream ?? body.stream === true) {
      return await streamWithLeaseCleanup(upstream, async () => {
        await completeUsage(env, user.id, lease.leaseId)
        await recordUsage(env, user.id, "managed-chat", "stream", lease.requestCount)
      })
    }

    const payload = await upstream.text()
    await completeUsage(env, user.id, lease.leaseId)

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

    await recordUsage(env, user.id, "managed-chat", "generate", lease.requestCount, usage.inputTokens, usage.outputTokens)

    return new Response(payload, {
      status: 200,
      headers: withCors({ "Content-Type": "application/json; charset=utf-8" }),
    })
  }
  catch (error) {
    await completeUsage(env, user.id, lease.leaseId)
    if (error instanceof HttpError) {
      throw error
    }
    throw new HttpError(500, error instanceof Error ? error.message : "Managed AI request failed")
  }
}

export async function handleAiGenerate(request: Request, env: Env, session: SessionContext) {
  return handleManagedChat(request, env, session, false)
}

export async function handleAiStream(request: Request, env: Env, session: SessionContext) {
  return handleManagedChat(request, env, session, true)
}

export async function handleOpenAiChatCompletions(request: Request, env: Env, session: SessionContext) {
  return handleManagedChat(request, env, session)
}
