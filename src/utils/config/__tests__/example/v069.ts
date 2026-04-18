import type { TestSeriesObject } from "./types"
import { testSeries as v068TestSeries } from "./v068"

const managedProviderId = "managed-cloud-default"
const managedProviderConfig = {
  id: managedProviderId,
  name: "Lexio Cloud",
  description: "Managed by your Lexio account.",
  enabled: true,
  provider: "openai-compatible" as const,
  baseURL: "https://lexio.example.com/v1/llm",
  model: {
    model: "use-custom-model" as const,
    isCustomModel: true,
    customModel: managedProviderId,
  },
}

export const testSeries: TestSeriesObject = Object.fromEntries(
  Object.entries(v068TestSeries).map(([seriesId, seriesData]) => [
    seriesId,
    {
      description: `${seriesData.description}; switches to the managed Lexio cloud provider`,
      config: {
        ...seriesData.config,
        providersConfig: [managedProviderConfig],
        translate: {
          ...seriesData.config.translate,
          providerId: managedProviderId,
        },
        languageDetection: seriesData.config.languageDetection.mode === "llm"
          ? {
              ...seriesData.config.languageDetection,
              providerId: managedProviderId,
            }
          : seriesData.config.languageDetection,
        selectionToolbar: {
          ...seriesData.config.selectionToolbar,
          features: {
            ...seriesData.config.selectionToolbar.features,
            translate: {
              ...seriesData.config.selectionToolbar.features.translate,
              providerId: managedProviderId,
            },
          },
          customActions: seriesData.config.selectionToolbar.customActions.map((action: typeof seriesData.config.selectionToolbar.customActions[number]) => ({
            ...action,
            providerId: managedProviderId,
          })),
        },
        inputTranslation: {
          ...seriesData.config.inputTranslation,
          providerId: managedProviderId,
        },
        videoSubtitles: {
          ...seriesData.config.videoSubtitles,
          providerId: managedProviderId,
        },
      },
    },
  ]),
)
