export function toSignedValue(value: number, unit: "%" | "Hz"): string {
  return `${value >= 0 ? "+" : ""}${value}${unit}`
}

export function getTTSFriendlyErrorDescription(error: Error): string | undefined {
  if (error.message.includes("Edge TTS returned empty audio data")) {
    return "Speech generation returned empty audio. Please try again."
  }

  if (error.message.includes("empty audio payload")) {
    return "Speech generation returned empty audio. Please try again."
  }

  if (error.message.includes("[SYNTH_RATE_LIMITED]")) {
    return "Too many TTS requests. Please try again in a moment."
  }

  if (error.message.includes("[NETWORK_ERROR]") || error.message.includes("[TOKEN_FETCH_FAILED]") || error.message.includes("[TOKEN_INVALID]")) {
    return "Edge TTS is temporarily unavailable. Please check your network and retry."
  }

  return error.message || undefined
}
