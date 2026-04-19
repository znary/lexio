// @vitest-environment jsdom
import type { ComponentProps, ReactElement } from "react"
import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { ExplainButton } from ".."

const openToolbarExplainMock = vi.fn()

vi.mock("#imports", () => ({
  i18n: {
    t: (key: string) => key,
  },
}))

vi.mock("@/components/ui/selection-popover", () => ({
  SelectionPopover: {
    Trigger: ({ children, ...props }: ComponentProps<"button">) => (
      <button type="button" {...props}>
        {children}
      </button>
    ),
  },
}))

vi.mock("../../../components/selection-tooltip", () => ({
  SelectionToolbarTooltip: ({ render }: { render: ReactElement }) => render,
}))

vi.mock("../provider", () => ({
  useSelectionExplainPopover: () => ({
    openToolbarExplain: openToolbarExplainMock,
  }),
}))

describe("explainButton", () => {
  beforeEach(() => {
    openToolbarExplainMock.mockReset()
  })

  it("blurs the toolbar trigger before opening the explain popover", () => {
    render(<ExplainButton />)

    const trigger = screen.getByRole("button", { name: "action.explain" })
    const blurSpy = vi.spyOn(trigger, "blur")

    trigger.focus()
    expect(trigger).toHaveFocus()

    fireEvent.click(trigger)

    expect(blurSpy).toHaveBeenCalledOnce()
    expect(openToolbarExplainMock).toHaveBeenCalledOnce()
    expect(openToolbarExplainMock).toHaveBeenCalledWith(trigger)
    expect(blurSpy.mock.invocationCallOrder[0]).toBeLessThan(openToolbarExplainMock.mock.invocationCallOrder[0]!)
    expect(document.activeElement).not.toBe(trigger)
  })
})
