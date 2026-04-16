import type { PromptResolver } from "./api/ai"
import type { Config } from "@/types/config/config"
import type { ProviderConfig } from "@/types/config/provider"
import { ISO6393_TO_6391, LANG_CODE_TO_EN_NAME } from "@read-frog/definitions"
import { isLLMProviderConfig } from "@/types/config/provider"
import { translateWithManagedPlatform } from "@/utils/platform/api"
import { prepareTranslationText } from "./text-preparation"

export async function executeTranslate<TContext>(
  text: string,
  langConfig: Config["language"],
  providerConfig: ProviderConfig,
  promptResolver: PromptResolver<TContext>,
  options?: {
    isBatch?: boolean
    context?: TContext
    scene?: string
  },
) {
  const preparedText = prepareTranslationText(text)
  if (preparedText === "") {
    return ""
  }

  const sourceLang = langConfig.sourceCode === "auto" ? "auto" : (ISO6393_TO_6391[langConfig.sourceCode] ?? "auto")
  const targetLang = ISO6393_TO_6391[langConfig.targetCode]
  if (!targetLang) {
    throw new Error(`Invalid target language code: ${langConfig.targetCode}`)
  }

  const targetLangName = LANG_CODE_TO_EN_NAME[langConfig.targetCode]
  const { systemPrompt, prompt } = await promptResolver(targetLangName, preparedText, options)
  const translatedText = await translateWithManagedPlatform({
    scene: options?.scene,
    text: preparedText,
    sourceLanguage: sourceLang,
    targetLanguage: targetLang,
    systemPrompt,
    prompt,
    temperature: isLLMProviderConfig(providerConfig) ? providerConfig.temperature : undefined,
    isBatch: options?.isBatch,
  })

  return translatedText.trim()
}
