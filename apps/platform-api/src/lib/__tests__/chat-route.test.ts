import type { SessionContext } from "../auth"
import type { Env } from "../env"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const syncUserFromClerkMock = vi.fn()
const listChatThreadsMock = vi.fn()
const createChatThreadMock = vi.fn()
const getChatThreadMessagesMock = vi.fn()
const appendChatMessageAndStreamReplyMock = vi.fn()
const deleteChatThreadMock = vi.fn()

vi.mock("../db", () => ({
  syncUserFromClerk: (...args: unknown[]) => syncUserFromClerkMock(...args),
  listChatThreads: (...args: unknown[]) => listChatThreadsMock(...args),
  createChatThread: (...args: unknown[]) => createChatThreadMock(...args),
  getChatThreadMessages: (...args: unknown[]) => getChatThreadMessagesMock(...args),
  appendChatMessageAndStreamReply: (...args: unknown[]) => appendChatMessageAndStreamReplyMock(...args),
  deleteChatThread: (...args: unknown[]) => deleteChatThreadMock(...args),
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
}

describe("chat routes", () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    seedAuthenticatedUser()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("returns the current user's chat threads", async () => {
    listChatThreadsMock.mockResolvedValue([
      {
        id: "thread_1",
        title: "First thread",
        createdAt: "2026-04-18T00:00:00.000Z",
        updatedAt: "2026-04-18T01:00:00.000Z",
        lastMessageAt: "2026-04-18T01:00:00.000Z",
      },
    ])

    const { handleChatThreadList } = await import("../../routes/chat")
    const response = await handleChatThreadList(
      new Request("https://example.com/v1/chat/threads", { method: "GET" }),
      createEnv(),
      session,
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      threads: [
        {
          id: "thread_1",
          title: "First thread",
          createdAt: "2026-04-18T00:00:00.000Z",
          updatedAt: "2026-04-18T01:00:00.000Z",
          lastMessageAt: "2026-04-18T01:00:00.000Z",
        },
      ],
    })
    expect(listChatThreadsMock).toHaveBeenCalledWith(expect.anything(), "user_1")
  })

  it("creates a new chat thread", async () => {
    createChatThreadMock.mockResolvedValue({
      id: "thread_1",
      title: "New chat",
      createdAt: "2026-04-18T00:00:00.000Z",
      updatedAt: "2026-04-18T00:00:00.000Z",
      lastMessageAt: null,
    })

    const { handleChatThreadCreate } = await import("../../routes/chat")
    const response = await handleChatThreadCreate(
      new Request("https://example.com/v1/chat/threads", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      }),
      createEnv(),
      session,
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      thread: {
        id: "thread_1",
        title: "New chat",
        createdAt: "2026-04-18T00:00:00.000Z",
        updatedAt: "2026-04-18T00:00:00.000Z",
        lastMessageAt: null,
      },
    })
    expect(createChatThreadMock).toHaveBeenCalledWith(expect.anything(), "user_1")
  })

  it("returns messages for one thread", async () => {
    getChatThreadMessagesMock.mockResolvedValue({
      thread: {
        id: "thread_1",
        title: "First thread",
        createdAt: "2026-04-18T00:00:00.000Z",
        updatedAt: "2026-04-18T01:00:00.000Z",
        lastMessageAt: "2026-04-18T01:00:00.000Z",
      },
      messages: [
        {
          id: "msg_1",
          role: "user",
          contentText: "hello",
          createdAt: "2026-04-18T00:00:00.000Z",
        },
        {
          id: "msg_2",
          role: "assistant",
          contentText: "hi",
          createdAt: "2026-04-18T00:00:01.000Z",
        },
      ],
    })

    const { handleChatThreadMessages } = await import("../../routes/chat")
    const response = await handleChatThreadMessages(
      new Request("https://example.com/v1/chat/threads/thread_1/messages", { method: "GET" }),
      createEnv(),
      session,
      "thread_1",
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      thread: {
        id: "thread_1",
        title: "First thread",
        createdAt: "2026-04-18T00:00:00.000Z",
        updatedAt: "2026-04-18T01:00:00.000Z",
        lastMessageAt: "2026-04-18T01:00:00.000Z",
      },
      messages: [
        {
          id: "msg_1",
          role: "user",
          contentText: "hello",
          createdAt: "2026-04-18T00:00:00.000Z",
        },
        {
          id: "msg_2",
          role: "assistant",
          contentText: "hi",
          createdAt: "2026-04-18T00:00:01.000Z",
        },
      ],
    })
    expect(getChatThreadMessagesMock).toHaveBeenCalledWith(expect.anything(), "user_1", "thread_1")
  })

  it("streams a new reply into an existing thread", async () => {
    appendChatMessageAndStreamReplyMock.mockResolvedValue(new Response(
      "data: {\"choices\":[{\"delta\":{\"content\":\"hi\"}}]}\n\ndata: [DONE]\n\n",
      {
        status: 200,
        headers: {
          "Content-Type": "text/event-stream; charset=utf-8",
        },
      },
    ))

    const { handleChatThreadMessageStream } = await import("../../routes/chat")
    const response = await handleChatThreadMessageStream(
      new Request("https://example.com/v1/chat/threads/thread_1/messages/stream", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          content: "hello",
        }),
      }),
      createEnv(),
      session,
      "thread_1",
    )

    expect(response.status).toBe(200)
    expect(response.headers.get("Content-Type")).toContain("text/event-stream")
    await expect(response.text()).resolves.toContain("data: [DONE]")
    expect(appendChatMessageAndStreamReplyMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        userId: "user_1",
        threadId: "thread_1",
        content: "hello",
      }),
      expect.any(AbortSignal),
    )
  })

  it("deletes a thread", async () => {
    deleteChatThreadMock.mockResolvedValue(true)

    const { handleChatThreadDelete } = await import("../../routes/chat")
    const response = await handleChatThreadDelete(
      new Request("https://example.com/v1/chat/threads/thread_1", {
        method: "DELETE",
      }),
      createEnv(),
      session,
      "thread_1",
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true })
    expect(deleteChatThreadMock).toHaveBeenCalledWith(expect.anything(), "user_1", "thread_1")
  })
})
