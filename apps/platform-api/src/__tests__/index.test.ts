import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const requireSessionMock = vi.fn()
const noContentMock = vi.fn()
const handleRouteErrorMock = vi.fn()
const handleLlmChatCompletionsMock = vi.fn()
const handleTranslateTextMock = vi.fn()
const handleChatThreadListMock = vi.fn()
const handleChatThreadCreateMock = vi.fn()
const handleChatThreadMessagesMock = vi.fn()
const handleChatThreadMessageStreamMock = vi.fn()
const handleChatThreadDeleteMock = vi.fn()

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

vi.mock("../routes/chat", () => ({
  handleChatThreadList: (...args: unknown[]) => handleChatThreadListMock(...args),
  handleChatThreadCreate: (...args: unknown[]) => handleChatThreadCreateMock(...args),
  handleChatThreadMessages: (...args: unknown[]) => handleChatThreadMessagesMock(...args),
  handleChatThreadMessageStream: (...args: unknown[]) => handleChatThreadMessageStreamMock(...args),
  handleChatThreadDelete: (...args: unknown[]) => handleChatThreadDeleteMock(...args),
}))

vi.mock("../routes/vocabulary", () => ({
  handleVocabularyClear: vi.fn(),
  handleVocabularyCreate: vi.fn(),
  handleVocabularyDelete: vi.fn(),
  handleVocabularyList: vi.fn(),
  handleVocabularyMeta: vi.fn(),
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

  it("routes GET /v1/chat/threads to the chat thread list handler", async () => {
    handleChatThreadListMock.mockResolvedValue(new Response(JSON.stringify({
      threads: [],
    }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
      },
    }))

    const { default: handler } = await import("../index")
    const response = await handler.fetch(
      new Request("https://example.com/v1/chat/threads", {
        method: "GET",
      }),
      {} as never,
      {} as never,
    )

    expect(response.status).toBe(200)
    expect(handleChatThreadListMock).toHaveBeenCalledTimes(1)
  })

  it("routes POST /v1/chat/threads to the chat thread create handler", async () => {
    handleChatThreadCreateMock.mockResolvedValue(new Response(JSON.stringify({
      thread: {
        id: "thread_1",
      },
    }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
      },
    }))

    const { default: handler } = await import("../index")
    const response = await handler.fetch(
      new Request("https://example.com/v1/chat/threads", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      }),
      {} as never,
      {} as never,
    )

    expect(response.status).toBe(200)
    expect(handleChatThreadCreateMock).toHaveBeenCalledTimes(1)
  })

  it("routes GET /v1/chat/threads/:id/messages to the chat message list handler", async () => {
    handleChatThreadMessagesMock.mockResolvedValue(new Response(JSON.stringify({
      thread: { id: "thread_1" },
      messages: [],
    }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
      },
    }))

    const { default: handler } = await import("../index")
    const response = await handler.fetch(
      new Request("https://example.com/v1/chat/threads/thread_1/messages", {
        method: "GET",
      }),
      {} as never,
      {} as never,
    )

    expect(response.status).toBe(200)
    expect(handleChatThreadMessagesMock).toHaveBeenCalledTimes(1)
  })

  it("routes POST /v1/chat/threads/:id/messages/stream to the chat stream handler", async () => {
    handleChatThreadMessageStreamMock.mockResolvedValue(new Response("data: [DONE]\n\n", {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
      },
    }))

    const { default: handler } = await import("../index")
    const response = await handler.fetch(
      new Request("https://example.com/v1/chat/threads/thread_1/messages/stream", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          content: "hello",
        }),
      }),
      {} as never,
      {} as never,
    )

    expect(response.status).toBe(200)
    expect(handleChatThreadMessageStreamMock).toHaveBeenCalledTimes(1)
  })

  it("routes DELETE /v1/chat/threads/:id to the chat delete handler", async () => {
    handleChatThreadDeleteMock.mockResolvedValue(new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
      },
    }))

    const { default: handler } = await import("../index")
    const response = await handler.fetch(
      new Request("https://example.com/v1/chat/threads/thread_1", {
        method: "DELETE",
      }),
      {} as never,
      {} as never,
    )

    expect(response.status).toBe(200)
    expect(handleChatThreadDeleteMock).toHaveBeenCalledTimes(1)
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

  it("routes GET /v1/vocabulary/meta to the lightweight vocabulary meta handler", async () => {
    const { handleVocabularyMeta } = await import("../routes/vocabulary")
    vi.mocked(handleVocabularyMeta).mockResolvedValue(new Response(JSON.stringify({
      updatedAt: 123,
      count: 7,
    }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
      },
    }))

    const { default: handler } = await import("../index")
    const response = await handler.fetch(
      new Request("https://example.com/v1/vocabulary/meta", {
        method: "GET",
      }),
      {} as never,
      {} as never,
    )

    expect(response.status).toBe(200)
    expect(handleVocabularyMeta).toHaveBeenCalledTimes(1)
  })
})
