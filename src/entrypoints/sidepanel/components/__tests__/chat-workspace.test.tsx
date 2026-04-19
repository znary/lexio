// @vitest-environment jsdom
import { browser } from "#imports"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { ChatWorkspace } from "../chat-workspace"

const {
  clearSidepanelChatDraftMock,
  consumePendingSidepanelChatRequestMock,
  createPlatformChatThreadMock,
  deletePlatformChatThreadMock,
  getPendingSidepanelChatRequestsMock,
  getSidepanelChatDraftMock,
  getSidepanelChatSnapshotMock,
  getPlatformChatThreadMessagesMock,
  listPlatformChatThreadsMock,
  sendMessageMock,
  setSidepanelChatDraftMock,
  setSidepanelChatSnapshotMock,
  streamPlatformChatThreadMessageMock,
  watchPendingSidepanelChatRequestMock,
} = vi.hoisted(() => ({
  clearSidepanelChatDraftMock: vi.fn(),
  consumePendingSidepanelChatRequestMock: vi.fn(),
  createPlatformChatThreadMock: vi.fn(),
  deletePlatformChatThreadMock: vi.fn(),
  getPendingSidepanelChatRequestsMock: vi.fn(),
  getSidepanelChatDraftMock: vi.fn(),
  getSidepanelChatSnapshotMock: vi.fn(),
  getPlatformChatThreadMessagesMock: vi.fn(),
  listPlatformChatThreadsMock: vi.fn(),
  sendMessageMock: vi.fn(),
  setSidepanelChatDraftMock: vi.fn(),
  setSidepanelChatSnapshotMock: vi.fn(),
  streamPlatformChatThreadMessageMock: vi.fn(),
  watchPendingSidepanelChatRequestMock: vi.fn(),
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

vi.mock("@/utils/platform/sidepanel-chat-draft", () => ({
  clearSidepanelChatDraft: (...args: unknown[]) => clearSidepanelChatDraftMock(...args),
  getSidepanelChatDraft: (...args: unknown[]) => getSidepanelChatDraftMock(...args),
  setSidepanelChatDraft: (...args: unknown[]) => setSidepanelChatDraftMock(...args),
}))

vi.mock("@/utils/platform/sidepanel-chat-request", () => ({
  buildSidepanelChatRequestPrompt: (payload: { type: string }) => `prepared:${payload.type}`,
  createSidepanelChatRequest: vi.fn((payload: unknown) => ({
    id: "local-request-1",
    payload,
  })),
  consumePendingSidepanelChatRequest: (...args: unknown[]) => consumePendingSidepanelChatRequestMock(...args),
  getPendingSidepanelChatRequests: (...args: unknown[]) => getPendingSidepanelChatRequestsMock(...args),
  watchPendingSidepanelChatRequests: (...args: unknown[]) => watchPendingSidepanelChatRequestMock(...args),
}))

vi.mock("@/utils/message", () => ({
  sendMessage: (...args: unknown[]) => sendMessageMock(...args),
}))

vi.mock("#imports", () => ({
  browser: {
    runtime: {
      openOptionsPage: vi.fn(),
    },
    tabs: {
      query: vi.fn(),
    },
  },
  i18n: {
    t: (key: string) => key,
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

function createDraftSession(overrides: Partial<{
  sessionKey: string
  createdAt: number
}> = {}) {
  return {
    sessionKey: "draft-session-1",
    createdAt: 1_745_020_000_000,
    ...overrides,
  }
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve
  })

  return {
    promise,
    resolve,
  }
}

async function openTooltip(trigger: Element) {
  fireEvent.mouseEnter(trigger)
  fireEvent.focus(trigger)

  await waitFor(() => {
    expect(document.querySelector("[data-slot='tooltip-content']")).toBeTruthy()
  })

  return document.querySelector("[data-slot='tooltip-content']")
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
    browser.tabs.query = vi.fn().mockResolvedValue([{ id: 7, windowId: 1 }])
    clearSidepanelChatDraftMock.mockResolvedValue(undefined)
    consumePendingSidepanelChatRequestMock.mockResolvedValue(undefined)
    getPendingSidepanelChatRequestsMock.mockResolvedValue([])
    getSidepanelChatDraftMock.mockResolvedValue(null)
    getSidepanelChatSnapshotMock.mockResolvedValue(null)
    listPlatformChatThreadsMock.mockResolvedValue([])
    sendMessageMock.mockReset()
    sendMessageMock.mockResolvedValue(true)
    setSidepanelChatDraftMock.mockResolvedValue(undefined)
    setSidepanelChatSnapshotMock.mockResolvedValue(undefined)
    watchPendingSidepanelChatRequestMock.mockImplementation(() => () => {})
  })

  it("renders a fresh chat session without crashing", async () => {
    render(<ChatWorkspace isSignedIn isSessionLoading={false} sessionAccountKey="user-1" />)

    await screen.findByPlaceholderText("问任何问题")
    expect(screen.getByPlaceholderText("问任何问题")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Summarize current page" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Start new chat" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Open chat history" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Open full settings" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Open account menu" })).toBeInTheDocument()
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument()
    expect(listPlatformChatThreadsMock).toHaveBeenCalledTimes(1)
  })

  it("keeps new chat as the first composer tool and moves page explain behind it", async () => {
    const { container } = render(<ChatWorkspace isSignedIn isSessionLoading={false} sessionAccountKey="user-1" />)

    await screen.findByPlaceholderText("问任何问题")

    const toolButtons = Array.from(
      container.querySelector(".lexio-sider-composer-tools")!.querySelectorAll("button"),
    ).map(button => button.getAttribute("aria-label") ?? button.textContent?.trim())

    expect(toolButtons).toEqual([
      "Start new chat",
      "Summarize current page",
      "Open chat history",
      "Open full settings",
      "Open account menu",
    ])
  })

  it("shows short hover labels for the composer tools", async () => {
    render(<ChatWorkspace isSignedIn isSessionLoading={false} sessionAccountKey="user-1" />)

    await screen.findByPlaceholderText("问任何问题")

    const newChatTrigger = screen.getByRole("button", { name: "Start new chat" }).closest("[data-slot='tooltip-trigger']")
    const summarizeTrigger = screen.getByRole("button", { name: "Summarize current page" }).closest("[data-slot='tooltip-trigger']")
    const historyTrigger = screen.getByRole("button", { name: "Open chat history" }).closest("[data-slot='tooltip-trigger']")
    const settingsTrigger = screen.getByRole("button", { name: "Open full settings" }).closest("[data-slot='tooltip-trigger']")
    const accountTrigger = screen.getByRole("button", { name: "Open account menu" }).closest("[data-slot='tooltip-trigger']")

    expect(newChatTrigger).toBeTruthy()
    expect(summarizeTrigger).toBeTruthy()
    expect(historyTrigger).toBeTruthy()
    expect(settingsTrigger).toBeTruthy()
    expect(accountTrigger).toBeTruthy()

    expect(await openTooltip(newChatTrigger!)).toHaveTextContent("sidepanel.actions.newChat")
    fireEvent.mouseLeave(newChatTrigger!)

    expect(await openTooltip(summarizeTrigger!)).toHaveTextContent("sidepanel.actions.explainPage")
    fireEvent.mouseLeave(summarizeTrigger!)

    expect(await openTooltip(historyTrigger!)).toHaveTextContent("sidepanel.actions.history")
    fireEvent.mouseLeave(historyTrigger!)

    expect(await openTooltip(settingsTrigger!)).toHaveTextContent("options.sidebar.settings")
    fireEvent.mouseLeave(settingsTrigger!)

    expect(await openTooltip(accountTrigger!)).toHaveTextContent("sidepanel.actions.account")
  })

  it("shows a cached thread immediately while refreshing history in the background", async () => {
    const cachedThread = createThread()
    const cachedMessage = createMessage()
    const threadsDeferred = createDeferred<ReturnType<typeof createThread>[]>()
    getSidepanelChatSnapshotMock.mockResolvedValue({
      threads: [cachedThread],
      currentThreadId: cachedThread.id,
      currentThreadSummary: cachedThread,
      currentThreadMessages: [cachedMessage],
      cachedAt: Date.now(),
    })
    listPlatformChatThreadsMock.mockReturnValue(threadsDeferred.promise)

    render(<ChatWorkspace isSignedIn isSessionLoading={false} sessionAccountKey="user-1" />)

    await screen.findByText("Cached hello")
    expect(screen.getByText("Cached hello")).toBeInTheDocument()
    expect(screen.getByPlaceholderText("问任何问题")).toBeInTheDocument()
    expect(screen.queryByText("Loading Lexio Cloud...")).not.toBeInTheDocument()
    expect(getSidepanelChatSnapshotMock).toHaveBeenCalledWith("user-1")
    expect(listPlatformChatThreadsMock).toHaveBeenCalledTimes(1)

    threadsDeferred.resolve([cachedThread])
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

  it("persists a saved draft when starting a new chat", async () => {
    const savedThread = createThread()
    const cachedMessage = createMessage()
    getSidepanelChatSnapshotMock.mockResolvedValue({
      threads: [savedThread],
      currentThreadId: savedThread.id,
      currentThreadSummary: savedThread,
      currentThreadMessages: [cachedMessage],
      cachedAt: Date.now(),
    })
    listPlatformChatThreadsMock.mockResolvedValue([savedThread])

    render(<ChatWorkspace isSignedIn isSessionLoading={false} sessionAccountKey="user-1" />)

    await screen.findByText("Cached hello")

    fireEvent.click(screen.getByRole("button", { name: "Start new chat" }))

    await waitFor(() => {
      expect(screen.queryByText("Cached hello")).not.toBeInTheDocument()
    })

    expect(setSidepanelChatSnapshotMock).toHaveBeenLastCalledWith("user-1", expect.objectContaining({
      currentThreadId: null,
      threads: [expect.objectContaining({ id: "thread-1" })],
    }))
    expect(setSidepanelChatDraftMock).toHaveBeenCalledWith("user-1", expect.objectContaining({
      sessionKey: expect.any(String),
    }))

    fireEvent.click(screen.getByRole("button", { name: "Open chat history" }))

    expect(await screen.findByRole("button", { name: "Open draft chat" })).toBeInTheDocument()
    expect(screen.getByText("Saved thread")).toBeInTheDocument()
  })

  it("reuses the existing saved draft instead of creating another empty chat", async () => {
    const savedThread = createThread()
    const draftSession = createDraftSession()
    getSidepanelChatSnapshotMock.mockResolvedValue({
      threads: [savedThread],
      currentThreadId: null,
      currentThreadSummary: null,
      currentThreadMessages: [],
      cachedAt: Date.now(),
    })
    getSidepanelChatDraftMock.mockResolvedValue(draftSession)
    listPlatformChatThreadsMock.mockResolvedValue([savedThread])

    render(<ChatWorkspace isSignedIn isSessionLoading={false} sessionAccountKey="user-1" />)

    await screen.findByPlaceholderText("问任何问题")

    fireEvent.click(screen.getByRole("button", { name: "Start new chat" }))
    fireEvent.click(screen.getByRole("button", { name: "Open chat history" }))

    expect(await screen.findByRole("button", { name: "Open draft chat" })).toBeInTheDocument()
    expect(screen.getAllByRole("button", { name: "Open draft chat" })).toHaveLength(1)
    expect(setSidepanelChatDraftMock).not.toHaveBeenCalled()
    expect(setSidepanelChatSnapshotMock).toHaveBeenLastCalledWith("user-1", expect.objectContaining({
      currentThreadId: null,
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
    const threadsDeferred = createDeferred<ReturnType<typeof createThread>[]>()
    getSidepanelChatSnapshotMock.mockResolvedValue({
      threads: [staleThread],
      currentThreadId: staleThread.id,
      currentThreadSummary: staleThread,
      currentThreadMessages: [createMessage()],
      cachedAt: Date.now(),
    })
    listPlatformChatThreadsMock.mockReturnValue(threadsDeferred.promise)

    render(<ChatWorkspace isSignedIn isSessionLoading={false} sessionAccountKey="user-1" />)

    await screen.findByText("Cached hello")
    expect(screen.getByText("Cached hello")).toBeInTheDocument()

    threadsDeferred.resolve([replacementThread])

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

  it("refreshes the committed thread snapshot without keeping the empty draft", async () => {
    const committedThread = createThread({
      id: "thread-new",
      title: "New thread",
      updatedAt: "2026-04-19T12:10:00.000Z",
      lastMessageAt: "2026-04-19T12:10:00.000Z",
    })
    const draftSession = createDraftSession()
    createPlatformChatThreadMock.mockResolvedValue(committedThread)
    getSidepanelChatSnapshotMock.mockResolvedValue({
      threads: [],
      currentThreadId: null,
      currentThreadSummary: null,
      currentThreadMessages: [],
      cachedAt: Date.now(),
    })
    getSidepanelChatDraftMock.mockResolvedValue(draftSession)
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
    expect(clearSidepanelChatDraftMock).toHaveBeenCalledWith("user-1")
  })

  it("auto-sends a pending sidepanel chat request when the workspace opens", async () => {
    const committedThread = createThread({
      id: "thread-new",
      title: "New thread",
      updatedAt: "2026-04-19T12:10:00.000Z",
      lastMessageAt: "2026-04-19T12:10:00.000Z",
    })
    createPlatformChatThreadMock.mockResolvedValue(committedThread)
    getPendingSidepanelChatRequestsMock.mockResolvedValue([{
      id: "request-1",
      payload: {
        type: "selection-explain",
        selectionText: "Selected text",
      },
    }])
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
          contentText: "prepared:selection-explain",
        }),
        createMessage({
          id: "message-assistant",
          role: "assistant",
          contentText: "Draft reply",
        }),
      ],
    })

    render(<ChatWorkspace isSignedIn isSessionLoading={false} sessionAccountKey="user-1" />)

    await screen.findByText("Draft reply")

    expect(streamPlatformChatThreadMessageMock).toHaveBeenCalledWith(
      "thread-new",
      "prepared:selection-explain",
      expect.objectContaining({
        signal: expect.any(AbortSignal),
      }),
    )
    expect(consumePendingSidepanelChatRequestMock).toHaveBeenCalledWith(1, "request-1")
  })

  it("sends the current page summary request into sidepanel chat", async () => {
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
          contentText: "prepared:current-webpage-summary",
        }),
        createMessage({
          id: "message-assistant",
          role: "assistant",
          contentText: "Draft reply",
        }),
      ],
    })
    browser.tabs.query = vi.fn().mockResolvedValue([{
      id: 7,
      windowId: 1,
      title: "Example article",
      url: "https://example.com/article",
    }])
    sendMessageMock.mockResolvedValue({
      url: "https://example.com/article",
      webTitle: "Example article",
      webContent: "A detailed article body.",
    })

    render(<ChatWorkspace isSignedIn isSessionLoading={false} sessionAccountKey="user-1" />)

    await screen.findByPlaceholderText("问任何问题")

    fireEvent.click(screen.getByRole("button", { name: "Summarize current page" }))

    await screen.findByText("Draft reply")

    await waitFor(() => {
      expect(streamPlatformChatThreadMessageMock).toHaveBeenCalledWith(
        "thread-new",
        "prepared:current-webpage-summary",
        expect.objectContaining({
          signal: expect.any(AbortSignal),
        }),
      )
    })

    expect(sendMessageMock).toHaveBeenCalledTimes(1)
    expect(sendMessageMock).toHaveBeenCalledWith("getCurrentWebPageContext", undefined, 7)
  })
})
