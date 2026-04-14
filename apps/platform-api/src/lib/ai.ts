import type { Env, Plan } from "./env"
import { HttpError } from "./http"

function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value
}

function resolveGatewayModel(env: Env, plan: Plan): string {
  if (plan === "pro") {
    return env.AI_GATEWAY_MODEL_PRO || "openai/gpt-4.1-mini"
  }

  return env.AI_GATEWAY_MODEL_FREE || "openai/gpt-4.1-nano"
}

export async function forwardChatCompletions(
  env: Env,
  body: Record<string, unknown>,
  plan: Plan,
): Promise<Response> {
  if (!env.AI_GATEWAY_BASE_URL || !env.AI_GATEWAY_API_KEY) {
    throw new HttpError(500, "AI Gateway is not configured")
  }

  const upstreamUrl = `${trimTrailingSlash(env.AI_GATEWAY_BASE_URL)}/chat/completions`
  const upstreamBody = JSON.stringify({
    ...body,
    model: resolveGatewayModel(env, plan),
  })

  const response = await fetch(upstreamUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${env.AI_GATEWAY_API_KEY}`,
    },
    body: upstreamBody,
  })

  if (!response.ok) {
    const errorBody = await response.text()
    throw new HttpError(response.status, errorBody || "Upstream AI Gateway error")
  }

  return response
}
