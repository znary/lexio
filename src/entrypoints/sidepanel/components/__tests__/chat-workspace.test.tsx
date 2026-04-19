// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { ChatWorkspace } from "../chat-workspace"

const {
  createPlatformChatThreadMock,
  deletePlatformChatThreadMock,
  getSidepanelChatSnapshotMock,
  getPlatformChatThreadMessagesMock,
  listPlatformChatThreadsMock,
  setSidepanelChatSnapshotMock,
  streamPlatformChatThreadMessageMock,
} = vi.hoisted(() => ({
  createPlatformChatThreadMock: vi.fn(),
  deletePlatformChatThreadMock: vi.fn(),
  getSidepanelChatSnapshotMock: vi.fn(),
  getPlatformChatThreadMessagesMock: vi.fn(),
  listPlatformChatThreadsMock: vi.fn(),
  setSidepanelChatSnapshotMock: vi.fn(),
  streamPlatformChatThreadMessageMock: vi.fn(),
}))

vi.mock("@/utils/platform/api", () => ({
  createPlatformChatThread: (...args: unknown[]) => createPlatformChatThreadMock(...args),
  deletePlatformChatThread: (...args: unknown[]) => deletePlatformChatThreadMock(...args),
  getPlatformChatThreadMessages: (...args: unknown[]) => getPlatformChatThreadMessagesMock(...args),
  listPlatformChatThreads: (...args: unknown[]) => listPlatformChatThreadsMock(...args),
  streamPlatformChatThreadMessage: (...args: unknown[]) => streamPlatformChatThreadMessageMock(...args),
}))

