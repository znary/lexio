/**
 * Extract error message from API response
 * Handles various error formats: JSON string, { error: { message } }, { message }, plain text
 */
export async function extractErrorMessage(response: Response): Promise<string> {
  const fallback = `${response.status} ${response.statusText}`
  const text = await response.text()

  if (!text)
    return fallback

  try {
    const json = JSON.parse(text)
    if (typeof json === "string")
      return json
    if (json.error?.message)
      return json.error.message
    if (json.message)
      return json.message
    return fallback
  }
  catch {
    return text.slice(0, 100)
  }
}

function getNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function extractMessageFromTextBody(text: string): string {
  try {
    const json = JSON.parse(text) as unknown
    if (typeof json === "string") {
      return json
    }
    if (json && typeof json === "object") {
      const value = json as {
        error?: unknown
        message?: unknown
      }
      if (value.error && typeof value.error === "object") {
        const errorValue = value.error as { message?: unknown }
        const message = getNonEmptyString(errorValue.message)
        if (message) {
          return message
        }
      }
      if (typeof value.error === "string") {
        return value.error
      }
      const message = getNonEmptyString(value.message)
      if (message) {
        return message
      }
    }
  }
  catch {
    // Fall through to the raw body preview.
  }

  return text.slice(0, 500)
}

export function extractAISDKErrorMessage(error: unknown): string {
  if (typeof error === "string") {
    return error
  }

  if (typeof error === "object" && error !== null) {
    const source = error as {
      message?: unknown
      responseBody?: unknown
      statusCode?: unknown
      text?: unknown
    }
    const responseBody = getNonEmptyString(source.responseBody)
    const statusCode = typeof source.statusCode === "number" ? source.statusCode : undefined
    const message = responseBody
      ? extractMessageFromTextBody(responseBody)
      : getNonEmptyString(source.message)
        ?? getNonEmptyString(source.text)

    if (message && statusCode) {
      return `${statusCode}: ${message}`
    }

    return message ?? "Unexpected error occurred"
  }

  return "Unexpected error occurred"
}
