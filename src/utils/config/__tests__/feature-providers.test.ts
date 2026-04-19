import type { ProviderConfig } from "@/types/config/provider"
import { describe, expect, it } from "vitest"
import { DEFAULT_CONFIG } from "@/utils/constants/config"
import { buildFeatureProviderPatch } from "@/utils/constants/feature-providers"
import { MANAGED_CLOUD_PROVIDER_ID } from "@/utils/constants/platform"
import {
  computeLanguageDetectionFallbackAfterDeletion,
  computeProviderFallbacksAfterDeletion,
  computeSelectionToolbarCustomActionFallbacksAfterDeletion,
  findFeatureMissingProvider,
  resolveLanguageDetectionConfigForModeChange,
} from "../helpers"

function getProviderById(id: string): ProviderConfig {
  const provider = DEFAULT_CONFIG.providersConfig.find(item => item.id === id)
  if (!provider)
    throw new Error(`Provider "${id}" not found in DEFAULT_CONFIG.providersConfig`)
  return provider
}

function createManagedProvider(
  id: string,
  overrides: Partial<ProviderConfig> = {},
): ProviderConfig {
  return {
    ...getProviderById(MANAGED_CLOUD_PROVIDER_ID),
    id,
    ...overrides,
  } as ProviderConfig
}

