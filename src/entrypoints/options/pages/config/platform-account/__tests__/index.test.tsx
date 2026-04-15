// @vitest-environment jsdom
import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { PlatformAccountMenu } from "../index"

const platformQuickAccessMock = vi.fn()

vi.mock("@/components/platform/platform-quick-access", () => ({
  PlatformQuickAccess: (props: {
    variant?: string
    size?: string
    className?: string
  }) => {
    platformQuickAccessMock(props)
    return (
      <div
        data-testid="platform-quick-access"
        data-variant={props.variant}
        data-size={props.size}
        data-classname={props.className}
      />
    )
  },
}))

describe("platformAccountMenu", () => {
  it("reuses the popup quick access menu variant", () => {
    render(<PlatformAccountMenu />)

    const quickAccess = screen.getByTestId("platform-quick-access")
    expect(quickAccess).toHaveAttribute("data-variant", "menu")
    expect(quickAccess).toHaveAttribute("data-size", "sm")
    expect(quickAccess).toHaveAttribute("data-classname", "shrink-0")
    expect(platformQuickAccessMock).toHaveBeenCalledTimes(1)
  })
})
