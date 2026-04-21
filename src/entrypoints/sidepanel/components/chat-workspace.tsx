import type { MessageStatus, ThreadMessage, ThreadMessageLike } from "@assistant-ui/react"
import type { AssistantMessageConfig, UserMessageConfig } from "@assistant-ui/react-ui"
import type { PlatformChatMessage, PlatformChatThreadSummary } from "@/utils/platform/api"
import type { SidepanelChatSnapshot } from "@/utils/platform/chat-cache"
import type { SidepanelChatDraft } from "@/utils/platform/sidepanel-chat-draft"
import type { SidepanelChatRequest } from "@/utils/platform/sidepanel-chat-request"
import { browser, i18n } from "#imports"
import { AssistantRuntimeProvider, ComposerPrimitive, ThreadPrimitive, useLocalRuntime, useThreadRuntime } from "@assistant-ui/react"
import { AssistantMessage, ThreadConfigProvider, UserMessage } from "@assistant-ui/react-ui"
import { IconArrowUp, IconBook2, IconClockHour4, IconFileDescription, IconLoader2, IconMessagePlus, IconSettings } from "@tabler/icons-react"
import { useAtomValue } from "jotai"
import { createContext, use, useCallback, useEffect, useReducer, useRef, useState } from "react"
import { toast } from "sonner"
import { PlatformQuickAccess } from "@/components/platform/platform-quick-access"
import { Button } from "@/components/ui/base-ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/base-ui/tooltip"
import { configFieldsAtomMap } from "@/utils/atoms/config"
import { getRandomUUID } from "@/utils/crypto-polyfill"
import { sendMessage } from "@/utils/message"
import { createPlatformChatThread, deletePlatformChatThread, getPlatformChatThreadMessages, listPlatformChatThreads, streamPlatformChatThreadMessage } from "@/utils/platform/api"
import { getSidepanelChatSnapshot, setSidepanelChatSnapshot } from "@/utils/platform/chat-cache"
import { clearSidepanelChatDraft, getSidepanelChatDraft, setSidepanelChatDraft } from "@/utils/platform/sidepanel-chat-draft"
import {
  buildCurrentWebPageSummaryRequestPayload,
  buildSidepanelChatRequestHiddenContext,
  buildSidepanelChatRequestPrompt,
  consumePendingSidepanelChatRequest,
  createSidepanelChatRequest,
  getPendingSidepanelChatRequests,
  watchPendingSidepanelChatRequests,
} from "@/utils/platform/sidepanel-chat-request"
import { SIDEPANEL_MARKDOWN_TEXT } from "./sidepanel-markdown"
import { SidepanelWelcomeState } from "./sidepanel-welcome-state"
import { ThreadHistorySheet } from "./thread-history-sheet"
import { VocabularySheet } from "./vocabulary-sheet"

interface ChatSessionState {
  sessionKey: string
  threadId: string | null
  initialMessages: ThreadMessageLike[]
  draftSessionKey: string | null
}

type PendingChatRequestsAction
  = { type: "replace", requests: SidepanelChatRequest[] }
    | { type: "enqueue", request: SidepanelChatRequest }
    | { type: "consume", requestId: string }

const COMPLETE_STATUS: MessageStatus = {
  type: "complete",
  reason: "stop",
}

const ASSISTANT_MESSAGE_CONFIG: AssistantMessageConfig = {
  allowReload: false,
  allowSpeak: false,
  allowFeedbackPositive: false,
  allowFeedbackNegative: false,
  components: {
    Text: SIDEPANEL_MARKDOWN_TEXT,
  },
}

const USER_MESSAGE_CONFIG: UserMessageConfig = {
  allowEdit: false,
}

interface ComposerControlsContextValue {
  isSignedIn: boolean
  isSummarizingCurrentPage: boolean
  onOpenHistory: () => void
  onOpenSettings: () => void
  onOpenVocabulary: () => void
  onStartNewChat: () => void
  onSummarizeCurrentPage: () => void
}

