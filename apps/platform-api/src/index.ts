import type { ExportedHandler } from "@cloudflare/workers-types"
import type { SessionContext } from "./lib/auth"
import type { Env } from "./lib/env"
import { mintExtensionToken, requireSession } from "./lib/auth"
import { handleRouteError, noContent } from "./lib/http"
import { handleExchangeExtensionToken } from "./routes/auth"
import { handleHealthCheck } from "./routes/health"
import { handleLlmChatCompletions } from "./routes/llm"
import { handleMe } from "./routes/me"
import { handlePaddleWebhook } from "./routes/paddle"
import { handleSyncPull, handleSyncPush } from "./routes/sync"
import { handleTranslateText } from "./routes/translate"
import {
  handleVocabularyClear,
  handleVocabularyCreate,
  handleVocabularyDelete,
  handleVocabularyList,
  handleVocabularyMeta,
  handleVocabularyUpdate,
} from "./routes/vocabulary"

type PlatformEnv = Env

const PLATFORM_TOKEN_HEADER = "x-lexio-platform-token"
const PLATFORM_TOKEN_EXPIRES_AT_HEADER = "x-lexio-platform-token-expires-at"
const VOCABULARY_ITEM_PATH_REGEX = /^\/v1\/vocabulary\/([^/]+)$/

async function withRefreshedExtensionSession(response: Response, session: SessionContext | null, env: PlatformEnv): Promise<Response> {
  if (!session || session.tokenType !== "extension") {
    return response
  }

  const nextSession = await mintExtensionToken(session, env)
  const headers = new Headers(response.headers)
  headers.set(PLATFORM_TOKEN_HEADER, nextSession.token)
  headers.set(PLATFORM_TOKEN_EXPIRES_AT_HEADER, nextSession.expiresAt)

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

const handler: ExportedHandler<PlatformEnv> = {
  async fetch(request, env) {
    let session: SessionContext | null = null

    if (request.method === "OPTIONS") {
      return noContent()
    }

    try {
      const url = new URL(request.url)

      if (request.method === "GET" && url.pathname === "/health") {
        return handleHealthCheck(env)
      }

      if (request.method === "POST" && url.pathname === "/webhooks/paddle") {
        return handlePaddleWebhook(request, env)
      }

      session = await requireSession(request, env)
      let response: Response

      if (request.method === "POST" && url.pathname === "/v1/auth/extension-token") {
        response = await handleExchangeExtensionToken(request, env, session)
        return withRefreshedExtensionSession(response, session, env)
      }

      if (request.method === "GET" && url.pathname === "/v1/me") {
        response = await handleMe(request, env, session)
        return withRefreshedExtensionSession(response, session, env)
      }

      if (request.method === "POST" && url.pathname === "/v1/sync/pull") {
        response = await handleSyncPull(request, env, session)
        return withRefreshedExtensionSession(response, session, env)
      }

      if (request.method === "POST" && url.pathname === "/v1/sync/push") {
        response = await handleSyncPush(request, env, session)
        return withRefreshedExtensionSession(response, session, env)
      }

      // Vocabulary API
      if (request.method === "GET" && url.pathname === "/v1/vocabulary") {
        response = await handleVocabularyList(request, env, session)
        return withRefreshedExtensionSession(response, session, env)
      }

      if (request.method === "GET" && url.pathname === "/v1/vocabulary/meta") {
        response = await handleVocabularyMeta(request, env, session)
        return withRefreshedExtensionSession(response, session, env)
      }

      if (request.method === "POST" && url.pathname === "/v1/vocabulary") {
        response = await handleVocabularyCreate(request, env, session)
        return withRefreshedExtensionSession(response, session, env)
      }

      if (request.method === "PUT" && url.pathname === "/v1/vocabulary") {
        response = await handleVocabularyUpdate(request, env, session)
        return withRefreshedExtensionSession(response, session, env)
      }

      if (request.method === "DELETE" && url.pathname === "/v1/vocabulary") {
        response = await handleVocabularyClear(request, env, session)
        return withRefreshedExtensionSession(response, session, env)
      }

      const vocabularyItemMatch = request.method === "DELETE" && url.pathname.match(VOCABULARY_ITEM_PATH_REGEX)
      if (vocabularyItemMatch) {
        response = await handleVocabularyDelete(request, env, session, vocabularyItemMatch[1])
        return withRefreshedExtensionSession(response, session, env)
      }

      if (request.method === "POST" && url.pathname === "/v1/translate") {
        response = await handleTranslateText(request, env, session)
        return withRefreshedExtensionSession(response, session, env)
      }

      if (request.method === "POST" && url.pathname === "/v1/llm/chat/completions") {
        response = await handleLlmChatCompletions(request, env, session)
        return withRefreshedExtensionSession(response, session, env)
      }

      if (request.method === "POST" && url.pathname === "/v1/openai/chat/completions") {
        response = await handleLlmChatCompletions(request, env, session)
        return withRefreshedExtensionSession(response, session, env)
      }

      response = new Response("Not found", { status: 404 })
      return withRefreshedExtensionSession(response, session, env)
    }
    catch (error) {
      return withRefreshedExtensionSession(handleRouteError(error), session, env)
    }
  },
}

export default handler
