// @vitest-environment jsdom
/* eslint-disable react/no-clone-element, react/no-context-provider, react/no-use-context */
import type { MouseEvent, ReactElement, ReactNode } from "react"
import { fireEvent, render, screen } from "@testing-library/react"
import { createContext, useContext, useState } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { MoreMenu } from "../more-menu"

const { tabsCreateMock, getUrlMock, openMock, openPlatformWordBankTabMock, browserMock } = vi.hoisted(() => ({
  tabsCreateMock: vi.fn(),
  getUrlMock: vi.fn((path: string) => `chrome-extension://test${path}`),
  openMock: vi.fn(),
  openPlatformWordBankTabMock: vi.fn(),
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
vi.stubGlobal("open", openMock)

vi.mock("#imports", () => ({
  browser: browserMock,
  i18n: {
    t: (key: string) => ({
      "popup.more.title": "More",
      "popup.more.vocabulary": "Vocabulary",
      "popup.more.translationHub": "Translation Hub",
      "popup.more.tutorial": "Tutorial",
    }[key] ?? key),
  },
}))

vi.mock("wxt/browser", () => ({
  browser: browserMock,
}))

vi.mock("@/utils/platform/navigation", () => ({
  openPlatformWordBankTab: (...args: unknown[]) => openPlatformWordBankTabMock(...args),
}))

vi.mock("@/components/ui/base-ui/dropdown-menu", async () => {
  const React = await import("react")

  interface MenuContextValue {
    open: boolean
    setOpen: (open: boolean) => void
  }

  const MenuContext = createContext<MenuContextValue | null>(null)

  function useMenuContext() {
    const context = useContext(MenuContext)
    if (!context) {
      throw new Error("DropdownMenu components must be used within DropdownMenu.")
    }
    return context
  }

  function DropdownMenu({ children }: { children: ReactNode }) {
    const [open, setOpen] = useState(false)
    return (
      <MenuContext.Provider value={{ open, setOpen }}>
        {children}
      </MenuContext.Provider>
    )
  }

  function DropdownMenuTrigger({
    children,
    render,
  }: {
    children: ReactNode
    render: ReactElement<{
      children?: ReactNode
      onClick?: (event: MouseEvent<HTMLButtonElement>) => void
    }>
  }) {
    const { setOpen } = useMenuContext()
    return React.cloneElement(render, {
      onClick: (event: MouseEvent<HTMLButtonElement>) => {
        render.props.onClick?.(event)
        setOpen(true)
      },
      children,
    })
  }

  function DropdownMenuContent({ children }: { children: ReactNode }) {
    const { open } = useMenuContext()
    return open ? <div>{children}</div> : null
  }

  function DropdownMenuItem({
    children,
    onClick,
  }: {
    children: ReactNode
    onClick?: () => void
  }) {
    return (
      <button type="button" onClick={onClick}>
        {children}
      </button>
    )
  }

  return {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
  }
})

describe("more menu", () => {
  beforeEach(() => {
    tabsCreateMock.mockReset()
    getUrlMock.mockClear()
    openMock.mockReset()
    openPlatformWordBankTabMock.mockReset()
    openPlatformWordBankTabMock.mockResolvedValue("https://lexio.example.com/word-bank")
  })

  it("opens the website word bank", () => {
    render(<MoreMenu />)

    fireEvent.click(screen.getByRole("button", { name: "popup.more.title" }))
    fireEvent.click(screen.getByRole("button", { name: "popup.more.vocabulary" }))

    expect(openPlatformWordBankTabMock).toHaveBeenCalledTimes(1)
  })

  it("opens the new website instead of the retired tutorial page", () => {
    render(<MoreMenu />)

    fireEvent.click(screen.getByRole("button", { name: "popup.more.title" }))
    fireEvent.click(screen.getByRole("button", { name: "popup.more.tutorial" }))

    expect(openMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/sign-in$/),
      "_blank",
      "noopener,noreferrer",
    )
  })
})
