import type { TestSeriesObject } from "./types"
import { testSeries as v067TestSeries } from "./v067"

export const testSeries: TestSeriesObject = Object.fromEntries(
  Object.entries(v067TestSeries).map(([seriesId, seriesData]) => [
    seriesId,
    {
      description: `${seriesData.description}; adds vocabulary settings`,
      config: {
        ...seriesData.config,
        vocabulary: {
          autoSave: true,
          highlightEnabled: true,
          maxPhraseWords: 8,
          highlightColor: "#fde68a",
        },
      },
    },
  ]),
)