describe("feature providers", () => {
  describe("buildFeatureProviderPatch", () => {
    it("builds patch for a single feature assignment", () => {
      const patch = buildFeatureProviderPatch({
        translate: MANAGED_CLOUD_PROVIDER_ID,
      })

      expect(patch).toEqual({
        translate: {
          providerId: MANAGED_CLOUD_PROVIDER_ID,
        },
      })
    })

    it("builds patch for multiple feature assignments", () => {
      const patch = buildFeatureProviderPatch({
        "translate": MANAGED_CLOUD_PROVIDER_ID,
        "selectionToolbar.translate": "backup-managed-cloud",
        "selectionToolbar.explain": "managed-cloud-explain",
      })

      expect(patch).toEqual({
        translate: {
          providerId: MANAGED_CLOUD_PROVIDER_ID,
        },
        selectionToolbar: {
          features: {
            translate: {
              providerId: "backup-managed-cloud",
            },
            explain: {
              providerId: "managed-cloud-explain",
            },
          },
        },
      })
    })
  })

  describe("computeProviderFallbacksAfterDeletion", () => {
    it("returns fallback assignments for every affected feature when candidates exist", () => {
      const config = {
        ...DEFAULT_CONFIG,
        translate: {
          ...DEFAULT_CONFIG.translate,
          providerId: "deleted-provider",
        },
        videoSubtitles: {
          ...DEFAULT_CONFIG.videoSubtitles,
          providerId: "deleted-provider",
        },
        selectionToolbar: {
          ...DEFAULT_CONFIG.selectionToolbar,
          features: {
            ...DEFAULT_CONFIG.selectionToolbar.features,
            translate: { enabled: true, providerId: "deleted-provider" },
            explain: { enabled: true, providerId: "deleted-provider" },
          },
        },
        inputTranslation: {
          ...DEFAULT_CONFIG.inputTranslation,
          providerId: "deleted-provider",
        },
      }

      const remainingProviders = [
        createManagedProvider("fallback-managed-cloud"),
        createManagedProvider("backup-managed-cloud"),
      ]

      const fallbacks = computeProviderFallbacksAfterDeletion("deleted-provider", config, remainingProviders)

      expect(fallbacks).toEqual({
        "translate": "fallback-managed-cloud",
        "videoSubtitles": "fallback-managed-cloud",
        "selectionToolbar.translate": "fallback-managed-cloud",
        "selectionToolbar.explain": "fallback-managed-cloud",
        "inputTranslation": "fallback-managed-cloud",
      })
    })

    it("skips features that have no compatible remaining provider", () => {
      const config = {
        ...DEFAULT_CONFIG,
        translate: {
          ...DEFAULT_CONFIG.translate,
          providerId: "deleted-provider",
        },
      }

      const remainingProviders: ProviderConfig[] = []

      const fallbacks = computeProviderFallbacksAfterDeletion("deleted-provider", config, remainingProviders)

      expect(fallbacks.translate).toBeUndefined()
    })

    it("skips disabled providers when selecting fallbacks", () => {
      const config = {
        ...DEFAULT_CONFIG,
        translate: {
          ...DEFAULT_CONFIG.translate,
          providerId: "deleted-provider",
        },
      }

      const remainingProviders = [
        createManagedProvider("disabled-managed-cloud", {
          enabled: false,
        }),
      ]

      const fallbacks = computeProviderFallbacksAfterDeletion("deleted-provider", config, remainingProviders)

      expect(fallbacks.translate).toBeUndefined()
    })
  })

  describe("findFeatureMissingProvider", () => {
    it("returns the first missing feature key when providers are insufficient", () => {
      const remainingProviders: ProviderConfig[] = []

      expect(findFeatureMissingProvider(remainingProviders)).toBe("translate")
    })

    it("returns null when all features have at least one compatible provider", () => {
      const remainingProviders = [
        getProviderById(MANAGED_CLOUD_PROVIDER_ID),
      ]

      expect(findFeatureMissingProvider(remainingProviders)).toBeNull()
    })

    it("treats disabled providers as unavailable", () => {
      const remainingProviders = [
        createManagedProvider("disabled-managed-cloud", {
          enabled: false,
        }),
      ]

      expect(findFeatureMissingProvider(remainingProviders)).toBe("translate")
    })
  })

  describe("computeSelectionToolbarCustomActionFallbacksAfterDeletion", () => {
    it("reassigns affected custom actions to the first enabled llm provider", () => {
      const config = {
        ...DEFAULT_CONFIG,
        selectionToolbar: {
          ...DEFAULT_CONFIG.selectionToolbar,
          customActions: [
            {
              id: "action-a",
              name: "Action A",
              enabled: true,
              icon: "tabler:sparkles",
              providerId: "deleted-provider",
              systemPrompt: "",
              prompt: "{{selection}}",
              outputSchema: [
                {
                  id: "field-a",
                  name: "summary",
                  type: "string" as const,
                  description: "",
                  speaking: false,
                },
              ],
            },
          ],
        },
      }

      const remainingProviders = [
        createManagedProvider("disabled-managed-cloud", {
          enabled: false,
        }),
        createManagedProvider("fallback-llm-provider"),
      ]

      const result = computeSelectionToolbarCustomActionFallbacksAfterDeletion(
        "deleted-provider",
        config,
        remainingProviders,
      )

      expect(result).toEqual([
        expect.objectContaining({
          id: "action-a",
          providerId: "fallback-llm-provider",
        }),
      ])
    })

    it("returns null when no enabled llm provider is available", () => {
      const config = {
        ...DEFAULT_CONFIG,
        selectionToolbar: {
          ...DEFAULT_CONFIG.selectionToolbar,
          customActions: [
            {
              id: "action-a",
              name: "Action A",
              enabled: true,
              icon: "tabler:sparkles",
              providerId: "deleted-provider",
              systemPrompt: "",
              prompt: "{{selection}}",
              outputSchema: [
                {
                  id: "field-a",
                  name: "summary",
                  type: "string" as const,
                  description: "",
                  speaking: false,
                },
              ],
            },
          ],
        },
      }

      const remainingProviders = [
        createManagedProvider("disabled-managed-cloud", {
          enabled: false,
        }),
      ]

      const result = computeSelectionToolbarCustomActionFallbacksAfterDeletion(
        "deleted-provider",
        config,
        remainingProviders,
      )

      expect(result).toBeNull()
    })
  })

  describe("resolveLanguageDetectionConfigForModeChange", () => {
    it("assigns the first enabled llm provider when switching from basic to llm", () => {
      const result = resolveLanguageDetectionConfigForModeChange(
        DEFAULT_CONFIG.languageDetection,
        "llm",
        DEFAULT_CONFIG.providersConfig,
      )

      expect(result).toEqual({
        mode: "llm",
        providerId: MANAGED_CLOUD_PROVIDER_ID,
      })
    })

    it("keeps the current provider when it is already an enabled llm provider", () => {
      const result = resolveLanguageDetectionConfigForModeChange(
        {
          mode: "basic",
          providerId: "fallback-llm-provider",
        },
        "llm",
        [
          createManagedProvider("fallback-llm-provider"),
        ],
      )

      expect(result).toEqual({
        mode: "llm",
        providerId: "fallback-llm-provider",
      })
    })

    it("returns null when there is no enabled llm provider", () => {
      const result = resolveLanguageDetectionConfigForModeChange(
        DEFAULT_CONFIG.languageDetection,
        "llm",
        [
          createManagedProvider("disabled-managed-cloud-a", {
            enabled: false,
          }),
          createManagedProvider("disabled-managed-cloud-b", {
            enabled: false,
          }),
        ],
      )

      expect(result).toBeNull()
    })
  })

  describe("computeLanguageDetectionFallbackAfterDeletion", () => {
    it("reassigns language detection to the first enabled llm provider", () => {
      const config = {
        ...DEFAULT_CONFIG,
        languageDetection: {
          mode: "llm" as const,
          providerId: "deleted-provider",
        },
      }

      const result = computeLanguageDetectionFallbackAfterDeletion(
        "deleted-provider",
        config,
        [
          createManagedProvider("disabled-managed-cloud", {
            enabled: false,
          }),
          createManagedProvider("fallback-llm-provider"),
        ],
      )

      expect(result).toBe("fallback-llm-provider")
    })
  })
})
