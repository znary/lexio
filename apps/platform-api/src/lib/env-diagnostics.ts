import type { Env } from "./env"
import { toList } from "./env"

const DEFAULT_ARK_BASE_URL = "https://ark.cn-beijing.volces.com/api/v3"

function normalizeOptionalValue(value?: string): string {
  return value?.trim() || ""
}

function firstConfiguredValue(...values: Array<string | undefined>): string {
  return values.find(value => normalizeOptionalValue(value))?.trim() ?? ""
}

function hostLooksLocal(hostname: string): boolean {
  const normalizedHost = hostname.trim().toLowerCase()
  return normalizedHost === "localhost"
    || normalizedHost === "127.0.0.1"
    || normalizedHost === "0.0.0.0"
}

function valueLooksLocal(value?: string): boolean {
  const normalizedValue = normalizeOptionalValue(value)
  if (!normalizedValue) {
    return false
  }

  try {
    return hostLooksLocal(new URL(normalizedValue).hostname)
  }
  catch {
    return hostLooksLocal(normalizedValue)
  }
}

function listLooksLocal(value?: string): boolean {
  return toList(value).some(entry => valueLooksLocal(entry))
}

const CHAT_COMPLETIONS_PATH_REGEX = /\/+$/
const CHAT_COMPLETIONS_SUFFIX = "/chat/completions"

function looksLikeChatCompletionsEndpoint(value?: string): boolean {
  const normalizedValue = normalizeOptionalValue(value)
  if (!normalizedValue) {
    return false
  }

  try {
    return new URL(normalizedValue).pathname.replace(CHAT_COMPLETIONS_PATH_REGEX, "").toLowerCase().endsWith(CHAT_COMPLETIONS_SUFFIX)
  }
  catch {
    return normalizedValue.replace(CHAT_COMPLETIONS_PATH_REGEX, "").toLowerCase().endsWith(CHAT_COMPLETIONS_SUFFIX)
  }
}

export interface PublicEnvDiagnostics {
  checks: {
    clerkSecretKey: boolean
    clerkPublishableKey: boolean
    clerkJwtKey: boolean
    clerkAudienceConfigured: boolean
    clerkAuthorizedParties: {
      configured: boolean
      looksLocal: boolean
    }
    aiGatewayBaseUrl: {
      configured: boolean
      looksLocal: boolean
      looksLikeChatCompletionsEndpoint: boolean
    }
    aiGatewayApiKey: boolean
    aiGatewayModelFreeConfigured: boolean
    aiGatewayModelProConfigured: boolean
    paddleWebhookSecret: boolean
    paddleProPriceId: boolean
  }
  warnings: string[]
}

export function buildPublicEnvDiagnostics(env: Env): PublicEnvDiagnostics {
  const aiBaseUrl = firstConfiguredValue(env.ARK_BASE_URL, env.AI_GATEWAY_BASE_URL, DEFAULT_ARK_BASE_URL)
  const aiApiKey = firstConfiguredValue(env.ARK_API_KEY, env.AI_GATEWAY_API_KEY)
  const aiModelFree = firstConfiguredValue(env.ARK_MODEL_FREE, env.AI_GATEWAY_MODEL_FREE, env.ARK_MODEL)
  const aiModelPro = firstConfiguredValue(env.ARK_MODEL_PRO, env.AI_GATEWAY_MODEL_PRO, env.ARK_MODEL)
  const checks: PublicEnvDiagnostics["checks"] = {
    clerkSecretKey: Boolean(normalizeOptionalValue(env.CLERK_SECRET_KEY)),
    clerkPublishableKey: Boolean(normalizeOptionalValue(env.CLERK_PUBLISHABLE_KEY)),
    clerkJwtKey: Boolean(normalizeOptionalValue(env.CLERK_JWT_KEY)),
    clerkAudienceConfigured: Boolean(toList(env.CLERK_AUDIENCE).length),
    clerkAuthorizedParties: {
      configured: Boolean(toList(env.CLERK_AUTHORIZED_PARTIES).length),
      looksLocal: listLooksLocal(env.CLERK_AUTHORIZED_PARTIES),
    },
    aiGatewayBaseUrl: {
      configured: Boolean(aiBaseUrl),
      looksLocal: valueLooksLocal(aiBaseUrl),
      looksLikeChatCompletionsEndpoint: looksLikeChatCompletionsEndpoint(aiBaseUrl),
    },
    aiGatewayApiKey: Boolean(aiApiKey),
    aiGatewayModelFreeConfigured: Boolean(aiModelFree),
    aiGatewayModelProConfigured: Boolean(aiModelPro),
    paddleWebhookSecret: Boolean(normalizeOptionalValue(env.PADDLE_WEBHOOK_SECRET)),
    paddleProPriceId: Boolean(normalizeOptionalValue(env.PADDLE_PRO_PRICE_ID)),
  }

  const warnings: string[] = []

  if (!checks.clerkSecretKey) {
    warnings.push("CLERK_SECRET_KEY is missing")
  }
  if (!checks.clerkPublishableKey) {
    warnings.push("CLERK_PUBLISHABLE_KEY is missing")
  }
  if (!checks.clerkJwtKey) {
    warnings.push("CLERK_JWT_KEY is missing")
  }
  if (checks.clerkAuthorizedParties.looksLocal) {
    warnings.push("CLERK_AUTHORIZED_PARTIES still points to localhost or 127.0.0.1")
  }
  if (!checks.aiGatewayBaseUrl.configured) {
    warnings.push("ARK_BASE_URL or AI_GATEWAY_BASE_URL is missing")
  }
  if (!checks.aiGatewayApiKey) {
    warnings.push("ARK_API_KEY or AI_GATEWAY_API_KEY is missing")
  }
  if (checks.aiGatewayBaseUrl.looksLocal) {
    warnings.push("ARK_BASE_URL or AI_GATEWAY_BASE_URL still points to localhost or 127.0.0.1")
  }
  if (checks.aiGatewayBaseUrl.looksLikeChatCompletionsEndpoint) {
    warnings.push("ARK_BASE_URL or AI_GATEWAY_BASE_URL should be the API root, not a /chat/completions endpoint")
  }
  if (!checks.paddleWebhookSecret) {
    warnings.push("PADDLE_WEBHOOK_SECRET is missing, webhook verification will fail")
  }
  if (!checks.paddleProPriceId) {
    warnings.push("PADDLE_PRO_PRICE_ID is missing, Paddle webhooks cannot promote users to pro")
  }

  return {
    checks,
    warnings,
  }
}
