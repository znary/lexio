import type { ReactNode } from "react"
import type { SelectionSession, SelectionToolbarTranslateRequestSlice } from "../atoms"
import type { SelectionToolbarInlineError } from "../inline-error"
import type { BackgroundTextStreamSnapshot, ThinkingSnapshot } from "@/types/background-stream"
import type { LLMProviderConfig, ProviderConfig } from "@/types/config/provider"
import { i18n } from "#imports"
import { ISO6393_TO_6391, LANG_CODE_TO_EN_NAME } from "@read-frog/definitions"
import { useAtomValue, useSetAtom } from "jotai"
import { createContext, use, useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/base-ui/badge"
import { SelectionPopover } from "@/components/ui/selection-popover"
import { ANALYTICS_FEATURE, ANALYTICS_SURFACE } from "@/types/analytics"
import { isLLMProviderConfig, isTranslateProviderConfig } from "@/types/config/provider"
import { createFeatureUsageContext, trackFeatureUsed } from "@/utils/analytics"
import { configFieldsAtomMap } from "@/utils/atoms/config"
import { filterEnabledProvidersConfig, getProviderConfigById } from "@/utils/config/helpers"
import { DEFAULT_DICTIONARY_ACTION_ID } from "@/utils/constants/custom-action"
import { CUSTOM_ACTION_TEMPLATES } from "@/utils/constants/custom-action-templates"
import { prepareTranslationText } from "@/utils/host/translate/text-preparation"
import { translateTextCore } from "@/utils/host/translate/translate-text"
import { getOrCreateWebPageContext } from "@/utils/host/translate/webpage-context"
import { getOrGenerateWebPageSummary } from "@/utils/host/translate/webpage-summary"
import { onMessage } from "@/utils/message"
import { streamManagedTranslation } from "@/utils/platform/api"
import { getTranslatePromptFromConfig } from "@/utils/prompts/translate"
import { saveTranslatedSelectionToVocabulary } from "@/utils/vocabulary/service"
import { shadowWrapper } from "../.."
import { SelectionToolbarErrorAlert } from "../../components/selection-toolbar-error-alert"
import { SelectionToolbarFooterContent } from "../../components/selection-toolbar-footer-content"
import { SelectionToolbarTitleContent } from "../../components/selection-toolbar-title-content"
import {
  isSelectionToolbarVisibleAtom,
  selectionSessionAtom,
  selectionToolbarTranslateRequestAtom,
} from "../atoms"
import { buildCustomActionExecutionPlan, useCustomActionExecution, useCustomActionWebPageContext } from "../custom-action-button/use-custom-action-execution"
import {
  createSelectionToolbarPrecheckError,
  createSelectionToolbarRuntimeError,
  isAbortError,
} from "../inline-error"
import { useSelectionContextMenuRequestResolver } from "../use-selection-context-menu-request"
import { TargetLanguageSelector } from "./target-language-selector"
import { TranslationContent } from "./translation-content"

interface SelectionTranslatePendingOpenRequest {
  anchor?: { x: number, y: number }
  session: SelectionSession
  surface: typeof ANALYTICS_SURFACE.SELECTION_TOOLBAR | typeof ANALYTICS_SURFACE.CONTEXT_MENU
}

async function getSelectionWebPagePromptContext(
  providerConfig: ProviderConfig,
  enableAIContentAware: boolean,
) {
  const webPageContext = await getOrCreateWebPageContext()
  if (!webPageContext) {
    return undefined
  }

  const webSummary = await getOrGenerateWebPageSummary(webPageContext, providerConfig, enableAIContentAware)
  return {
    webTitle: webPageContext.webTitle,
    webContent: webPageContext.webContent,
    webSummary: webSummary ?? undefined,
  }
}

async function translateWithLlm({
  preparedText,
  providerConfig,
  translateRequest,
  onChunk,
  registerAbortController,
}: {
  preparedText: string
  providerConfig: LLMProviderConfig
  translateRequest: SelectionToolbarTranslateRequestSlice
  onChunk: (data: BackgroundTextStreamSnapshot) => void
  registerAbortController: (abortController: AbortController) => void
}) {
  const targetLangName = LANG_CODE_TO_EN_NAME[translateRequest.language.targetCode]
  const abortController = new AbortController()
  registerAbortController(abortController)

  const throwIfAborted = () => {
    if (abortController.signal.aborted) {
      throw new DOMException("aborted", "AbortError")
    }
  }

  const webPageContext = await getSelectionWebPagePromptContext(providerConfig, translateRequest.enableAIContentAware)
  throwIfAborted()
  const { systemPrompt, prompt } = getTranslatePromptFromConfig(
    { customPromptsConfig: translateRequest.customPromptsConfig },
    targetLangName,
    preparedText,
    webPageContext
      ? {
          context: {
            webTitle: webPageContext.webTitle,
            webContent: webPageContext.webContent,
            webSummary: webPageContext.webSummary,
          },
        }
      : undefined,
  )

  const sourceLanguage = translateRequest.language.sourceCode === "auto"
    ? "auto"
    : (ISO6393_TO_6391[translateRequest.language.sourceCode] ?? "auto")
  const targetLanguage = ISO6393_TO_6391[translateRequest.language.targetCode]
  if (!targetLanguage) {
    throw new Error(`Invalid target language code: ${translateRequest.language.targetCode}`)
  }

  const translatedText = await streamManagedTranslation(
    {
      scene: "selection",
      text: preparedText,
      sourceLanguage,
      targetLanguage,
      systemPrompt,
      prompt,
      temperature: providerConfig.temperature,
    },
    {
      signal: abortController.signal,
      onChunk,
    },
  )

  return translatedText
}

async function translateWithStandardProvider({
  text,
  providerConfig,
  translateRequest,
}: {
  text: string
  providerConfig: ProviderConfig
  translateRequest: SelectionToolbarTranslateRequestSlice
}) {
  const webPageContext = await getSelectionWebPagePromptContext(providerConfig, translateRequest.enableAIContentAware)
  const translatedText = await translateTextCore({
    text,
    langConfig: translateRequest.language,
    providerConfig,
    enableAIContentAware: translateRequest.enableAIContentAware,
    extraHashTags: ["selectionTranslation"],
    webPageContext,
  })

  return translatedText
}

interface SelectionTranslationContextValue {
  prepareToolbarOpen: () => void
}

const SelectionTranslationContext = createContext<SelectionTranslationContextValue | null>(null)

function useSelectionTranslationContext() {
  const context = use(SelectionTranslationContext)
  if (!context) {
    throw new Error("Selection translation popover must be used within SelectionTranslationProvider.")
  }

  return context
}

export function useSelectionTranslationPopover() {
  return useSelectionTranslationContext()
}

export function SelectionTranslationProvider({
  children,
}: {
  children: ReactNode
}) {
  const bodyRef = useRef<HTMLDivElement>(null)
  const [isOpen, setIsOpen] = useState(false)
  const [anchor, setAnchor] = useState<{ x: number, y: number } | null>(null)
  const [popoverSessionKey, setPopoverSessionKey] = useState(0)
  const [translatedText, setTranslatedText] = useState<string | undefined>(undefined)
  const [savedVocabularyText, setSavedVocabularyText] = useState<string | null>(null)
  const [isDetailedExplanationVisible, setIsDetailedExplanationVisible] = useState(false)
  const [hasRequestedDetailedExplanation, setHasRequestedDetailedExplanation] = useState(false)
  const [thinking, setThinking] = useState<ThinkingSnapshot | null>(null)
  const [error, setError] = useState<SelectionToolbarInlineError | null>(null)
  const [isTranslating, setIsTranslating] = useState(false)
  const [rerunNonce, setRerunNonce] = useState(0)
  const [sourceSurface, setSourceSurface] = useState<
    typeof ANALYTICS_SURFACE.SELECTION_TOOLBAR | typeof ANALYTICS_SURFACE.CONTEXT_MENU
  >(ANALYTICS_SURFACE.SELECTION_TOOLBAR)
  const [activeSession, setActiveSession] = useState<SelectionSession | null>(null)
  const selectionSession = useAtomValue(selectionSessionAtom)
  const translateRequest = useAtomValue(selectionToolbarTranslateRequestAtom)
  const providersConfig = useAtomValue(configFieldsAtomMap.providersConfig)
  const selectionToolbarConfig = useAtomValue(configFieldsAtomMap.selectionToolbar)
  const vocabularySettings = useAtomValue(configFieldsAtomMap.vocabulary)
  const setIsSelectionToolbarVisible = useSetAtom(isSelectionToolbarVisibleAtom)
  const abortControllerRef = useRef<AbortController | null>(null)
  const pendingOpenRequestRef = useRef<SelectionTranslatePendingOpenRequest | null>(null)
  const reopenFrameRef = useRef<number | null>(null)
  const lastTranslationRunKeyRef = useRef<string | null>(null)
  const runIdRef = useRef(0)
  const { resolveContextMenuSelectionRequest } = useSelectionContextMenuRequestResolver(selectionSession)
  const selectionText = activeSession?.selectionSnapshot.text ?? null
  const paragraphsText = activeSession?.contextSnapshot.text ?? selectionText
  const titleText = document.title || null
  const cleanedSelectionText = useMemo(
    () => prepareTranslationText(selectionText),
    [selectionText],
  )
  const llmProviders = useMemo(
    () => filterEnabledProvidersConfig(providersConfig).filter(isLLMProviderConfig),
    [providersConfig],
  )
  const translateRequestKey = useMemo(
    () => JSON.stringify(translateRequest),
    [translateRequest],
  )
  const defaultDictionaryTemplate = useMemo(
    () => CUSTOM_ACTION_TEMPLATES.find(template => template.id === "dictionary") ?? null,
    [],
  )
  const dictionaryFallbackAction = useMemo(() => {
    if (!defaultDictionaryTemplate || llmProviders.length === 0) {
      return null
    }

    const fallbackAction = defaultDictionaryTemplate.createAction(llmProviders[0].id)
    return {
      ...fallbackAction,
      id: DEFAULT_DICTIONARY_ACTION_ID,
    }
  }, [defaultDictionaryTemplate, llmProviders])
  const dictionaryAction = useMemo(
    () => selectionToolbarConfig.customActions.find(action => action.id === DEFAULT_DICTIONARY_ACTION_ID) ?? dictionaryFallbackAction,
    [dictionaryFallbackAction, selectionToolbarConfig.customActions],
  )
  const dictionaryProviderConfig = useMemo(
    () => dictionaryAction ? getProviderConfigById(providersConfig, dictionaryAction.providerId) ?? null : null,
    [dictionaryAction, providersConfig],
  )
  const dictionaryWebPageContext = useCustomActionWebPageContext(
    isOpen && hasRequestedDetailedExplanation,
    popoverSessionKey,
  )
  const dictionaryExecutionPlan = useMemo(
    () => buildCustomActionExecutionPlan(
      {
        language: translateRequest.language,
        action: dictionaryAction,
        providerConfig: dictionaryProviderConfig,
      },
      cleanedSelectionText,
      paragraphsText || cleanedSelectionText,
      dictionaryWebPageContext,
    ),
    [
      cleanedSelectionText,
      dictionaryAction,
      dictionaryProviderConfig,
      dictionaryWebPageContext,
      paragraphsText,
      translateRequest.language,
    ],
  )
  const {
    error: detailedExplanationRuntimeError,
    isRunning: isDetailedExplanationRunning,
    resetSessionState: resetDetailedExplanationState,
    result: detailedExplanationResult,
    thinking: detailedExplanationThinking,
  } = useCustomActionExecution({
    analyticsSurface: sourceSurface,
    bodyRef,
    executionContext: dictionaryExecutionPlan.executionContext,
    open: isOpen && hasRequestedDetailedExplanation,
    popoverSessionKey,
    rerunNonce: 0,
  })

  const resetPopoverSession = useCallback((options?: { clearAnchor?: boolean }) => {
    setActiveSession(null)
    if (options?.clearAnchor) {
      setAnchor(null)
    }
  }, [])

  const resetDetailedExplanation = useCallback(() => {
    setIsDetailedExplanationVisible(false)
    setHasRequestedDetailedExplanation(false)
    resetDetailedExplanationState()
  }, [resetDetailedExplanationState])

  const resetTranslationState = useCallback(() => {
    setIsTranslating(false)
    setTranslatedText(undefined)
    setSavedVocabularyText(null)
    setThinking(null)
    setError(null)
    resetDetailedExplanation()
  }, [resetDetailedExplanation])

  const cancelCurrentTranslation = useCallback((runId?: number) => {
    if (runId !== undefined && runIdRef.current !== runId) {
      return
    }

    runIdRef.current += 1
    abortControllerRef.current?.abort()
    abortControllerRef.current = null
  }, [])

  const commitOpenRequest = useCallback((request: SelectionTranslatePendingOpenRequest) => {
    pendingOpenRequestRef.current = request
    if (request.anchor) {
      setAnchor(request.anchor)
    }
  }, [])

  const handleRegenerate = useCallback(() => {
    cancelCurrentTranslation()
    resetDetailedExplanation()
    setRerunNonce(prev => prev + 1)
  }, [cancelCurrentTranslation, resetDetailedExplanation])

  const toggleDetailedExplanation = useCallback(() => {
    setIsDetailedExplanationVisible((prev) => {
      const nextVisible = !prev
      if (nextVisible) {
        setHasRequestedDetailedExplanation(true)
      }
      return nextVisible
    })
  }, [])

  const runTranslation = useCallback(async (runId: number) => {
    const preparedText = prepareTranslationText(selectionText)

    if (preparedText === "") {
      if (runIdRef.current === runId) {
        resetTranslationState()
      }
      return
    }

    const analyticsContext = createFeatureUsageContext(
      ANALYTICS_FEATURE.SELECTION_TRANSLATION,
      sourceSurface,
    )

    setIsTranslating(true)
    setTranslatedText(undefined)
    setThinking(null)
    setError(null)

    const providerConfig = translateRequest.providerConfig
    if (!providerConfig || !isTranslateProviderConfig(providerConfig)) {
      if (runIdRef.current === runId) {
        setIsTranslating(false)
        setError(createSelectionToolbarPrecheckError("translate", "providerUnavailable"))
      }
      void trackFeatureUsed({
        ...analyticsContext,
        outcome: "failure",
      })
      return
    }

    if (!providerConfig.enabled) {
      if (runIdRef.current === runId) {
        setIsTranslating(false)
        setError(createSelectionToolbarPrecheckError("translate", "providerDisabled"))
      }
      void trackFeatureUsed({
        ...analyticsContext,
        outcome: "failure",
      })
      return
    }

    try {
      let nextTranslatedText = ""
      if (isLLMProviderConfig(providerConfig)) {
        setThinking({
          status: "thinking",
          text: "",
        })

        const nextSnapshot = await translateWithLlm({
          preparedText,
          providerConfig,
          translateRequest,
          onChunk: (data) => {
            if (runIdRef.current === runId) {
              setTranslatedText(data.output)
              setThinking(data.thinking)
            }
          },
          registerAbortController: (abortController) => {
            abortControllerRef.current = abortController
          },
        })

        nextTranslatedText = nextSnapshot.output
        if (runIdRef.current === runId) {
          setThinking(nextSnapshot.thinking)
        }
      }
      else {
        setThinking(null)
        nextTranslatedText = await translateWithStandardProvider({
          text: preparedText,
          providerConfig,
          translateRequest,
        })
      }

      if (runIdRef.current === runId) {
        setTranslatedText(nextTranslatedText)
      }

      if (selectionText && nextTranslatedText) {
        try {
          const savedItem = await saveTranslatedSelectionToVocabulary({
            sourceText: selectionText,
            translatedText: nextTranslatedText,
            sourceLang: translateRequest.language.sourceCode,
            targetLang: translateRequest.language.targetCode,
            settings: vocabularySettings,
          })

          if (runIdRef.current === runId) {
            setSavedVocabularyText(savedItem?.sourceText ?? null)
          }
        }
        catch {
          if (runIdRef.current === runId) {
            setSavedVocabularyText(null)
          }
        }
      }

      void trackFeatureUsed({
        ...analyticsContext,
        outcome: "success",
      })
    }
    catch (error) {
      if (!isAbortError(error) && runIdRef.current === runId) {
        setThinking(prev => prev?.text ? { ...prev, status: "complete" } : null)
        setError(createSelectionToolbarRuntimeError("translate", error))
      }

      if (!isAbortError(error)) {
        void trackFeatureUsed({
          ...analyticsContext,
          outcome: "failure",
        })
      }
    }
    finally {
      if (runIdRef.current === runId) {
        abortControllerRef.current = null
        setIsTranslating(false)
      }
    }
  }, [resetTranslationState, selectionText, sourceSurface, translateRequest, vocabularySettings])

  const startTranslation = useEffectEvent((runId: number) => {
    void runTranslation(runId)
  })

  useEffect(() => {
    if (!isOpen) {
      return
    }

    const nextRunKey = JSON.stringify({
      popoverSessionKey,
      rerunNonce,
      sessionId: activeSession?.id ?? null,
      translateRequestKey,
    })
    if (lastTranslationRunKeyRef.current === nextRunKey) {
      return
    }
    lastTranslationRunKeyRef.current = nextRunKey

    const runId = runIdRef.current + 1
    runIdRef.current = runId

    resetDetailedExplanation()
    startTranslation(runId)

    return () => {
      cancelCurrentTranslation(runId)
    }
  }, [activeSession?.id, cancelCurrentTranslation, isOpen, popoverSessionKey, rerunNonce, resetDetailedExplanation, translateRequestKey])

  const handleOpenChange = useCallback((nextOpen: boolean) => {
    cancelCurrentTranslation()
    resetTranslationState()

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
      lastTranslationRunKeyRef.current = null
    }

    setIsOpen(nextOpen)
  }, [cancelCurrentTranslation, resetPopoverSession, resetTranslationState, selectionSession, setIsSelectionToolbarVisible])

  const prepareToolbarOpen = useCallback(() => {
    if (!selectionSession) {
      return
    }

    commitOpenRequest({
      session: selectionSession,
      surface: ANALYTICS_SURFACE.SELECTION_TOOLBAR,
    })
  }, [commitOpenRequest, selectionSession])

  const resolveContextMenuRequest = useCallback((): SelectionTranslatePendingOpenRequest | null => {
    const request = resolveContextMenuSelectionRequest()
    if (!request) {
      return null
    }

    return {
      anchor: request.anchor,
      session: request.session,
      surface: ANALYTICS_SURFACE.CONTEXT_MENU,
    }
  }, [resolveContextMenuSelectionRequest])

  const openFromContextMenu = useCallback(() => {
    const request = resolveContextMenuRequest()
    if (!request) {
      const nextError = createSelectionToolbarPrecheckError("translate", "missingSelection")
      toast.error(nextError.description)
      return
    }

    if (reopenFrameRef.current !== null) {
      cancelAnimationFrame(reopenFrameRef.current)
      reopenFrameRef.current = null
    }

    if (isOpen) {
      handleOpenChange(false)
      reopenFrameRef.current = requestAnimationFrame(() => {
        reopenFrameRef.current = null
        commitOpenRequest(request)
        handleOpenChange(true)
      })
      return
    }

    commitOpenRequest(request)
    handleOpenChange(true)
  }, [commitOpenRequest, handleOpenChange, isOpen, resolveContextMenuRequest])

  useEffect(() => {
    return onMessage("openSelectionTranslationFromContextMenu", () => {
      openFromContextMenu()
    })
  }, [openFromContextMenu])

  useEffect(() => {
    return () => {
      if (reopenFrameRef.current !== null) {
        cancelAnimationFrame(reopenFrameRef.current)
      }
    }
  }, [])

  const detailedExplanationError = hasRequestedDetailedExplanation
    ? (detailedExplanationRuntimeError ?? dictionaryExecutionPlan.error)
    : null
  const detailedExplanationLoading = hasRequestedDetailedExplanation
    && (
      (dictionaryExecutionPlan.executionContext ? isDetailedExplanationRunning : false)
      || dictionaryWebPageContext === undefined
    )
  const detailedExplanationValue = dictionaryExecutionPlan.executionContext ? detailedExplanationResult : null
  const detailedExplanationThinkingValue = dictionaryExecutionPlan.executionContext ? detailedExplanationThinking : null
  const contextValue = useMemo<SelectionTranslationContextValue>(() => ({
    prepareToolbarOpen,
  }), [prepareToolbarOpen])

  return (
    <SelectionTranslationContext value={contextValue}>
      <SelectionPopover.Root
        open={isOpen}
        onOpenChange={handleOpenChange}
        anchor={anchor}
        onAnchorChange={setAnchor}
      >
        {children}
        <SelectionPopover.Content
          key={popoverSessionKey}
          container={shadowWrapper ?? document.body}
          finalFocus={false}
        >
          <SelectionPopover.Header className="border-b">
            <SelectionToolbarTitleContent
              title="Translation"
              icon="ri:translate"
            />
            <div className="flex items-center gap-1">
              <TargetLanguageSelector />
              <SelectionPopover.Pin />
              <SelectionPopover.Close />
            </div>
          </SelectionPopover.Header>

          <SelectionPopover.Body ref={bodyRef}>
            <TranslationContent
              detailedExplanation={dictionaryAction
                ? {
                    error: detailedExplanationError,
                    isExpanded: isDetailedExplanationVisible,
                    isLoading: detailedExplanationLoading,
                    onToggle: toggleDetailedExplanation,
                    outputSchema: dictionaryAction.outputSchema,
                    result: detailedExplanationValue,
                    thinking: detailedExplanationThinkingValue,
                  }
                : null}
              selectionContent={selectionText}
              translatedText={translatedText}
              isTranslating={isTranslating}
              thinking={thinking}
            />
            <SelectionToolbarErrorAlert error={error} className="-mt-3" />
          </SelectionPopover.Body>
          <SelectionToolbarFooterContent
            paragraphsText={paragraphsText}
            titleText={titleText}
            onRegenerate={handleRegenerate}
          >
            {savedVocabularyText && (
              <Badge variant="secondary">
                {i18n.t("action.savedToVocabulary")}
              </Badge>
            )}
          </SelectionToolbarFooterContent>
        </SelectionPopover.Content>
      </SelectionPopover.Root>
    </SelectionTranslationContext>
  )
}
