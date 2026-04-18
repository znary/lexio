import type { SessionContext } from "../auth"
import type { Env } from "../env"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const syncUserFromClerkMock = vi.fn()
const getPlanForUserMock = vi.fn()
const recordUsageMock = vi.fn()
const forwardChatCompletionsMock = vi.fn()

vi.mock("../db", () => ({
  getPlanForUser: (...args: unknown[]) => getPlanForUserMock(...args),
  syncUserFromClerk: (...args: unknown[]) => syncUserFromClerkMock(...args),
  recordUsage: (...args: unknown[]) => recordUsageMock(...args),
}))

vi.mock("../ai", () => ({
  forwardChatCompletions: (...args: unknown[]) => forwardChatCompletionsMock(...args),
}))

function createEnv(overrides: Partial<Env> = {}): Env {
  return {
    DB: {} as D1Database,
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

const session: SessionContext = {
  clerkUserId: "clerk_user_1",
  sessionId: "session_1",
  tokenType: "clerk",
}

function seedAuthenticatedUser(): void {
  syncUserFromClerkMock.mockResolvedValue({
    id: "user_1",
    clerkUserId: "clerk_user_1",
    email: "user@example.com",
    name: "User",
    avatarUrl: null,
  })
  getPlanForUserMock.mockResolvedValue("free")
  recordUsageMock.mockResolvedValue(undefined)
}

describe("/v1/ai handlers", () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("returns JSON for generate requests without server-side leasing", async () => {
    seedAuthenticatedUser()
    forwardChatCompletionsMock.mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      usage: {
        prompt_tokens: 5,
        completion_tokens: 7,
      },
    }), {
      headers: {
        "Content-Type": "application/json",
      },
    }))

    const { handleAiGenerate } = await import("../../routes/ai")
    const response = await handleAiGenerate(new Request("https://example.com/v1/ai/generate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messages: [{ role: "user", content: "hello" }],
      }),
    }), createEnv(), session)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      ok: true,
      usage: {
        prompt_tokens: 5,
        completion_tokens: 7,
      },
    })
    expect(forwardChatCompletionsMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        stream: false,
      }),
      "free",
      expect.any(AbortSignal),
    )
    expect(recordUsageMock).toHaveBeenCalledWith(
      expect.anything(),
      "user_1",
      "managed-chat",
      "generate",
      1,
      5,
      7,
    )
  })

  it("passes through SSE for stream requests without server-side leasing", async () => {
    seedAuthenticatedUser()
    forwardChatCompletionsMock.mockResolvedValue(new Response(
      "data: {\"choices\":[{\"delta\":{\"content\":\"你\"}}]}\n\ndata: [DONE]\n\n",
      {
        headers: {
          "Content-Type": "text/event-stream; charset=utf-8",
        },
      },
    ))

    const { handleAiStream } = await import("../../routes/ai")
    const response = await handleAiStream(new Request("https://example.com/v1/ai/stream", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messages: [{ role: "user", content: "hello" }],
      }),
    }), createEnv(), session)

    expect(response.status).toBe(200)
    expect(response.headers.get("Content-Type")).toContain("text/event-stream")
    await expect(response.text()).resolves.toContain("data: [DONE]")
    expect(forwardChatCompletionsMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        stream: true,
      }),
      "free",
      expect.any(AbortSignal),
    )
    expect(recordUsageMock).toHaveBeenCalledWith(
      expect.anything(),
      "user_1",
      "managed-chat",
      "stream",
      1,
    )
  })
})
