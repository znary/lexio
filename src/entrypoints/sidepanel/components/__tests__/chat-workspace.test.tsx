// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { ChatWorkspace } from "../chat-workspace"

const {
  createPlatformChatThreadMock,
  deletePlatformChatThreadMock,
  getPlatformChatThreadMessagesMock,
  listPlatformChatThreadsMock,
  streamPlatformChatThreadMessageMock,
} = vi.hoisted(() => ({
  createPlatformChatThreadMock: vi.fn(),
  deletePlatformChatThreadMock: vi.fn(),
  getPlatformChatThreadMessagesMock: vi.fn(),
  listPlatformChatThreadsMock: vi.fn(),
  streamPlatformChatThreadMessageMock: vi.fn(),
}))

vi.mock("@/utils/platform/api", () => ({
  createPlatformChatThread: (...args: unknown[]) => createPlatformChatThreadMock(...args),
  deletePlatformChatThread: (...args: unknown[]) => deletePlatformChatThreadMock(...args),
  getPlatformChatThreadMessages: (...args: unknown[]) => getPlatformChatThreadMessagesMock(...args),
  listPlatformChatThreads: (...args: unknown[]) => listPlatformChatThreadsMock(...args),
  streamPlatformChatThreadMessage: (...args: unknown[]) => streamPlatformChatThreadMessageMock(...args),
}))

vi.mock("#imports", () => ({
  browser: {
    runtime: {
      openOptionsPage: vi.fn(),
    },
  },
}))

vi.mock("@/components/platform/platform-quick-access", () => ({
  PlatformQuickAccess: () => <button type="button" aria-label="Open account menu">Account</button>,
}))

describe("chatWorkspace", () => {
  beforeAll(() => {
    class ResizeObserverMock {
      observe() {}
      unobserve() {}
      disconnect() {}
    }

    vi.stubGlobal("ResizeObserver", ResizeObserverMock)
    HTMLElement.prototype.scrollTo = vi.fn()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal("confirm", vi.fn(() => true))
    listPlatformChatThreadsMock.mockResolvedValue([])
  })

  it("renders a fresh chat session without crashing", async () => {
    render(<ChatWorkspace isSignedIn isSessionLoading={false} />)

    expect(await screen.findByPlaceholderText("问任何问题")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Start new chat" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Open chat history" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Open full settings" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Open account menu" })).toBeInTheDocument()
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument()
    expect(listPlatformChatThreadsMock).toHaveBeenCalledTimes(1)
  })

  it("opens thread history from the bottom sheet instead of rendering a select box", async () => {
    listPlatformChatThreadsMock.mockResolvedValue([
      {
        id: "thread-1",
        title: "Saved thread",
        createdAt: "2026-04-19T10:00:00.000Z",
        updatedAt: "2026-04-19T10:10:00.000Z",
        lastMessageAt: "2026-04-19T10:10:00.000Z",
      },
    ])
    getPlatformChatThreadMessagesMock.mockResolvedValue({
      messages: [],
    })

    render(<ChatWorkspace isSignedIn isSessionLoading={false} />)

    expect(await screen.findByPlaceholderText("问任何问题")).toBeInTheDocument()
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Open chat history" }))

    expect(await screen.findByRole("heading", { name: "History" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Delete Saved thread" })).toBeInTheDocument()

    fireEvent.click(screen.getByText("Saved thread").closest("button")!)

    await waitFor(() => {
      expect(getPlatformChatThreadMessagesMock).toHaveBeenCalledWith("thread-1")
    })
  })
})
