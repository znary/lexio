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

function buildTranslateRequest(body: Record<string, unknown>): Request {
  return new Request("https://example.com/v1/translate", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  })
}

function createAiRunMock(result: unknown): ReturnType<typeof vi.fn> {
  return vi.fn().mockResolvedValue(result)
}

describe("/v1/translate handler", () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe("managed-llm engine", () => {
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
      const response = await handleTranslateText(buildTranslateRequest({
        text: "hello",
        systemPrompt: "system",
        prompt: "prompt",
        scene: "page",
      }), createEnv({ MANAGED_TRANSLATION_ENGINE: "managed-llm" }), session)

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
      const response = await handleTranslateText(buildTranslateRequest({
        text: "hello",
        systemPrompt: "system",
        prompt: "prompt",
        scene: "page",
        stream: true,
      }), createEnv({ MANAGED_TRANSLATION_ENGINE: "managed-llm" }), session)

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

  describe("cf-workers-ai engine", () => {
    it("returns JSON from Workers AI when stream is not requested", async () => {
      seedAuthenticatedUser()
      const runMock = createAiRunMock({ translated_text: "Hola" })
      const env = createEnv({
        MANAGED_TRANSLATION_ENGINE: "cf-workers-ai",
        AI: { run: runMock } as unknown as Ai,
      })

      const { handleTranslateText } = await import("../../routes/translate")
      const response = await handleTranslateText(buildTranslateRequest({
        text: "hello",
        sourceLanguage: "en",
        targetLanguage: "es",
        systemPrompt: "system",
        prompt: "prompt",
        scene: "selection",
      }), env, session)

      expect(response.status).toBe(200)
      await expect(response.json()).resolves.toEqual({
        text: "Hola",
      })
      expect(runMock).toHaveBeenCalledWith(
        "@cf/meta/m2m100-1.2b",
        {
          text: "hello",
          source_lang: "en",
          target_lang: "es",
        },
      )
      expect(recordUsageMock).toHaveBeenCalledWith(
        expect.anything(),
        "user_1",
        "managed-translate:selection",
        "generate",
        1,
        0,
        0,
      )
    })

    it("emits SSE when stream=true so streaming clients still work", async () => {
      seedAuthenticatedUser()
      const runMock = createAiRunMock({ translated_text: "Hola" })
      const env = createEnv({
        MANAGED_TRANSLATION_ENGINE: "cf-workers-ai",
        AI: { run: runMock } as unknown as Ai,
      })

      const { handleTranslateText } = await import("../../routes/translate")
      const response = await handleTranslateText(buildTranslateRequest({
        text: "hello",
        sourceLanguage: "en",
        targetLanguage: "es",
        systemPrompt: "system",
        prompt: "prompt",
        stream: true,
        scene: "page",
      }), env, session)

      expect(response.status).toBe(200)
      expect(response.headers.get("Content-Type")).toContain("text/event-stream")
      const raw = await response.text()
      expect(raw).toContain("event: chunk")
      expect(raw).toContain("event: completed")
      expect(raw).toContain("Hola")
      expect(recordUsageMock).toHaveBeenCalledWith(
        expect.anything(),
        "user_1",
        "managed-translate:page",
        "stream",
        1,
        0,
        0,
      )
    })

    it("returns 400 when the target language is missing", async () => {
      seedAuthenticatedUser()
      const env = createEnv({
        MANAGED_TRANSLATION_ENGINE: "cf-workers-ai",
        AI: { run: createAiRunMock({ translated_text: "x" }) } as unknown as Ai,
      })

      const { handleTranslateText } = await import("../../routes/translate")
      await expect(handleTranslateText(buildTranslateRequest({
        text: "hello",
        sourceLanguage: "en",
        systemPrompt: "system",
        prompt: "prompt",
      }), env, session)).rejects.toMatchObject({ status: 400 })
    })
  })
})
