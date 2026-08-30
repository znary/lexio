import type { Env } from "../env"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

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

describe("forwardChatCompletions", () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("forwards to the configured OpenAI-compatible endpoint with model and auth headers", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: "stub" } }],
    }), { status: 200 }))
    vi.stubGlobal("fetch", fetchMock)

    const { forwardChatCompletions } = await import("../ai")
    await forwardChatCompletions(createEnv(), {
      messages: [{ role: "user", content: "hi" }],
    }, "free")

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe("https://api.example.com/v1/chat/completions")
    const headers = new Headers(init?.headers)
    expect(headers.get("Authorization")).toBe("Bearer llm-key")
    expect(headers.get("x-api-key")).toBe("llm-key")
    expect(JSON.parse(String(init?.body))).toEqual({
      messages: [{ role: "user", content: "hi" }],
      model: "fast-model",
    })
  })

  it("merges provider-specific extra body fields from LLM_EXTRA_BODY and lets the model win", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }))
    vi.stubGlobal("fetch", fetchMock)

    const { forwardChatCompletions } = await import("../ai")
    await forwardChatCompletions(createEnv({
      LLM_EXTRA_BODY: JSON.stringify({ thinking: { type: "disabled" } }),
    }), {
      messages: [],
      model: "client-model",
    }, "free")

    const [, init] = fetchMock.mock.calls[0]
    expect(JSON.parse(String(init?.body))).toEqual({
      messages: [],
      thinking: { type: "disabled" },
      model: "fast-model",
    })
  })

  it("throws a 500 when LLM_BASE_URL is not configured", async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    const { forwardChatCompletions } = await import("../ai")
    await expect(forwardChatCompletions(createEnv({ LLM_BASE_URL: "" }), {
      messages: [],
    }, "free")).rejects.toMatchObject({ status: 500, message: "LLM_BASE_URL is not configured" })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("throws a 500 when LLM_API_KEY is not configured", async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    const { forwardChatCompletions } = await import("../ai")
    await expect(forwardChatCompletions(createEnv({ LLM_API_KEY: "" }), {
      messages: [],
    }, "free")).rejects.toMatchObject({ status: 500, message: "LLM_API_KEY is not configured" })
  })

  it("throws a 500 when LLM_MODEL is not configured", async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    const { forwardChatCompletions } = await import("../ai")
    await expect(forwardChatCompletions(createEnv({ LLM_MODEL: "" }), {
      messages: [],
    }, "free")).rejects.toMatchObject({ status: 500, message: "LLM_MODEL is not configured" })
  })

  it("surfaces the upstream error body on a non-retryable status", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("model not found", { status: 404 }))
    vi.stubGlobal("fetch", fetchMock)

    const { forwardChatCompletions } = await import("../ai")
    await expect(forwardChatCompletions(createEnv(), {
      messages: [],
    }, "free")).rejects.toMatchObject({ status: 404, message: "model not found" })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("retries transient 429 responses with backoff before succeeding", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("rate limited", { status: 429 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{ message: { content: "ok" } }],
      }), { status: 200 }))
    vi.stubGlobal("fetch", fetchMock)

    const { forwardChatCompletions } = await import("../ai")
    const response = await forwardChatCompletions(createEnv({ LLM_MAX_RETRIES: "2" }), {
      messages: [],
    }, "free")

    expect(response.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  }, 15_000)

  it("throws after exhausting transient retries", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("rate limited", { status: 429 }))
      .mockResolvedValueOnce(new Response("rate limited", { status: 429 }))
    vi.stubGlobal("fetch", fetchMock)

    const { forwardChatCompletions } = await import("../ai")
    await expect(forwardChatCompletions(createEnv({ LLM_MAX_RETRIES: "1" }), {
      messages: [],
    }, "free")).rejects.toMatchObject({ status: 429, message: "rate limited" })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  }, 15_000)

  it("distributes requests across LLM_API_KEY and LLM_API_KEY_2", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: "stub" } }],
    }), { status: 200 }))
    vi.stubGlobal("fetch", fetchMock)

    const { forwardChatCompletions } = await import("../ai")
    const env = createEnv({ LLM_API_KEY_2: "llm-key-2" })
    await forwardChatCompletions(env, { messages: [] }, "free")
    await forwardChatCompletions(env, { messages: [] }, "free")

    const usedKeys = fetchMock.mock.calls.map(([, init]) => {
      const headers = new Headers(init?.headers)
      return headers.get("Authorization")
    })
    expect(new Set(usedKeys)).toEqual(new Set(["Bearer llm-key", "Bearer llm-key-2"]))
  })

  it("falls back to the other key when one returns 429", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("rate limited", { status: 429 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{ message: { content: "ok" } }],
      }), { status: 200 }))
    vi.stubGlobal("fetch", fetchMock)

    const { forwardChatCompletions } = await import("../ai")
    const env = createEnv({ LLM_API_KEY_2: "llm-key-2", LLM_MAX_RETRIES: "1" })
    const response = await forwardChatCompletions(env, { messages: [] }, "free")

    expect(response.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const usedKeys = fetchMock.mock.calls.map(([, init]) => new Headers(init?.headers).get("Authorization"))
    expect(new Set(usedKeys)).toEqual(new Set(["Bearer llm-key", "Bearer llm-key-2"]))
  }, 15_000)
})