vi.mock("@/utils/platform/chat-cache", () => ({
  getSidepanelChatSnapshot: (...args: unknown[]) => getSidepanelChatSnapshotMock(...args),
  setSidepanelChatSnapshot: (...args: unknown[]) => setSidepanelChatSnapshotMock(...args),
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

function createThread(overrides: Partial<{
  id: string
  title: string
  createdAt: string
  updatedAt: string
  lastMessageAt: string | null
}> = {}) {
  return {
    id: "thread-1",
    title: "Saved thread",
    createdAt: "2026-04-19T10:00:00.000Z",
    updatedAt: "2026-04-19T10:10:00.000Z",
    lastMessageAt: "2026-04-19T10:10:00.000Z",
    ...overrides,
  }
}

function createMessage(overrides: Partial<{
  id: string
  role: "user" | "assistant"
  contentText: string
  createdAt: string
}> = {}) {
  return {
    id: "message-1",
    role: "assistant" as const,
    contentText: "Cached hello",
    createdAt: "2026-04-19T10:10:00.000Z",
    ...overrides,
  }
}

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
    getSidepanelChatSnapshotMock.mockResolvedValue(null)
    listPlatformChatThreadsMock.mockResolvedValue([])
    setSidepanelChatSnapshotMock.mockResolvedValue(undefined)
  })

  it("renders a fresh chat session without crashing", async () => {
    render(<ChatWorkspace isSignedIn isSessionLoading={false} sessionAccountKey="user-1" />)

    await screen.findByPlaceholderText("问任何问题")
    expect(screen.getByPlaceholderText("问任何问题")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Start new chat" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Open chat history" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Open full settings" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Open account menu" })).toBeInTheDocument()
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument()
    expect(listPlatformChatThreadsMock).toHaveBeenCalledTimes(1)
  })

  it("shows a cached thread immediately while refreshing history in the background", async () => {
    const cachedThread = createThread()
    const cachedMessage = createMessage()
    let resolveThreads: ((threads: ReturnType<typeof createThread>[]) => void) | null = null
    getSidepanelChatSnapshotMock.mockResolvedValue({
      threads: [cachedThread],
      currentThreadId: cachedThread.id,
      currentThreadSummary: cachedThread,
      currentThreadMessages: [cachedMessage],
      cachedAt: Date.now(),
    })
    listPlatformChatThreadsMock.mockReturnValue(new Promise((resolve) => {
      resolveThreads = resolve
    }))

    render(<ChatWorkspace isSignedIn isSessionLoading={false} sessionAccountKey="user-1" />)

    await screen.findByText("Cached hello")
    expect(screen.getByText("Cached hello")).toBeInTheDocument()
    expect(screen.getByPlaceholderText("问任何问题")).toBeInTheDocument()
    expect(screen.queryByText("Loading Lexio Cloud...")).not.toBeInTheDocument()
    expect(getSidepanelChatSnapshotMock).toHaveBeenCalledWith("user-1")
    expect(listPlatformChatThreadsMock).toHaveBeenCalledTimes(1)

    resolveThreads?.([cachedThread])
  })

  it("keeps an empty session when only remote history exists", async () => {
    const remoteThread = createThread()
    listPlatformChatThreadsMock.mockResolvedValue([remoteThread])

    render(<ChatWorkspace isSignedIn isSessionLoading={false} sessionAccountKey="user-1" />)

    await screen.findByPlaceholderText("问任何问题")
    expect(screen.getByPlaceholderText("问任何问题")).toBeInTheDocument()
    expect(screen.queryByText("Cached hello")).not.toBeInTheDocument()
    expect(getPlatformChatThreadMessagesMock).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole("button", { name: "Open chat history" }))

    expect(await screen.findByRole("heading", { name: "History" })).toBeInTheDocument()
    expect(screen.getByText("Saved thread")).toBeInTheDocument()
  })

  it("opens thread history from the bottom sheet instead of rendering a select box", async () => {
    const savedThread = createThread()
    listPlatformChatThreadsMock.mockResolvedValue([savedThread])
    getPlatformChatThreadMessagesMock.mockResolvedValue({
      thread: savedThread,
      messages: [],
    })

    render(<ChatWorkspace isSignedIn isSessionLoading={false} sessionAccountKey="user-1" />)

    await screen.findByPlaceholderText("问任何问题")
    expect(screen.getByPlaceholderText("问任何问题")).toBeInTheDocument()
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Open chat history" }))

    expect(await screen.findByRole("heading", { name: "History" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Delete Saved thread" })).toBeInTheDocument()

    fireEvent.click(screen.getByText("Saved thread").closest("button")!)

    await waitFor(() => {
      expect(getPlatformChatThreadMessagesMock).toHaveBeenCalledWith("thread-1")
    })

    expect(setSidepanelChatSnapshotMock).toHaveBeenLastCalledWith("user-1", expect.objectContaining({
      currentThreadId: "thread-1",
      currentThreadSummary: expect.objectContaining({ id: "thread-1" }),
      threads: [expect.objectContaining({ id: "thread-1" })],
    }))
  })

  it("clears a stale cached thread when it no longer exists remotely", async () => {
    const staleThread = createThread()
    const replacementThread = createThread({
      id: "thread-2",
      title: "Fresh thread",
      updatedAt: "2026-04-19T11:10:00.000Z",
      lastMessageAt: "2026-04-19T11:10:00.000Z",
    })
    let resolveThreads: ((threads: ReturnType<typeof createThread>[]) => void) | null = null
    getSidepanelChatSnapshotMock.mockResolvedValue({
      threads: [staleThread],
      currentThreadId: staleThread.id,
      currentThreadSummary: staleThread,
      currentThreadMessages: [createMessage()],
      cachedAt: Date.now(),
    })
    listPlatformChatThreadsMock.mockReturnValue(new Promise((resolve) => {
      resolveThreads = resolve
    }))

    render(<ChatWorkspace isSignedIn isSessionLoading={false} sessionAccountKey="user-1" />)

    await screen.findByText("Cached hello")
    expect(screen.getByText("Cached hello")).toBeInTheDocument()

    resolveThreads?.([replacementThread])

    await waitFor(() => {
      expect(screen.queryByText("Cached hello")).not.toBeInTheDocument()
    })

    expect(screen.getByPlaceholderText("问任何问题")).toBeInTheDocument()
    expect(getPlatformChatThreadMessagesMock).not.toHaveBeenCalled()
    expect(setSidepanelChatSnapshotMock).toHaveBeenLastCalledWith("user-1", expect.objectContaining({
      currentThreadId: null,
      currentThreadSummary: null,
      currentThreadMessages: [],
      threads: [expect.objectContaining({ id: "thread-2" })],
    }))
  })

  it("refreshes the committed thread snapshot without resetting the current UI", async () => {
    const committedThread = createThread({
      id: "thread-new",
      title: "New thread",
      updatedAt: "2026-04-19T12:10:00.000Z",
      lastMessageAt: "2026-04-19T12:10:00.000Z",
    })
    createPlatformChatThreadMock.mockResolvedValue(committedThread)
    listPlatformChatThreadsMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([committedThread])
    streamPlatformChatThreadMessageMock.mockImplementation(async function* () {
      yield "Draft reply"
    })
    getPlatformChatThreadMessagesMock.mockResolvedValue({
      thread: committedThread,
      messages: [
        createMessage({
          id: "message-user",
          role: "user",
          contentText: "hello",
        }),
        createMessage({
          id: "message-assistant",
          role: "assistant",
          contentText: "Draft reply",
        }),
      ],
    })

    const { container } = render(<ChatWorkspace isSignedIn isSessionLoading={false} sessionAccountKey="user-1" />)

    await screen.findByPlaceholderText("问任何问题")

    fireEvent.change(screen.getByPlaceholderText("问任何问题"), {
      target: { value: "hello" },
    })

    const sendButton = container.querySelector(".lexio-sider-send-button")
    if (!(sendButton instanceof HTMLButtonElement)) {
      throw new TypeError("Expected sidepanel send button")
    }

    await waitFor(() => {
      expect(sendButton).not.toBeDisabled()
    })

    fireEvent.click(sendButton)

    await screen.findByText("Draft reply")

    await waitFor(() => {
      expect(getPlatformChatThreadMessagesMock).toHaveBeenCalledWith("thread-new")
    })

    expect(screen.getByText("Draft reply")).toBeInTheDocument()
    expect(screen.queryByText("Loading thread...")).not.toBeInTheDocument()
    expect(setSidepanelChatSnapshotMock).toHaveBeenLastCalledWith("user-1", expect.objectContaining({
      currentThreadId: "thread-new",
      currentThreadSummary: expect.objectContaining({ id: "thread-new" }),
      currentThreadMessages: expect.arrayContaining([
        expect.objectContaining({ contentText: "Draft reply" }),
      ]),
    }))
  })
})
