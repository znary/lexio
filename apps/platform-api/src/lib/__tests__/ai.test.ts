import type { Env } from "../env"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

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
    AI_GATEWAY_MODEL_FREE: "free-model",
    AI_GATEWAY_MODEL_PRO: "pro-model",
    PADDLE_WEBHOOK_SECRET: "whsec_123",
    PADDLE_PRO_PRICE_ID: "pri_123",
    ...overrides,
  }
}

describe("forwardChatCompletions", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("always forwards managed chat requests with thinking disabled and uses the highest tier configured model", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }))
    vi.stubGlobal("fetch", fetchMock)

    const { forwardChatCompletions } = await import("../ai")
    await forwardChatCompletions(createEnv({
      AI_GATEWAY_BASE_URL: "https://ark.cn-beijing.volces.com/api/v3",
      AI_GATEWAY_MODEL_FREE: "ep-ark-free",
    }), {
      model: "user-picked-model",
      thinking: { type: "enabled" },
      messages: [{ role: "user", content: "hello" }],
      stream: false,
    }, "free")

    expect(fetchMock).toHaveBeenCalledTimes(1)

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe("https://ark.cn-beijing.volces.com/api/v3/chat/completions")
    expect(init.headers).toEqual({
      "Content-Type": "application/json",
      "Authorization": "Bearer gateway-key",
    })

    const body = JSON.parse(String(init.body)) as Record<string, unknown>
    expect(body).toEqual(expect.objectContaining({
      model: "pro-model",
      thinking: { type: "disabled" },
      stream: false,
      messages: [{ role: "user", content: "hello" }],
    }))
    expect(body.model).not.toBe("user-picked-model")
  })

  it("accepts ARK_* env vars without the generic gateway vars", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }))
    vi.stubGlobal("fetch", fetchMock)

    const { forwardChatCompletions } = await import("../ai")
    await forwardChatCompletions(createEnv({
      ARK_BASE_URL: "https://ark.cn-beijing.volces.com/api/v3",
      ARK_API_KEY: "ark-key",
      ARK_MODEL: "doubao-seed-2-0-lite-260215",
      AI_GATEWAY_BASE_URL: "",
      AI_GATEWAY_API_KEY: "",
      AI_GATEWAY_MODEL_FREE: "",
      AI_GATEWAY_MODEL_PRO: "",
    }), {
      messages: [{ role: "user", content: "hello" }],
    }, "pro")

    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(String(init.body)) as Record<string, unknown>

    expect(init.headers).toEqual({
      "Content-Type": "application/json",
      "Authorization": "Bearer ark-key",
    })
    expect(body.model).toBe("doubao-seed-2-0-lite-260215")
    expect(body.thinking).toEqual({ type: "disabled" })
  })
})
