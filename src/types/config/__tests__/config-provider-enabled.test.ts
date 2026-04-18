import type { ProviderConfig } from "@/types/config/provider"
import { describe, expect, it } from "vitest"
import { createBuiltInDictionaryAction } from "@/utils/constants/built-in-dictionary-action"
import { DEFAULT_CONFIG } from "@/utils/constants/config"
import { MANAGED_CLOUD_PROVIDER_ID } from "@/utils/constants/platform"
import { configSchema } from "../config"

function getIssuePaths(input: unknown) {
  const result = configSchema.safeParse(input)
  if (result.success) {
    return []
  }

  return result.error.issues.map(issue => issue.path.join("."))
}

function createManagedProvider(
  id: string,
  overrides: Partial<ProviderConfig> = {},
): ProviderConfig {
  const provider = DEFAULT_CONFIG.providersConfig.find(item => item.id === MANAGED_CLOUD_PROVIDER_ID)
  if (!provider) {
    throw new Error(`Provider "${MANAGED_CLOUD_PROVIDER_ID}" not found in DEFAULT_CONFIG.providersConfig`)
  }

  return {
    ...provider,
    id,
    ...overrides,
  } as ProviderConfig
}

describe("config provider enabled validation", () => {
  it("fails when a built-in feature uses a disabled provider", () => {
    const fallbackProviderId = "managed-cloud-backup"
    const providersConfig = [
      createManagedProvider(MANAGED_CLOUD_PROVIDER_ID, { enabled: false }),
      createManagedProvider(fallbackProviderId),
    ]

    const issuePaths = getIssuePaths({
      ...DEFAULT_CONFIG,
      providersConfig,
      selectionToolbar: {
        ...DEFAULT_CONFIG.selectionToolbar,
        customActions: [
          createBuiltInDictionaryAction(fallbackProviderId),
        ],
      },
    })

    expect(issuePaths).toContain("translate.providerId")
    expect(issuePaths).not.toContain("selectionToolbar.customActions.0.providerId")
  })

  it("fails when a custom action uses a disabled provider", () => {
    const fallbackProviderId = "managed-cloud-backup"
    const providersConfig = [
      createManagedProvider(MANAGED_CLOUD_PROVIDER_ID, { enabled: false }),
      createManagedProvider(fallbackProviderId),
    ]

    const issuePaths = getIssuePaths({
      ...DEFAULT_CONFIG,
      providersConfig,
      translate: {
        ...DEFAULT_CONFIG.translate,
        providerId: fallbackProviderId,
      },
      videoSubtitles: {
        ...DEFAULT_CONFIG.videoSubtitles,
        providerId: fallbackProviderId,
      },
      inputTranslation: {
        ...DEFAULT_CONFIG.inputTranslation,
        providerId: fallbackProviderId,
      },
      selectionToolbar: {
        ...DEFAULT_CONFIG.selectionToolbar,
        features: {
          ...DEFAULT_CONFIG.selectionToolbar.features,
          translate: {
            ...DEFAULT_CONFIG.selectionToolbar.features.translate,
            providerId: fallbackProviderId,
          },
        },
        customActions: [
          createBuiltInDictionaryAction(MANAGED_CLOUD_PROVIDER_ID),
        ],
      },
    })

    expect(issuePaths).toContain("selectionToolbar.customActions.0.providerId")
    expect(issuePaths).not.toContain("translate.providerId")
  })
})
