import type { ReactNode } from "react"
import type { SelectionSession, SelectionToolbarTranslateRequestSlice } from "../atoms"
import type { SelectionToolbarInlineError } from "../inline-error"
import type { BackgroundStructuredObjectStreamSnapshot, BackgroundTextStreamSnapshot, ThinkingSnapshot } from "@/types/background-stream"
import type { LLMProviderConfig, ProviderConfig } from "@/types/config/provider"
import type { SelectionToolbarCustomActionOutputField } from "@/types/config/selection-toolbar"
import type { VocabularyItem, VocabularySettings, VocabularyWordFamily, VocabularyWordFamilyEntry } from "@/types/vocabulary"
import { i18n } from "#imports"
import { ISO6393_TO_6391, LANG_CODE_TO_EN_NAME } from "@read-frog/definitions"
import { IconAlertCircle, IconCheck, IconLoader2 } from "@tabler/icons-react"
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
import {
  createBuiltInDictionaryAction,
  createBuiltInDictionaryOutputSchema,
  shouldUseBuiltInDictionary,
} from "@/utils/constants/built-in-dictionary-action"
import { DEFAULT_DICTIONARY_ACTION_ID } from "@/utils/constants/custom-action"
import { CONTENT_WRAPPER_CLASS, PARAGRAPH_ATTRIBUTE } from "@/utils/constants/dom-labels"
import { prepareTranslationText } from "@/utils/host/translate/text-preparation"
import { translateTextCore } from "@/utils/host/translate/translate-text"
import { getOrCreateWebPageContext } from "@/utils/host/translate/webpage-context"
import { getOrGenerateWebPageSummary } from "@/utils/host/translate/webpage-summary"
import { onMessage } from "@/utils/message"
import { streamManagedTranslation } from "@/utils/platform/api"
import { getTranslatePromptFromConfig } from "@/utils/prompts/translate"
import {
  findVocabularyItemForSelection,
  saveTranslatedSelectionToVocabulary,
  setVocabularyItemMastered,
  updateVocabularyItemContextTranslation,
  updateVocabularyItemDetails,
} from "@/utils/vocabulary/service"
import { shadowWrapper } from "../.."
import { SelectionToolbarErrorAlert } from "../../components/selection-toolbar-error-alert"
import { SelectionToolbarFooterContent } from "../../components/selection-toolbar-footer-content"
import { SelectionToolbarTitleContent } from "../../components/selection-toolbar-title-content"
import { extractSelectionContextSentence } from "../../utils"
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
import { TranslationContent } from "./translation-content"

interface SelectionTranslatePendingOpenRequest {
  anchor?: { x: number, y: number }
  session: SelectionSession
  surface: typeof ANALYTICS_SURFACE.SELECTION_TOOLBAR | typeof ANALYTICS_SURFACE.CONTEXT_MENU
}

interface TranslationResumeSnapshot {
  isTranslating: boolean
  thinking: ThinkingSnapshot | null
  translatedText: string | undefined
  translationRunKey: string | null
}

const CONTEXT_TEXT_WHITESPACE_RE = /\s+/g
const CONTEXT_SENTENCE_BOUNDARY_RE = /(?<=[.!?。！？])\s+|\n+/u

function createTranslationRunKey({
  popoverSessionKey,
  rerunNonce,
  sessionId,
  translateRequestKey,
}: {
  popoverSessionKey: number
  rerunNonce: number
  sessionId: number | null
  translateRequestKey: string
}) {
  return JSON.stringify({
    popoverSessionKey,
    rerunNonce,
    sessionId,
    translateRequestKey,
  })
}

