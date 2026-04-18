// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react"
import { atom } from "jotai"
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import FloatingButton from ".."

const { sendMessageMock } = vi.hoisted(() => ({
  sendMessageMock: vi.fn(),
}))

vi.mock("#imports", () => ({
  browser: {
    runtime: {
      getURL: (path = "") => `chrome-extension://test-extension${path}`,
    },
  },
  i18n: {
    t: (key: string) => key,
  },
}))

vi.mock("@/utils/atoms/config", () => ({
  configFieldsAtomMap: {
    floatingButton: atom({
      enabled: true,
      position: 0.66,
      clickAction: "translate",
      disabledFloatingButtonPatterns: [],
    }),
    sideContent: atom({ width: 360 }),
  },
}))

vi.mock("../../../atoms", () => ({
  enablePageTranslationAtom: atom({ enabled: false }),
  isDraggingButtonAtom: atom(false),
  isSideOpenAtom: atom(false),
}))

vi.mock("../../../index", () => ({
  shadowWrapper: document.body,
}))

vi.mock("../components/hidden-button", () => ({
  default: ({ className, onClick }: { className?: string, onClick: () => void }) => (
    <button type="button" data-testid="hidden-button" className={className} onClick={onClick} />
  ),
}))

vi.mock("@/utils/message", () => ({
  sendMessage: (...args: unknown[]) => sendMessageMock(...args),
}))

beforeAll(() => {
  class ResizeObserverMock {
    observe() {}
    unobserve() {}
    disconnect() {}
  }

  vi.stubGlobal("ResizeObserver", ResizeObserverMock)
})

beforeEach(() => {
  sendMessageMock.mockReset()
})

describe("floatingButton close trigger", () => {
  it("keeps enough of the main trigger visible while collapsed", () => {
    render(<FloatingButton />)

    const mainTrigger = screen.getByRole("img").closest("div")

    expect(mainTrigger).toHaveClass("w-11")
    expect(mainTrigger).toHaveClass("translate-x-2")
    expect(mainTrigger).not.toHaveClass("translate-x-6")
  })

  it("keeps the close trigger in the layout with visibility classes instead of display:none", () => {
    render(<FloatingButton />)

    const closeTrigger = screen.getByTitle("Close floating button")

    expect(closeTrigger).toHaveClass("invisible")
    expect(closeTrigger).toHaveClass("group-hover:visible")
    expect(closeTrigger).not.toHaveClass("hidden")
    expect(closeTrigger).not.toHaveClass("group-hover:block")
  })

  it("forces the close trigger visible while the dropdown is open", () => {
    render(<FloatingButton />)

    const closeTrigger = screen.getByTitle("Close floating button")
    fireEvent.click(closeTrigger)

    expect(closeTrigger).toHaveClass("visible")
    expect(screen.getByText("options.floatingButtonAndToolbar.floatingButton.closeMenu.disableForSite")).toBeInTheDocument()
  })

  it("starts page translation only from the secondary translate button", () => {
    render(<FloatingButton />)

    const [translateButton] = screen.getAllByTestId("hidden-button")
    fireEvent.click(translateButton)

    expect(sendMessageMock).toHaveBeenCalledWith(
      "tryToSetEnablePageTranslationOnContentScript",
      { enabled: true },
    )
  })

  it("does not start page translation when the main floating trigger is clicked", () => {
    render(<FloatingButton />)

    const mainTrigger = screen.getByRole("img").closest("div")

    expect(mainTrigger).not.toBeNull()
    expect(mainTrigger?.parentElement).toHaveStyle({
      right: "var(--removed-body-scroll-bar-size, 0px)",
    })

    fireEvent.mouseDown(mainTrigger!, { clientY: 100 })
    fireEvent.mouseUp(document, { clientY: 100 })

    expect(sendMessageMock).not.toHaveBeenCalledWith(
      "tryToSetEnablePageTranslationOnContentScript",
      expect.anything(),
    )
    expect(mainTrigger?.parentElement).toHaveStyle({
      right: "calc(360px + var(--removed-body-scroll-bar-size, 0px))",
    })
  })
})
