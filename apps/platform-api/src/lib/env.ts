export interface Env {
  DB: D1Database
  AI?: Ai
  CLERK_SECRET_KEY: string
  CLERK_PUBLISHABLE_KEY: string
  CLERK_JWT_KEY?: string
  CLERK_AUDIENCE?: string
  CLERK_AUTHORIZED_PARTIES?: string
  PLATFORM_EXTENSION_TOKEN_SECRET?: string
  LLM_API_KEY?: string
  LLM_API_KEY_2?: string
  LLM_BASE_URL?: string
  LLM_MODEL?: string
  LLM_EXTRA_BODY?: string
  LLM_MAX_RETRIES?: string
  MANAGED_TRANSLATION_ENGINE?: string
  WORKERS_AI_TRANSLATION_MODEL?: string
  LEXIO_BACKFILL_DEV?: string
  PLATFORM_CHAT_WEB_FETCH_ENABLED?: string
  PADDLE_WEBHOOK_SECRET?: string
  PADDLE_PRO_PRICE_ID?: string
}

export type Plan = "free" | "pro"

export interface Entitlements {
  plan: Plan
  monthlyRequestLimit: number
  monthlyTokenLimit: number
  concurrentRequestLimit: number
}

export const UNLIMITED_ENTITLEMENT_VALUE = 2_147_483_647

export function toList(value?: string): string[] {
  return (value ?? "")
    .split(",")
    .map(item => item.trim())
    .filter(Boolean)
}

export function isPlatformChatWebFetchEnabled(
  env: Pick<Env, "PLATFORM_CHAT_WEB_FETCH_ENABLED">,
): boolean {
  const value = env.PLATFORM_CHAT_WEB_FETCH_ENABLED?.trim().toLowerCase()
  if (!value) {
    return true
  }

  return value !== "0"
    && value !== "false"
    && value !== "no"
    && value !== "off"
}

export function buildEntitlements(plan: Plan): Entitlements {
  return {
    plan,
    monthlyRequestLimit: UNLIMITED_ENTITLEMENT_VALUE,
    monthlyTokenLimit: UNLIMITED_ENTITLEMENT_VALUE,
    concurrentRequestLimit: UNLIMITED_ENTITLEMENT_VALUE,
  }
}
