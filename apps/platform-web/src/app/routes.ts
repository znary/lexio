const TRAILING_SLASHES_RE = /\/+$/

function normalizePath(path: string | undefined, fallback: string): string {
  const candidate = (path || fallback).trim()
  if (!candidate) {
    return fallback
  }

  const withLeadingSlash = candidate.startsWith("/") ? candidate : `/${candidate}`
  if (withLeadingSlash === "/") {
    return withLeadingSlash
  }

  return withLeadingSlash.replace(TRAILING_SLASHES_RE, "")
}

export const APP_ROUTES = {
  signIn: normalizePath(import.meta.env.VITE_SIGN_IN_PATH, "/sign-in"),
  pricing: normalizePath(import.meta.env.VITE_PRICING_PATH, "/pricing"),
  checkoutSuccess: normalizePath(import.meta.env.VITE_CHECKOUT_SUCCESS_PATH, "/checkout-success"),
  extensionSync: normalizePath(import.meta.env.VITE_EXTENSION_SYNC_PATH, "/extension-sync"),
} as const

export function normalizePathname(pathname: string): string {
  return normalizePath(pathname, APP_ROUTES.signIn)
}
