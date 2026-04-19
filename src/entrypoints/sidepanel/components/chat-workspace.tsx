import type { MessageStatus, ThreadMessage, ThreadMessageLike } from "@assistant-ui/react"
import type { AssistantMessageConfig, UserMessageConfig } from "@assistant-ui/react-ui"
import type { PlatformChatMessage, PlatformChatThreadSummary } from "@/utils/platform/api"
import { browser } from "#imports"
import { AssistantRuntimeProvider, ComposerPrimitive, ThreadPrimitive, useLocalRuntime } from "@assistant-ui/react"
import { AssistantMessage, makeMarkdownText, ThreadConfigProvider, UserMessage } from "@assistant-ui/react-ui"
import { IconArrowUp, IconClockHour4, IconLoader2, IconMessagePlus, IconSettings } from "@tabler/icons-react"
import { createContext, use, useEffect, useRef, useState } from "react"
import rehypeKatex from "rehype-katex"
import remarkGfm from "remark-gfm"
import remarkMath from "remark-math"
import { toast } from "sonner"
import { PlatformQuickAccess } from "@/components/platform/platform-quick-access"
import { Button } from "@/components/ui/base-ui/button"
import { getRandomUUID } from "@/utils/crypto-polyfill"
import { createPlatformChatThread, deletePlatformChatThread, getPlatformChatThreadMessages, listPlatformChatThreads, streamPlatformChatThreadMessage } from "@/utils/platform/api"
import { ThreadHistorySheet } from "./thread-history-sheet"

interface ChatSessionState {
  sessionKey: string
  threadId: string | null
  initialMessages: ThreadMessageLike[]
}

const COMPLETE_STATUS: MessageStatus = {
  type: "complete",
  reason: "stop",
}

const SIDE_PANEL_MARKDOWN_TEXT = makeMarkdownText({
  remarkPlugins: [remarkGfm, remarkMath],
  rehypePlugins: [rehypeKatex],
})

const ASSISTANT_MESSAGE_CONFIG: AssistantMessageConfig = {
  allowReload: false,
  allowSpeak: false,
  allowFeedbackPositive: false,
  allowFeedbackNegative: false,
  components: {
    Text: SIDE_PANEL_MARKDOWN_TEXT,
  },
}

const USER_MESSAGE_CONFIG: UserMessageConfig = {
  allowEdit: false,
}

interface ComposerControlsContextValue {
  isSignedIn: boolean
  onOpenHistory: () => void
  onOpenSettings: () => void
  onStartNewChat: () => void
}

const ComposerControlsContext = createContext<ComposerControlsContextValue | null>(null)

function useComposerControls(): ComposerControlsContextValue {
  const context = use(ComposerControlsContext)
  if (!context) {
    throw new Error("Composer controls are missing.")
  }

  return context
}

