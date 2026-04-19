// @vitest-environment jsdom
/* eslint-disable react/no-clone-element, react/no-context-provider, react/no-use-context */
import type { MouseEvent, ReactElement, ReactNode } from "react"
import { browser } from "#imports"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { createContext, useContext, useState } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { PlatformQuickAccess } from "@/components/platform/platform-quick-access"

const getPlatformAuthSessionMock = vi.fn()
const watchPlatformAuthSessionMock = vi.fn()
const openPlatformExtensionSyncTabMock = vi.fn()
const openPlatformPricingTabMock = vi.fn()
const clearPlatformAuthSessionMock = vi.fn()
const openOptionsPageMock = vi.fn()

vi.mock("#imports", async () => {
  const actual = await vi.importActual<typeof import("#imports")>("#imports")

  return {
    ...actual,
    i18n: {
      t: (key: string) => key,
    },
  }
})

vi.mock("@/components/ui/base-ui/button", () => ({
  Button: ({
    children,
    type = "button",
    ...props
  }: React.ComponentProps<"button">) => (
    <button type={type} {...props}>
      {children}
    </button>
  ),
}))

vi.mock("@/components/ui/base-ui/badge", () => ({
  Badge: ({ children }: { children: ReactNode }) => <span>{children}</span>,
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
    variant,
  }: {
    children: ReactNode
    onClick?: () => void
    variant?: string
  }) {
    return (
      <button type="button" data-variant={variant} onClick={onClick}>
        {children}
      </button>
    )
  }

  function DropdownMenuSeparator() {
    return <div role="separator" />
  }

  return {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
  }
})

vi.mock("@/utils/platform/storage", () => ({
  clearPlatformAuthSession: (...args: unknown[]) => clearPlatformAuthSessionMock(...args),
  getPlatformAuthSession: (...args: unknown[]) => getPlatformAuthSessionMock(...args),
  watchPlatformAuthSession: (...args: unknown[]) => watchPlatformAuthSessionMock(...args),
}))

vi.mock("@/utils/platform/navigation", () => ({
  openPlatformExtensionSyncTab: (...args: unknown[]) => openPlatformExtensionSyncTabMock(...args),
  openPlatformPricingTab: (...args: unknown[]) => openPlatformPricingTabMock(...args),
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe("platformQuickAccess", () => {
  it("shows a compact account menu in popup mode", async () => {
    getPlatformAuthSessionMock.mockResolvedValue(null)
    watchPlatformAuthSessionMock.mockReturnValue(() => {})

    render(<PlatformQuickAccess variant="menu" size="sm" />)

    await waitFor(() => {
      expect(screen.getByLabelText("platform.quickAccess.menuLabel")).toBeInTheDocument()
    })

    fireEvent.click(screen.getByLabelText("platform.quickAccess.menuLabel"))

    expect(screen.getByText("platform.quickAccess.title")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "platform.quickAccess.actions.signIn" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "platform.quickAccess.actions.plans" })).toBeInTheDocument()
  })

  it("shows logout inside the popup menu when signed in", async () => {
    getPlatformAuthSessionMock.mockResolvedValue({
      token: "token",
      user: {
        email: "user@example.com",
      },
      updatedAt: Date.now(),
    })
    watchPlatformAuthSessionMock.mockReturnValue(() => {})

    render(<PlatformQuickAccess variant="menu" />)

    await waitFor(() => {
      expect(screen.getByLabelText("platform.quickAccess.menuLabel")).toBeInTheDocument()
    })

    fireEvent.click(screen.getByLabelText("platform.quickAccess.menuLabel"))

    expect(screen.getByText("user@example.com")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "platform.quickAccess.actions.logOut" }))

    expect(clearPlatformAuthSessionMock).toHaveBeenCalledTimes(1)
  })

  it("can show a full settings item inside the account menu", async () => {
    browser.runtime.openOptionsPage = (...args: unknown[]) => openOptionsPageMock(...args)
    getPlatformAuthSessionMock.mockResolvedValue(null)
    watchPlatformAuthSessionMock.mockReturnValue(() => {})

    render(<PlatformQuickAccess variant="menu" includeSettingsEntry />)

    await waitFor(() => {
      expect(screen.getByLabelText("platform.quickAccess.menuLabel")).toBeInTheDocument()
    })

    fireEvent.click(screen.getByLabelText("platform.quickAccess.menuLabel"))
    fireEvent.click(screen.getByRole("button", { name: "platform.quickAccess.actions.openSettings" }))

    expect(openOptionsPageMock).toHaveBeenCalledTimes(1)
  })

  it("keeps the inline card actions and logout button for options pages", async () => {
    getPlatformAuthSessionMock.mockResolvedValue({
      token: "token",
      user: {},
      updatedAt: Date.now(),
    })
    watchPlatformAuthSessionMock.mockReturnValue(() => {})

    render(<PlatformQuickAccess />)

    await waitFor(() => {
      expect(screen.getByText("platform.quickAccess.status.signedIn")).toBeInTheDocument()
    })

    expect(screen.getByText("platform.quickAccess.accountHint")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "platform.quickAccess.actions.reconnect" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "platform.quickAccess.actions.logOut" })).toBeInTheDocument()
  })
})
