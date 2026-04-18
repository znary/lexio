export interface Env {
  DB: D1Database
  CLERK_SECRET_KEY: string
  CLERK_PUBLISHABLE_KEY: string
  CLERK_JWT_KEY?: string
  CLERK_AUDIENCE?: string
  CLERK_AUTHORIZED_PARTIES?: string
  PLATFORM_EXTENSION_TOKEN_SECRET?: string
  ARK_API_KEY?: string
  ARK_BASE_URL?: string
  ARK_MODEL?: string
  ARK_MODEL_FREE?: string
  ARK_MODEL_PRO?: string
  MANAGED_TRANSLATION_ENGINE?: string
  AI_GATEWAY_BASE_URL: string
  AI_GATEWAY_API_KEY: string
  AI_GATEWAY_MODEL_FREE?: string
  AI_GATEWAY_MODEL_PRO?: string
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

export function buildEntitlements(plan: Plan): Entitlements {
  return {
    plan,
    monthlyRequestLimit: UNLIMITED_ENTITLEMENT_VALUE,
    monthlyTokenLimit: UNLIMITED_ENTITLEMENT_VALUE,
    concurrentRequestLimit: UNLIMITED_ENTITLEMENT_VALUE,
  }
}