function SiderComposer() {
  const {
    isSignedIn,
    onOpenHistory,
    onOpenSettings,
    onStartNewChat,
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
          <PlatformQuickAccess
            variant="menu"
            size="sm"
            className="lexio-sider-tool-button"
          />
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

function ChatRuntimePane({
  isSignedIn,
  onOpenHistory,
  onOpenSettings,
  onStartNewChat,
  session,
  onRunCommitted,
}: {
  isSignedIn: boolean
  onOpenHistory: () => void
  onOpenSettings: () => void
  onStartNewChat: () => void
  session: ChatSessionState
  onRunCommitted: (threadId: string) => void
}) {
  const threadIdRef = useRef(session.threadId)

  const runtime = useLocalRuntime({
    async* run({ messages, abortSignal }) {
      let threadId = threadIdRef.current
      const content = extractLatestUserText(messages)

      if (!threadId) {
        const createdThread = await createPlatformChatThread()
        threadId = createdThread.id
        threadIdRef.current = threadId
      }

      let assistantText = ""
      for await (const nextText of streamPlatformChatThreadMessage(threadId, content, {
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
          onOpenHistory,
          onOpenSettings,
          onStartNewChat,
        }}
      >
        <div className="sidepanel-chat-thread flex h-full min-h-0 flex-col">
          <SidepanelThread />
        </div>
      </ComposerControlsContext>
    </AssistantRuntimeProvider>
  )
}

export function ChatWorkspace({
  isSignedIn,
  isSessionLoading,
}: {
  isSignedIn: boolean
  isSessionLoading: boolean
}) {
  const [threads, setThreads] = useState<PlatformChatThreadSummary[]>([])
  const [session, setSession] = useState<ChatSessionState>(() => createEmptySession())
  const [isBootstrapping, setIsBootstrapping] = useState(true)
  const [isHistoryOpen, setIsHistoryOpen] = useState(false)
  const [isLoadingThread, setIsLoadingThread] = useState(false)
  const [isRefreshingThreads, setIsRefreshingThreads] = useState(false)

  useEffect(() => {
    let isDisposed = false

    async function bootstrapChat() {
      if (!isSignedIn) {
        if (!isDisposed) {
          setThreads([])
          setSession(createEmptySession())
          setIsBootstrapping(false)
        }
        return
      }

      setIsBootstrapping(true)
      try {
        const nextThreads = await listPlatformChatThreads()
        if (isDisposed) {
          return
        }

        setThreads(nextThreads)

        if (!nextThreads[0]) {
          setSession(createEmptySession())
          return
        }

        setIsLoadingThread(true)
        const payload = await getPlatformChatThreadMessages(nextThreads[0].id)
        if (isDisposed) {
          return
        }

        setSession({
          sessionKey: nextThreads[0].id,
          threadId: nextThreads[0].id,
          initialMessages: payload.messages.map(toInitialMessage),
        })
      }
      catch (error) {
        if (!isDisposed) {
          toast.error(error instanceof Error ? error.message : "Failed to load Lexio Cloud chat.")
          setThreads([])
          setSession(createEmptySession())
        }
      }
      finally {
        if (!isDisposed) {
          setIsLoadingThread(false)
          setIsBootstrapping(false)
        }
      }
    }

    void bootstrapChat()

    return () => {
      isDisposed = true
    }
  }, [isSignedIn])

  async function refreshThreads(keepThreadId: string | null) {
    setIsRefreshingThreads(true)
    try {
      const nextThreads = await listPlatformChatThreads()
      setThreads(nextThreads)

      if (!keepThreadId) {
        return
      }

      const exists = nextThreads.some(thread => thread.id === keepThreadId)
      if (!exists) {
        if (nextThreads[0]) {
          await selectThread(nextThreads[0].id)
        }
        else {
          setSession(createEmptySession())
        }
      }
    }
    catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to refresh threads.")
    }
    finally {
      setIsRefreshingThreads(false)
    }
  }

  async function selectThread(threadId: string) {
    if (!threadId) {
      setSession(createEmptySession())
      return
    }

    setIsLoadingThread(true)
    try {
      const payload = await getPlatformChatThreadMessages(threadId)
      setSession({
        sessionKey: threadId,
        threadId,
        initialMessages: payload.messages.map(toInitialMessage),
      })
    }
    catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to load that thread.")
    }
    finally {
      setIsLoadingThread(false)
    }
  }

  async function handleDeleteThread(threadId: string) {
    try {
      const isDeletingCurrentThread = session.threadId === threadId

      await deletePlatformChatThread(threadId)
      const nextThreads = await listPlatformChatThreads()
      setThreads(nextThreads)

      if (!isDeletingCurrentThread) {
        return
      }

      if (nextThreads[0]) {
        await selectThread(nextThreads[0].id)
      }
      else {
        setSession(createEmptySession())
      }
    }
    catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to delete this thread.")
    }
  }

  function handleStartNewChat() {
    setSession(createEmptySession())
    setIsHistoryOpen(false)
  }

  const isWorkspaceLoading = isSessionLoading || isBootstrapping
  const isBusy = isWorkspaceLoading || isLoadingThread

  let content = (
    <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
      <IconLoader2 className="size-4 animate-spin" />
      Loading Lexio Cloud...
    </div>
  )

  if (!isWorkspaceLoading && !isSignedIn) {
    content = (
      <div className="mx-auto flex h-full max-w-sm flex-col items-center justify-center text-center">
        <div className="rounded-full border border-border/70 bg-muted/60 p-3 text-primary">
          <IconMessagePlus className="size-5" />
        </div>
        <h2 className="mt-4 text-lg font-semibold">Sign in to use cloud chat</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Threads live in your Lexio account, so the same history follows you across devices.
        </p>
      </div>
    )
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
            onOpenHistory={() => setIsHistoryOpen(true)}
            onOpenSettings={() => void browser.runtime.openOptionsPage()}
            onStartNewChat={handleStartNewChat}
            session={session}
            onRunCommitted={(threadId) => {
              setSession(current => current.sessionKey === session.sessionKey
                ? {
                    ...current,
                    threadId,
                  }
                : current)
              void refreshThreads(threadId)
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
        isBusy={isBusy}
        isRefreshing={isRefreshingThreads}
        onRefresh={() => refreshThreads(session.threadId)}
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
    </div>
  )
}