const ComposerControlsContext = createContext<ComposerControlsContextValue | null>(null)

function useComposerControls(): ComposerControlsContextValue {
  const context = use(ComposerControlsContext)
  if (!context) {
    throw new Error("Composer controls are missing.")
  }

  return context
}

function ComposerToolTooltip({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="inline-flex" />}>
        {children}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

function SiderComposer() {
  const {
    isSignedIn,
    isSummarizingCurrentPage,
    onOpenHistory,
    onOpenSettings,
    onOpenVocabulary,
    onStartNewChat,
    onSummarizeCurrentPage,
  } = useComposerControls()

  return (
    <ComposerPrimitive.Root className="lexio-sider-composer">
      <ComposerPrimitive.Input
        rows={3}
        placeholder="问任何问题"
        className="lexio-sider-composer-input"
        unstable_focusOnThreadSwitched
      />

      <div className="lexio-sider-composer-footer">
        <div className="lexio-sider-composer-tools">
          <ComposerToolTooltip label={i18n.t("sidepanel.actions.newChat")}>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="lexio-sider-tool-button"
              aria-label="Start new chat"
              onClick={onStartNewChat}
              disabled={!isSignedIn}
            >
              <IconMessagePlus className="size-4" />
            </Button>
          </ComposerToolTooltip>
          <ComposerToolTooltip label={i18n.t("sidepanel.actions.explainPage")}>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="lexio-sider-tool-button"
              aria-label="Summarize current page"
              onClick={onSummarizeCurrentPage}
              disabled={isSummarizingCurrentPage}
            >
              {isSummarizingCurrentPage
                ? <IconLoader2 className="size-4 animate-spin" />
                : <IconFileDescription className="size-4" />}
            </Button>
          </ComposerToolTooltip>
          <ComposerToolTooltip label={i18n.t("sidepanel.actions.history")}>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="lexio-sider-tool-button"
              aria-label="Open chat history"
              onClick={onOpenHistory}
              disabled={!isSignedIn}
            >
              <IconClockHour4 className="size-4" />
            </Button>
          </ComposerToolTooltip>
          <ComposerToolTooltip label={i18n.t("options.sidebar.settings")}>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="lexio-sider-tool-button"
              aria-label="Open full settings"
              onClick={onOpenSettings}
            >
              <IconSettings className="size-4" />
            </Button>
          </ComposerToolTooltip>
          <ComposerToolTooltip label={i18n.t("sidepanel.actions.account")}>
            <PlatformQuickAccess
              variant="menu"
              size="sm"
              className="lexio-sider-tool-button"
            />
          </ComposerToolTooltip>
          <ComposerToolTooltip label={i18n.t("options.vocabulary.title")}>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="lexio-sider-tool-button"
              aria-label="Open vocabulary"
              onClick={onOpenVocabulary}
            >
              <IconBook2 className="size-4" />
            </Button>
          </ComposerToolTooltip>
        </div>

        <div className="lexio-sider-composer-actions">
          <ComposerPrimitive.Send className="lexio-sider-send-button">
            <IconArrowUp className="size-4" />
          </ComposerPrimitive.Send>
        </div>
      </div>
    </ComposerPrimitive.Root>
  )
}

function SidepanelThread() {
  return (
    <ThreadConfigProvider
      config={{
        assistantMessage: ASSISTANT_MESSAGE_CONFIG,
        userMessage: USER_MESSAGE_CONFIG,
        branchPicker: { allowBranchPicker: false },
        composer: { allowAttachments: false },
        strings: {
          thread: {
            scrollToBottom: {
              tooltip: "Scroll to bottom",
            },
          },
        },
      }}
    >
      <ThreadPrimitive.Root className="sidepanel-chat-shell">
        <ThreadPrimitive.Viewport className="sidepanel-chat-viewport">
          <ThreadPrimitive.Messages
            components={{
              UserMessage,
              AssistantMessage,
            }}
          />
        </ThreadPrimitive.Viewport>
        <SiderComposer />
      </ThreadPrimitive.Root>
    </ThreadConfigProvider>
  )
}

function createEmptySession(): ChatSessionState {
  return {
    sessionKey: `new-${getRandomUUID()}`,
    threadId: null,
    initialMessages: [],
    draftSessionKey: null,
  }
}

function createSavedDraft(): SidepanelChatDraft {
  return {
    sessionKey: `draft-${getRandomUUID()}`,
    createdAt: Date.now(),
  }
}

function pendingChatRequestsReducer(
  state: SidepanelChatRequest[],
  action: PendingChatRequestsAction,
) {
  if (action.type === "replace") {
    return action.requests
  }

  if (action.type === "enqueue") {
    return [...state, action.request]
  }

  return state.filter(request => request.id !== action.requestId)
}

function PendingSidepanelChatRequestSender({
  request,
  targetLanguageCode,
  onHandled,
  onPrepare,
}: {
  request: SidepanelChatRequest | null
  targetLanguageCode: Parameters<typeof buildSidepanelChatRequestPrompt>[1]
  onHandled: (requestId: string) => void
  onPrepare: (request: SidepanelChatRequest) => void
}) {
  const thread = useThreadRuntime()
  const handledRequestIdRef = useRef<string | null>(null)

  useEffect(() => {
    if (!request || handledRequestIdRef.current === request.id) {
      return
    }

    handledRequestIdRef.current = request.id

    try {
      onPrepare(request)
      thread.append({
        role: "user",
        content: [{
          type: "text",
          text: buildSidepanelChatRequestPrompt(request.payload, targetLanguageCode),
        }],
        startRun: true,
      })
      onHandled(request.id)
    }
    catch (error) {
      handledRequestIdRef.current = null
      toast.error(error instanceof Error ? error.message : "Failed to send the prepared chat request.")
    }
  }, [onHandled, onPrepare, request, targetLanguageCode, thread])

  return null
}

function createThreadSession(threadId: string, messages: PlatformChatMessage[]): ChatSessionState {
  return {
    sessionKey: `${threadId}-${getRandomUUID()}`,
    threadId,
    initialMessages: messages.map(toInitialMessage),
    draftSessionKey: null,
  }
}

function createDraftSession(draft: SidepanelChatDraft): ChatSessionState {
  return {
    sessionKey: draft.sessionKey,
    threadId: null,
    initialMessages: [],
    draftSessionKey: draft.sessionKey,
  }
}

function toInitialMessage(message: PlatformChatMessage): ThreadMessageLike {
  return {
    id: message.id,
    role: message.role,
    content: message.contentText,
    createdAt: new Date(message.createdAt),
    ...(message.role === "assistant" ? { status: COMPLETE_STATUS } : {}),
  }
}

function extractLatestUserText(messages: readonly ThreadMessage[]): string {
  const latestUserMessage = [...messages].reverse().find(message => message.role === "user")
  if (!latestUserMessage) {
    throw new Error("No user message found in the current thread.")
  }

  const text = latestUserMessage.content
    .map((part) => {
      if (part.type === "text") {
        return part.text
      }
      return ""
    })
    .join("")
    .trim()

  if (!text) {
    throw new Error("The latest user message is empty.")
  }

  return text
}

function findThreadSummary(threads: PlatformChatThreadSummary[], threadId: string | null): PlatformChatThreadSummary | null {
  if (!threadId) {
    return null
  }

  return threads.find(thread => thread.id === threadId) ?? null
}

function hasThreadSummaryChanged(
  previousThread: PlatformChatThreadSummary | null,
  nextThread: PlatformChatThreadSummary | null,
): boolean {
  if (!previousThread || !nextThread) {
    return previousThread !== nextThread
  }

  return previousThread.title !== nextThread.title
    || previousThread.updatedAt !== nextThread.updatedAt
    || previousThread.lastMessageAt !== nextThread.lastMessageAt
}

function buildSnapshot(
  threads: PlatformChatThreadSummary[],
  currentThreadId: string | null,
  currentThreadMessages: PlatformChatMessage[],
  currentThreadSummary?: PlatformChatThreadSummary | null,
): SidepanelChatSnapshot {
  const resolvedCurrentThreadId = currentThreadId ?? null
  const resolvedCurrentThreadSummary = resolvedCurrentThreadId
    ? (currentThreadSummary ?? findThreadSummary(threads, resolvedCurrentThreadId))
    : null

  return {
    threads,
    currentThreadId: resolvedCurrentThreadId,
    currentThreadSummary: resolvedCurrentThreadSummary,
    currentThreadMessages: resolvedCurrentThreadId ? currentThreadMessages : [],
    cachedAt: Date.now(),
  }
}

function createSessionFromSnapshot(
  snapshot: SidepanelChatSnapshot | null,
  draftSession: SidepanelChatDraft | null,
): ChatSessionState {
  if (!snapshot?.currentThreadId) {
    return draftSession ? createDraftSession(draftSession) : createEmptySession()
  }

  return createThreadSession(snapshot.currentThreadId, snapshot.currentThreadMessages)
}

function ChatRuntimePane({
  isSignedIn,
  isSummarizingCurrentPage,
  onOpenHistory,
  onOpenSettings,
  onOpenVocabulary,
  onStartNewChat,
  onSummarizeCurrentPage,
  pendingChatRequest,
  onPendingChatRequestHandled,
  session,
  targetLanguageCode,
  onRunCommitted,
}: {
  isSignedIn: boolean
  isSummarizingCurrentPage: boolean
  onOpenHistory: () => void
  onOpenSettings: () => void
  onOpenVocabulary: () => void
  onStartNewChat: () => void
  onSummarizeCurrentPage: () => void
  pendingChatRequest: SidepanelChatRequest | null
  onPendingChatRequestHandled: (requestId: string) => void
  session: ChatSessionState
  targetLanguageCode: Parameters<typeof buildSidepanelChatRequestPrompt>[1]
  onRunCommitted: (threadId: string) => void
}) {
  const threadIdRef = useRef(session.threadId)
  const pendingRequestContextRef = useRef<ReturnType<typeof buildSidepanelChatRequestHiddenContext> | null>(null)

  const runtime = useLocalRuntime({
    async* run({ messages, abortSignal }) {
      let threadId = threadIdRef.current
      const content = extractLatestUserText(messages)
      const requestContext = pendingRequestContextRef.current
      pendingRequestContextRef.current = null

      if (!threadId) {
        const createdThread = await createPlatformChatThread()
        threadId = createdThread.id
        threadIdRef.current = threadId
      }

      let assistantText = ""
      for await (const nextText of streamPlatformChatThreadMessage(threadId, content, {
        context: requestContext ?? undefined,
        signal: abortSignal,
      })) {
        assistantText = nextText
        yield {
          content: [{ type: "text", text: assistantText }],
        }
      }

      yield {
        content: [{ type: "text", text: assistantText }],
        status: COMPLETE_STATUS,
      }
      onRunCommitted(threadId)
    },
  }, {
    initialMessages: session.initialMessages,
  } satisfies Parameters<typeof useLocalRuntime>[1])

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ComposerControlsContext
        value={{
          isSignedIn,
          isSummarizingCurrentPage,
          onOpenHistory,
          onOpenSettings,
          onOpenVocabulary,
          onStartNewChat,
          onSummarizeCurrentPage,
        }}
      >
        <div className="sidepanel-chat-thread flex h-full min-h-0 flex-col">
          <PendingSidepanelChatRequestSender
            request={pendingChatRequest}
            targetLanguageCode={targetLanguageCode}
            onHandled={onPendingChatRequestHandled}
            onPrepare={(request) => {
              pendingRequestContextRef.current = buildSidepanelChatRequestHiddenContext(request.payload)
            }}
          />
          <SidepanelThread />
        </div>
      </ComposerControlsContext>
    </AssistantRuntimeProvider>
  )
}

