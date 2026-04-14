export interface Env {
  DB: D1Database
  USAGE_GATE: DurableObjectNamespace
  CLERK_SECRET_KEY: string
  CLERK_PUBLISHABLE_KEY: string
  CLERK_JWT_KEY?: string
  CLERK_AUDIENCE?: string
  CLERK_AUTHORIZED_PARTIES?: string
  AI_GATEWAY_BASE_URL: string
  AI_GATEWAY_API_KEY: string
  AI_GATEWAY_MODEL_FREE?: string
  AI_GATEWAY_MODEL_PRO?: string
  PADDLE_API_KEY?: string
  PADDLE_WEBHOOK_SECRET?: string
  PADDLE_ENV?: "sandbox" | "production"
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
      concurrentRequestLimit: 8,
    }
  }

  return {
    plan: "free",
    monthlyRequestLimit: 500,
    monthlyTokenLimit: 500_000,
    concurrentRequestLimit: 2,
  }
}
