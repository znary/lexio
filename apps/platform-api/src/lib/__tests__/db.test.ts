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

describe("translation task helpers", () => {
  it("creates a pending translation task and reuses an existing client request key", async () => {
    const prepareMock = vi.fn((sql: string) => {
      if (sql.includes("SELECT")) {
        return {
          sql,
          bind: () => ({
            first: async () => ({
              id: "task_existing",
              user_id: "user_1",
              client_request_key: "client_key_1",
              scene: "web",
              lane: "background",
              mode: "generate",
              owner_tab_id: 12,
              text: "hello",
              source_language: "en",
              target_language: "zh",
              system_prompt: "system",
              prompt: "prompt",
              temperature: 0.2,
              is_batch: 0,
              status: "queued",
              result_text: null,
              error_code: null,
              error_message: null,
              created_at: "2026-04-16T00:00:00.000Z",
              updated_at: "2026-04-16T00:00:00.000Z",
              started_at: null,
              finished_at: null,
              canceled_at: null,
            }),
          }),
        }
      }

      return {
        sql,
        bind: (...args: unknown[]) => ({
          sql,
          args,
          run: vi.fn().mockResolvedValue(undefined),
        }),
      }
    })

    const env = {
      DB: {
        prepare: prepareMock,
      },
    } as unknown as Env

    const { createTranslationTask } = await import("../db")
    const result = await createTranslationTask(env, "user_1", {
      clientRequestKey: "client_key_1",
      scene: "web",
      ownerTabId: 12,
      text: "hello",
      sourceLanguage: "en",
      targetLanguage: "zh",
      systemPrompt: "system",
      prompt: "prompt",
      temperature: 0.2,
      isBatch: false,
    })

    expect(result).toEqual({
      created: false,
      task: {
        id: "task_existing",
        userId: "user_1",
        clientRequestKey: "client_key_1",
        scene: "web",
        lane: "background",
        mode: "generate",
        ownerTabId: 12,
        text: "hello",
        sourceLanguage: "en",
        targetLanguage: "zh",
        systemPrompt: "system",
        prompt: "prompt",
        temperature: 0.2,
        isBatch: false,
        status: "queued",
        resultText: null,
        errorCode: null,
        errorMessage: null,
        createdAt: "2026-04-16T00:00:00.000Z",
        updatedAt: "2026-04-16T00:00:00.000Z",
        startedAt: null,
        finishedAt: null,
        canceledAt: null,
      },
    })
    expect(prepareMock.mock.calls.some(([sql]) => String(sql).includes("INSERT INTO translation_tasks"))).toBe(false)
  })

  it("stores completion data and cancellation timestamps for translation tasks", async () => {
    const runMock = vi.fn().mockResolvedValue(undefined)
    const selectMock = vi.fn().mockResolvedValue({
      id: "task_1",
      user_id: "user_1",
      client_request_key: "client_key_1",
      scene: null,
      lane: "background",
      mode: "generate",
      owner_tab_id: null,
      text: "hello",
      source_language: null,
      target_language: "zh",
      system_prompt: "system",
      prompt: "prompt",
      temperature: null,
      is_batch: 0,
      status: "queued",
      result_text: null,
      error_code: null,
      error_message: null,
      created_at: "2026-04-16T00:00:00.000Z",
      updated_at: "2026-04-16T00:00:00.000Z",
      started_at: null,
      finished_at: null,
      canceled_at: null,
    })
    const prepareMock = vi.fn((sql: string) => {
      if (sql.includes("SELECT")) {
        return {
          sql,
          bind: () => ({
            first: selectMock,
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

    const { completeTranslationTask, cancelTranslationTask } = await import("../db")
    await completeTranslationTask(env, "user_1", "task_1", "你好")
    await cancelTranslationTask(env, "user_1", "task_1")

    expect(runMock).toHaveBeenCalledTimes(2)
    expect(prepareMock.mock.calls.some(([sql]) => String(sql).includes("UPDATE translation_tasks"))).toBe(true)
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
      monthlyRequestLimit: 500,
      monthlyTokenLimit: 500000,
      concurrentRequestLimit: 10,
    })
    expect(runMock).toHaveBeenCalledTimes(1)
  })
})
