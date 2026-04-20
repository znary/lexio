import type { PlatformChatThreadSummary } from "@/utils/platform/api"
import type { SidepanelChatDraft } from "@/utils/platform/sidepanel-chat-draft"
import { IconClockHour4, IconLoader2, IconMessagePlus, IconRefresh, IconTrash } from "@tabler/icons-react"
import { useState } from "react"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/base-ui/alert-dialog"
import { Badge } from "@/components/ui/base-ui/badge"
import { Button } from "@/components/ui/base-ui/button"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/base-ui/sheet"

function formatThreadTimestamp(lastMessageAt: string | null): string {
  if (!lastMessageAt) {
    return "New"
  }

  return new Date(lastMessageAt).toLocaleDateString()
}

export function ThreadHistorySheet({
  currentThreadId,
  draftSession,
  isDraftSelected,
  isBusy,
  isRefreshing,
  onDeleteThread,
  onOpenChange,
  onRefresh,
  onSelectDraft,
  onSelectThread,
  onStartNewChat,
  open,
  threads,
}: {
  currentThreadId: string | null
  draftSession: SidepanelChatDraft | null
  isDraftSelected: boolean
  isBusy: boolean
  isRefreshing: boolean
  onDeleteThread: (threadId: string) => void | Promise<void>
  onOpenChange: (open: boolean) => void
  onRefresh: () => void | Promise<void>
  onSelectDraft: () => void | Promise<void>
  onSelectThread: (threadId: string) => void | Promise<void>
  onStartNewChat: () => void
  open: boolean
  threads: PlatformChatThreadSummary[]
}) {
  const [pendingDeleteThread, setPendingDeleteThread] = useState<PlatformChatThreadSummary | null>(null)
  const historyCount = threads.length + (draftSession ? 1 : 0)

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="bottom"
          showCloseButton={false}
          className="flex h-[78vh] max-h-[78vh] flex-col rounded-t-[28px] border-x-0 border-b-0 px-0 pt-0 shadow-2xl sm:max-w-none"
        >
          <SheetHeader className="shrink-0 gap-3 border-b border-border/70 px-4 pt-3 pb-4">
            <div className="mx-auto h-1.5 w-14 rounded-full bg-border/80" />
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <SheetTitle className="flex items-center gap-2 text-base">
                    <IconClockHour4 className="size-4 text-muted-foreground" />
                    History
                  </SheetTitle>
                  <Badge variant="outline" size="sm">
                    {historyCount}
                    {" "}
                    saved
                  </Badge>
                </div>
                <SheetDescription>
                  Switch threads, start a new one, or remove old conversations.
                </SheetDescription>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void onRefresh()}
                  disabled={isBusy}
                >
                  {isRefreshing
                    ? <IconLoader2 className="size-4 animate-spin" />
                    : <IconRefresh className="size-4" />}
                  Refresh
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={onStartNewChat}
                  disabled={isBusy}
                >
                  <IconMessagePlus className="size-4" />
                  New chat
                </Button>
              </div>
            </div>
          </SheetHeader>

          <div className="flex-1 overflow-y-auto px-4 pt-4 pb-6 scrollbar-thin">
            <div className="space-y-2">
              {draftSession
                ? (
                    <div
                      className={`flex items-center gap-3 rounded-2xl border px-3 py-3 transition-colors ${
                        isDraftSelected
                          ? "border-primary/25 bg-primary/8"
                          : "border-border/70 bg-background hover:bg-muted/50"
                      }`}
                    >
                      <button
                        type="button"
                        aria-label="Open draft chat"
                        className="min-w-0 flex-1 text-left"
                        onClick={() => void onSelectDraft()}
                        disabled={isBusy}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <span className="truncate text-sm font-medium">New chat</span>
                          <span className="shrink-0 text-xs text-muted-foreground">Draft</span>
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {isDraftSelected ? "Current draft" : "Empty draft"}
                        </div>
                      </button>
                    </div>
                  )
                : null}
              {threads.length === 0 && !draftSession
                ? (
                    <div className="rounded-2xl border border-dashed border-border/80 bg-muted/40 px-4 py-6 text-sm text-muted-foreground">
                      No saved threads yet. Start a new chat and the first message will create one.
                    </div>
                  )
                : (
                    threads.map(thread => (
                      <div
                        key={thread.id}
                        className={`group flex items-center gap-3 rounded-2xl border px-3 py-3 transition-colors ${
                          currentThreadId === thread.id
                            ? "border-primary/25 bg-primary/8"
                            : "border-border/70 bg-background hover:bg-muted/50"
                        }`}
                      >
                        <button
                          type="button"
                          className="min-w-0 flex-1 text-left"
                          onClick={() => void onSelectThread(thread.id)}
                          disabled={isBusy}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <span className="truncate text-sm font-medium">{thread.title}</span>
                            <span className="shrink-0 text-xs text-muted-foreground">
                              {formatThreadTimestamp(thread.lastMessageAt)}
                            </span>
                          </div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            {currentThreadId === thread.id ? "Current thread" : "Tap to open"}
                          </div>
                        </button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          className="text-muted-foreground hover:text-destructive"
                          aria-label={`Delete ${thread.title}`}
                          onClick={(event) => {
                            event.preventDefault()
                            event.stopPropagation()
                            setPendingDeleteThread(thread)
                          }}
                          disabled={isBusy}
                        >
                          <IconTrash className="size-4" />
                        </Button>
                      </div>
                    ))
                  )}
            </div>
          </div>
        </SheetContent>
      </Sheet>

      <AlertDialog
        open={pendingDeleteThread !== null}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) {
            setPendingDeleteThread(null)
          }
        }}
      >
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this thread?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDeleteThread
                ? `“${pendingDeleteThread.title}” will be removed from Lexio Cloud.`
                : "This thread will be removed from Lexio Cloud."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (!pendingDeleteThread) {
                  return
                }

                void onDeleteThread(pendingDeleteThread.id)
                setPendingDeleteThread(null)
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
