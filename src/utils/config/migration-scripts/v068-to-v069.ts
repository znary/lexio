/**
 * Migration script from v068 to v069
 * - Replaces local provider configuration with the managed Lexio cloud provider.
 * - Reassigns all feature and custom action provider ids to managed-cloud-default.
 *
 * IMPORTANT: All values are hardcoded inline. Migration scripts are frozen
 * snapshots — never import constants or helpers that may change.
 */

export function migrate(oldConfig: any): any {
  const managedProviderId = "managed-cloud-default"
  const managedProvider = {
    id: managedProviderId,
    name: "Lexio Cloud",
    description: "Managed by your Lexio account.",
    enabled: true,
    provider: "openai-compatible",
    baseURL: "https://lexio.example.com/v1/llm",
    model: {
      model: "use-custom-model",
      isCustomModel: true,
      customModel: managedProviderId,
    },
  }

  const customActions = Array.isArray(oldConfig?.selectionToolbar?.customActions)
    ? oldConfig.selectionToolbar.customActions.map((action: any) => ({
        ...action,
        providerId: managedProviderId,
      }))
    : []

  const languageDetection = oldConfig?.languageDetection?.mode === "llm"
    ? {
        ...oldConfig.languageDetection,
        providerId: managedProviderId,
      }
    : (oldConfig?.languageDetection ?? { mode: "basic" })

  return {
    ...oldConfig,
    providersConfig: [managedProvider],
    translate: {
      ...oldConfig?.translate,
      providerId: managedProviderId,
    },
    languageDetection,
    selectionToolbar: {
      ...oldConfig?.selectionToolbar,
      features: {
        ...oldConfig?.selectionToolbar?.features,
        translate: {
          ...oldConfig?.selectionToolbar?.features?.translate,
          providerId: managedProviderId,
        },
      },
      customActions,
    },
    inputTranslation: {
      ...oldConfig?.inputTranslation,
      providerId: managedProviderId,
    },
    videoSubtitles: {
      ...oldConfig?.videoSubtitles,
      providerId: managedProviderId,
    },
  }
}
