import type { Env } from "../env"
import { describe, expect, it } from "vitest"
import { buildPublicEnvDiagnostics } from "../env-diagnostics"

function createEnv(overrides: Partial<Env> = {}): Env {
  return {
    DB: {} as D1Database,
    CLERK_SECRET_KEY: "sk_test_123",
    CLERK_PUBLISHABLE_KEY: "pk_test_123",
    CLERK_JWT_KEY: "jwt-public-key",
    CLERK_AUDIENCE: "",
    CLERK_AUTHORIZED_PARTIES: "https://lexio.example.com",
    LLM_BASE_URL: "https://api.example.com/v1",
    LLM_API_KEY: "llm-key",
    LLM_MODEL: "fast-model",
    PADDLE_WEBHOOK_SECRET: "whsec_123",
    PADDLE_PRO_PRICE_ID: "pri_123",
    ...overrides,
  }
}

describe("buildPublicEnvDiagnostics", () => {
  it("reports a healthy LLM configuration", () => {
    const diagnostics = buildPublicEnvDiagnostics(createEnv())
    expect(diagnostics.checks.llmBaseUrl.configured).toBe(true)
    expect(diagnostics.checks.llmBaseUrl.looksLocal).toBe(false)
    expect(diagnostics.checks.llmApiKey).toBe(true)
    expect(diagnostics.checks.llmModelConfigured).toBe(true)
    expect(diagnostics.warnings).toEqual([])
  })

  it("warns about a localhost or chat/completions base URL and missing model", () => {
    const diagnostics = buildPublicEnvDiagnostics(createEnv({
      LLM_BASE_URL: "http://127.0.0.1:8080/chat/completions",
      LLM_API_KEY: "",
      LLM_MODEL: "",
    }))
    expect(diagnostics.checks.llmBaseUrl.looksLocal).toBe(true)
    expect(diagnostics.checks.llmBaseUrl.looksLikeChatCompletionsEndpoint).toBe(true)
    expect(diagnostics.warnings).toEqual(expect.arrayContaining([
      "LLM_API_KEY is missing",
      "LLM_MODEL is missing",
      "LLM_BASE_URL still points to localhost or 127.0.0.1",
      "LLM_BASE_URL should be the API root, not a /chat/completions endpoint",
    ]))
  })
})
