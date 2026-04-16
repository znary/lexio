export interface Env {
  DB: D1Database
  USAGE_GATE: DurableObjectNamespace
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

export function toList(value?: string): string[] {
  return (value ?? "")
    .split(",")
    .map(item => item.trim())
    .filter(Boolean)
}

export function buildEntitlements(plan: Plan): Entitlements {
  if (plan === "pro") {
    return {
      plan,
      monthlyRequestLimit: 5000,
      monthlyTokenLimit: 5_000_000,
      concurrentRequestLimit: 20,
    }
  }

  return {
    plan: "free",
    monthlyRequestLimit: 500,
    monthlyTokenLimit: 500_000,
    concurrentRequestLimit: 10,
  }
}
