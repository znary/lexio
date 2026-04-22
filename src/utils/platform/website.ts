import { WEBSITE_URL } from "@/utils/constants/url"

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

export const PLATFORM_WEBSITE_PATHS = {
  signIn: normalizePath(import.meta.env.WXT_PLATFORM_SIGN_IN_PATH, "/sign-in"),
  wordBank: normalizePath(import.meta.env.WXT_PLATFORM_WORD_BANK_PATH, "/word-bank"),
  pricing: normalizePath(import.meta.env.WXT_PLATFORM_PRICING_PATH, "/pricing"),
  extensionSync: normalizePath(import.meta.env.WXT_PLATFORM_EXTENSION_SYNC_PATH, "/extension-sync"),
} as const

export function buildPlatformWebsiteUrl(path: string, searchParams?: URLSearchParams): string {
  const url = new URL(path, WEBSITE_URL)
  if (searchParams) {
    url.search = searchParams.toString()
  }
  return url.toString()
}

export function buildPlatformSignInUrl(searchParams?: URLSearchParams): string {
  return buildPlatformWebsiteUrl(PLATFORM_WEBSITE_PATHS.signIn, searchParams)
}