export function ChatWorkspace({
  isSignedIn,
  isSessionLoading,
  sessionAccountKey,
}: {
  isSignedIn: boolean
  isSessionLoading: boolean
  sessionAccountKey: string | null
}) {
  const language = useAtomValue(configFieldsAtomMap.language)
  const [threads, setThreads] = useState<PlatformChatThreadSummary[]>([])
  const [session, setSession] = useState<ChatSessionState>(() => createEmptySession())
  const [draftSession, setDraftSession] = useState<SidepanelChatDraft | null>(null)
  const [isHistoryOpen, setIsHistoryOpen] = useState(false)
  const [isVocabularyOpen, setIsVocabularyOpen] = useState(false)
  const [isSummarizingCurrentPage, setIsSummarizingCurrentPage] = useState(false)
  const [isLoadingThread, setIsLoadingThread] = useState(false)
  const [isRefreshingThreads, setIsRefreshingThreads] = useState(false)
  const [currentWindowId, setCurrentWindowId] = useState<number | null>(null)
  const [pendingChatRequests, dispatchPendingChatRequests] = useReducer(pendingChatRequestsReducer, [])
  const [isChatBootstrapReady, setIsChatBootstrapReady] = useState(false)
  const snapshotRef = useRef<SidepanelChatSnapshot | null>(null)
  const draftSessionRef = useRef<SidepanelChatDraft | null>(null)
  const replacePendingChatRequests = useCallback((requests: SidepanelChatRequest[]) => {
    dispatchPendingChatRequests({ type: "replace", requests })
  }, [])

  const persistSnapshot = useCallback(async (snapshot: SidepanelChatSnapshot) => {
    snapshotRef.current = snapshot

    if (!sessionAccountKey) {
      return
    }

    await setSidepanelChatSnapshot(sessionAccountKey, snapshot)
  }, [sessionAccountKey])

  const persistDraftSession = useCallback(async (nextDraftSession: SidepanelChatDraft | null) => {
    draftSessionRef.current = nextDraftSession
    setDraftSession(nextDraftSession)

    if (!sessionAccountKey) {
      return
    }

    if (nextDraftSession) {
      await setSidepanelChatDraft(sessionAccountKey, nextDraftSession)
      return
    }

    await clearSidepanelChatDraft(sessionAccountKey)
  }, [sessionAccountKey])

  useEffect(() => {
    let isDisposed = false

    async function bootstrapChat() {
      if (!isDisposed) {
        setIsChatBootstrapReady(false)
      }

      if (!isSignedIn || !sessionAccountKey) {
        if (!isDisposed) {
          snapshotRef.current = null
          draftSessionRef.current = null
          setThreads([])
          setSession(createEmptySession())
          setDraftSession(null)
          setIsRefreshingThreads(false)
          setIsChatBootstrapReady(true)
        }
        return
      }

      const [cachedSnapshot, cachedDraftSession] = await Promise.all([
        getSidepanelChatSnapshot(sessionAccountKey),
        getSidepanelChatDraft(sessionAccountKey),
      ])
      if (isDisposed) {
        return
      }

      snapshotRef.current = cachedSnapshot
      draftSessionRef.current = cachedDraftSession
      setDraftSession(cachedDraftSession)

      if (cachedSnapshot) {
        setThreads(cachedSnapshot.threads)
        setSession(createSessionFromSnapshot(cachedSnapshot, cachedDraftSession))
      }
      else {
        setThreads([])
        setSession(createSessionFromSnapshot(null, cachedDraftSession))
      }

      setIsRefreshingThreads(true)
      try {
        const nextThreads = await listPlatformChatThreads()
        if (isDisposed) {
          return
        }

        setThreads(nextThreads)

        const cachedThreadId = cachedSnapshot?.currentThreadId ?? null
        if (!cachedThreadId) {
          await persistSnapshot(buildSnapshot(nextThreads, null, []))
          return
        }

        const nextCurrentThread = findThreadSummary(nextThreads, cachedThreadId)
        if (!nextCurrentThread) {
          setSession((current) => {
            if (current.threadId !== cachedThreadId) {
              return current
            }

            return cachedDraftSession ? createDraftSession(cachedDraftSession) : createEmptySession()
          })
          await persistSnapshot(buildSnapshot(nextThreads, null, []))
          return
        }

        if (!hasThreadSummaryChanged(cachedSnapshot?.currentThreadSummary ?? null, nextCurrentThread)) {
          await persistSnapshot(buildSnapshot(
            nextThreads,
            cachedThreadId,
            cachedSnapshot?.currentThreadMessages ?? [],
            nextCurrentThread,
          ))
          return
        }

        const payload = await getPlatformChatThreadMessages(cachedThreadId)
        if (isDisposed) {
          return
        }

        setSession((current) => {
          if (current.threadId !== cachedThreadId) {
            return current
          }

          return createThreadSession(cachedThreadId, payload.messages)
        })
        await persistSnapshot(buildSnapshot(
          nextThreads,
          cachedThreadId,
          payload.messages,
          payload.thread ?? nextCurrentThread,
        ))
      }
      catch {
        // Keep the cached view when background sync fails.
      }
      finally {
        if (!isDisposed) {
          setIsRefreshingThreads(false)
          setIsChatBootstrapReady(true)
        }
      }
    }

    void bootstrapChat()

    return () => {
      isDisposed = true
    }
  }, [isSignedIn, sessionAccountKey, persistSnapshot])

  useEffect(() => {
    let isDisposed = false

    void browser.tabs.query({
      active: true,
      currentWindow: true,
    }).then(([activeTab]) => {
      if (!isDisposed) {
        setCurrentWindowId(activeTab?.windowId ?? null)
      }
    })

    return () => {
      isDisposed = true
    }
  }, [])

  useEffect(() => {
    if (!currentWindowId) {
      replacePendingChatRequests([])
      return
    }

    let isDisposed = false

    void getPendingSidepanelChatRequests(currentWindowId).then((requests) => {
      if (!isDisposed) {
        replacePendingChatRequests(requests)
      }
    })

    const unwatch = watchPendingSidepanelChatRequests(currentWindowId, (requests) => {
      if (!isDisposed) {
        replacePendingChatRequests(requests)
      }
    })

    return () => {
      isDisposed = true
      unwatch()
    }
  }, [currentWindowId, replacePendingChatRequests])

  async function refreshThreads(keepThreadId: string | null, options?: { showErrorToast?: boolean }) {
    setIsRefreshingThreads(true)
    try {
      const nextThreads = await listPlatformChatThreads()
      setThreads(nextThreads)

      const snapshot = snapshotRef.current
      const preferredThreadId = keepThreadId ?? snapshot?.currentThreadId ?? null
      const nextCurrentThreadId = preferredThreadId && nextThreads.some(thread => thread.id === preferredThreadId)
        ? preferredThreadId
        : null

      if (keepThreadId && !nextCurrentThreadId) {
        setSession((current) => {
          if (current.threadId !== keepThreadId) {
            return current
          }

          return draftSessionRef.current ? createDraftSession(draftSessionRef.current) : createEmptySession()
        })
      }

      const nextCurrentThreadSummary = findThreadSummary(nextThreads, nextCurrentThreadId)
      const nextCurrentThreadMessages = snapshot?.currentThreadId === nextCurrentThreadId
        ? snapshot.currentThreadMessages
        : []

      await persistSnapshot(buildSnapshot(
        nextThreads,
        nextCurrentThreadId,
        nextCurrentThreadMessages,
        nextCurrentThreadSummary,
      ))
    }
    catch (error) {
      if (options?.showErrorToast ?? true) {
        toast.error(error instanceof Error ? error.message : "Failed to refresh threads.")
      }
    }
    finally {
      setIsRefreshingThreads(false)
    }
  }

  async function selectThread(threadId: string) {
    if (!threadId) {
      return
    }

    setIsLoadingThread(true)
    try {
      const payload = await getPlatformChatThreadMessages(threadId)
      setSession(createThreadSession(threadId, payload.messages))
      await persistSnapshot(buildSnapshot(
        threads,
        threadId,
        payload.messages,
        payload.thread ?? findThreadSummary(threads, threadId),
      ))
    }
    catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to load that thread.")
    }
    finally {
      setIsLoadingThread(false)
    }
  }

  function selectDraft() {
    const nextDraftSession = draftSessionRef.current
    if (!nextDraftSession) {
      handleStartNewChat()
      return
    }

    setIsHistoryOpen(false)
    setSession(createDraftSession(nextDraftSession))
    void persistSnapshot(buildSnapshot(threads, null, []))
  }

  async function handleDeleteThread(threadId: string) {
    try {
      const isDeletingCurrentThread = session.threadId === threadId

      await deletePlatformChatThread(threadId)
      const nextThreads = await listPlatformChatThreads()
      setThreads(nextThreads)

      if (isDeletingCurrentThread) {
        setSession(draftSessionRef.current ? createDraftSession(draftSessionRef.current) : createEmptySession())
      }

      const previousSnapshot = snapshotRef.current
      const nextCurrentThreadId = previousSnapshot?.currentThreadId === threadId
        ? null
        : previousSnapshot?.currentThreadId ?? null
      const nextCurrentThreadSummary = findThreadSummary(nextThreads, nextCurrentThreadId)
      const nextCurrentThreadMessages = previousSnapshot?.currentThreadId === nextCurrentThreadId
        ? previousSnapshot.currentThreadMessages
        : []

      await persistSnapshot(buildSnapshot(
        nextThreads,
        nextCurrentThreadId,
        nextCurrentThreadMessages,
        nextCurrentThreadSummary,
      ))
    }
    catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to delete this thread.")
    }
  }

  async function syncCommittedThread(threadId: string) {
    if (!sessionAccountKey) {
      return
    }

    try {
      const [nextThreads, payload] = await Promise.all([
        listPlatformChatThreads(),
        getPlatformChatThreadMessages(threadId),
      ])

      setThreads(nextThreads)
      await persistSnapshot(buildSnapshot(
        nextThreads,
        threadId,
        payload.messages,
        payload.thread ?? findThreadSummary(nextThreads, threadId),
      ))
    }
    catch {
      // Keep the active UI unchanged when post-send sync fails.
    }
  }

  const handlePendingChatRequestHandled = useCallback((requestId: string) => {
    dispatchPendingChatRequests({ type: "consume", requestId })

    if (!currentWindowId) {
      return
    }

    void consumePendingSidepanelChatRequest(currentWindowId, requestId)
  }, [currentWindowId])

  function handleStartNewChat() {
    const nextDraftSession = draftSessionRef.current ?? createSavedDraft()
    setSession(createDraftSession(nextDraftSession))
    setIsHistoryOpen(false)
    if (!draftSessionRef.current) {
      void persistDraftSession(nextDraftSession)
    }
    void persistSnapshot(buildSnapshot(threads, null, []))
  }

  const summarizeCurrentPage = useCallback(async () => {
    setIsSummarizingCurrentPage(true)
    try {
      const [activeTab] = await browser.tabs.query({
        active: true,
        currentWindow: true,
      })
      if (!activeTab?.id) {
        throw new Error("Current page is unavailable on this tab.")
      }

      const webPageContext = await sendMessage("getCurrentWebPageContext", undefined, activeTab.id)
      const pageUrl = webPageContext?.url?.trim() ?? activeTab.url?.trim()
      if (!pageUrl) {
        throw new Error("Current page URL is unavailable on this tab.")
      }

      const requestPayload = buildCurrentWebPageSummaryRequestPayload({
        fallbackPageTitle: activeTab.title,
        fallbackPageUrl: pageUrl,
        webPageContext,
      })
      if (!requestPayload) {
        throw new Error("Current page URL is unavailable on this tab.")
      }

      dispatchPendingChatRequests({
        type: "enqueue",
        request: createSidepanelChatRequest(requestPayload),
      })
    }
    catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to summarize the current page.")
    }
    finally {
      setIsSummarizingCurrentPage(false)
    }
  }, [])

  const isWorkspaceLoading = isSessionLoading
  const isBusy = isWorkspaceLoading || isLoadingThread

  let content = (
    <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
      <IconLoader2 className="size-4 animate-spin" />
      Loading Lexio Cloud...
    </div>
  )

  if (!isWorkspaceLoading && !isSignedIn) {
    content = <SidepanelWelcomeState />
  }

  if (!isWorkspaceLoading && isSignedIn) {
    content = isLoadingThread
      ? (
          <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
            <IconLoader2 className="size-4 animate-spin" />
            Loading thread...
          </div>
        )
      : (
          <ChatRuntimePane
            key={session.sessionKey}
            isSignedIn={isSignedIn}
            isSummarizingCurrentPage={isSummarizingCurrentPage}
            onOpenHistory={() => {
              setIsVocabularyOpen(false)
              setIsHistoryOpen(true)
            }}
            onOpenSettings={() => void browser.runtime.openOptionsPage()}
            onOpenVocabulary={() => {
              setIsHistoryOpen(false)
              setIsVocabularyOpen(true)
            }}
            onStartNewChat={handleStartNewChat}
            onSummarizeCurrentPage={() => {
              void summarizeCurrentPage()
            }}
            pendingChatRequest={isChatBootstrapReady ? (pendingChatRequests[0] ?? null) : null}
            onPendingChatRequestHandled={handlePendingChatRequestHandled}
            session={session}
            targetLanguageCode={language.targetCode}
            onRunCommitted={(threadId) => {
              const shouldClearDraft = session.draftSessionKey !== null
              setSession(current => current.sessionKey === session.sessionKey
                ? {
                    ...current,
                    threadId,
                    draftSessionKey: null,
                  }
                : current)
              if (shouldClearDraft) {
                void persistDraftSession(null)
              }
              void syncCommittedThread(threadId)
            }}
          />
        )
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col bg-background">
      <div className="min-h-0 flex-1 px-4 pt-3">
        <div className="flex h-full min-h-0 flex-col">
          {content}
        </div>
      </div>

      <ThreadHistorySheet
        open={isHistoryOpen}
        onOpenChange={setIsHistoryOpen}
        currentThreadId={session.threadId}
        draftSession={draftSession}
        isDraftSelected={session.threadId === null && session.draftSessionKey !== null}
        isBusy={isBusy}
        isRefreshing={isRefreshingThreads}
        onRefresh={() => refreshThreads(session.threadId, { showErrorToast: true })}
        onSelectDraft={selectDraft}
        onSelectThread={async (threadId) => {
          setIsHistoryOpen(false)
          await selectThread(threadId)
        }}
        onStartNewChat={handleStartNewChat}
        onDeleteThread={async (threadId) => {
          await handleDeleteThread(threadId)
        }}
        threads={threads}
      />

      <VocabularySheet
        open={isVocabularyOpen}
        onOpenChange={setIsVocabularyOpen}
      />
    </div>
  )
}
