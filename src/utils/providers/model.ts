import type { Config } from "@/types/config/config"
import { storage } from "#imports"
import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import { getLLMProvidersConfig, getProviderConfigById } from "../config/helpers"
import { CONFIG_STORAGE_KEY } from "../constants/config"
import { MANAGED_CLOUD_PROVIDER_ID, PLATFORM_LLM_BASE_URL } from "../constants/platform"
import { refreshPlatformSessionFromResponse } from "../platform/api"
import { clearPlatformAuthSession, getPlatformAuthSession } from "../platform/storage"
import { resolveModelId } from "./model-id"

export async function fetchManagedCloudWithSessionGuard(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const response = await fetch(input, init)

  if (response.status !== 401 && response.status !== 403) {
    await refreshPlatformSessionFromResponse(response)
    return response
  }

  await clearPlatformAuthSession()

  const headers = new Headers(response.headers)
  headers.set("Content-Type", "application/json; charset=utf-8")

  return new Response(JSON.stringify({
    error: {
      message: "Platform session expired. Sign in again.",
    },
  }), {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

async function getLanguageModelById(providerId: string) {
  const config = await storage.getItem<Config>(`local:${CONFIG_STORAGE_KEY}`)
  if (!config) {
    throw new Error("Config not found")
  }

  const llmProvidersConfig = getLLMProvidersConfig(config.providersConfig)
  const selectedProviderConfig = getProviderConfigById(llmProvidersConfig, providerId)
  if (!selectedProviderConfig) {
    throw new Error(`Provider ${providerId} not found`)
  }

  const session = await getPlatformAuthSession()
  if (!session?.token) {
    throw new Error("No Lexio account token found. Sign in again.")
  }

  return createOpenAICompatible({
    name: "openai-compatible",
    baseURL: PLATFORM_LLM_BASE_URL,
    apiKey: session.token,
    fetch: fetchManagedCloudWithSessionGuard,
    supportsStructuredOutputs: false,
  }).languageModel(resolveModelId(selectedProviderConfig.model) || MANAGED_CLOUD_PROVIDER_ID)
}

export async function getModelById(providerId: string) {
  return getLanguageModelById(providerId)
}
