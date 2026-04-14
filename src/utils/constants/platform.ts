const DEFAULT_PLATFORM_API_URL = "http://127.0.0.1:8787"

export const MANAGED_CLOUD_PROVIDER_ID = "managed-cloud-default"
export const MANAGED_CLOUD_PROVIDER_NAME = "Lexio Cloud"
export const MANAGED_CLOUD_PROVIDER_DESCRIPTION = "Managed by your Lexio account."

export const PLATFORM_API_URL = import.meta.env.WXT_PLATFORM_API_URL || DEFAULT_PLATFORM_API_URL

function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value
}

export function buildPlatformApiUrl(path: string): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`
  return `${trimTrailingSlash(PLATFORM_API_URL)}${normalizedPath}`
}

export const PLATFORM_OPENAI_BASE_URL = buildPlatformApiUrl("/v1/openai")
