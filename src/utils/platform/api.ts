import type { BackgroundTextStreamSnapshot, ThinkingSnapshot } from "@/types/background-stream"
import type { Config } from "@/types/config/config"
import type { VocabularyItem } from "@/types/vocabulary"
import { buildPlatformApiUrl } from "../constants/platform"
import { clearPlatformAuthSession, getPlatformAuthSession, setPlatformAuthSession } from "./storage"

export const PLATFORM_TOKEN_REFRESH_HEADER = "x-lexio-platform-token"
export const PLATFORM_TOKEN_EXPIRES_AT_HEADER = "x-lexio-platform-token-expires-at"

export interface PlatformUserPayload {
  id: string
  clerkUserId: string
  email: string
  name: string
  avatarUrl: string | null
}

export interface PlatformMeResponse {
  user: PlatformUserPayload
  subscription: {
    plan: "free" | "pro"
    status: string
  }
  entitlements: {
    plan: "free" | "pro"
    monthlyRequestLimit: number
    monthlyTokenLimit: number
    concurrentRequestLimit: number
  }
  sync: {
    lastPushAt: string | null
    lastPullAt: string | null
    lastStatus: string
    updatedAt: string
  }
}

export interface PlatformPullResponse {
  settings: Record<string, unknown> | null
  vocabularyItems: VocabularyItem[]
}

export interface ManagedTranslateRequest {
  scene?: string
  text: string
  sourceLanguage?: string
  targetLanguage?: string
  systemPrompt: string
  prompt: string
  temperature?: number
  isBatch?: boolean
}

async function getAccessTokenOrThrow(): Promise<string> {
  const session = await getPlatformAuthSession()
  if (!session?.token) {
    throw new Error("No platform token found. Sign in again.")
  }

  return session.token
}

async function getPlatformErrorMessage(response: Response): Promise<string> {
  const payload = await response.text()
  if (!payload) {
    return `Platform request failed with status ${response.status}`
  }

  try {
    const parsed = JSON.parse(payload) as { error?: string }
    if (typeof parsed.error === "string" && parsed.error.trim()) {
      return parsed.error
    }
  }
  catch {
    // Fall back to the raw response text below.
  }

  return payload
}

export async function refreshPlatformSessionFromResponse(response: Response): Promise<void> {
  const nextToken = response.headers.get(PLATFORM_TOKEN_REFRESH_HEADER)
    ?? response.headers.get("X-Lexio-Platform-Token")
  if (!nextToken?.trim()) {
    return
  }

  const currentSession = await getPlatformAuthSession()
  await setPlatformAuthSession({
    token: nextToken.trim(),
    user: currentSession?.user,
  })
}

export async function platformFetch(path: string, init?: RequestInit): Promise<Response> {
  const token = await getAccessTokenOrThrow()
  const headers = new Headers(init?.headers)
  headers.set("Authorization", `Bearer ${token}`)

  const response = await fetch(buildPlatformApiUrl(path), {
    ...init,
    headers,
  })
  await refreshPlatformSessionFromResponse(response)

  if (response.status === 401) {
    await clearPlatformAuthSession()
    throw new Error("Platform session expired. Sign in again.")
  }

  if (!response.ok) {
    throw new Error(await getPlatformErrorMessage(response))
  }

  return response
}

export async function getPlatformMe(): Promise<PlatformMeResponse> {
  const response = await platformFetch("/v1/me")
  return await response.json() as PlatformMeResponse
}

export async function pullPlatformSync(): Promise<PlatformPullResponse> {
  const response = await platformFetch("/v1/sync/pull", {
    method: "POST",
  })
  return await response.json() as PlatformPullResponse
}

export async function pushPlatformSync(payload: {
  settings: Config
  vocabularyItems?: VocabularyItem[]
}): Promise<{ ok: true, syncedAt: string }> {
  const response = await platformFetch("/v1/sync/push", {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(payload),
  })

  return await response.json() as { ok: true, syncedAt: string }
}

export async function translateWithManagedPlatform(payload: ManagedTranslateRequest): Promise<string> {
  const response = await platformFetch("/v1/translate", {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(payload),
  })

  const data = await response.json() as { text: string }
  return data.text
}

function extractStreamTextPart(payloadText: string): string {
  const payload = JSON.parse(payloadText) as {
    choices?: Array<{
      delta?: {
        content?: string | Array<{ text?: string }>
      }
    }>
  }
  const content = payload.choices?.[0]?.delta?.content

  if (typeof content === "string") {
    return content
  }

  if (!Array.isArray(content)) {
    return ""
  }

  return content
    .map(part => typeof part?.text === "string" ? part.text : "")
    .join("")
}

const STREAM_THINKING_PENDING: ThinkingSnapshot = {
  status: "thinking",
  text: "",
}

const STREAM_THINKING_COMPLETE: ThinkingSnapshot = {
  status: "complete",
  text: "",
}

const STREAM_LINE_SPLIT_RE = /\r?\n/

export async function streamManagedTranslation(
  payload: ManagedTranslateRequest,
  options: {
    signal?: AbortSignal
    onChunk?: (snapshot: BackgroundTextStreamSnapshot) => void
  } = {},
): Promise<BackgroundTextStreamSnapshot> {
  const response = await platformFetch("/v1/translate/stream", {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(payload),
    signal: options.signal,
  })

  if (!response.body) {
    throw new Error("Managed translation stream is unavailable")
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  let translatedText = ""

  const processLine = (line: string) => {
    const trimmedLine = line.trim()
    if (!trimmedLine.startsWith("data:")) {
      return
    }

    const payloadText = trimmedLine.slice(5).trim()
    if (!payloadText || payloadText === "[DONE]") {
      return
    }

    const chunkText = extractStreamTextPart(payloadText)
    if (!chunkText) {
      return
    }

    translatedText += chunkText
    options.onChunk?.({
      output: translatedText,
      thinking: STREAM_THINKING_PENDING,
    })
  }

  while (true) {
    const { done, value } = await reader.read()
    if (done) {
      break
    }

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split(STREAM_LINE_SPLIT_RE)
    buffer = lines.pop() ?? ""

    for (const line of lines) {
      processLine(line)
    }
  }

  buffer += decoder.decode()
  if (buffer.trim()) {
    for (const line of buffer.split(STREAM_LINE_SPLIT_RE)) {
      processLine(line)
    }
  }

  return {
    output: translatedText,
    thinking: STREAM_THINKING_COMPLETE,
  }
}

// Vocabulary API
export async function getVocabularyItems(): Promise<VocabularyItem[]> {
  const response = await platformFetch("/v1/vocabulary")
  const data = await response.json() as { items: VocabularyItem[] }
  return data.items
}

export async function createVocabularyItem(item: VocabularyItem): Promise<{ ok: true, id: string }> {
  const response = await platformFetch("/v1/vocabulary", {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(item),
  })
  return await response.json() as { ok: true, id: string }
}

export async function updateVocabularyItem(item: VocabularyItem): Promise<{ ok: true }> {
  const response = await platformFetch("/v1/vocabulary", {
    method: "PUT",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(item),
  })
  return await response.json() as { ok: true }
}

export async function deleteVocabularyItem(itemId: string): Promise<{ ok: true }> {
  const response = await platformFetch(`/v1/vocabulary/${encodeURIComponent(itemId)}`, {
    method: "DELETE",
  })
  return await response.json() as { ok: true }
}

export async function clearVocabularyItems(): Promise<{ ok: true }> {
  const response = await platformFetch("/v1/vocabulary", {
    method: "DELETE",
  })
  return await response.json() as { ok: true }
}
