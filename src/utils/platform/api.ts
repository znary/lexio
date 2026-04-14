import type { Config } from "@/types/config/config"
import type { VocabularyItem } from "@/types/vocabulary"
import { buildPlatformApiUrl } from "../constants/platform"
import { clearPlatformAuthSession, getPlatformAuthSession } from "./storage"

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

export async function platformFetch(path: string, init?: RequestInit): Promise<Response> {
  const token = await getAccessTokenOrThrow()
  const headers = new Headers(init?.headers)
  headers.set("Authorization", `Bearer ${token}`)

  const response = await fetch(buildPlatformApiUrl(path), {
    ...init,
    headers,
  })

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
  vocabularyItems: VocabularyItem[]
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
