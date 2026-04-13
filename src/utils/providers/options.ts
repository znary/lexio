import type { JSONValue } from "ai"
import { CUSTOM_LLM_PROVIDER_TYPES } from "@/types/config/provider"
import { LLM_MODEL_OPTIONS } from "../constants/models"

export interface RecommendedProviderOptionsMatch {
  matchIndex: number
  options: Record<string, JSONValue>
}

const OPENAI_COMPATIBLE_PROVIDER_TYPES = new Set<string>(CUSTOM_LLM_PROVIDER_TYPES)

const OPENAI_COMPATIBLE_OPTION_ALIASES = {
  reasoning_effort: "reasoningEffort",
  verbosity: "textVerbosity",
} as const satisfies Record<string, string>

const PROVIDER_SCOPED_OPTIONS: Array<{
  provider: string
  options: Record<string, JSONValue>
}> = [
  {
    provider: "volcengine",
    options: { thinking: { type: "disabled" } },
  },
]

function normalizeUserProviderOptions(
  provider: string,
  userOptions: Record<string, JSONValue>,
): Record<string, JSONValue> {
  if (!OPENAI_COMPATIBLE_PROVIDER_TYPES.has(provider)) {
    return userOptions
  }

  let changed = false
  const normalizedOptions: Record<string, JSONValue> = { ...userOptions }

  for (const [rawKey, canonicalKey] of Object.entries(OPENAI_COMPATIBLE_OPTION_ALIASES)) {
    if (!(rawKey in normalizedOptions)) {
      continue
    }

    if (!(canonicalKey in normalizedOptions)) {
      normalizedOptions[canonicalKey] = normalizedOptions[rawKey]
    }

    delete normalizedOptions[rawKey]
    changed = true
  }

  return changed ? normalizedOptions : userOptions
}

function mergeRecommendedProviderOptions(
  model: string,
  provider: string,
  baseOptions: Record<string, JSONValue> | undefined,
  disableThinking?: boolean,
): Record<string, JSONValue> | undefined {
  if (disableThinking === false) {
    return baseOptions
  }

  const recommendedOptions = getRecommendedProviderOptions(model, provider)
  if (!recommendedOptions) {
    return baseOptions
  }

  return baseOptions
    ? { ...baseOptions, ...recommendedOptions }
    : recommendedOptions
}

/**
 * Detect the recommended provider options for a given model.
 * First match wins - more specific patterns should be placed first in MODEL_OPTIONS.
 */
export function getRecommendedProviderOptionsMatch(
  model: string,
  provider?: string,
): RecommendedProviderOptionsMatch | undefined {
  const scopedMatchIndex = provider === undefined
    ? -1
    : PROVIDER_SCOPED_OPTIONS.findIndex(rule => rule.provider === provider)

  if (scopedMatchIndex >= 0) {
    const scopedRule = PROVIDER_SCOPED_OPTIONS[scopedMatchIndex]
    return {
      matchIndex: scopedMatchIndex,
      options: scopedRule.options,
    }
  }

  for (const [matchIndex, { pattern, options }] of LLM_MODEL_OPTIONS.entries()) {
    if (pattern.test(model)) {
      return { matchIndex, options }
    }
  }
}

/**
 * Get the recommended provider options payload without wrapping it by provider id.
 */
export function getRecommendedProviderOptions(
  model: string,
  provider?: string,
): Record<string, JSONValue> | undefined {
  return getRecommendedProviderOptionsMatch(model, provider)?.options
}

/**
 * Wrap a recommendation for the AI SDK request shape.
 */
export function getProviderOptions(
  model: string,
  provider: string,
  disableThinking?: boolean,
): Record<string, Record<string, JSONValue>> {
  const options = mergeRecommendedProviderOptions(model, provider, undefined, disableThinking)
  if (!options) {
    return {}
  }

  return { [provider]: options }
}

/**
 * Get provider options for AI SDK calls.
 * - If the user has saved provider options (including `{}`), use them as-is.
 * - Otherwise fall back to the recommended defaults for the current model.
 */
export function getProviderOptionsWithOverride(
  model: string,
  provider: string,
  userOptions?: Record<string, JSONValue>,
  disableThinking?: boolean,
): Record<string, Record<string, JSONValue>> | undefined {
  const normalizedUserOptions = userOptions === undefined
    ? undefined
    : normalizeUserProviderOptions(provider, userOptions)

  if (userOptions !== undefined) {
    const mergedOptions = mergeRecommendedProviderOptions(
      model,
      provider,
      normalizedUserOptions,
      disableThinking,
    )

    return {
      [provider]: mergedOptions ?? normalizedUserOptions!,
    }
  }

  const recommendedOptions = mergeRecommendedProviderOptions(model, provider, undefined, disableThinking)
  if (!recommendedOptions) {
    return undefined
  }

  return { [provider]: recommendedOptions }
}
