import type { ExportedHandler } from "@cloudflare/workers-types"
import type { Env } from "./lib/env"
import { UsageGate } from "./durable-objects/usage-gate"
import { requireSession } from "./lib/auth"
import { handleRouteError, noContent } from "./lib/http"
import { handleAiGenerate, handleAiStream, handleOpenAiChatCompletions } from "./routes/ai"
import { handleHealthCheck } from "./routes/health"
import { handleMe } from "./routes/me"
import { handlePaddleWebhook } from "./routes/paddle"
import { handleSyncPull, handleSyncPush } from "./routes/sync"

const handler: ExportedHandler<Env> = {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return noContent()
    }

    try {
      const url = new URL(request.url)

      if (request.method === "GET" && url.pathname === "/health") {
        return handleHealthCheck()
      }

      if (request.method === "POST" && url.pathname === "/webhooks/paddle") {
        return handlePaddleWebhook(request, env)
      }

      const session = await requireSession(request, env)

      if (request.method === "GET" && url.pathname === "/v1/me") {
        return handleMe(request, env, session)
      }

      if (request.method === "POST" && url.pathname === "/v1/sync/pull") {
        return handleSyncPull(request, env, session)
      }

      if (request.method === "POST" && url.pathname === "/v1/sync/push") {
        return handleSyncPush(request, env, session)
      }

      if (request.method === "POST" && url.pathname === "/v1/ai/generate") {
        return handleAiGenerate(request, env, session)
      }

      if (request.method === "POST" && url.pathname === "/v1/ai/stream") {
        return handleAiStream(request, env, session)
      }

      if (request.method === "POST" && url.pathname === "/v1/openai/chat/completions") {
        return handleOpenAiChatCompletions(request, env, session)
      }

      return new Response("Not found", { status: 404 })
    }
    catch (error) {
      return handleRouteError(error)
    }
  },
}

export { UsageGate }
export default handler
