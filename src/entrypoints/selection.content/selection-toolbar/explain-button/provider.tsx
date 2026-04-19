import type { ReactNode } from "react"
import type { ContextSnapshot, SelectionSnapshot } from "../../utils"
import type { SelectionSession } from "../atoms"
import { useAtomValue, useSetAtom } from "jotai"
import { createContext, use, useCallback, useEffect, useMemo, useRef } from "react"
import { toast } from "sonner"
import { onMessage, sendMessage } from "@/utils/message"
import { normalizeSelectedText } from "../../utils"
import {
  contextAtom,
  isSelectionToolbarVisibleAtom,
  selectionAtom,
  selectionSessionAtom,
} from "../atoms"
import { useSelectionContextMenuRequestResolver } from "../use-selection-context-menu-request"

interface SelectionExplainContextValue {
  openToolbarExplain: (triggerElement: HTMLElement | null) => void
}

const SelectionExplainContext = createContext<SelectionExplainContextValue | null>(null)

function useSelectionExplainContext() {
  const context = use(SelectionExplainContext)
  if (!context) {
    throw new Error("Selection explain trigger must be used within SelectionExplainProvider.")
  }

  return context
}

export function useSelectionExplainPopover() {
  return useSelectionExplainContext()
}

function createEphemeralSelectionSession(
  selection: SelectionSnapshot | null,
  context: ContextSnapshot | null,
  nextSessionId: number,
): SelectionSession | null {
  if (!selection) {
    return null
  }

  return {
    id: nextSessionId,
    createdAt: Date.now(),
    selectionSnapshot: selection,
    contextSnapshot: context ?? {
      text: "",
      paragraphs: [],
    },
  }
}

export function SelectionExplainProvider({
  children,
}: {
  children: ReactNode
}) {
  const selectionSession = useAtomValue(selectionSessionAtom)
  const selection = useAtomValue(selectionAtom)
  const context = useAtomValue(contextAtom)
  const setIsSelectionToolbarVisible = useSetAtom(isSelectionToolbarVisibleAtom)
  const nextEphemeralSessionIdRef = useRef(0)
  const { resolveContextMenuSelectionRequest } = useSelectionContextMenuRequestResolver(selectionSession)

  const sendExplainRequest = useCallback(async (session: SelectionSession | null) => {
    const selectionText = normalizeSelectedText(session?.selectionSnapshot.text)
    if (!selectionText) {
      return
    }

    const opened = await sendMessage("openSidePanelChatRequest", {
      type: "selection-explain",
      selectionText,
      pageTitle: document.title || undefined,
      pageUrl: window.location.href || undefined,
    })
    if (!opened) {
      throw new Error("Side panel is unavailable in this browser.")
    }
  }, [])

  const openToolbarExplain = useCallback((_triggerElement: HTMLElement | null) => {
    const nextSession = selectionSession ?? createEphemeralSelectionSession(
      selection,
      context,
      --nextEphemeralSessionIdRef.current,
    )
    setIsSelectionToolbarVisible(false)

    void sendExplainRequest(nextSession).catch((error) => {
      toast.error(error instanceof Error ? error.message : "Failed to send the explain request.")
    })
  }, [context, selection, selectionSession, sendExplainRequest, setIsSelectionToolbarVisible])

  const openContextMenuExplain = useCallback(() => {
    const request = resolveContextMenuSelectionRequest()
    setIsSelectionToolbarVisible(false)
    void sendExplainRequest(request?.session ?? null).catch((error) => {
      toast.error(error instanceof Error ? error.message : "Failed to send the explain request.")
    })
  }, [resolveContextMenuSelectionRequest, sendExplainRequest, setIsSelectionToolbarVisible])

  useEffect(() => {
    return onMessage("openSelectionExplainFromContextMenu", () => {
      openContextMenuExplain()
    })
  }, [openContextMenuExplain])

  const contextValue = useMemo<SelectionExplainContextValue>(() => ({
    openToolbarExplain,
  }), [openToolbarExplain])

  return (
    <SelectionExplainContext value={contextValue}>
      {children}
    </SelectionExplainContext>
  )
}
