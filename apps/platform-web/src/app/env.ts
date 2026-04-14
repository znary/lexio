export const PLATFORM_API_URL = import.meta.env.VITE_PLATFORM_API_URL || "http://127.0.0.1:8787"
export const PADDLE_CLIENT_TOKEN = import.meta.env.VITE_PADDLE_CLIENT_TOKEN || ""
export const PADDLE_ENV = (import.meta.env.VITE_PADDLE_ENV || "sandbox") as "sandbox" | "production"
export const DEFAULT_EXTENSION_ID = import.meta.env.VITE_EXTENSION_ID || ""

export function getExtensionIdFromLocation(): string {
  const query = new URLSearchParams(window.location.search)
  return query.get("extensionId") || DEFAULT_EXTENSION_ID
}
