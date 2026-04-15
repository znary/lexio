import type { PlatformAuthSession } from "@/utils/platform/storage"
import { buildPlatformApiUrl } from "@/utils/constants/platform"

export interface PlatformAuthSyncMessage {
  type: "lexio-platform-auth-sync"
  token: string
  user?: {
    id?: string | null
    email?: string | null
    name?: string | null
    imageUrl?: string | null
  }
}

export interface PlatformAuthClearMessage {
  type: "lexio-platform-auth-clear"
}

export type PlatformAuthExternalMessage = PlatformAuthSyncMessage | PlatformAuthClearMessage

export interface PlatformAuthExchangePayload {
  token: string
  expiresAt?: string
  user?: {
    id?: string | null
    email?: string | null
    name?: string | null
    imageUrl?: string | null
  }
}

export interface HandlePlatformAuthExternalMessageParams {
  message: unknown
  senderUrl?: string
  websiteOrigin: string | null
  setPlatformAuthSession: (payload: Omit<PlatformAuthSession, "updatedAt"> & { updatedAt?: number }) => Promise<unknown>
  clearPlatformAuthSession: () => Promise<unknown>
  exchangeWebsiteToken?: (token: string) => Promise<PlatformAuthExchangePayload>
}

export function isPlatformAuthSyncMessage(value: unknown): value is PlatformAuthSyncMessage {
  if (!value || typeof value !== "object") {
    return false
  }

  const message = value as Record<string, unknown>
  return message.type === "lexio-platform-auth-sync" && typeof message.token === "string" && message.token.trim().length > 0
}

export function isPlatformAuthClearMessage(value: unknown): value is PlatformAuthClearMessage {
  if (!value || typeof value !== "object") {
    return false
  }

  return (value as Record<string, unknown>).type === "lexio-platform-auth-clear"
}

export function isAuthorizedExternalSender(senderUrl: string | undefined, websiteOrigin: string | null): boolean {
  if (!websiteOrigin || !senderUrl) {
    return false
  }

  try {
    return new URL(senderUrl).origin === websiteOrigin
  }
  catch {
    return false
  }
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
    // Ignore invalid JSON and fall back to the raw text below.
  }

  return payload
}

export async function exchangeWebsiteTokenForPlatformSession(token: string): Promise<PlatformAuthExchangePayload> {
  const response = await fetch(buildPlatformApiUrl("/v1/auth/extension-token"), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  })

  if (!response.ok) {
    throw new Error(await getPlatformErrorMessage(response))
  }

  return await response.json() as PlatformAuthExchangePayload
}

export async function handlePlatformAuthExternalMessage({
  message,
  senderUrl,
  websiteOrigin,
  setPlatformAuthSession,
  clearPlatformAuthSession,
  exchangeWebsiteToken = exchangeWebsiteTokenForPlatformSession,
}: HandlePlatformAuthExternalMessageParams): Promise<{ ok: true } | { ok: false, error: string } | null> {
  if (!isPlatformAuthSyncMessage(message) && !isPlatformAuthClearMessage(message)) {
    return null
  }

  if (!isAuthorizedExternalSender(senderUrl, websiteOrigin)) {
    return { ok: false, error: "Unauthorized sender" }
  }

  try {
    if (isPlatformAuthSyncMessage(message)) {
      const nextSession = await exchangeWebsiteToken(message.token)
      await setPlatformAuthSession({
        token: nextSession.token,
        user: nextSession.user ?? message.user,
      })
    }
    else {
      await clearPlatformAuthSession()
    }

    return { ok: true }
  }
  catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Failed to update platform session",
    }
  }
}
