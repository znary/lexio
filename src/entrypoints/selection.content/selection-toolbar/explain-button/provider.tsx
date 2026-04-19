import type { ReactNode } from "react"
import type { SelectionSession } from "../atoms"
import { useAtomValue, useSetAtom } from "jotai"
import { createContext, use, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { SelectionPopover } from "@/components/ui/selection-popover"
import { ANALYTICS_FEATURE, ANALYTICS_SURFACE } from "@/types/analytics"
import { createFeatureUsageContext, trackFeatureUsed } from "@/utils/analytics"
import { configFieldsAtomMap } from "@/utils/atoms/config"
import { getProviderConfigById } from "@/utils/config/helpers"
import { createBuiltInExplainAction, getBuiltInExplainFieldLabel } from "@/utils/constants/built-in-explain-action"
import { onMessage } from "@/utils/message"
import { shadowWrapper } from "../.."
import { SelectionToolbarFooterContent } from "../../components/selection-toolbar-footer-content"
import { SelectionToolbarTitleContent } from "../../components/selection-toolbar-title-content"
import { normalizeSelectedText } from "../../utils"
import {
  contextAtom,
  isSelectionToolbarVisibleAtom,
  selectionAtom,
  selectionSessionAtom,
} from "../atoms"
import { CustomActionContent } from "../custom-action-button/custom-action-content"
import { buildCustomActionExecutionPlan, useCustomActionExecution, useCustomActionWebPageContext } from "../custom-action-button/use-custom-action-execution"
import { useSelectionContextMenuRequestResolver } from "../use-selection-context-menu-request"

interface SelectionExplainPendingOpenRequest {
  anchor?: { x: number, y: number }
  session: SelectionSession | null
  surface: typeof ANALYTICS_SURFACE.SELECTION_TOOLBAR | typeof ANALYTICS_SURFACE.CONTEXT_MENU
}

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

export function SelectionExplainProvider({
  children,
}: {
  children: ReactNode
}) {
  const [isOpen, setIsOpen] = useState(false)
  const [anchor, setAnchor] = useState<{ x: number, y: number } | null>(null)
  const [popoverSessionKey, setPopoverSessionKey] = useState(0)
  const [rerunNonce, setRerunNonce] = useState(0)
  const [activeSession, setActiveSession] = useState<SelectionSession | null>(null)
  const [sourceSurface, setSourceSurface] = useState<
    typeof ANALYTICS_SURFACE.SELECTION_TOOLBAR | typeof ANALYTICS_SURFACE.CONTEXT_MENU
  >(ANALYTICS_SURFACE.SELECTION_TOOLBAR)
  const selectionSession = useAtomValue(selectionSessionAtom)
  const selection = useAtomValue(selectionAtom)
  const context = useAtomValue(contextAtom)
  const selectionToolbarConfig = useAtomValue(configFieldsAtomMap.selectionToolbar)
  const providersConfig = useAtomValue(configFieldsAtomMap.providersConfig)
  const language = useAtomValue(configFieldsAtomMap.language)
  const setIsSelectionToolbarVisible = useSetAtom(isSelectionToolbarVisibleAtom)
  const bodyRef = useRef<HTMLDivElement>(null)
  const pendingOpenRequestRef = useRef<SelectionExplainPendingOpenRequest | null>(null)
  const reopenFrameRef = useRef<number | null>(null)
  const nextEphemeralSessionIdRef = useRef(0)
  const trackedPrecheckErrorKeyRef = useRef<string | null>(null)
  const { resolveContextMenuSelectionRequest } = useSelectionContextMenuRequestResolver(selectionSession)
  const selectionText = activeSession?.selectionSnapshot.text ?? null
  const cleanSelection = useMemo(
    () => normalizeSelectedText(selectionText),
    [selectionText],
  )
  const paragraphsText = useMemo(() => {
    if (!cleanSelection) {
      return ""
    }

    return activeSession?.contextSnapshot.text || cleanSelection
  }, [activeSession?.contextSnapshot.text, cleanSelection])
  const webPageContext = useCustomActionWebPageContext(isOpen, popoverSessionKey)
  const titleText = (webPageContext?.webTitle ?? document.title) || null
  const explainFeature = selectionToolbarConfig.features.explain
  const providerConfig = getProviderConfigById(providersConfig, explainFeature.providerId) ?? null
  const explainAction = useMemo(
    () => createBuiltInExplainAction(explainFeature.providerId),
    [explainFeature.providerId],
  )
  const explainRequest = useMemo(() => ({
    language,
    action: explainAction,
    providerConfig,
  }), [explainAction, language, providerConfig])
  const executionPlan = useMemo(
    () => buildCustomActionExecutionPlan(explainRequest, cleanSelection, paragraphsText, webPageContext),
    [cleanSelection, explainRequest, paragraphsText, webPageContext],
  )
  const {
    isRunning,
    resetSessionState,
    result,
    thinking,
  } = useCustomActionExecution({
    bodyRef,
    analyticsSurface: sourceSurface,
    executionContext: executionPlan.executionContext,
    open: isOpen,
    popoverSessionKey,
    rerunNonce,
  })
  const displayedResult = executionPlan.executionContext ? result : null
  const displayedIsRunning = (isOpen && webPageContext === undefined) || (executionPlan.executionContext ? isRunning : false)
  const displayedThinking = executionPlan.executionContext ? thinking : null

  const resetPopoverSession = useCallback((options?: { clearAnchor?: boolean }) => {
    setActiveSession(null)
    if (options?.clearAnchor) {
      setAnchor(null)
    }
  }, [])

  const commitOpenRequest = useCallback((request: SelectionExplainPendingOpenRequest) => {
    pendingOpenRequestRef.current = request
    if (request.anchor) {
      setAnchor(request.anchor)
    }
  }, [])

  const handleOpenChange = useCallback((nextOpen: boolean) => {
    resetSessionState()

    if (nextOpen) {
      const pendingRequest = pendingOpenRequestRef.current
      const nextSession = pendingRequest?.session ?? selectionSession

      setActiveSession(nextSession)
      setSourceSurface(pendingRequest?.surface ?? ANALYTICS_SURFACE.SELECTION_TOOLBAR)
      setPopoverSessionKey(prev => prev + 1)
      if (pendingRequest?.anchor) {
        setAnchor(pendingRequest.anchor)
      }
      setIsSelectionToolbarVisible(false)
      pendingOpenRequestRef.current = null
    }
    else {
      resetPopoverSession({
        clearAnchor: pendingOpenRequestRef.current === null,
      })
    }

    setIsOpen(nextOpen)
  }, [resetPopoverSession, resetSessionState, selectionSession, setIsSelectionToolbarVisible])

  const openActionRequest = useCallback((request: SelectionExplainPendingOpenRequest) => {
    if (isOpen) {
      handleOpenChange(false)

      if (reopenFrameRef.current !== null) {
        cancelAnimationFrame(reopenFrameRef.current)
      }

      reopenFrameRef.current = requestAnimationFrame(() => {
        reopenFrameRef.current = null
        commitOpenRequest(request)
        handleOpenChange(true)
      })
      return
    }

    commitOpenRequest(request)
    handleOpenChange(true)
  }, [commitOpenRequest, handleOpenChange, isOpen])

  const openToolbarExplain = useCallback((triggerElement: HTMLElement | null) => {
    if (!triggerElement) {
      return
    }

    const rect = triggerElement.getBoundingClientRect()
    openActionRequest({
      anchor: { x: rect.left, y: rect.top },
      surface: ANALYTICS_SURFACE.SELECTION_TOOLBAR,
      session: selectionSession ?? (selection
        ? {
            id: --nextEphemeralSessionIdRef.current,
            createdAt: Date.now(),
            selectionSnapshot: selection,
            contextSnapshot: context ?? {
              text: "",
              paragraphs: [],
            },
          }
        : null),
    })
  }, [context, openActionRequest, selection, selectionSession])

  const openContextMenuExplain = useCallback(() => {
    const request = resolveContextMenuSelectionRequest()
    if (!request) {
      void trackFeatureUsed({
        ...createFeatureUsageContext(
          ANALYTICS_FEATURE.CUSTOM_AI_ACTION,
          ANALYTICS_SURFACE.CONTEXT_MENU,
          Date.now(),
          {
            action_id: "default-explain",
          },
        ),
        outcome: "failure",
      })
      return
    }

    openActionRequest({
      anchor: request.anchor,
      session: request.session,
      surface: ANALYTICS_SURFACE.CONTEXT_MENU,
    })
  }, [openActionRequest, resolveContextMenuSelectionRequest])

  const handleRegenerate = useCallback(() => {
    setRerunNonce(prev => prev + 1)
  }, [])

  useEffect(() => {
    return onMessage("openSelectionExplainFromContextMenu", () => {
      openContextMenuExplain()
    })
  }, [openContextMenuExplain])

  useEffect(() => {
    return () => {
      if (reopenFrameRef.current !== null) {
        cancelAnimationFrame(reopenFrameRef.current)
      }
    }
  }, [])

  useEffect(() => {
    if (!isOpen || !executionPlan.error || executionPlan.executionContext) {
      return
    }

    const analyticsContext = createFeatureUsageContext(
      ANALYTICS_FEATURE.CUSTOM_AI_ACTION,
      sourceSurface,
      Date.now(),
      {
        action_id: "default-explain",
        action_name: explainAction.name,
      },
    )
    const nextErrorKey = JSON.stringify({
      description: executionPlan.error.description,
      popoverSessionKey,
      surface: sourceSurface,
    })

    if (trackedPrecheckErrorKeyRef.current === nextErrorKey) {
      return
    }
    trackedPrecheckErrorKeyRef.current = nextErrorKey

    void trackFeatureUsed({
      ...analyticsContext,
      outcome: "failure",
    })
  }, [
    executionPlan.error,
    executionPlan.executionContext,
    explainAction.name,
    isOpen,
    popoverSessionKey,
    sourceSurface,
  ])

  const contextValue = useMemo<SelectionExplainContextValue>(() => ({
    openToolbarExplain,
  }), [openToolbarExplain])

  return (
    <SelectionExplainContext value={contextValue}>
      {children}
      <SelectionPopover.Root
        open={isOpen}
        onOpenChange={handleOpenChange}
        anchor={anchor}
        onAnchorChange={setAnchor}
      >
        <SelectionPopover.Content key={popoverSessionKey} container={shadowWrapper ?? document.body} finalFocus={false}>
          <SelectionPopover.Header className="border-b">
            <SelectionToolbarTitleContent
              title={explainAction.name}
              icon={explainAction.icon}
            />
            <div className="flex items-center gap-1">
              <SelectionPopover.Pin />
              <SelectionPopover.Close />
            </div>
          </SelectionPopover.Header>

          <SelectionPopover.Body ref={bodyRef}>
            <CustomActionContent
              isRunning={displayedIsRunning}
              outputSchema={explainAction.outputSchema}
              selectionContent={selectionText}
              value={displayedResult}
              thinking={displayedThinking}
              fieldLabelResolver={field => getBuiltInExplainFieldLabel(field.id, field.name)}
            />
          </SelectionPopover.Body>
          <SelectionToolbarFooterContent
            paragraphsText={paragraphsText}
            titleText={titleText}
            onRegenerate={handleRegenerate}
          />
        </SelectionPopover.Content>
      </SelectionPopover.Root>
    </SelectionExplainContext>
  )
}
