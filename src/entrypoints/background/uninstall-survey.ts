import { browser } from "#imports"
import { EXTENSION_VERSION } from "@/utils/constants/app"
import { buildPlatformSignInUrl } from "@/utils/platform/website"

const EDGE_VERSION_RE = /Edg(?:e|A|iOS)?\/([\d.]+)/i
const EDGE_LEGACY_VERSION_RE = /Edge\/([\d.]+)/i
const FIREFOX_VERSION_RE = /Firefox\/([\d.]+)/i
const CHROME_VERSION_RE = /Chrome\/([\d.]+)/i
const ANY_BROWSER_VERSION_RE = /(?:Edg|Edge|Firefox|Chrome)\/([\d.]+)/i
const IOS_PLATFORM_RE = /iPhone|iPad|iPod|iOS/i
const ANDROID_PLATFORM_RE = /Android/i
const WINDOWS_PLATFORM_RE = /Windows/i
const MAC_PLATFORM_RE = /Mac/i
const LINUX_PLATFORM_RE = /Linux/i

type BrowserType = "chrome" | "edge" | "firefox"
type BrowserApi = Pick<typeof browser, "i18n" | "runtime">

function getBrowserVersion(browserType: string): string {
  const ua = globalThis.navigator?.userAgent ?? ""
  const type = browserType.toLowerCase() as BrowserType

  if (type === "edge") {
    return ua.match(EDGE_VERSION_RE)?.[1]
      ?? ua.match(EDGE_LEGACY_VERSION_RE)?.[1]
      ?? "unknown"
  }

  if (type === "firefox")
    return ua.match(FIREFOX_VERSION_RE)?.[1] ?? "unknown"

  if (type === "chrome")
    return ua.match(CHROME_VERSION_RE)?.[1] ?? "unknown"

  return ua.match(ANY_BROWSER_VERSION_RE)?.[1] ?? "unknown"
}

function getOS(): string {
  const nav = globalThis.navigator as Navigator & {
    userAgentData?: {
      platform?: string
    }
  }
  const platform = `${nav.userAgentData?.platform ?? ""} ${nav.platform ?? ""} ${nav.userAgent ?? ""}`

  if (IOS_PLATFORM_RE.test(platform))
    return "iOS"
  if (ANDROID_PLATFORM_RE.test(platform))
    return "Android"
  if (WINDOWS_PLATFORM_RE.test(platform))
    return "Windows"
  if (MAC_PLATFORM_RE.test(platform))
    return "MacOS"
  if (LINUX_PLATFORM_RE.test(platform))
    return "Linux"
  return "Unknown"
}

function getUILang(browserApi: BrowserApi): string {
  try {
    const uiLang = browserApi.i18n.getUILanguage?.()
    if (uiLang) {
      return uiLang
    }
  }
  catch {}

  return globalThis.navigator?.language || "unknown"
}

export async function setupUninstallSurvey(
  browserApi: BrowserApi = browser,
  browserType: string = import.meta.env.BROWSER ?? "chrome",
) {
  const searchParams = new URLSearchParams({
    rf_version: EXTENSION_VERSION,
    browser_type: browserType,
    browser_version: getBrowserVersion(browserType),
    os: getOS(),
    ui_lang: getUILang(browserApi),
  })

  void browserApi.runtime.setUninstallURL(buildPlatformSignInUrl(searchParams))
}
