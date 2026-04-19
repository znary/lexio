import type { Config } from "@/types/config/config"
import type { LLMProviderConfig } from "@/types/config/provider"
import type { CachedWebPageContext } from "@/utils/host/translate/webpage-context"
import { browser } from "#imports"
import { isLLMProviderConfig } from "@/types/config/provider"
import { getEnabledLLMProvidersConfig, getProviderConfigById } from "@/utils/config/helpers"
import { getOrGenerateWebPageSummary } from "@/utils/host/translate/webpage-summary"
import { sendMessage } from "@/utils/message"

export interface CurrentWebPageSummaryResult {
  summary: string
  url: string
  webTitle: string
}

function getCurrentWebPageSummaryProvider(
  config: Pick<Config, "providersConfig" | "translate">,
): LLMProviderConfig | null {
  const translateProvider = getProviderConfigById(
    config.providersConfig,
    config.translate.providerId,
  )

  if (translateProvider?.enabled && isLLMProviderConfig(translateProvider)) {
    return translateProvider
  }

  return getEnabledLLMProvidersConfig(config.providersConfig)[0] ?? null
}

async function getCurrentWebPageContext(): Promise<CachedWebPageContext> {
  const [activeTab] = await browser.tabs.query({
    active: true,
    currentWindow: true,
  })

  if (!activeTab?.id) {
    throw new Error("No active page found.")
  }

  const webPageContext = await sendMessage("getCurrentWebPageContext", undefined, activeTab.id)

  if (!webPageContext?.webTitle.trim() || !webPageContext.webContent.trim()) {
    throw new Error("Current page content is unavailable on this tab.")
  }

  return webPageContext
}

export async function generateCurrentWebPageSummary(
  config: Pick<Config, "providersConfig" | "translate">,
): Promise<CurrentWebPageSummaryResult> {
  const providerConfig = getCurrentWebPageSummaryProvider(config)
  if (!providerConfig) {
    throw new Error("No enabled AI provider is available for page summary.")
  }

  const webPageContext = await getCurrentWebPageContext()
  const summary = await getOrGenerateWebPageSummary(webPageContext, providerConfig, true)

  if (!summary) {
    throw new Error("Failed to summarize the current page.")
  }

  return {
    summary,
    url: webPageContext.url,
    webTitle: webPageContext.webTitle,
  }
}

export function CurrentWebPageSummaryCard({
  summary,
}: {
  summary: CurrentWebPageSummaryResult
}) {
  return (
    <section
      aria-label="Current page summary"
      className="sidepanel-page-summary-card"
    >
      <div className="sidepanel-page-summary-eyebrow">
        Current page summary
      </div>
      <h2 className="sidepanel-page-summary-title">
        {summary.webTitle}
      </h2>
      <p className="sidepanel-page-summary-url">
        {summary.url}
      </p>
      <p className="sidepanel-page-summary-text">
        {summary.summary}
      </p>
    </section>
  )
}
