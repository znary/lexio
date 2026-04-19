// @vitest-environment jsdom
import type { ComponentProps, ReactNode } from "react"
import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { TranslationServiceDropdown } from "../translation-service-dropdown"

const { tabsCreateMock, getUrlMock, browserMock } = vi.hoisted(() => ({
  tabsCreateMock: vi.fn(),
  getUrlMock: vi.fn((path: string) => `chrome-extension://test${path}`),
  browserMock: {
    runtime: {
      getURL: (path: string) => `chrome-extension://test${path}`,
    },
    tabs: {
      create: vi.fn(),
    },
  },
}))

browserMock.tabs.create = tabsCreateMock
browserMock.runtime.getURL = getUrlMock

vi.mock("#imports", () => ({
  browser: browserMock,
  i18n: {
    t: (key: string) => key,
  },
}))

vi.mock("wxt/browser", () => ({
  browser: browserMock,
}))

vi.mock("jotai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("jotai")>()
  return {
    ...actual,
    useAtom: () => [[], vi.fn()],
    useAtomValue: () => [],
  }
})

vi.mock("@/utils/atoms/config", () => ({
  configFieldsAtomMap: {
    providersConfig: {},
  },
}))

vi.mock("../atoms", () => ({
  selectedProviderIdsAtom: {},
}))

vi.mock("@/components/providers/theme-provider", () => ({
  useTheme: () => ({
    theme: "light",
  }),
}))

vi.mock("@/components/provider-icon", () => ({
  default: () => <span data-testid="provider-icon" />,
}))

vi.mock("@/components/ui/base-ui/button", () => ({
  Button: ({ children, ...props }: ComponentProps<"button">) => <button type="button" {...props}>{children}</button>,
}))

vi.mock("@/components/ui/base-ui/select", () => ({
  Select: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectGroup: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectItem: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectLabel: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectTrigger: ({ children }: { children: ReactNode }) => <button type="button">{children}</button>,
  SelectValue: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
}))

describe("translation service dropdown", () => {
  it("opens the main options page instead of the removed config route", () => {
    render(<TranslationServiceDropdown />)

    fireEvent.click(screen.getByTitle("Open account settings"))

    expect(tabsCreateMock).toHaveBeenCalledWith({
      url: "chrome-extension://test/options.html#/",
    })
  })
})
