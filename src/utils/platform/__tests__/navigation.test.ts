import { afterEach, describe, expect, it, vi } from "vitest"

const { tabsCreateMock, buildPlatformWebsiteUrlMock, browserMock } = vi.hoisted(() => {
  const tabsCreateMock = vi.fn()
  const buildPlatformWebsiteUrlMock = vi.fn()

  return {
    tabsCreateMock,
    buildPlatformWebsiteUrlMock,
    browserMock: {
      runtime: {
        id: "test-extension-id",
      },
      tabs: {
        create: tabsCreateMock,
      },
    },
  }
})

vi.mock("#imports", () => ({
  browser: browserMock,
}))

vi.mock("wxt/browser", () => ({
  browser: browserMock,
}))

vi.mock("@/utils/platform/website", () => ({
  PLATFORM_WEBSITE_PATHS: {
    extensionSync: "/extension-sync",
    pricing: "/pricing",
  },
  buildPlatformWebsiteUrl: (...args: unknown[]) => buildPlatformWebsiteUrlMock(...args),
}))

afterEach(() => {
  vi.clearAllMocks()
})

describe("platform navigation", () => {
  it("opens the remote extension sync page with the extension id", async () => {
    const { openPlatformExtensionSyncTab } = await import("@/utils/platform/navigation")
    buildPlatformWebsiteUrlMock.mockReturnValueOnce("https://example.com/extension-sync?extensionId=test-extension-id")

    const url = await openPlatformExtensionSyncTab()
    const searchParams = buildPlatformWebsiteUrlMock.mock.calls[0][1] as URLSearchParams

    expect(buildPlatformWebsiteUrlMock).toHaveBeenCalledWith(
      "/extension-sync",
      expect.any(URLSearchParams),
    )
    expect(searchParams.get("extensionId")).toBe("test-extension-id")
    expect(tabsCreateMock).toHaveBeenCalledWith({
      url: "https://example.com/extension-sync?extensionId=test-extension-id",
    })
    expect(url).toBe("https://example.com/extension-sync?extensionId=test-extension-id")
  })

  it("opens the remote pricing page", async () => {
    const { openPlatformPricingTab } = await import("@/utils/platform/navigation")
    buildPlatformWebsiteUrlMock.mockReturnValueOnce("https://example.com/pricing")

    const url = await openPlatformPricingTab()

    expect(buildPlatformWebsiteUrlMock).toHaveBeenCalledWith("/pricing")
    expect(tabsCreateMock).toHaveBeenCalledWith({
      url: "https://example.com/pricing",
    })
    expect(url).toBe("https://example.com/pricing")
  })
})
