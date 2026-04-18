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

describe("/v1/translate handler", () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("returns JSON when stream is not requested", async () => {
    seedAuthenticatedUser()
    forwardChatCompletionsMock.mockResolvedValue(new Response(JSON.stringify({
      choices: [
        {
          message: {
            content: "translated",
          },
        },
      ],
      usage: {
        prompt_tokens: 3,
        completion_tokens: 2,
      },
    })))

    const { handleTranslateText } = await import("../../routes/translate")
    const response = await handleTranslateText(new Request("https://example.com/v1/translate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text: "hello",
        systemPrompt: "system",
        prompt: "prompt",
        scene: "page",
      }),
    }), createEnv(), session)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      text: "translated",
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
      "managed-translate:page",
      "generate",
      1,
      3,
      2,
    )
  })

  it("returns SSE from /v1/translate when stream=true", async () => {
    seedAuthenticatedUser()
    forwardChatCompletionsMock.mockResolvedValue(new Response(
      "data: {\"choices\":[{\"delta\":{\"content\":\"你\"}}]}\n\ndata: [DONE]\n\n",
      {
        headers: {
          "Content-Type": "text/event-stream; charset=utf-8",
        },
      },
    ))

    const { handleTranslateText } = await import("../../routes/translate")
    const response = await handleTranslateText(new Request("https://example.com/v1/translate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text: "hello",
        systemPrompt: "system",
        prompt: "prompt",
        scene: "page",
        stream: true,
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
      "managed-translate:page",
      "stream",
      1,
    )
  })
})
