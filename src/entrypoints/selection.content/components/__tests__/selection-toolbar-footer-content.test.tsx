// @vitest-environment jsdom
import { i18n } from "#imports"
import { act, fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { TooltipProvider } from "@/components/ui/base-ui/tooltip"
import { SelectionToolbarFooterContent } from "../selection-toolbar-footer-content"

describe("selectionToolbarFooterContent", () => {
  it("renders footer actions", async () => {
    const onRegenerate = vi.fn()

    render(
      <TooltipProvider>
        <SelectionToolbarFooterContent
          paragraphsText="Context text"
          titleText="Page Title"
          onRegenerate={onRegenerate}
        >
          <button type="button">Save to Notebase</button>
        </SelectionToolbarFooterContent>
      </TooltipProvider>,
    )

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "action.viewContextDetails" }))
      await Promise.resolve()
    })

    expect(screen.getByText(i18n.t("action.contextDetailsTitleLabel"))).toBeInTheDocument()
    expect(screen.getByText(i18n.t("action.contextDetailsParagraphsLabel"))).toBeInTheDocument()
    expect(screen.getByText("Page Title")).toBeInTheDocument()
    expect(screen.getByText("Context text")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Save to Notebase" })).toBeInTheDocument()
    const contextPreview = screen.getByText("Context text").closest("[data-slot='selection-toolbar-footer-preview-value']")

    expect(contextPreview).toHaveClass("max-h-36", "overflow-y-auto", "break-words")
    expect(contextPreview?.className).toContain("[overflow-wrap:anywhere]")

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "action.regenerate" }))
      await Promise.resolve()
    })

    expect(onRegenerate).toHaveBeenCalledTimes(1)
  })

  it("shows placeholders when title and context are empty", async () => {
    render(
      <TooltipProvider>
        <SelectionToolbarFooterContent
          paragraphsText={null}
          titleText=""
          onRegenerate={vi.fn()}
        />
      </TooltipProvider>,
    )

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "action.viewContextDetails" }))
      await Promise.resolve()
    })

    expect(screen.getAllByText("—")).toHaveLength(2)
  })
})
