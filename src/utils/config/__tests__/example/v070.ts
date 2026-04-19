import type { TestSeriesObject } from "./types"
import { testSeries as v069TestSeries } from "./v069"

export const testSeries: TestSeriesObject = Object.fromEntries(
  Object.entries(v069TestSeries).map(([seriesId, seriesData]) => {
    const { sideContent: _sideContent, ...config } = seriesData.config

    return [
      seriesId,
      {
        description: `${seriesData.description}; removes the legacy injected side panel width`,
        config,
      },
    ]
  }),
)
