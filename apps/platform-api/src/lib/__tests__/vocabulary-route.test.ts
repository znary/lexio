import type { SessionContext } from "../auth"
import type { Env } from "../env"
import { beforeEach, describe, expect, it, vi } from "vitest"

const syncUserFromClerkMock = vi.fn()

vi.mock("../db", () => ({
  syncUserFromClerk: (...args: unknown[]) => syncUserFromClerkMock(...args),
}))

function createEnv(results: unknown[] = []): Env {
  return {
    DB: {
      prepare: vi.fn((sql: string) => ({
        sql,
        bind: (...args: unknown[]) => ({
          sql,
          args,
          all: vi.fn().mockResolvedValue({
            results: sql.includes("FROM vocabulary_item_context_sentences")
              ? [
                  {
                    vocabulary_item_id: "voc_recent",
                    sentence: "The world keeps changing.",
                    source_url: "https://example.com/world",
                    created_at: 10,
                    last_seen_at: 10,
                  },
                  {
                    vocabulary_item_id: "voc_older",
                    sentence: "I said hello there.",
                    source_url: null,
                    created_at: 9,
                    last_seen_at: 9,
                  },
                ]
              : results,
          }),
        }),
      })),
    } as unknown as D1Database,
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
  }
}

const session: SessionContext = {
  clerkUserId: "clerk_user_1",
  sessionId: "session_1",
  tokenType: "clerk",
}

describe("vocabulary routes", () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    syncUserFromClerkMock.mockResolvedValue({
      id: "user_1",
      clerkUserId: "clerk_user_1",
      email: "user@example.com",
      name: "User",
      avatarUrl: null,
    })
  })

  it("orders vocabulary list queries by last seen time before update time", async () => {
    const env = createEnv([
      {
        id: "voc_recent",
        source_text: "world",
        normalized_text: "world",
        context_sentence: null,
        lemma: null,
        match_terms_json: "[]",
        translated_text: "世界",
        phonetic: null,
        part_of_speech: null,
        definition: null,
        difficulty: null,
        source_lang: "en",
        target_lang: "zh-CN",
        kind: "word",
        word_count: 1,
        created_at: 5,
        last_seen_at: 6,
        hit_count: 2,
        updated_at: 50,
        deleted_at: null,
        mastered_at: null,
      },
      {
        id: "voc_older",
        source_text: "hello",
        normalized_text: "hello",
        context_sentence: null,
        lemma: null,
        match_terms_json: "[]",
        translated_text: "你好",
        phonetic: null,
        part_of_speech: null,
        definition: null,
        difficulty: null,
        source_lang: "en",
        target_lang: "zh-CN",
        kind: "word",
        word_count: 1,
        created_at: 1,
        last_seen_at: 2,
        hit_count: 3,
        updated_at: 100,
        deleted_at: null,
        mastered_at: null,
      },
    ])

    const { handleVocabularyList } = await import("../../routes/vocabulary")
    const response = await handleVocabularyList(
      new Request("https://example.com/v1/vocabulary", { method: "GET" }),
      env,
      session,
    )

    const prepareMock = env.DB.prepare as unknown as ReturnType<typeof vi.fn>
    expect(prepareMock).toHaveBeenCalledWith(expect.stringContaining("ORDER BY last_seen_at DESC, updated_at DESC"))
    expect(prepareMock).toHaveBeenCalledWith(expect.stringContaining("FROM vocabulary_item_context_sentences"))
    expect(response.status).toBe(200)
    const responseText = await response.text()
    expect(responseText).toContain("\"contextEntries\": [")
    expect(responseText).toContain("\"contextSentences\": [")
    expect(responseText).toContain("\"The world keeps changing.\"")
    expect(responseText).toContain("\"sourceUrl\": \"https://example.com/world\"")
  })
})
