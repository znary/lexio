import type { Env } from "../env"
import { describe, expect, it, vi } from "vitest"
import { UNLIMITED_ENTITLEMENT_VALUE } from "../env"

function createEnv() {
  const prepareMock = vi.fn((sql: string) => ({
    sql,
    bind: (...args: unknown[]) => ({ sql, args }),
  }))
  const batchMock = vi.fn().mockResolvedValue(undefined)

  const env = {
    DB: {
      prepare: prepareMock,
      batch: batchMock,
    },
  } as unknown as Env

  return { env, batchMock }
}

describe("pushSyncData", () => {
  it("keeps existing vocabulary rows when the sync payload omits vocabularyItems", async () => {
    const { env, batchMock } = createEnv()
    const { pushSyncData } = await import("../db")

    await pushSyncData(env, "user_1", {
      settings: { theme: "dark" },
    })

    const statements = batchMock.mock.calls[0][0] as Array<{ sql: string }>
    expect(statements).toHaveLength(2)
    expect(statements.some(statement => statement.sql.includes("DELETE FROM vocabulary_items"))).toBe(false)
  })

  it("replaces vocabulary rows only when vocabularyItems are provided", async () => {
    const { env, batchMock } = createEnv()
    const { pushSyncData } = await import("../db")

    await pushSyncData(env, "user_1", {
      settings: { theme: "dark" },
      vocabularyItems: [
        {
          id: "voc_1",
          sourceText: "thinking",
          normalizedText: "hello",
          lemma: "think",
          matchTerms: ["think", "thinking"],
          translatedText: "思考",
          definition: "思考；认为",
          sourceLang: "en",
          targetLang: "zh-CN",
          kind: "word",
          wordCount: 1,
          createdAt: 1,
          lastSeenAt: 2,
          hitCount: 3,
          updatedAt: 4,
          deletedAt: null,
          masteredAt: 5,
          contextEntries: [
            {
              sentence: "I am thinking now.",
              sourceUrl: "https://example.com/article",
            },
            {
              sentence: "Thinking helps.",
            },
          ],
          contextSentences: ["I am thinking now.", "Thinking helps."],
        },
      ],
    })

    const statements = batchMock.mock.calls[0][0] as Array<{ sql: string }>
    expect(statements).toHaveLength(8)
    expect(statements.some(statement => statement.sql.includes("DELETE FROM vocabulary_item_context_sentences"))).toBe(true)
    expect(statements.some(statement => statement.sql.includes("DELETE FROM vocabulary_items"))).toBe(true)
    expect(statements.some(statement => statement.sql.includes("DELETE FROM vocabulary_practice_states"))).toBe(true)
    const insertStatement = statements.find(statement => statement.sql.includes("INSERT INTO vocabulary_items"))
    const contextInsertStatements = statements.filter(statement => statement.sql.includes("INSERT INTO vocabulary_item_context_sentences"))
    expect(insertStatement?.sql).toContain("source_text")
    expect(insertStatement?.sql).toContain("lemma")
    expect(insertStatement?.sql).toContain("target_lang")
    expect(insertStatement?.sql).toContain("definition")
    expect(insertStatement?.sql).toContain("mastered_at")
    expect(insertStatement?.sql).not.toContain("item_json")
    expect(contextInsertStatements).toHaveLength(2)
    expect(contextInsertStatements[0]?.sql).toContain("source_url")
  })
})

describe("ensureEntitlements", () => {
  it("refreshes stale plan limits even when the plan name has not changed", async () => {
    const runMock = vi.fn().mockResolvedValue(undefined)
    const prepareMock = vi.fn((sql: string) => {
      if (sql.includes("FROM entitlements")) {
        return {
          sql,
          bind: () => ({
            first: async () => ({
              plan: "free",
              monthly_request_limit: 500,
              monthly_token_limit: 500000,
              concurrent_request_limit: 2,
            }),
          }),
        }
      }

      return {
        sql,
        bind: (...args: unknown[]) => ({
          sql,
          args,
          run: runMock,
        }),
      }
    })

    const env = {
      DB: {
        prepare: prepareMock,
      },
    } as unknown as Env

    const { ensureEntitlements } = await import("../db")
    const result = await ensureEntitlements(env, "user_1", "free")

    expect(result).toMatchObject({
      plan: "free",
      monthlyRequestLimit: UNLIMITED_ENTITLEMENT_VALUE,
      monthlyTokenLimit: UNLIMITED_ENTITLEMENT_VALUE,
      concurrentRequestLimit: UNLIMITED_ENTITLEMENT_VALUE,
    })
    expect(runMock).toHaveBeenCalledTimes(1)
  })
})
