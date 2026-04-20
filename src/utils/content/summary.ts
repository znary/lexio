import type { LLMProviderConfig } from "@/types/config/provider"
import { generateText } from "ai"
import { logger } from "@/utils/logger"
import { getModelById } from "@/utils/providers/model"
import { resolveModelId } from "@/utils/providers/model-id"
import { getProviderOptionsWithOverride } from "@/utils/providers/options"
import { cleanText } from "./utils"

/**
 * Generate a brief summary of article content for translation context
 */
export async function generateArticleSummary(
  title: string,
  textContent: string,
  providerConfig: LLMProviderConfig,
  options?: {
    url?: string
  },
): Promise<string | null> {
  const preparedText = cleanText(textContent)

  if (!preparedText) {
    return null
  }

  try {
    const {
      model: providerModel,
      provider,
      providerOptions: userProviderOptions,
      temperature,
      disableThinking,
    } = providerConfig
    const modelName = resolveModelId(providerModel)
    const providerOptions = getProviderOptionsWithOverride(modelName ?? "", provider, userProviderOptions, disableThinking)
    const model = await getModelById(providerConfig.id)

    const prompt = `Summarize the following article in 4-6 sentences. Focus on the main topic, the key points, important facts or entities, and the conclusion or takeaway when it exists. Return ONLY the summary as plain text, with no bullet points or extra formatting.

Title: ${title}

${options?.url ? `URL: ${options.url}\n\n` : ""}Content:
${preparedText}`

    const { text: summary } = await generateText({
      model,
      prompt,
      temperature,
      providerOptions,
    })

    const cleanedSummary = summary.trim()
    logger.info("Generated article summary:", `${cleanedSummary.slice(0, 100)}...`)

    return cleanedSummary
  }
  catch (error) {
    logger.error("Failed to generate article summary:", error)
    return null
  }
}
