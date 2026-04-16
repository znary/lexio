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
