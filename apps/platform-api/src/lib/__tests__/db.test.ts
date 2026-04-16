import type { Env } from "../env"
import { describe, expect, it, vi } from "vitest"

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
          normalizedText: "hello",
        },
      ],
    })

    const statements = batchMock.mock.calls[0][0] as Array<{ sql: string }>
    expect(statements).toHaveLength(4)
    expect(statements.some(statement => statement.sql.includes("DELETE FROM vocabulary_items"))).toBe(true)
    expect(statements.some(statement => statement.sql.includes("INSERT INTO vocabulary_items"))).toBe(true)
  })
})
