import type { SessionContext } from "../auth"
import type { Env } from "../env"
import { beforeEach, describe, expect, it, vi } from "vitest"

const syncUserFromClerkMock = vi.fn()

vi.mock("../db", () => ({
  syncUserFromClerk: (...args: unknown[]) => syncUserFromClerkMock(...args),
}))

const session: SessionContext = {
  clerkUserId: "clerk_user_1",
  sessionId: "session_1",
  tokenType: "clerk",
}

describe("practice routes", () => {
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

  it("returns practice states alongside active vocabulary items", async () => {
    const prepareMock = vi.fn((sql: string) => ({
      sql,
      bind: (...args: unknown[]) => ({
        sql,
        args,
        all: vi.fn().mockResolvedValue({
          results: sql.includes("FROM vocabulary_practice_states")
            ? [
                {
                  item_id: "voc_recent",
                  last_practiced_at: 40,
                  last_decision: "review-again",
                  review_again_count: 2,
                  updated_at: 41,
                },
              ]
            : sql.includes("FROM vocabulary_item_context_sentences")
              ? [
                  {
                    vocabulary_item_id: "voc_recent",
                    sentence: "The world keeps changing.",
                    source_url: "https://example.com/world",
                    created_at: 10,
                    last_seen_at: 10,
                  },
                ]
              : [
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
                ],
        }),
      }),
    }))

    const env = {
      DB: {
        prepare: prepareMock,
      },
    } as unknown as Env

    const { handlePracticeSession } = await import("../../routes/practice")
    const response = await handlePracticeSession(
      new Request("https://example.com/v1/practice", { method: "GET" }),
      env,
      session,
    )

    expect(response.status).toBe(200)
    const responseText = await response.text()
    expect(responseText).toContain("\"practiceStates\": [")
    expect(responseText).toContain("\"itemId\": \"voc_recent\"")
    expect(responseText).toContain("\"lastDecision\": \"review-again\"")
    expect(responseText).toContain("\"The world keeps changing.\"")
  })

  it("marks a practiced item as mastered and stores the practice state", async () => {
    const runMock = vi.fn().mockResolvedValue({ meta: { changes: 1 } })
    const prepareMock = vi.fn((sql: string) => ({
      sql,
      bind: (...args: unknown[]) => ({
        sql,
        args,
        first: vi.fn().mockResolvedValue(
          sql.includes("FROM vocabulary_items")
            ? {
                id: "voc_1",
                mastered_at: null,
              }
            : {
                review_again_count: 1,
              },
        ),
        run: runMock,
      }),
    }))

    const env = {
      DB: {
        prepare: prepareMock,
      },
    } as unknown as Env

    const { handleVocabularyPracticeResult } = await import("../../routes/practice")
    const response = await handleVocabularyPracticeResult(
      new Request("https://example.com/v1/vocabulary/voc_1/practice-result", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          decision: "mastered",
          practicedAt: 123,
        }),
      }),
      env,
      session,
      "voc_1",
    )

    expect(response.status).toBe(200)
    const responseText = await response.text()
    expect(responseText).toContain("\"masteredAt\": 123")
    expect(responseText).toContain("\"lastDecision\": \"mastered\"")
    expect(runMock).toHaveBeenCalledTimes(2)
  })
})
