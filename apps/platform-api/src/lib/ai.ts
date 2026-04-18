import type { Env, Plan } from "./env"
import { HttpError } from "./http"

const DEFAULT_ARK_BASE_URL = "https://ark.cn-beijing.volces.com/api/v3"
const DEFAULT_ARK_MODEL = "doubao-seed-2-0-lite-260215"

function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value
}

function firstNonEmpty(...values: Array<string | undefined>): string {
  return values.find(value => value?.trim())?.trim() ?? ""
}

function resolveArkBaseUrl(env: Env): string {
  return firstNonEmpty(env.ARK_BASE_URL, env.AI_GATEWAY_BASE_URL, DEFAULT_ARK_BASE_URL)
}

function resolveArkApiKey(env: Env): string {
  return firstNonEmpty(env.ARK_API_KEY, env.AI_GATEWAY_API_KEY)
}

function resolveArkModel(env: Env, _plan: Plan): string {
  return firstNonEmpty(
    env.ARK_MODEL_PRO,
    env.AI_GATEWAY_MODEL_PRO,
    env.ARK_MODEL,
    env.ARK_MODEL_FREE,
    env.AI_GATEWAY_MODEL_FREE,
    DEFAULT_ARK_MODEL,
  )
}

export async function forwardChatCompletions(
  env: Env,
  body: Record<string, unknown>,
  plan: Plan,
  signal?: AbortSignal,
): Promise<Response> {
  const apiKey = resolveArkApiKey(env)
  if (!apiKey) {
    throw new HttpError(500, "Volcengine Ark is not configured")
  }

  const model = resolveArkModel(env, plan)
  const upstreamUrl = `${trimTrailingSlash(resolveArkBaseUrl(env))}/chat/completions`
  const {
    model: _ignoredModel,
    thinking: _ignoredThinking,
    reasoning: _ignoredReasoning,
    reasoning_effort: _ignoredReasoningEffort,
    ...restBody
  } = body

  const upstreamBody = JSON.stringify({
    ...restBody,
    model,
    thinking: { type: "disabled" as const },
  })

  const response = await fetch(upstreamUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: upstreamBody,
    signal,
  })

  if (!response.ok) {
    const errorBody = await response.text()
    throw new HttpError(response.status, errorBody || "Upstream AI Gateway error")
  }

  return response
}
