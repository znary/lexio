import { EDGE_TTS_HTTP_ENABLED, EDGE_TTS_SUPPORTED_BROWSERS } from "./constants"
import { EdgeTTSError } from "./errors"

function getRuntimeBrowser(): string | null {
  const browser = import.meta.env.BROWSER
  if (typeof browser !== "string") {
    return null
  }

  const trimmedBrowser = browser.trim()
  return trimmedBrowser || null
}

export function isEdgeTTSBrowserSupported(): boolean {
  const runtimeBrowser = getRuntimeBrowser()
  if (!runtimeBrowser) {
    return typeof window !== "undefined" && typeof fetch === "function"
  }

  return EDGE_TTS_SUPPORTED_BROWSERS.includes(runtimeBrowser as "chrome" | "edge")
}

export function assertEdgeTTSAvailable(): void {
  if (!EDGE_TTS_HTTP_ENABLED) {
    throw new EdgeTTSError("FEATURE_DISABLED", "Edge TTS HTTP route is disabled by feature flag")
  }

  if (!isEdgeTTSBrowserSupported()) {
    const runtimeBrowser = getRuntimeBrowser()
    throw new EdgeTTSError(
      "UNSUPPORTED_BROWSER",
      `Edge TTS is not supported in ${runtimeBrowser ?? "this browser"}`,
    )
  }
}
