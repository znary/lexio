import { logger } from "@/utils/logger"

export function isMissingTabMessageReceiver(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return message.includes("Could not establish connection")
    || message.includes("Receiving end does not exist")
    || message.includes("No response")
}

export function fireAndForgetTabMessage(
  promise: Promise<unknown> | unknown,
  context: string,
) {
  void Promise.resolve(promise).catch((error) => {
    if (isMissingTabMessageReceiver(error)) {
      logger.warn(`[Background] Missing tab message receiver: ${context}`, error)
      return
    }

    throw error
  })
}

export async function requestTabMessageOrNull<T>(
  promise: Promise<T> | T,
  context: string,
) {
  try {
    return await Promise.resolve(promise)
  }
  catch (error) {
    if (isMissingTabMessageReceiver(error)) {
      logger.warn(`[Background] Missing tab message receiver: ${context}`, error)
      return null
    }

    throw error
  }
}
