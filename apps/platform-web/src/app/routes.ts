const TRAILING_SLASHES_RE = /\/+$/
const PRACTICE_ITEM_QUERY_PARAM = "item"

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
  home: normalizePath(import.meta.env.VITE_HOME_PATH, "/"),
  wordBank: normalizePath(import.meta.env.VITE_WORD_BANK_PATH, "/word-bank"),
  practice: normalizePath(import.meta.env.VITE_PRACTICE_PATH, "/practice"),
  signIn: normalizePath(import.meta.env.VITE_SIGN_IN_PATH, "/sign-in"),
  pricing: normalizePath(import.meta.env.VITE_PRICING_PATH, "/pricing"),
  checkoutSuccess: normalizePath(import.meta.env.VITE_CHECKOUT_SUCCESS_PATH, "/checkout-success"),
  extensionSync: normalizePath(import.meta.env.VITE_EXTENSION_SYNC_PATH, "/extension-sync"),
} as const

export function normalizePathname(pathname: string): string {
  return normalizePath(pathname, APP_ROUTES.home)
}

export function getPracticeHref(): string {
  return APP_ROUTES.practice
}

export function getPracticeItemHref(itemId: string): string {
  const normalizedItemId = itemId.trim()
  if (!normalizedItemId) {
    return getPracticeHref()
  }

  const searchParams = new URLSearchParams({
    [PRACTICE_ITEM_QUERY_PARAM]: normalizedItemId,
  })

  return `${APP_ROUTES.practice}?${searchParams.toString()}`
}
