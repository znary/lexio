import type { Env } from "../env"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const authenticateRequestMock = vi.fn()

vi.mock("@clerk/backend", () => ({
  createClerkClient: () => ({
    authenticateRequest: (...args: unknown[]) => authenticateRequestMock(...args),
  }),
}))

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

describe("platform auth tokens", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("accepts a minted extension token without calling Clerk", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-04-15T00:00:00.000Z"))

    const { mintExtensionToken, requireSession } = await import("../auth")
    const env = createEnv()
    const { token } = await mintExtensionToken({
      clerkUserId: "user_123",
      sessionId: "sess_123",
    }, env)

    const session = await requireSession(new Request("https://example.com/v1/me", {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    }), env)

    expect(session).toEqual({
      clerkUserId: "user_123",
      sessionId: "sess_123",
      tokenType: "extension",
    })
    expect(authenticateRequestMock).not.toHaveBeenCalled()
  })

  it("rejects an expired extension token", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-04-15T00:00:00.000Z"))

    const { mintExtensionToken, requireSession } = await import("../auth")
    const env = createEnv()
    const { token } = await mintExtensionToken({
      clerkUserId: "user_123",
      sessionId: "sess_123",
    }, env)

    vi.setSystemTime(new Date("2026-05-16T00:00:01.000Z"))

    await expect(requireSession(new Request("https://example.com/v1/me", {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    }), env)).rejects.toThrow("Platform session expired. Sign in again.")
  })

  it("falls back to Clerk for normal session tokens", async () => {
    authenticateRequestMock.mockResolvedValue({
      isAuthenticated: true,
      message: null,
      toAuth: () => ({
        userId: "clerk_user_1",
        sessionId: "clerk_session_1",
      }),
    })

    const { requireSession } = await import("../auth")
    const session = await requireSession(new Request("https://example.com/v1/me", {
      headers: {
        Authorization: "Bearer clerk-session-token",
      },
    }), createEnv())

    expect(session).toEqual({
      clerkUserId: "clerk_user_1",
      sessionId: "clerk_session_1",
      tokenType: "clerk",
    })
    expect(authenticateRequestMock).toHaveBeenCalledTimes(1)
  })
})
