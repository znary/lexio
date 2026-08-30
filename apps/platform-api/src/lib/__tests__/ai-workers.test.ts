import type { Env } from "../env"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

function createAiEnv(overrides: Partial<Env> = {}): Env {
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

describe("runWorkersAITranslation", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("translates with the default workers-ai model and maps language codes", async () => {
    const runMock = vi.fn().mockResolvedValue({ translated_text: "Hola" })
    const env = createAiEnv({
      AI: { run: runMock } as unknown as Env["AI"],
    })

    const { runWorkersAITranslation } = await import("../ai-workers")
    const result = await runWorkersAITranslation(env, {
      text: "hello",
      sourceLanguage: "en",
      targetLanguage: "es",
    })

    expect(result.text).toBe("Hola")
    expect(runMock).toHaveBeenCalledWith(
      "@cf/meta/m2m100-1.2b",
      {
        text: "hello",
        source_lang: "en",
        target_lang: "es",
      },
    )
  })

  it("detects a CJK source language when sourceLanguage is auto", async () => {
    const runMock = vi.fn().mockResolvedValue({ translated_text: "hi" })
    const env = createAiEnv({ AI: { run: runMock } as unknown as Env["AI"] })

    const { runWorkersAITranslation } = await import("../ai-workers")
    await runWorkersAITranslation(env, {
      text: "\u4F60\u597D\u4E16\u754C",
      sourceLanguage: "auto",
      targetLanguage: "en",
    })

    expect(runMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ source_lang: "zh" }),
    )
  })

  it("detects a Japanese source language from kana", async () => {
    const runMock = vi.fn().mockResolvedValue({ translated_text: "hi" })
    const env = createAiEnv({ AI: { run: runMock } as unknown as Env["AI"] })

    const { runWorkersAITranslation } = await import("../ai-workers")
    await runWorkersAITranslation(env, {
      text: "\u3053\u3093\u306B\u3061\u306F",
      sourceLanguage: "auto",
      targetLanguage: "en",
    })

    expect(runMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ source_lang: "ja" }),
    )
  })

  it("detects a Korean source language from hangul", async () => {
    const runMock = vi.fn().mockResolvedValue({ translated_text: "hi" })
    const env = createAiEnv({ AI: { run: runMock } as unknown as Env["AI"] })

    const { runWorkersAITranslation } = await import("../ai-workers")
    await runWorkersAITranslation(env, {
      text: "\uC548\uB155\uD558\uC138\uC694",
      sourceLanguage: "auto",
      targetLanguage: "en",
    })

    expect(runMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ source_lang: "ko" }),
    )
  })

  it("defaults an auto/unknown source language to English for latin text", async () => {
    const runMock = vi.fn().mockResolvedValue({ translated_text: "hi" })
    const env = createAiEnv({ AI: { run: runMock } as unknown as Env["AI"] })

    const { runWorkersAITranslation } = await import("../ai-workers")
    await runWorkersAITranslation(env, {
      text: "hello world",
      sourceLanguage: "auto",
      targetLanguage: "es",
    })

    expect(runMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ source_lang: "en" }),
    )
  })

  it("honors a configurable workers-ai model", async () => {
    const runMock = vi.fn().mockResolvedValue({ translated_text: "x" })
    const env = createAiEnv({
      WORKERS_AI_TRANSLATION_MODEL: "@cf/meta/m2m100-1.2b-faster",
      AI: { run: runMock } as unknown as Env["AI"],
    })

    const { runWorkersAITranslation } = await import("../ai-workers")
    await runWorkersAITranslation(env, {
      text: "hello",
      sourceLanguage: "en",
      targetLanguage: "es",
    })

    expect(runMock).toHaveBeenCalledWith(
      "@cf/meta/m2m100-1.2b-faster",
      expect.anything(),
    )
  })

  it("throws a 400 when the target language is missing", async () => {
    const runMock = vi.fn().mockResolvedValue({ translated_text: "x" })
    const env = createAiEnv({ AI: { run: runMock } as unknown as Env["AI"] })

    const { runWorkersAITranslation } = await import("../ai-workers")
    await expect(runWorkersAITranslation(env, {
      text: "hello",
      sourceLanguage: "en",
    })).rejects.toMatchObject({ status: 400 })
  })

  it("throws a 500 when the AI binding is not configured", async () => {
    const env = createAiEnv()

    const { runWorkersAITranslation } = await import("../ai-workers")
    await expect(runWorkersAITranslation(env, {
      text: "hello",
      sourceLanguage: "en",
      targetLanguage: "es",
    })).rejects.toMatchObject({ status: 500 })
  })

  it("throws a 502 when the model returns empty text", async () => {
    const runMock = vi.fn().mockResolvedValue({})
    const env = createAiEnv({ AI: { run: runMock } as unknown as Env["AI"] })

    const { runWorkersAITranslation } = await import("../ai-workers")
    await expect(runWorkersAITranslation(env, {
      text: "hello",
      sourceLanguage: "en",
      targetLanguage: "es",
    })).rejects.toMatchObject({ status: 502 })
  })
})
