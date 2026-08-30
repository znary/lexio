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

function resolveApiKeys(env: Env): string[] {
  const keys = [env.LLM_API_KEY, env.LLM_API_KEY_2]
    .map(key => key?.trim() ?? "")
    .filter(Boolean)
  return [...new Set(keys)]
}

// Distribute requests across the configured upstream API keys. The counter is
// process-local (each Worker isolate), so it spreads load reasonably across
// isolates without any cross-request coordination (which would risk 1101).
//
// The cursor is primed with a random offset so that a fresh burst of parallel
// requests (which often land on different isolates) spreads across keys on
// their FIRST attempt. If it always started at 0, every isolate's first request
// would hit key[0], saturate its quota and only re-balance after a 429 retry.
let apiKeyCursor = Math.floor(Math.random() * Number.MAX_SAFE_INTEGER)

function pickApiKey(env: Env): string {
  const keys = resolveApiKeys(env)
  if (keys.length === 0) {
    return ""
  }

  const key = keys[apiKeyCursor % keys.length]
  apiKeyCursor += 1
  return key
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
//
// A new API key is picked for each attempt, so a request rate-limited (429) by
// one key falls back to another key when retried.
async function fetchWithRetry(
  env: Env,
  url: string,
  makeInit: (apiKey: string) => RequestInit,
): Promise<Response> {
  const maxRetries = resolveMaxRetries(env)
  let lastErrorBody = ""

  for (let attempt = 0; ; attempt += 1) {
    const apiKey = pickApiKey(env)
    const init = makeInit(apiKey)
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
  // The retry's main job is to fail over to another API key, so keep the wait
  // short rather than scaling up to seconds (which kept requests spinning in
  // "loading" while waiting for a 429 to clear).
  const exponential = DEFAULT_LLM_RETRY_BASE_DELAY_MS * (2 ** (attempt - 1))
  const jitter = Math.floor(Math.random() * DEFAULT_LLM_RETRY_BASE_DELAY_MS)
  return Math.min(exponential + jitter, 1_000)
}

export async function forwardChatCompletions(
  env: Env,
  body: Record<string, unknown>,
  plan: Plan,
  signal?: AbortSignal,
): Promise<Response> {
  const baseUrl = resolveBaseUrl(env)
  const apiKeys = resolveApiKeys(env)
  const model = resolveModel(env, plan)

  if (!baseUrl) {
    throw new HttpError(500, "LLM_BASE_URL is not configured")
  }
  if (apiKeys.length === 0) {
    throw new HttpError(500, "LLM_API_KEY is not configured")
  }
  if (!model) {
    throw new HttpError(500, "LLM_MODEL is not configured")
  }

  const upstreamUrl = `${baseUrl}/chat/completions`

  const makeInit = (apiKey: string): RequestInit => ({
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

  return await fetchWithRetry(env, upstreamUrl, makeInit)
}
