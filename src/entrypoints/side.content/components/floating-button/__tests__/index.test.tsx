// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react"
import { atom, createStore, Provider } from "jotai"
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { configFieldsAtomMap } from "@/utils/atoms/config"
import FloatingButton from ".."
import { enablePageTranslationAtom, isDraggingButtonAtom, isSideOpenAtom } from "../../../atoms"

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
      clickAction: "panel",
      disabledFloatingButtonPatterns: [],
    }),
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
  sendMessageMock.mockResolvedValue(true)
})

function renderFloatingButton(clickAction: "panel" | "translate" = "panel") {
  const store = createStore()

  void store.set(configFieldsAtomMap.floatingButton, {
    enabled: true,
    position: 0.66,
    clickAction,
    disabledFloatingButtonPatterns: [],
  })
  void store.set(isDraggingButtonAtom, false)
  void store.set(isSideOpenAtom, false)
  void store.set(enablePageTranslationAtom, { enabled: false })

  return render(
    <Provider store={store}>
      <FloatingButton />
    </Provider>,
  )
}

describe("floatingButton close trigger", () => {
  it("keeps enough of the main trigger visible while collapsed", () => {
    renderFloatingButton()

    const mainTrigger = screen.getByRole("img").closest("div")

    expect(mainTrigger).toHaveClass("w-11")
    expect(mainTrigger).toHaveClass("translate-x-2")
    expect(mainTrigger).not.toHaveClass("translate-x-6")
  })

  it("keeps the close trigger in the layout with visibility classes instead of display:none", () => {
    renderFloatingButton()

    const closeTrigger = screen.getByTitle("Close floating button")

    expect(closeTrigger).toHaveClass("invisible")
    expect(closeTrigger).toHaveClass("group-hover:visible")
    expect(closeTrigger).not.toHaveClass("hidden")
    expect(closeTrigger).not.toHaveClass("group-hover:block")
  })

  it("forces the close trigger visible while the dropdown is open", () => {
    renderFloatingButton()

    const closeTrigger = screen.getByTitle("Close floating button")
    fireEvent.click(closeTrigger)

    expect(closeTrigger).toHaveClass("visible")
    expect(screen.getByText("options.floatingButtonAndToolbar.floatingButton.closeMenu.disableForSite")).toBeInTheDocument()
  })

  it("opens the side panel when the main button uses the default panel action", () => {
    renderFloatingButton("panel")

    const mainTrigger = screen.getByRole("img").closest("div")
    const hiddenButtons = screen.getAllByTestId("hidden-button")

    expect(mainTrigger).not.toBeNull()

    fireEvent.mouseDown(mainTrigger!, { clientY: 100 })
    fireEvent.mouseUp(document, { clientY: 100 })

    expect(sendMessageMock).toHaveBeenCalledWith("openSidePanel", undefined)
    expect(sendMessageMock).not.toHaveBeenCalledWith("tryToSetEnablePageTranslationOnContentScript", expect.anything())
    hiddenButtons.forEach((button) => {
      expect(button).not.toHaveClass("translate-x-0")
    })
  })

  it("starts page translation when the main button uses the translate action", () => {
    renderFloatingButton("translate")

    const mainTrigger = screen.getByRole("img").closest("div")

    fireEvent.mouseDown(mainTrigger!, { clientY: 100 })
    fireEvent.mouseUp(document, { clientY: 100 })

    expect(sendMessageMock).toHaveBeenCalledWith(
      "tryToSetEnablePageTranslationOnContentScript",
      { enabled: true },
    )
    expect(sendMessageMock).not.toHaveBeenCalledWith("openSidePanel", undefined)
  })

  it("does not treat a drag as a click action", () => {
    renderFloatingButton("panel")

    const mainTrigger = screen.getByRole("img").closest("div")

    fireEvent.mouseDown(mainTrigger!, { clientY: 100 })
    fireEvent.mouseMove(document, { clientY: 120 })
    fireEvent.mouseUp(document, { clientY: 120 })

    expect(sendMessageMock).not.toHaveBeenCalled()
  })

  it("starts page translation only from the secondary translate button", () => {
    renderFloatingButton()

    const [translateButton] = screen.getAllByTestId("hidden-button")
    fireEvent.click(translateButton)

    expect(sendMessageMock).toHaveBeenCalledWith(
      "tryToSetEnablePageTranslationOnContentScript",
      { enabled: true },
    )
  })
})
