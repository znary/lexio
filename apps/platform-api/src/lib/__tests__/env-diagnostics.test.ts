import type { Env } from "../env"
import { describe, expect, it } from "vitest"
import { buildPublicEnvDiagnostics } from "../env-diagnostics"

function createEnv(overrides: Partial<Env> = {}): Env {
  return {
    DB: {} as D1Database,
    USAGE_GATE: {} as DurableObjectNamespace,
    CLERK_SECRET_KEY: "sk_test_123",
    CLERK_PUBLISHABLE_KEY: "pk_test_123",
    CLERK_JWT_KEY: "jwt-public-key",
    CLERK_AUDIENCE: "",
    CLERK_AUTHORIZED_PARTIES: "https://lexio.example.com",
    AI_GATEWAY_BASE_URL: "https://gateway.example.com",
    AI_GATEWAY_API_KEY: "gateway-key",
    AI_GATEWAY_MODEL_FREE: "openai/gpt-4.1-nano",
    AI_GATEWAY_MODEL_PRO: "openai/gpt-4.1-mini",
    PADDLE_WEBHOOK_SECRET: "whsec_123",
    PADDLE_PRO_PRICE_ID: "pri_123",
    ...overrides,
  }
}

describe("buildPublicEnvDiagnostics", () => {
  it("reports a healthy runtime without warnings", () => {
    const diagnostics = buildPublicEnvDiagnostics(createEnv())

    expect(diagnostics.checks.aiGatewayBaseUrl.configured).toBe(true)
    expect(diagnostics.checks.aiGatewayBaseUrl.looksLocal).toBe(false)
    expect(diagnostics.warnings).toEqual([])
  })

  it("flags missing and localhost-style values without exposing the secret values", () => {
    const diagnostics = buildPublicEnvDiagnostics(createEnv({
      CLERK_AUTHORIZED_PARTIES: "http://127.0.0.1:3355",
      AI_GATEWAY_BASE_URL: "http://127.0.0.1:8080/chat/completions",
      AI_GATEWAY_API_KEY: "",
      PADDLE_WEBHOOK_SECRET: "",
      PADDLE_PRO_PRICE_ID: "",
    }))

    expect(diagnostics.checks.clerkAuthorizedParties.looksLocal).toBe(true)
    expect(diagnostics.checks.aiGatewayBaseUrl.looksLocal).toBe(true)
    expect(diagnostics.checks.aiGatewayBaseUrl.looksLikeChatCompletionsEndpoint).toBe(true)
    expect(diagnostics.warnings).toEqual(expect.arrayContaining([
      "CLERK_AUTHORIZED_PARTIES still points to localhost or 127.0.0.1",
      "AI_GATEWAY_API_KEY is missing",
      "AI_GATEWAY_BASE_URL still points to localhost or 127.0.0.1",
      "AI_GATEWAY_BASE_URL should be the gateway root, not a /chat/completions endpoint",
      "PADDLE_WEBHOOK_SECRET is missing, webhook verification will fail",
      "PADDLE_PRO_PRICE_ID is missing, Paddle webhooks cannot promote users to pro",
    ]))
  })
})
