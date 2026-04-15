import { getExtensionIdFromLocation } from "./env"

interface RuntimeError {
  message?: string
}

declare global {
  interface Window {
    chrome?: {
      runtime?: {
        lastError?: RuntimeError
        sendMessage?: (
          extensionId: string,
          message: unknown,
          callback?: (response?: unknown) => void,
        ) => void
      }
    }
  }
}

export interface PlatformAuthUser {
  id?: string | null
  email?: string | null
  name?: string | null
  imageUrl?: string | null
}

interface PlatformAuthResponse {
  ok?: boolean
  error?: string
}

function getRuntime() {
  return window.chrome?.runtime ?? null
}

function sendExternalMessage(message: unknown): Promise<PlatformAuthResponse> {
  const runtime = getRuntime()
  const extensionId = getExtensionIdFromLocation()

  if (!extensionId) {
    throw new Error("Open this page from the extension again.")
  }

  if (!runtime?.sendMessage) {
    throw new Error("This page must run in a browser that can message the extension.")
  }

  const sendMessage = runtime.sendMessage

  return new Promise((resolve, reject) => {
    sendMessage(extensionId, message, (response) => {
      const runtimeError = runtime.lastError
      if (runtimeError) {
        reject(new Error(runtimeError.message || "The extension rejected the request."))
        return
      }

      resolve(response as PlatformAuthResponse)
    })
  })
}

export async function syncPlatformAuthToExtension(token: string, user: PlatformAuthUser | null | undefined): Promise<void> {
  const response = await sendExternalMessage({
    type: "lexio-platform-auth-sync",
    token,
    user,
  })

  if (!response?.ok) {
    throw new Error(response?.error || "The extension did not accept the sync payload.")
  }
}

export async function clearPlatformAuthSessionInExtension(): Promise<boolean> {
  const runtime = getRuntime()
  const extensionId = getExtensionIdFromLocation()

  if (!extensionId || !runtime?.sendMessage) {
    return false
  }

  try {
    const response = await sendExternalMessage({
      type: "lexio-platform-auth-clear",
    })

    return response?.ok !== false
  }
  catch {
    return false
  }
}
