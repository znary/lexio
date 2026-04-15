export const PADDLE_CLIENT_TOKEN = import.meta.env.VITE_PADDLE_CLIENT_TOKEN || ""
export const PADDLE_ENV = (import.meta.env.VITE_PADDLE_ENV || "sandbox") as "sandbox" | "production"
export const DEFAULT_EXTENSION_ID = import.meta.env.VITE_EXTENSION_ID || ""

const EXTENSION_ID_QUERY_PARAM = "extensionId"
const EXTENSION_ID_SESSION_STORAGE_KEY = "lexio.platform.extensionId"

function readStoredExtensionId(): string {
  try {
    return window.sessionStorage.getItem(EXTENSION_ID_SESSION_STORAGE_KEY)?.trim() || ""
  }
  catch {
    return ""
  }
}

export function getStoredExtensionId(): string {
  return readStoredExtensionId() || DEFAULT_EXTENSION_ID
}

function persistExtensionId(extensionId: string): void {
  try {
    window.sessionStorage.setItem(EXTENSION_ID_SESSION_STORAGE_KEY, extensionId)
  }
  catch {
    // Ignore storage failures so sign-in still works in stricter browser modes.
  }
}

export function getExtensionIdFromLocation(): string {
  const query = new URLSearchParams(window.location.search)
  const extensionId = query.get(EXTENSION_ID_QUERY_PARAM)?.trim() || ""

  if (extensionId) {
    persistExtensionId(extensionId)
    return extensionId
  }

  return getStoredExtensionId()
}
