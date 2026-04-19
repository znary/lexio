import { beforeEach, describe, expect, it, vi } from "vitest"

const setUninstallURLMock = vi.fn()

vi.mock("@/utils/constants/app", () => ({
  EXTENSION_VERSION: "1.0.0",
}))

describe("setupUninstallSurvey", () => {
  beforeEach(() => {
    setUninstallURLMock.mockReset()
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: {
        language: "en-US",
        platform: "MacIntel",
        userAgent: "Mozilla/5.0 Chrome/136.0.0.0",
      },
    })
  })

  it("uses the new website sign-in page instead of the retired external survey", async () => {
    const { setupUninstallSurvey } = await import("../uninstall-survey")
    const browserApi = {
      i18n: {
        getUILanguage: () => "en-US",
      },
      runtime: {
        setUninstallURL: setUninstallURLMock,
      },
    } as any

    await setupUninstallSurvey(browserApi, "chrome")

    expect(setUninstallURLMock).toHaveBeenCalledTimes(1)

    const uninstallUrl = new URL(setUninstallURLMock.mock.calls[0][0])
    expect(uninstallUrl.pathname).toBe("/sign-in")
    expect(uninstallUrl.searchParams.get("rf_version")).toBe("1.0.0")
    expect(uninstallUrl.searchParams.get("browser_type")).toBeDefined()
    expect(uninstallUrl.searchParams.get("browser_version")).toBe("136.0.0.0")
    expect(uninstallUrl.searchParams.get("os")).toBe("MacOS")
    expect(uninstallUrl.searchParams.get("ui_lang")).toBe("en-US")
  })
})
