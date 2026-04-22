import { browser } from "#imports"
import { buildPlatformWebsiteUrl, PLATFORM_WEBSITE_PATHS } from "./website"

export async function openPlatformExtensionSyncTab(extensionId = browser.runtime.id): Promise<string> {
  const searchParams = new URLSearchParams({
    extensionId,
  })
  const url = buildPlatformWebsiteUrl(PLATFORM_WEBSITE_PATHS.extensionSync, searchParams)

  await browser.tabs.create({ url })
  return url
}

export async function openPlatformWordBankTab(): Promise<string> {
  const url = buildPlatformWebsiteUrl(PLATFORM_WEBSITE_PATHS.wordBank)

  await browser.tabs.create({ url })
  return url
}

export async function openPlatformPricingTab(): Promise<string> {
  const url = buildPlatformWebsiteUrl(PLATFORM_WEBSITE_PATHS.pricing)

  await browser.tabs.create({ url })
  return url
}
