import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const requireSessionMock = vi.fn()
const noContentMock = vi.fn()
const handleRouteErrorMock = vi.fn()
const handleLlmChatCompletionsMock = vi.fn()
const handleTranslateTextMock = vi.fn()

vi.mock("../lib/auth", () => ({
  mintExtensionToken: vi.fn(),
  requireSession: (...args: unknown[]) => requireSessionMock(...args),
}))

vi.mock("../lib/http", () => ({
  handleRouteError: (...args: unknown[]) => handleRouteErrorMock(...args),
  noContent: (...args: unknown[]) => noContentMock(...args),
}))

vi.mock("../routes/llm", () => ({
  handleLlmChatCompletions: (...args: unknown[]) => handleLlmChatCompletionsMock(...args),
}))

vi.mock("../routes/auth", () => ({
  handleExchangeExtensionToken: vi.fn(),
}))

vi.mock("../routes/health", () => ({
  handleHealthCheck: vi.fn(),
}))

vi.mock("../routes/me", () => ({
  handleMe: vi.fn(),
}))

vi.mock("../routes/paddle", () => ({
  handlePaddleWebhook: vi.fn(),
}))

vi.mock("../routes/sync", () => ({
  handleSyncPull: vi.fn(),
  handleSyncPush: vi.fn(),
}))

vi.mock("../routes/translate", () => ({
  handleTranslateText: (...args: unknown[]) => handleTranslateTextMock(...args),
}))

vi.mock("../routes/vocabulary", () => ({
  handleVocabularyClear: vi.fn(),
  handleVocabularyCreate: vi.fn(),
  handleVocabularyDelete: vi.fn(),
  handleVocabularyList: vi.fn(),
  handleVocabularyUpdate: vi.fn(),
}))

describe("platform handler translation routing", () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    requireSessionMock.mockResolvedValue({
      clerkUserId: "clerk_user_1",
      sessionId: "session_1",
      tokenType: "clerk",
    })
    noContentMock.mockReturnValue(new Response(null, { status: 204 }))
    handleRouteErrorMock.mockImplementation((error) => {
      throw error
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("routes POST /v1/translate to the unified translate handler", async () => {
    handleTranslateTextMock.mockResolvedValue(new Response(JSON.stringify({ text: "translated" }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
      },
    }))

    const { default: handler } = await import("../index")
    const response = await handler.fetch(
      new Request("https://example.com/v1/translate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text: "hello",
          systemPrompt: "system",
          prompt: "prompt",
        }),
      }),
      {} as never,
      {} as never,
    )

    expect(response.status).toBe(200)
    expect(handleTranslateTextMock).toHaveBeenCalledTimes(1)
  })

  it("routes POST /v1/llm/chat/completions to the managed llm handler", async () => {
    handleLlmChatCompletionsMock.mockResolvedValue(new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
      },
    }))

    const { default: handler } = await import("../index")
    const response = await handler.fetch(
      new Request("https://example.com/v1/llm/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messages: [{ role: "user", content: "hello" }],
        }),
      }),
      {} as never,
      {} as never,
    )

    expect(response.status).toBe(200)
    expect(handleLlmChatCompletionsMock).toHaveBeenCalledTimes(1)
  })

  it("keeps /v1/openai/chat/completions as a compatibility alias", async () => {
    handleLlmChatCompletionsMock.mockResolvedValue(new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
      },
    }))

    const { default: handler } = await import("../index")
    const response = await handler.fetch(
      new Request("https://example.com/v1/openai/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messages: [{ role: "user", content: "hello" }],
        }),
      }),
      {} as never,
      {} as never,
    )

    expect(response.status).toBe(200)
    expect(handleLlmChatCompletionsMock).toHaveBeenCalledTimes(1)
  })

  it("does not expose the old /v1/translate/stream route", async () => {
    const { default: handler } = await import("../index")
    const response = await handler.fetch(
      new Request("https://example.com/v1/translate/stream", {
        method: "POST",
      }),
      {} as never,
      {} as never,
    )

    expect(response.status).toBe(404)
    expect(handleTranslateTextMock).not.toHaveBeenCalled()
  })

  it("does not expose the old /v1/ai routes", async () => {
    const { default: handler } = await import("../index")
    const generateResponse = await handler.fetch(
      new Request("https://example.com/v1/ai/generate", {
        method: "POST",
      }),
      {} as never,
      {} as never,
    )
    const streamResponse = await handler.fetch(
      new Request("https://example.com/v1/ai/stream", {
        method: "POST",
      }),
      {} as never,
      {} as never,
    )

    expect(generateResponse.status).toBe(404)
    expect(streamResponse.status).toBe(404)
  })

  it("does not expose the old task routes", async () => {
    const { default: handler } = await import("../index")

    const createResponse = await handler.fetch(
      new Request("https://example.com/v1/translate/tasks", {
        method: "POST",
      }),
      {} as never,
      {} as never,
    )
    const streamResponse = await handler.fetch(
      new Request("https://example.com/v1/translate/tasks/task_1/stream", {
        method: "GET",
      }),
      {} as never,
      {} as never,
    )
    const cancelResponse = await handler.fetch(
      new Request("https://example.com/v1/translate/tasks/task_1/cancel", {
        method: "POST",
      }),
      {} as never,
      {} as never,
    )

    expect(createResponse.status).toBe(404)
    expect(streamResponse.status).toBe(404)
    expect(cancelResponse.status).toBe(404)
  })
})
