import type { Env } from "./env"
import { HttpError } from "./http"

export const DEFAULT_WORKERS_AI_TRANSLATION_MODEL = "@cf/meta/m2m100-1.2b"

export interface WorkersAITranslationResult {
  text: string
  inputTokens: number
  outputTokens: number
}

interface WorkersAITranslationUpstreamOutput {
  translated_text?: string
  response?: string
  text?: string
}

const AUTO_SOURCE_PREFIXES = ["auto", "detect", ""]
const KANA_RE = /[\u3040-\u30FF]/
const HANGUL_RE = /[\uAC00-\uD7AF]/
const HAN_RE = /[\u4E00-\u9FFF]/g
const CYRILLIC_RE = /[\u0400-\u04FF]/
const ARABIC_RE = /[\u0600-\u06FF]/
const LANG_CODE_RE = /^[a-z]{2,3}$/

function normalizeWorkersAILangCode(value: string | null | undefined): string | null {
  const normalized = value?.trim().toLowerCase()
  if (!normalized) {
    return null
  }

  return LANG_CODE_RE.test(normalized) ? normalized : null
}

function detectSourceLangByScript(text: string): string | null {
  // Kana is unambiguous: an abundance can only come from Japanese.
  if (KANA_RE.test(text)) {
    return "ja"
  }

  if (HANGUL_RE.test(text)) {
    return "ko"
  }

  const hanChars = (text.match(HAN_RE) ?? []).length
  if (hanChars >= 2) {
    return "zh"
  }

  if (CYRILLIC_RE.test(text)) {
    return "ru"
  }

  if (ARABIC_RE.test(text)) {
    return "ar"
  }

  return null
}

function resolveWorkersAISourceLang(text: string, requestedSource: string | null | undefined): string {
  const requested = normalizeWorkersAILangCode(requestedSource)
  if (requested && !AUTO_SOURCE_PREFIXES.includes(requested)) {
    return requested
  }

  // m2m100 is a seq2seq model: it has no auto-detection. Fall back to a cheap
  // script-based guess so auto-source requests still translate, defaulting to English.
  return detectSourceLangByScript(text) ?? "en"
}

function resolveWorkersAITargetLang(requestedTarget: string | null | undefined): string {
  const target = normalizeWorkersAILangCode(requestedTarget)
  if (!target) {
    throw new HttpError(400, "Missing or invalid target language")
  }

  return target
}

function firstTruthyText(...values: Array<string | undefined>): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim()
    }
  }

  return ""
}

export function resolveWorkersAITranslationModel(env: Env): string {
  return env.WORKERS_AI_TRANSLATION_MODEL?.trim() || DEFAULT_WORKERS_AI_TRANSLATION_MODEL
}

export async function runWorkersAITranslation(
  env: Env,
  body: { text: string, sourceLanguage?: string, targetLanguage?: string },
): Promise<WorkersAITranslationResult> {
  const text = body.text?.trim()
  if (!text) {
    throw new HttpError(400, "Translation text is required")
  }

  if (!env.AI) {
    throw new HttpError(500, "Workers AI is not configured")
  }

  const sourceLang = resolveWorkersAISourceLang(text, body.sourceLanguage)
  const targetLang = resolveWorkersAITargetLang(body.targetLanguage)
  const model = resolveWorkersAITranslationModel(env)

  let upstream: WorkersAITranslationUpstreamOutput
  try {
    upstream = await env.AI.run(model, {
      text,
      source_lang: sourceLang,
      target_lang: targetLang,
    }) as WorkersAITranslationUpstreamOutput
  }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new HttpError(502, `Workers AI translation failed: ${message}`)
  }

  const translatedText = firstTruthyText(upstream?.translated_text, upstream?.response, upstream?.text)
  if (!translatedText) {
    throw new HttpError(502, "Workers AI translation returned empty text")
  }

  return {
    text: translatedText,
    inputTokens: 0,
    outputTokens: 0,
  }
}
