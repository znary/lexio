import type { Env, Plan } from "./env"
import { HttpError } from "./http"

export const DEFAULT_LLM_MAX_RETRIES = 4
export const DEFAULT_LLM_RETRY_BASE_DELAY_MS = 300

const RETRYABLE_STATUSES = new Set([429, 500, 502, 503])

function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value
}

function numberFromEnv(value: string | undefined, fallback: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function resolveBaseUrl(env: Env): string {
  return trimTrailingSlash(env.LLM_BASE_URL?.trim() ?? "")
}

function resolveApiKey(env: Env): string {
  return env.LLM_API_KEY?.trim() ?? ""
}

function resolveModel(env: Env, _plan: Plan): string {
  return env.LLM_MODEL?.trim() ?? ""
}

function resolveExtraBody(env: Env): Record<string, unknown> {
  const raw = env.LLM_EXTRA_BODY?.trim()
  if (!raw) {
    return {}
  }

  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {}
  }
  catch {
    return {}
  }
}

function resolveMaxRetries(env: Env): number {
  return numberFromEnv(env.LLM_MAX_RETRIES, DEFAULT_LLM_MAX_RETRIES)
}

// The client may send a `model` from its own provider config, but the upstream
// model is controlled by the platform environment (LLM_MODEL) so it is stripped.
function stripClientModel(body: Record<string, unknown>): Record<string, unknown> {
  const {
    model: _ignoredModel,
    ...restBody
  } = body

  return restBody
}

// A generic OpenAI-compatible passthrough. The upstream base URL, API key,
// model, and any provider-specific request fields (e.g. DeepSeek/B.AI's
// `thinking: { type: "disabled" }`) are all configured via environment variables,
// so switching providers only requires changing env vars, not code. The raw
// response is returned untouched so the caller can proxy streaming SSE directly.
async function fetchWithRetry(
  env: Env,
  url: string,
  init: RequestInit,
): Promise<Response> {
  const maxRetries = resolveMaxRetries(env)
  let lastErrorBody = ""

  for (let attempt = 0; ; attempt += 1) {
    const response = await fetch(url, init)

    if (response.ok) {
      return response
    }

    lastErrorBody = await response.text()

    const retryable = RETRYABLE_STATUSES.has(response.status)
    if (retryable && attempt < maxRetries) {
      await delay(computeRetryDelay(attempt + 1), init.signal ?? undefined)
      continue
    }

    throw new HttpError(response.status, lastErrorBody || "Upstream LLM error")
  }
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms)

    signal?.addEventListener("abort", () => {
      clearTimeout(timer)
      reject(signal.reason ?? new DOMException("Aborted", "AbortError"))
    }, { once: true })
  })
}

function computeRetryDelay(attempt: number): number {
  const exponential = DEFAULT_LLM_RETRY_BASE_DELAY_MS * (2 ** (attempt - 1))
  const jitter = Math.floor(Math.random() * DEFAULT_LLM_RETRY_BASE_DELAY_MS)
  return exponential + jitter
}

export async function forwardChatCompletions(
  env: Env,
  body: Record<string, unknown>,
  plan: Plan,
  signal?: AbortSignal,
): Promise<Response> {
  const baseUrl = resolveBaseUrl(env)
  const apiKey = resolveApiKey(env)
  const model = resolveModel(env, plan)

  if (!baseUrl) {
    throw new HttpError(500, "LLM_BASE_URL is not configured")
  }
  if (!apiKey) {
    throw new HttpError(500, "LLM_API_KEY is not configured")
  }
  if (!model) {
    throw new HttpError(500, "LLM_MODEL is not configured")
  }

  const upstreamUrl = `${baseUrl}/chat/completions`

  return await fetchWithRetry(env, upstreamUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
      "x-api-key": apiKey,
    },
    body: JSON.stringify({
      ...stripClientModel(body),
      ...resolveExtraBody(env),
      model,
    }),
    signal,
  })
}
