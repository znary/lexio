const DEFAULT_WEBSITE_URL = "https://lexio.example.com"

export const WEBSITE_URL = import.meta.env.WXT_WEBSITE_URL || DEFAULT_WEBSITE_URL

function buildOfficialSiteHostnames(websiteUrl: string): string[] {
  try {
    const url = new URL(websiteUrl)
    return [url.hostname.toLowerCase()]
  }
  catch {
    return []
  }
}

function buildOfficialSitePatterns(websiteUrl: string): string[] {
  try {
    const url = new URL(websiteUrl)
    return [`${url.origin}/*`]
  }
  catch {
    return []
  }
}

export const OFFICIAL_SITE_HOSTNAMES = buildOfficialSiteHostnames(WEBSITE_URL)
export const OFFICIAL_SITE_URL_PATTERNS = buildOfficialSitePatterns(WEBSITE_URL)
