import type { TestSeriesObject } from "./types"
import { testSeries as v070TestSeries } from "./v070"

export const testSeries: TestSeriesObject = Object.fromEntries(
  Object.entries(v070TestSeries).map(([seriesId, seriesData]) => {
    const translateProviderId = seriesData.config.selectionToolbar.features.translate.providerId

    return [
      seriesId,
      {
        description: `${seriesData.description}; adds built-in selection explain`,
        config: {
          ...seriesData.config,
          selectionToolbar: {
            ...seriesData.config.selectionToolbar,
            features: {
              ...seriesData.config.selectionToolbar.features,
              explain: {
                enabled: true,
                providerId: translateProviderId,
              },
            },
          },
        },
      },
    ]
  }),
)