function isSameSelectionSession(
  left: SelectionSession | null | undefined,
  right: SelectionSession | null | undefined,
) {
  if (!left || !right) {
    return false
  }

  return left.id === right.id
    || (
      left.selectionSnapshot.text === right.selectionSnapshot.text
      && left.contextSnapshot.text === right.contextSnapshot.text
    )
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
  onFinalSnapshot,
  registerFinalPromise,
  preparedText,
  providerConfig,
  translateRequest,
  onChunk,
  registerAbortController,
}: {
  onFinalSnapshot?: (data: BackgroundTextStreamSnapshot) => void
  registerFinalPromise?: (promise: Promise<BackgroundTextStreamSnapshot>) => void
  preparedText: string
  providerConfig: LLMProviderConfig
  translateRequest: SelectionToolbarTranslateRequestSlice
  onChunk: (data: BackgroundTextStreamSnapshot) => void
  registerAbortController: (abortController: AbortController) => void
}) {
  const targetLangName = LANG_CODE_TO_EN_NAME[translateRequest.language.targetCode]
  const lifecycleAbortController = new AbortController()
  // Keep a separate stream signal so a closed popover does not kill an already-started request.
  const streamAbortController = new AbortController()
  registerAbortController(lifecycleAbortController)

  const throwIfAborted = () => {
    if (lifecycleAbortController.signal.aborted) {
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

  const streamPromise = streamManagedTranslation(
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
      signal: streamAbortController.signal,
      onChunk,
    },
  )

  if (onFinalSnapshot) {
    void streamPromise.then(onFinalSnapshot).catch(() => {})
  }
  registerFinalPromise?.(streamPromise)

  const translatedText = await streamPromise

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

function normalizeContextSentenceText(value: string | null | undefined) {
  return prepareTranslationText(value)?.replace(CONTEXT_TEXT_WHITESPACE_RE, " ") ?? ""
}

function splitContextParagraphIntoSentences(paragraph: string): string[] {
  if (typeof Intl !== "undefined" && typeof Intl.Segmenter === "function") {
    try {
      const segmenter = new Intl.Segmenter(undefined, { granularity: "sentence" })
      const segments = Array.from(
        segmenter.segment(paragraph),
        segment => normalizeContextSentenceText(segment.segment),
      ).filter(Boolean)

      if (segments.length > 0) {
        return segments
      }
    }
    catch {
      // Fall through to the regex fallback when sentence segmentation is unavailable.
    }
  }

  return paragraph
    .split(CONTEXT_SENTENCE_BOUNDARY_RE)
    .map(segment => normalizeContextSentenceText(segment))
    .filter(Boolean)
}

function getOriginalParagraphText(paragraphElement: HTMLElement) {
  const clone = paragraphElement.cloneNode(true) as HTMLElement
  clone.querySelectorAll(`.${CONTENT_WRAPPER_CLASS}`).forEach((wrapper) => {
    wrapper.remove()
  })
  return normalizeContextSentenceText(clone.textContent)
}

function getTranslatedParagraphText(paragraphElement: HTMLElement): string | null {
  const wrapperTexts = Array.from(paragraphElement.querySelectorAll<HTMLElement>(`.${CONTENT_WRAPPER_CLASS}`))
    .map(wrapper => normalizeContextSentenceText(wrapper.textContent))
    .filter(Boolean)

  if (wrapperTexts.length > 0) {
    return wrapperTexts.join(" ")
  }

  const nextSibling = paragraphElement.nextElementSibling
  if (nextSibling instanceof HTMLElement && nextSibling.classList.contains(CONTENT_WRAPPER_CLASS)) {
    return normalizeContextSentenceText(nextSibling.textContent)
  }

  return null
}

function resolveTranslatedSentenceFromParagraph(
  sourceParagraph: string,
  translatedParagraph: string,
  contextSentence: string,
): string | null {
  const normalizedSourceParagraph = normalizeContextSentenceText(sourceParagraph)
  const normalizedTranslatedParagraph = normalizeContextSentenceText(translatedParagraph)
  const normalizedContextSentence = normalizeContextSentenceText(contextSentence)
  if (!normalizedSourceParagraph || !normalizedTranslatedParagraph || !normalizedContextSentence) {
    return null
  }

  const sourceSentences = splitContextParagraphIntoSentences(normalizedSourceParagraph)
  const sentenceIndex = sourceSentences.findIndex(sentence => sentence === normalizedContextSentence)
  if (sentenceIndex === -1) {
    return normalizedSourceParagraph === normalizedContextSentence
      ? normalizedTranslatedParagraph
      : null
  }

  if (sourceSentences.length === 1) {
    return normalizedTranslatedParagraph
  }

  const translatedSentences = splitContextParagraphIntoSentences(normalizedTranslatedParagraph)
  if (translatedSentences.length === sourceSentences.length && translatedSentences[sentenceIndex]) {
    return translatedSentences[sentenceIndex]
  }

  return null
}

function findTranslatedContextSentenceOnPage(contextSentence: string): string | null {
  const normalizedContextSentence = normalizeContextSentenceText(contextSentence)
  if (!normalizedContextSentence) {
    return null
  }

  const paragraphElements = Array.from(document.querySelectorAll<HTMLElement>(`[${PARAGRAPH_ATTRIBUTE}]`))
  for (const paragraphElement of paragraphElements) {
    const sourceParagraph = getOriginalParagraphText(paragraphElement)
    if (!sourceParagraph || !sourceParagraph.includes(normalizedContextSentence)) {
      continue
    }

    const translatedParagraph = getTranslatedParagraphText(paragraphElement)
    if (!translatedParagraph) {
      continue
    }

    const translatedSentence = resolveTranslatedSentenceFromParagraph(
      sourceParagraph,
      translatedParagraph,
      normalizedContextSentence,
    )
    if (translatedSentence) {
      return translatedSentence
    }
  }

  return null
}

async function persistVocabularyContextSentenceTranslation({
  item,
  contextSentence,
  providerConfig,
  sourceUrl,
  translateRequest,
}: {
  item: VocabularyItem
  contextSentence: string
  providerConfig: ProviderConfig
  sourceUrl: string
  translateRequest: SelectionToolbarTranslateRequestSlice
}) {
  const normalizedContextSentence = normalizeContextSentenceText(contextSentence)
  if (!normalizedContextSentence) {
    return
  }

  const matchingEntry = item.contextEntries?.find(entry => normalizeContextSentenceText(entry.sentence) === normalizedContextSentence)
  if (matchingEntry?.translatedSentence?.trim()) {
    return
  }

  const translatedSentence = findTranslatedContextSentenceOnPage(normalizedContextSentence)
    || await translateWithStandardProvider({
      text: normalizedContextSentence,
      providerConfig,
      translateRequest,
    })

  if (!normalizeContextSentenceText(translatedSentence)) {
    return
  }

  await updateVocabularyItemContextTranslation({
    itemId: item.id,
    contextSentence: normalizedContextSentence,
    translatedSentence,
    sourceUrl,
  })
}

async function saveVocabularyEvidenceFromReuse({
  contextSentence,
  providerConfig,
  selectionText,
  sourceUrl,
  translateRequest,
  translatedText,
  vocabularySettings,
}: {
  contextSentence: string | null
  providerConfig: ProviderConfig
  selectionText: string
  sourceUrl: string
  translateRequest: SelectionToolbarTranslateRequestSlice
  translatedText: string
  vocabularySettings: VocabularySettings
}) {
  const savedItem = await saveTranslatedSelectionToVocabulary({
    sourceText: selectionText,
    translatedText,
    contextSentence: contextSentence ?? undefined,
    sourceUrl,
    sourceLang: translateRequest.language.sourceCode,
    targetLang: translateRequest.language.targetCode,
    settings: vocabularySettings,
  })

  if (savedItem && contextSentence) {
    await persistVocabularyContextSentenceTranslation({
      item: savedItem,
      contextSentence,
      providerConfig,
      sourceUrl,
      translateRequest,
    })
  }
}

function getDictionaryFieldValue(
  result: BackgroundStructuredObjectStreamSnapshot["output"] | null,
  outputSchema: SelectionToolbarCustomActionOutputField[],
  fieldIdSuffix: string,
) {
  if (!result) {
    return ""
  }

  const field = outputSchema.find(item => item.id.endsWith(fieldIdSuffix))
  if (!field) {
    return ""
  }

  const value = result[field.name]
  return typeof value === "string" ? value.trim() : ""
}

function parseWordFamilyGroupValue(
  value: string,
  limit: number,
): VocabularyWordFamilyEntry[] {
  const entries: VocabularyWordFamilyEntry[] = []
  const seenTerms = new Set<string>()

  for (const rawLine of value.split("\n")) {
    const line = rawLine.trim()
    if (!line) {
      continue
    }

    const parts = line.split("||").map(part => part.trim())
    const [term = "", middle = "", ...rest] = parts
    const definition = rest.length > 0
      ? rest.join(" || ").trim()
      : middle
    const partOfSpeech = rest.length > 0 ? middle : ""
    if (!term || !definition) {
      continue
    }

    const normalizedTerm = term.toLowerCase()
    if (seenTerms.has(normalizedTerm)) {
      continue
    }

    seenTerms.add(normalizedTerm)
    entries.push(
      partOfSpeech
        ? { term, partOfSpeech, definition }
        : { term, definition },
    )

    if (entries.length >= limit) {
      break
    }
  }

  return entries
}

function parseWordFamilyFromDictionaryResult(
  result: BackgroundStructuredObjectStreamSnapshot["output"] | null,
  outputSchema: SelectionToolbarCustomActionOutputField[],
): VocabularyWordFamily | null {
  const core = parseWordFamilyGroupValue(
    getDictionaryFieldValue(result, outputSchema, "dictionary-word-family-core"),
    3,
  )
  const contrast = parseWordFamilyGroupValue(
    getDictionaryFieldValue(result, outputSchema, "dictionary-word-family-contrast"),
    2,
  )
  const related = parseWordFamilyGroupValue(
    getDictionaryFieldValue(result, outputSchema, "dictionary-word-family-related"),
    2,
  )

  return core.length > 0 || contrast.length > 0 || related.length > 0
    ? { core, contrast, related }
    : null
}

function extractVocabularyDetailsFromDictionaryResult(
  result: BackgroundStructuredObjectStreamSnapshot["output"] | null,
  outputSchema: SelectionToolbarCustomActionOutputField[],
) {
  const definition = getDictionaryFieldValue(result, outputSchema, "dictionary-definition")
  const difficulty = getDictionaryFieldValue(result, outputSchema, "dictionary-difficulty")
  const lemma = getDictionaryFieldValue(result, outputSchema, "dictionary-term")
  const nuance = getDictionaryFieldValue(result, outputSchema, "dictionary-nuance")
  const partOfSpeech = getDictionaryFieldValue(result, outputSchema, "dictionary-part-of-speech")
  const phonetic = getDictionaryFieldValue(result, outputSchema, "dictionary-phonetic")
  const wordFamily = parseWordFamilyFromDictionaryResult(result, outputSchema)

  if (!definition && !difficulty && !lemma && !nuance && !partOfSpeech && !phonetic && !wordFamily) {
    return null
  }

  return {
    ...(definition ? { definition } : {}),
    ...(difficulty ? { difficulty } : {}),
    ...(lemma ? { lemma } : {}),
    ...(nuance ? { nuance } : {}),
    ...(partOfSpeech ? { partOfSpeech } : {}),
    ...(phonetic ? { phonetic } : {}),
    ...(wordFamily ? { wordFamily } : {}),
  }
}

function buildStoredDetailedExplanationValue(item: VocabularyItem): Record<string, string> | null {
  const value = {
    ...(item.lemma?.trim() ? { term: item.lemma.trim() } : item.sourceText.trim() ? { term: item.sourceText.trim() } : {}),
    ...(item.phonetic?.trim() ? { phonetic: item.phonetic.trim() } : {}),
    ...(item.partOfSpeech?.trim() ? { partOfSpeech: item.partOfSpeech.trim() } : {}),
    ...(item.definition?.trim() ? { definition: item.definition.trim() } : {}),
    ...(item.difficulty?.trim() ? { difficulty: item.difficulty.trim() } : {}),
  }

  return Object.keys(value).length > 0 ? value : null
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
  const [reusedVocabularyItem, setReusedVocabularyItem] = useState<VocabularyItem | null>(null)
  const [savedVocabularyItemId, setSavedVocabularyItemId] = useState<string | null>(null)
  const [savedVocabularyText, setSavedVocabularyText] = useState<string | null>(null)
  const [dictionaryReadyRunKey, setDictionaryReadyRunKey] = useState<string | null>(null)
  const [thinking, setThinking] = useState<ThinkingSnapshot | null>(null)
  const [error, setError] = useState<SelectionToolbarInlineError | null>(null)
  const [isTranslating, setIsTranslating] = useState(false)
  const [translationResumeVersion, setTranslationResumeVersion] = useState(0)
  const [vocabularyReuseState, setVocabularyReuseState] = useState<"idle" | "checking" | "hit" | "miss">("idle")
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
  const lastVocabularyDetailsSyncKeyRef = useRef<string | null>(null)
  const isTranslationInFlightRef = useRef(false)
  const pendingLlmFinalPromiseRef = useRef<{
    promise: Promise<BackgroundTextStreamSnapshot>
    translationRunKey: string | null
  } | null>(null)
  const translationResumeSnapshotRef = useRef<TranslationResumeSnapshot>({
    isTranslating: false,
    thinking: null,
    translatedText: undefined,
    translationRunKey: null,
  })
  const forceRefreshNextRunRef = useRef(false)
  const runIdRef = useRef(0)
  const { resolveContextMenuSelectionRequest } = useSelectionContextMenuRequestResolver(selectionSession)
  const selectionText = activeSession?.selectionSnapshot.text ?? null
  const paragraphsText = activeSession?.contextSnapshot.text ?? selectionText
  const contextSentence = extractSelectionContextSentence(selectionText, activeSession?.contextSnapshot)
  const titleText = document.title || null
  const cleanedSelectionText = useMemo(
    () => prepareTranslationText(selectionText),
    [selectionText],
  )
  const shouldRenderDictionaryResult = useMemo(
    () => shouldUseBuiltInDictionary(cleanedSelectionText),
    [cleanedSelectionText],
  )
  const llmProviders = useMemo(
    () => filterEnabledProvidersConfig(providersConfig).filter(isLLMProviderConfig),
    [providersConfig],
  )
  const translateRequestKey = useMemo(
    () => JSON.stringify(translateRequest),
    [translateRequest],
  )
  const activeTranslationRunKey = useMemo(() => {
    if (!activeSession) {
      return null
    }

    return createTranslationRunKey({
      popoverSessionKey,
      rerunNonce,
      sessionId: activeSession?.id ?? null,
      translateRequestKey,
    })
  }, [activeSession, popoverSessionKey, rerunNonce, translateRequestKey])
  const dictionaryProviderId = useMemo(() => {
    const configuredProviderId = selectionToolbarConfig.customActions
      .find(action => action.id === DEFAULT_DICTIONARY_ACTION_ID)
      ?.providerId

    if (configuredProviderId) {
      const configuredProvider = getProviderConfigById(providersConfig, configuredProviderId)
      if (configuredProvider && isLLMProviderConfig(configuredProvider) && configuredProvider.enabled) {
        return configuredProvider.id
      }
    }

    return llmProviders[0]?.id ?? null
  }, [llmProviders, providersConfig, selectionToolbarConfig.customActions])
  const builtInDictionaryOutputSchema = useMemo(
    () => createBuiltInDictionaryOutputSchema(),
    [],
  )
  const dictionaryAction = useMemo(
    () => shouldRenderDictionaryResult && dictionaryProviderId
      ? createBuiltInDictionaryAction(dictionaryProviderId)
      : null,
    [dictionaryProviderId, shouldRenderDictionaryResult],
  )
  const shouldRunDictionaryAction = vocabularyReuseState === "miss"
    && activeTranslationRunKey != null
    && dictionaryReadyRunKey === activeTranslationRunKey
  const dictionaryActionExecution = shouldRunDictionaryAction ? dictionaryAction : null
  const dictionaryProviderConfig = useMemo(
    () => dictionaryProviderId ? getProviderConfigById(providersConfig, dictionaryProviderId) ?? null : null,
    [dictionaryProviderId, providersConfig],
  )
  const dictionaryWebPageContext = useCustomActionWebPageContext(
    isOpen && Boolean(dictionaryActionExecution),
    popoverSessionKey,
  )
  const dictionaryExecutionPlan = useMemo(
    () => buildCustomActionExecutionPlan(
      {
        language: translateRequest.language,
        action: dictionaryActionExecution,
        providerConfig: dictionaryProviderConfig,
      },
      cleanedSelectionText,
      paragraphsText || cleanedSelectionText,
      dictionaryWebPageContext,
    ),
    [
      cleanedSelectionText,
      dictionaryActionExecution,
      dictionaryProviderConfig,
      dictionaryWebPageContext,
      paragraphsText,
      translateRequest.language,
    ],
  )
  const {
    isRunning: isDetailedExplanationRunning,
    resetSessionState: resetDetailedExplanationState,
    result: detailedExplanationResult,
    thinking: detailedExplanationThinking,
  } = useCustomActionExecution({
    analyticsSurface: sourceSurface,
    bodyRef,
    executionContext: dictionaryExecutionPlan.executionContext,
    open: isOpen && Boolean(dictionaryActionExecution),
    popoverSessionKey,
    rerunNonce,
  })

  const resetPopoverSession = useCallback((options?: { clearAnchor?: boolean }) => {
    setActiveSession(null)
    if (options?.clearAnchor) {
      setAnchor(null)
    }
  }, [])

  const resetDetailedExplanation = useCallback(() => {
    resetDetailedExplanationState()
  }, [resetDetailedExplanationState])

  const resetTranslationState = useCallback(() => {
    setIsTranslating(false)
    setReusedVocabularyItem(null)
    setSavedVocabularyItemId(null)
    setTranslatedText(undefined)
    setSavedVocabularyText(null)
    setDictionaryReadyRunKey(null)
    setThinking(null)
    setError(null)
    setVocabularyReuseState("idle")
    translationResumeSnapshotRef.current = {
      isTranslating: false,
      thinking: null,
      translatedText: undefined,
      translationRunKey: null,
    }
    setTranslationResumeVersion(prev => prev + 1)
    lastVocabularyDetailsSyncKeyRef.current = null
    resetDetailedExplanation()
  }, [resetDetailedExplanation])

  const updateTranslationResumeSnapshot = useCallback((snapshot: TranslationResumeSnapshot) => {
    translationResumeSnapshotRef.current = snapshot
    setTranslationResumeVersion(prev => prev + 1)
  }, [])

  const cancelCurrentTranslation = useCallback((runId?: number) => {
    if (runId !== undefined && runIdRef.current !== runId) {
      return
    }

    isTranslationInFlightRef.current = false
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
    forceRefreshNextRunRef.current = true
    cancelCurrentTranslation()
    resetDetailedExplanation()
    setReusedVocabularyItem(null)
    setVocabularyReuseState("miss")
    setRerunNonce(prev => prev + 1)
  }, [cancelCurrentTranslation, resetDetailedExplanation])

  const runTranslation = useCallback(async (runId: number, options?: { forceRefresh?: boolean, translationRunKey: string }) => {
    const preparedText = prepareTranslationText(selectionText)
    const forceRefresh = options?.forceRefresh === true
    const currentTranslationRunKey = options?.translationRunKey ?? null
    const isActiveRun = () => {
      if (currentTranslationRunKey) {
        return lastTranslationRunKeyRef.current === currentTranslationRunKey
      }

      return runIdRef.current === runId
    }

    if (preparedText === "") {
      if (isActiveRun()) {
        resetTranslationState()
      }
      return
    }

    const analyticsContext = createFeatureUsageContext(
      ANALYTICS_FEATURE.SELECTION_TRANSLATION,
      sourceSurface,
    )
    const providerConfig = translateRequest.providerConfig

    isTranslationInFlightRef.current = true
    updateTranslationResumeSnapshot({
      isTranslating: true,
      thinking: null,
      translatedText: undefined,
      translationRunKey: currentTranslationRunKey,
    })
    setIsTranslating(true)
    setReusedVocabularyItem(null)
    setTranslatedText(undefined)
    setThinking(null)
    setError(null)
    setDictionaryReadyRunKey(null)
    setVocabularyReuseState(forceRefresh ? "miss" : "checking")

    if (!forceRefresh && selectionText) {
      try {
        const reusableItem = await findVocabularyItemForSelection({
          sourceText: selectionText,
          sourceLang: translateRequest.language.sourceCode,
          targetLang: translateRequest.language.targetCode,
        })

        if (!isActiveRun()) {
          return
        }

        if (reusableItem) {
          const nextReusableItem = reusableItem.masteredAt == null
            ? reusableItem
            : {
                ...reusableItem,
                masteredAt: null,
              }

          if (reusableItem.masteredAt != null) {
            void Promise.resolve(setVocabularyItemMastered(reusableItem.id, false)).catch(() => {})
          }

          setReusedVocabularyItem(nextReusableItem)
          setSavedVocabularyItemId(reusableItem.id)
          setSavedVocabularyText(reusableItem.sourceText)
          setTranslatedText(nextReusableItem.translatedText)
          setThinking(null)
          setError(null)
          setVocabularyReuseState("hit")
          setIsTranslating(false)
          isTranslationInFlightRef.current = false
          updateTranslationResumeSnapshot({
            isTranslating: false,
            thinking: null,
            translatedText: nextReusableItem.translatedText,
            translationRunKey: currentTranslationRunKey,
          })

          void trackFeatureUsed({
            ...analyticsContext,
            outcome: "success",
          })
          if (providerConfig && isTranslateProviderConfig(providerConfig) && providerConfig.enabled) {
            void saveVocabularyEvidenceFromReuse({
              contextSentence,
              providerConfig,
              selectionText,
              sourceUrl: window.location.href,
              translateRequest,
              translatedText: nextReusableItem.translatedText,
              vocabularySettings,
            }).catch(() => {})
          }
          return
        }
      }
      catch {
        if (!isActiveRun()) {
          return
        }
      }
    }

    if (isActiveRun()) {
      setDictionaryReadyRunKey(currentTranslationRunKey)
      setVocabularyReuseState("miss")
    }

    if (!providerConfig || !isTranslateProviderConfig(providerConfig)) {
      if (isActiveRun()) {
        setIsTranslating(false)
        setError(createSelectionToolbarPrecheckError("translate", "providerUnavailable"))
      }
      isTranslationInFlightRef.current = false
      updateTranslationResumeSnapshot({
        isTranslating: false,
        thinking: null,
        translatedText: undefined,
        translationRunKey: currentTranslationRunKey,
      })
      void trackFeatureUsed({
        ...analyticsContext,
        outcome: "failure",
      })
      return
    }

    if (!providerConfig.enabled) {
      if (isActiveRun()) {
        setIsTranslating(false)
        setError(createSelectionToolbarPrecheckError("translate", "providerDisabled"))
      }
      isTranslationInFlightRef.current = false
      updateTranslationResumeSnapshot({
        isTranslating: false,
        thinking: null,
        translatedText: undefined,
        translationRunKey: currentTranslationRunKey,
      })
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
          onFinalSnapshot: (data) => {
            updateTranslationResumeSnapshot({
              isTranslating: false,
              thinking: data.thinking,
              translatedText: data.output,
              translationRunKey: currentTranslationRunKey,
            })

            if (lastTranslationRunKeyRef.current === currentTranslationRunKey) {
              setTranslatedText(data.output)
              setThinking(data.thinking)
              setIsTranslating(false)
            }
          },
          registerFinalPromise: (promise) => {
            pendingLlmFinalPromiseRef.current = {
              promise,
              translationRunKey: currentTranslationRunKey,
            }
          },
          preparedText,
          providerConfig,
          translateRequest,
          onChunk: (data) => {
            updateTranslationResumeSnapshot({
              isTranslating: true,
              thinking: data.thinking,
              translatedText: data.output,
              translationRunKey: currentTranslationRunKey,
            })
            if (isActiveRun()) {
              setTranslatedText(data.output)
              setThinking(data.thinking)
            }
          },
          registerAbortController: (abortController) => {
            abortControllerRef.current = abortController
          },
        })

        nextTranslatedText = nextSnapshot.output
        if (isActiveRun()) {
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

      if (isActiveRun()) {
        updateTranslationResumeSnapshot({
          isTranslating: true,
          thinking: translationResumeSnapshotRef.current.thinking,
          translatedText: nextTranslatedText,
          translationRunKey: currentTranslationRunKey,
        })
        setTranslatedText(nextTranslatedText)
      }

      if (selectionText && nextTranslatedText && isActiveRun()) {
        let savedItem: VocabularyItem | null = null
        try {
          savedItem = await saveTranslatedSelectionToVocabulary({
            sourceText: selectionText,
            translatedText: nextTranslatedText,
            contextSentence: contextSentence ?? undefined,
            sourceUrl: window.location.href,
            sourceLang: translateRequest.language.sourceCode,
            targetLang: translateRequest.language.targetCode,
            settings: vocabularySettings,
          })

          if (isActiveRun()) {
            setSavedVocabularyItemId(savedItem?.id ?? null)
            setSavedVocabularyText(savedItem?.sourceText ?? null)
          }
        }
        catch {
          if (isActiveRun()) {
            setSavedVocabularyItemId(null)
            setSavedVocabularyText(null)
          }
        }

        if (savedItem && contextSentence) {
          void persistVocabularyContextSentenceTranslation({
            item: savedItem,
            contextSentence,
            providerConfig,
            sourceUrl: window.location.href,
            translateRequest,
          }).catch(() => {})
        }
      }

      void trackFeatureUsed({
        ...analyticsContext,
        outcome: "success",
      })
    }
    catch (error) {
      if (!isAbortError(error) && isActiveRun()) {
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
      if (isActiveRun()) {
        isTranslationInFlightRef.current = false
        abortControllerRef.current = null
        setIsTranslating(false)
        updateTranslationResumeSnapshot({
          ...translationResumeSnapshotRef.current,
          isTranslating: false,
          translationRunKey: currentTranslationRunKey,
        })
      }
    }
  }, [contextSentence, resetTranslationState, selectionText, sourceSurface, translateRequest, updateTranslationResumeSnapshot, vocabularySettings])

  const startTranslation = useEffectEvent((runId: number, options?: { forceRefresh?: boolean, translationRunKey: string }) => {
    void runTranslation(runId, options)
  })

  useEffect(() => {
    if (!isOpen) {
      return
    }

    const nextRunKey = activeTranslationRunKey
    if (!nextRunKey) {
      return
    }
    if (lastTranslationRunKeyRef.current === nextRunKey) {
      return
    }

    cancelCurrentTranslation()
    lastTranslationRunKeyRef.current = nextRunKey

    const runId = runIdRef.current + 1
    runIdRef.current = runId
    const forceRefresh = forceRefreshNextRunRef.current
    forceRefreshNextRunRef.current = false

    resetDetailedExplanation()
    startTranslation(runId, {
      forceRefresh,
      translationRunKey: nextRunKey,
    })
  }, [activeTranslationRunKey, cancelCurrentTranslation, isOpen, resetDetailedExplanation])

  useEffect(() => {
    if (!isOpen) {
      return
    }

    const resumeSnapshot = translationResumeSnapshotRef.current
    if (resumeSnapshot.translationRunKey !== lastTranslationRunKeyRef.current) {
      return
    }

    setIsTranslating(resumeSnapshot.isTranslating)
    setThinking(resumeSnapshot.thinking)
    setTranslatedText(resumeSnapshot.translatedText)
  }, [isOpen, translationResumeVersion])

  const handleOpenChange = useCallback((nextOpen: boolean) => {
    if (nextOpen) {
      const pendingRequest = pendingOpenRequestRef.current
      const nextSession = pendingRequest?.session ?? selectionSession ?? activeSession
      const hasResumableTranslationState = isTranslationInFlightRef.current
        || translationResumeSnapshotRef.current.translationRunKey === lastTranslationRunKeyRef.current
        || translatedText !== undefined
        || reusedVocabularyItem != null
        || error != null

      const shouldResumeExistingSession = Boolean(
        pendingRequest
        && nextSession
        && activeSession
        && isSameSelectionSession(nextSession, activeSession)
        && hasResumableTranslationState,
      )

      if (shouldResumeExistingSession) {
        const resumeSnapshot = translationResumeSnapshotRef.current
        const resumeRunKey = resumeSnapshot.translationRunKey
        if (resumeRunKey) {
          lastTranslationRunKeyRef.current = resumeRunKey
        }
        setSourceSurface(pendingRequest?.surface ?? ANALYTICS_SURFACE.SELECTION_TOOLBAR)
        if (pendingRequest?.anchor) {
          setAnchor(pendingRequest.anchor)
        }
        setIsTranslating(resumeSnapshot.isTranslating)
        setThinking(resumeSnapshot.thinking)
        setTranslatedText(resumeSnapshot.translatedText)
        if (resumeRunKey && pendingLlmFinalPromiseRef.current?.translationRunKey === resumeRunKey) {
          const pendingPromise = pendingLlmFinalPromiseRef.current.promise
          void pendingPromise.then((data) => {
            if (lastTranslationRunKeyRef.current !== resumeRunKey) {
              return
            }

            updateTranslationResumeSnapshot({
              isTranslating: false,
              thinking: data.thinking,
              translatedText: data.output,
              translationRunKey: resumeRunKey,
            })
            setTranslatedText(data.output)
            setThinking(data.thinking)
            setIsTranslating(false)
          }).catch(() => {})
        }
        setIsSelectionToolbarVisible(false)
        pendingOpenRequestRef.current = null
        setIsOpen(true)
        return
      }

      cancelCurrentTranslation()
      resetTranslationState()

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
      const hasInFlightTranslation = isTranslationInFlightRef.current
        || Boolean(abortControllerRef.current)
        || isTranslating
        || vocabularyReuseState === "checking"

      if (!hasInFlightTranslation) {
        cancelCurrentTranslation()
        resetTranslationState()
        resetPopoverSession({
          clearAnchor: pendingOpenRequestRef.current === null,
        })
        lastTranslationRunKeyRef.current = null
      }
      else if (pendingOpenRequestRef.current === null) {
        setAnchor(null)
      }
    }

    setIsOpen(nextOpen)
  }, [
    activeSession,
    cancelCurrentTranslation,
    error,
    isTranslating,
    resetPopoverSession,
    resetTranslationState,
    reusedVocabularyItem,
    selectionSession,
    setIsSelectionToolbarVisible,
    translatedText,
    vocabularyReuseState,
  ])

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
      cancelCurrentTranslation()
      if (reopenFrameRef.current !== null) {
        cancelAnimationFrame(reopenFrameRef.current)
      }
    }
  }, [cancelCurrentTranslation])

  const detailedExplanationLoading = Boolean(dictionaryAction)
    && (
      shouldRunDictionaryAction
      && (
        (dictionaryExecutionPlan.executionContext ? isDetailedExplanationRunning : false)
        || dictionaryWebPageContext === undefined
      )
    )
  const detailedExplanationValue = reusedVocabularyItem
    ? buildStoredDetailedExplanationValue(reusedVocabularyItem)
    : (dictionaryExecutionPlan.executionContext ? detailedExplanationResult : null)
  const detailedExplanationThinkingValue = reusedVocabularyItem
    ? null
    : (dictionaryExecutionPlan.executionContext ? detailedExplanationThinking : null)
  const headerStatus = useMemo(() => {
    const isLoading = isTranslating || detailedExplanationLoading
    const isFailed = Boolean(error)
    const isReady = !isLoading && !isFailed && Boolean(translatedText?.trim() || detailedExplanationValue)

    if (isLoading) {
      return (
        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
          <IconLoader2 className="size-3 animate-spin" strokeWidth={1.8} />
          <span>{i18n.t("translation.loadingStatus.translating")}</span>
        </span>
      )
    }

    if (isFailed) {
      return (
        <span className="inline-flex items-center gap-1 text-xs text-destructive">
          <IconAlertCircle className="size-3" strokeWidth={1.8} />
          <span>{i18n.t("translation.loadingStatus.failed")}</span>
        </span>
      )
    }

    if (isReady) {
      return (
        <span className="inline-flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
          <IconCheck className="size-3" strokeWidth={2} />
          <span>{i18n.t("translation.loadingStatus.ready")}</span>
        </span>
      )
    }

    return null
  }, [detailedExplanationLoading, detailedExplanationValue, error, isTranslating, translatedText])

  useEffect(() => {
    if (!savedVocabularyItemId || !dictionaryAction || detailedExplanationLoading || reusedVocabularyItem) {
      return
    }

    const details = extractVocabularyDetailsFromDictionaryResult(
      detailedExplanationValue,
      dictionaryAction.outputSchema,
    )
    if (!details) {
      return
    }

    const syncKey = JSON.stringify({
      itemId: savedVocabularyItemId,
      ...details,
    })
    if (lastVocabularyDetailsSyncKeyRef.current === syncKey) {
      return
    }
    lastVocabularyDetailsSyncKeyRef.current = syncKey

    void Promise.resolve(updateVocabularyItemDetails(savedVocabularyItemId, details)).catch(() => {})
  }, [dictionaryAction, detailedExplanationLoading, detailedExplanationValue, reusedVocabularyItem, savedVocabularyItemId])

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
              meta={headerStatus}
            />
            <div className="flex items-center gap-1">
              <SelectionPopover.Pin />
              <SelectionPopover.Close />
            </div>
          </SelectionPopover.Header>

          <SelectionPopover.Body ref={bodyRef}>
            <TranslationContent
              detailedExplanation={dictionaryAction
                ? {
                    isLoading: detailedExplanationLoading,
                    outputSchema: dictionaryAction.outputSchema,
                    result: detailedExplanationValue,
                    thinking: detailedExplanationThinkingValue,
                  }
                : detailedExplanationValue
                  ? {
                      isLoading: false,
                      outputSchema: builtInDictionaryOutputSchema,
                      result: detailedExplanationValue,
                      thinking: null,
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
