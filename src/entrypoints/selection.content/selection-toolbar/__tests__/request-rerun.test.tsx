import type { ReactElement } from "react"
import type {
  BackgroundStructuredObjectStreamSnapshot,
  BackgroundTextStreamSnapshot,
} from "@/types/background-stream"
import type { Config } from "@/types/config/config"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { createStore, Provider } from "jotai"
// @vitest-environment jsdom
import { useRef } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { TooltipProvider } from "@/components/ui/base-ui/tooltip"
import { isLLMProviderConfig } from "@/types/config/provider"
import { configAtom, configFieldsAtomMap } from "@/utils/atoms/config"
import { createBuiltInDictionaryAction } from "@/utils/constants/built-in-dictionary-action"
import { DEFAULT_CONFIG } from "@/utils/constants/config"
import { MANAGED_CLOUD_PROVIDER_ID } from "@/utils/constants/platform"
import { DEFAULT_PROVIDER_CONFIG } from "@/utils/constants/providers"
import {
  buildContextSnapshot,
  createRangeSnapshot,
  normalizeSelectedText,
} from "../../utils"
import { setSelectionStateAtom } from "../atoms"
import { SelectionToolbarCustomActionButtons } from "../custom-action-button"
import {
  SelectionCustomActionProvider,
  useSelectionCustomActionPopover,
} from "../custom-action-button/provider"
import { SelectionExplainProvider } from "../explain-button/provider"
import { SelectionToolbar } from "../index"
import { TranslateButton } from "../translate-button"
import { SelectionTranslationProvider } from "../translate-button/provider"

const streamManagedTranslationMock = vi.fn()
const streamBackgroundTextMock = vi.fn()
const streamBackgroundStructuredObjectMock = vi.fn()
const translateTextCoreMock = vi.fn()
const getOrCreateWebPageContextMock = vi.fn().mockResolvedValue(null)
const getOrGenerateWebPageSummaryMock = vi.fn()
const findVocabularyItemForSelectionMock = vi.fn()
const saveTranslatedSelectionToVocabularyMock = vi.fn().mockResolvedValue(null)
const setVocabularyItemMasteredMock = vi.fn().mockResolvedValue(null)
const updateVocabularyItemDetailsMock = vi.fn().mockResolvedValue(null)
const toastErrorMock = vi.fn()
const onMessageMock = vi.fn()
const storageAdapterGetMock = vi.fn()
const storageAdapterSetMock = vi.fn()
const storageAdapterSetMetaMock = vi.fn()
const storageAdapterWatchMock = vi.fn()
const originalGetSelection = window.getSelection

vi.mock("@/components/ui/selection-popover", async () => {
  const React = await import("react")

  interface PopoverContextValue {
    open: boolean
    onOpenChange?: (open: boolean) => void
  }

  const PopoverContext = React.createContext<PopoverContextValue | null>(null)

  function usePopoverContext() {
    const context = React.use(PopoverContext)
    if (!context) {
      throw new Error("SelectionPopover components must be used within SelectionPopover.Root.")
    }
    return context
  }

  function Root({
    children,
    open,
    onOpenChange,
  }: {
    children: React.ReactNode
    open: boolean
    onOpenChange?: (open: boolean) => void
  }) {
    return (
      <PopoverContext value={{ open, onOpenChange }}>
        {children}
      </PopoverContext>
    )
  }

  function Trigger({
    children,
    onClick,
    ...props
  }: React.ComponentProps<"button"> & {
    children: React.ReactNode
  }) {
    const { onOpenChange } = usePopoverContext()
    return (
      <button
        {...props}
        type="button"
        onClick={(event) => {
          onClick?.(event)
          onOpenChange?.(true)
        }}
      >
        {children}
      </button>
    )
  }

  function Content({
    children,
    finalFocus,
  }: {
    children: React.ReactNode
    finalFocus?: boolean
  }) {
    const { open } = usePopoverContext()
    return open
      ? (
          <div
            data-testid="selection-popover-content"
            data-final-focus={finalFocus === false ? "false" : undefined}
            data-rf-selection-overlay-root=""
          >
            {children}
          </div>
        )
      : null
  }

  function Body({
    children,
    ref,
    ...props
  }: React.ComponentProps<"div"> & { ref?: React.Ref<HTMLDivElement> }) {
    return (
      <div ref={ref} {...props}>
        {children}
      </div>
    )
  }

  function Close() {
    const { onOpenChange } = usePopoverContext()
    return (
      <button type="button" aria-label="Close" onClick={() => onOpenChange?.(false)}>
        Close
      </button>
    )
  }

  function Pin() {
    return <button type="button">Pin</button>
  }

  function Footer({ children }: { children: React.ReactNode }) {
    return <div>{children}</div>
  }

  return {
    SelectionPopover: {
      Root,
      Trigger,
      Content,
      Header: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
      Body,
      Footer,
      Pin,
      Close,
    },
    useSelectionPopoverOverlayProps: () => ({
      container: undefined,
      positionerClassName: undefined,
    }),
  }
})

vi.mock("../../components/selection-toolbar-title-content", () => ({
  SelectionToolbarTitleContent: ({ title, meta }: { title: string, meta?: React.ReactNode }) => (
    <div>
      <span>{title}</span>
      <span data-testid="translation-header-status">{meta}</span>
    </div>
  ),
}))

vi.mock("../../components/selection-toolbar-footer-content", () => ({
  SelectionToolbarFooterContent: ({
    children,
    paragraphsText,
    onRegenerate,
    titleText,
  }: {
    children?: React.ReactNode
    paragraphsText: string | null | undefined
    onRegenerate: () => void
    titleText: string | null | undefined
  }) => {
    return (
      <div>
        <span data-testid="footer-title">{titleText}</span>
        <span data-testid="footer-paragraphs">{paragraphsText}</span>
        {children}
        <button type="button" aria-label="Regenerate" onClick={onRegenerate}>
          Regenerate
        </button>
      </div>
    )
  },
}))

vi.mock("../translate-button/translation-content", () => ({
  TranslationContent: ({
    detailedExplanation,
    selectionContent,
    translatedText,
    isTranslating,
  }: {
    detailedExplanation?: {
      result: Record<string, unknown> | null
    } | null
    selectionContent: string | null | undefined
    translatedText: string | undefined
    isTranslating: boolean
  }) => (
    <div data-testid="translation-content">
      <span data-testid="translation-selection">{selectionContent}</span>
      <span data-testid="translation-result">{translatedText ?? ""}</span>
      <span data-testid="translation-status">{String(isTranslating)}</span>
      <span data-testid="translation-detailed">{JSON.stringify(detailedExplanation?.result ?? null)}</span>
      <span data-testid="translation-detailed-error"></span>
    </div>
  ),
}))

vi.mock("../custom-action-button/structured-object-renderer", () => ({
  StructuredObjectRenderer: ({ value }: { value: Record<string, unknown> | null }) => (
    <pre>{JSON.stringify(value)}</pre>
  ),
}))

vi.mock("@/utils/content-script/background-stream-client", () => ({
  streamBackgroundText: (...args: unknown[]) => streamBackgroundTextMock(...args),
  streamBackgroundStructuredObject: (...args: unknown[]) => streamBackgroundStructuredObjectMock(...args),
}))

vi.mock("@/utils/platform/api", async () => {
  const actual = await vi.importActual<typeof import("@/utils/platform/api")>("@/utils/platform/api")
  return {
    ...actual,
    streamManagedTranslation: (...args: unknown[]) => streamManagedTranslationMock(...args),
  }
})

vi.mock("@/utils/host/translate/translate-text", () => ({
  translateTextCore: (...args: unknown[]) => translateTextCoreMock(...args),
}))

vi.mock("@/utils/host/translate/webpage-context", () => ({
  getOrCreateWebPageContext: (...args: unknown[]) => getOrCreateWebPageContextMock(...args),
}))

vi.mock("@/utils/host/translate/webpage-summary", () => ({
  getOrGenerateWebPageSummary: (...args: unknown[]) => getOrGenerateWebPageSummaryMock(...args),
}))

vi.mock("sonner", () => ({
  toast: {
    error: (...args: unknown[]) => toastErrorMock(...args),
    success: vi.fn(),
  },
}))

vi.mock("@/utils/logger", () => ({
  logger: {
    info: vi.fn(),
    log: vi.fn(),
    error: vi.fn(),
  },
}))

vi.mock("@/utils/message", () => ({
  onMessage: (...args: unknown[]) => onMessageMock(...args),
  sendMessage: vi.fn(),
}))

vi.mock("@/utils/vocabulary/service", () => ({
  findVocabularyItemForSelection: (...args: unknown[]) => findVocabularyItemForSelectionMock(...args),
  saveTranslatedSelectionToVocabulary: (...args: unknown[]) => saveTranslatedSelectionToVocabularyMock(...args),
  setVocabularyItemMastered: (...args: unknown[]) => setVocabularyItemMasteredMock(...args),
  updateVocabularyItemDetails: (...args: unknown[]) => updateVocabularyItemDetailsMock(...args),
}))

vi.mock("@/utils/atoms/storage-adapter", () => ({
  storageAdapter: {
    get: (...args: unknown[]) => storageAdapterGetMock(...args),
    set: (...args: unknown[]) => storageAdapterSetMock(...args),
    setMeta: (...args: unknown[]) => storageAdapterSetMetaMock(...args),
    watch: (...args: unknown[]) => storageAdapterWatchMock(...args),
  },
}))

function cloneConfig(config: Config): Config {
  return JSON.parse(JSON.stringify(config)) as Config
}

function createDefaultCustomActionConfig() {
  const config = cloneConfig(DEFAULT_CONFIG)
  const defaultAction = createBuiltInDictionaryAction(MANAGED_CLOUD_PROVIDER_ID)
  config.selectionToolbar.customActions = [defaultAction]

  return {
    action: defaultAction,
    config,
  }
}

function createVisibleCustomActionConfig() {
  const { action: defaultAction, config } = createDefaultCustomActionConfig()

  const visibleAction = {
    ...defaultAction,
    id: "visible-custom-action",
    name: "Visible Custom Action",
  }

  config.selectionToolbar.customActions = [visibleAction]
  return {
    action: visibleAction,
    config,
  }
}

function createRangeFor(node: Node) {
  const range = document.createRange()
  range.selectNodeContents(node)
  return range
}

function createRangeAcrossNodes(
  startNode: Text,
  endNode: Text,
) {
  const range = document.createRange()
  range.setStart(startNode, 0)
  range.setEnd(endNode, endNode.textContent?.length ?? 0)
  return range
}

type TestStore = ReturnType<typeof createStore>
let currentConfigStore: TestStore | null = null

function setSelectionState(
  store: TestStore,
  {
    range,
    text,
  }: {
    range?: Range | null
    text?: string | null
  },
) {
  if (text === undefined && !range) {
    store.set(setSelectionStateAtom, { selection: null, context: null })
    return
  }

  const normalizedText = text !== undefined
    ? normalizeSelectedText(text)
    : normalizeSelectedText(range?.toString())
  const selection = {
    text: normalizedText,
    ranges: range ? [createRangeSnapshot(range)] : [],
  }

  store.set(setSelectionStateAtom, {
    selection,
    context: selection.ranges.length > 0 && selection.text !== ""
      ? buildContextSnapshot(selection)
      : null,
  })
}

function createDeferredPromise<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void

  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })

  return { promise, resolve, reject }
}

function mockWindowSelection(range: Range | null) {
  window.getSelection = vi.fn(() => {
    if (!range) {
      return null
    }

    return {
      anchorNode: range.startContainer,
      focusNode: range.endContainer,
      rangeCount: 1,
      toString: () => range.toString(),
      getRangeAt: () => range,
      containsNode: vi.fn(() => false),
    } as unknown as Selection
  }) as unknown as typeof window.getSelection
}

function getRegisteredMessageHandler<T>(name: string) {
  const registration = onMessageMock.mock.calls.find(call => call[0] === name)
  if (!registration) {
    throw new Error(`Message handler not registered: ${name}`)
  }

  return registration[1] as (message: { data: T }) => void
}

function createStructuredObjectSnapshot(output: Record<string, unknown>): BackgroundStructuredObjectStreamSnapshot {
  return {
    output,
    thinking: {
      status: "complete",
      text: "",
    },
  }
}

function findAlternateLLMProviderId(config: Config, currentProviderId: string) {
  return config.providersConfig.find(provider =>
    provider.id !== currentProviderId && isLLMProviderConfig(provider),
  )?.id
}

function setSelectionToolbarTranslateProvider(config: Config, providerId: string) {
  config.selectionToolbar.features.translate.providerId = providerId
}

function addAlternateManagedProvider(config: Config) {
  const baseProvider = config.providersConfig.find(provider => provider.id === MANAGED_CLOUD_PROVIDER_ID)
  if (!baseProvider) {
    throw new Error("Managed cloud provider is missing from config")
  }

  config.providersConfig = [
    baseProvider,
    {
      ...baseProvider,
      id: "managed-cloud-backup",
      name: `${baseProvider.name} Backup`,
    },
  ]
}

function createStandardTranslateConfig(includeAlternateProvider = false): Config {
  const config = cloneConfig(DEFAULT_CONFIG)
  const primaryProvider = DEFAULT_PROVIDER_CONFIG["microsoft-translate"]
  const alternateProvider = DEFAULT_PROVIDER_CONFIG["google-translate"]

  config.providersConfig = includeAlternateProvider
    ? [primaryProvider, alternateProvider, ...config.providersConfig]
    : [primaryProvider, ...config.providersConfig]
  config.translate.providerId = primaryProvider.id
  config.selectionToolbar.features.translate.providerId = primaryProvider.id

  return config
}

function renderWithProviders(ui: ReactElement, store = createStore()) {
  currentConfigStore = store
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  })

  const view = render(
    <QueryClientProvider client={queryClient}>
      <Provider store={store}>
        <TooltipProvider>
          <SelectionTranslationProvider>
            <SelectionExplainProvider>
              <SelectionCustomActionProvider>
                {ui}
              </SelectionCustomActionProvider>
            </SelectionExplainProvider>
          </SelectionTranslationProvider>
        </TooltipProvider>
      </Provider>
    </QueryClientProvider>,
  )

  return {
    ...view,
    queryClient,
    store,
  }
}

function ToolbarCustomActionTestTrigger({
  actionId,
  label,
}: {
  actionId: string
  label: string
}) {
  const { openToolbarCustomAction } = useSelectionCustomActionPopover()
  const triggerRef = useRef<HTMLButtonElement>(null)

  return (
    <button
      ref={triggerRef}
      type="button"
      onClick={() => openToolbarCustomAction(actionId, triggerRef.current)}
    >
      {label}
    </button>
  )
}

async function openTooltip(trigger: HTMLElement) {
  fireEvent.mouseEnter(trigger)
  fireEvent.focus(trigger)

  await waitFor(() => {
    expect(document.querySelector("[data-slot='tooltip-content']")).toBeTruthy()
  })
}

describe("selection toolbar requests", () => {
  beforeEach(() => {
    getOrCreateWebPageContextMock.mockResolvedValue(null)
    getOrGenerateWebPageSummaryMock.mockResolvedValue(undefined)
    storageAdapterGetMock.mockImplementation(async (_key: string, fallback: Config) => currentConfigStore?.get(configAtom) ?? fallback)
    storageAdapterSetMock.mockResolvedValue(undefined)
    storageAdapterSetMetaMock.mockResolvedValue(undefined)
    storageAdapterWatchMock.mockImplementation(() => () => {})
  })

  afterEach(() => {
    cleanup()
    document.body.innerHTML = ""
    currentConfigStore = null
    window.getSelection = originalGetSelection
    vi.resetAllMocks()
  })

  it("does not rerun translation on passive config refresh, but reruns when request values change", async () => {
    translateTextCoreMock.mockResolvedValue("translated once")
    getOrCreateWebPageContextMock.mockResolvedValue(null)

    const store = createStore()
    const initialConfig = createStandardTranslateConfig(true)
    store.set(configAtom, initialConfig)
    setSelectionState(store, { text: "Selected text" })
    const view = renderWithProviders(<TranslateButton />, store)

    fireEvent.click(screen.getByRole("button", { name: "action.translation" }))

    await waitFor(() => {
      expect(translateTextCoreMock).toHaveBeenCalledTimes(1)
    })

    const refreshedConfig = cloneConfig(store.get(configAtom))
    act(() => {
      store.set(configAtom, refreshedConfig)
    })
    view.rerender(
      <QueryClientProvider client={view.queryClient}>
        <Provider store={store}>
          <TooltipProvider>
            <SelectionTranslationProvider>
              <SelectionCustomActionProvider>
                <TranslateButton />
              </SelectionCustomActionProvider>
            </SelectionTranslationProvider>
          </TooltipProvider>
        </Provider>
      </QueryClientProvider>,
    )

    await act(async () => {
      await Promise.resolve()
    })

    expect(translateTextCoreMock).toHaveBeenCalledTimes(1)

    const updatedConfig = cloneConfig(store.get(configAtom))
    const nextProviderId = DEFAULT_PROVIDER_CONFIG["google-translate"].id
    updatedConfig.selectionToolbar.features.translate.providerId = nextProviderId

    act(() => {
      store.set(configAtom, updatedConfig)
    })

    await waitFor(() => {
      expect(translateTextCoreMock).toHaveBeenCalledTimes(2)
    })

    expect(translateTextCoreMock.mock.calls[1]?.[0]).toMatchObject({
      providerConfig: expect.objectContaining({
        id: nextProviderId,
      }),
    })

    await waitFor(() => {
      expect(screen.getByTestId("translation-status").textContent).toBe("false")
    })
  })

  it("renders the translation tooltip as non-interactive and closes it on hover leave", async () => {
    translateTextCoreMock.mockResolvedValue("translated once")
    getOrCreateWebPageContextMock.mockResolvedValue(null)

    const store = createStore()
    store.set(configAtom, createStandardTranslateConfig())
    setSelectionState(store, { text: "Selected text" })
    renderWithProviders(<TranslateButton />, store)

    const trigger = screen.getByRole("button", { name: "action.translation" })
    await openTooltip(trigger)

    const tooltip = document.querySelector("[data-slot='tooltip-content']")
    expect(tooltip).toHaveTextContent("action.translation")
    expect(tooltip).toHaveClass("pointer-events-none")

    fireEvent.mouseLeave(trigger)
    fireEvent.blur(trigger)
    await waitFor(() => {
      expect(document.querySelector("[data-slot='tooltip-content']")).toBeNull()
    })
  })

  it("opts out of focus restoration when closing the translation popover", async () => {
    translateTextCoreMock.mockResolvedValue("translated once")
    getOrCreateWebPageContextMock.mockResolvedValue(null)

    const store = createStore()
    store.set(configAtom, createStandardTranslateConfig())
    setSelectionState(store, { text: "Selected text" })
    renderWithProviders(<TranslateButton />, store)

    fireEvent.click(screen.getByRole("button", { name: "action.translation" }))

    await waitFor(() => {
      expect(screen.getByTestId("selection-popover-content")).toHaveAttribute("data-final-focus", "false")
    })
  })

  it("reruns standard translation from the footer and ignores stale results from older runs", async () => {
    const firstRun = createDeferredPromise<string>()
    const secondRun = createDeferredPromise<string>()

    translateTextCoreMock
      .mockImplementationOnce(() => firstRun.promise)
      .mockImplementationOnce(() => secondRun.promise)
    getOrCreateWebPageContextMock.mockResolvedValue(null)

    const store = createStore()
    store.set(configAtom, createStandardTranslateConfig())
    setSelectionState(store, { text: "Selected text" })
    renderWithProviders(<TranslateButton />, store)

    fireEvent.click(screen.getByRole("button", { name: "action.translation" }))

    await waitFor(() => {
      expect(translateTextCoreMock).toHaveBeenCalledTimes(1)
    })

    fireEvent.click(screen.getByRole("button", { name: "Regenerate" }))

    await waitFor(() => {
      expect(translateTextCoreMock).toHaveBeenCalledTimes(2)
    })

    await act(async () => {
      firstRun.resolve("stale result")
      await Promise.resolve()
    })

    expect(screen.getByTestId("translation-result").textContent).toBe("")
    expect(screen.getByTestId("translation-status").textContent).toBe("true")

    await act(async () => {
      secondRun.resolve("fresh result")
      await Promise.resolve()
    })

    await waitFor(() => {
      expect(screen.getByTestId("translation-result").textContent).toBe("fresh result")
    })
    expect(screen.getByTestId("translation-status").textContent).toBe("false")
  })

  it("keeps the original page selection session when selecting text inside the translation popover", async () => {
    translateTextCoreMock.mockResolvedValue("Overlay panel content")
    getOrCreateWebPageContextMock.mockResolvedValue(null)

    const paragraph = document.createElement("p")
    paragraph.textContent = "Original page paragraph with surrounding context."
    document.body.appendChild(paragraph)

    const store = createStore()
    store.set(configAtom, createStandardTranslateConfig())
    setSelectionState(store, {
      text: "Original page selection",
      range: createRangeFor(paragraph),
    })
    renderWithProviders(<SelectionToolbar />, store)

    const toolbarTranslateButton = document.querySelector<HTMLButtonElement>("button[aria-label='action.translation']")
    if (!toolbarTranslateButton) {
      throw new Error("Selection toolbar translate trigger is missing")
    }

    fireEvent.click(toolbarTranslateButton)

    await waitFor(() => {
      expect(translateTextCoreMock).toHaveBeenCalledTimes(1)
    })
    await waitFor(() => {
      expect(screen.getByTestId("translation-result").textContent).toBe("Overlay panel content")
    })
    expect(screen.getByTestId("footer-paragraphs").textContent).toBe("Original page paragraph with surrounding context.")

    const overlayText = screen.getByTestId("translation-result")
    const overlaySelectionRange = createRangeFor(overlayText)
    const requestAnimationFrameSpy = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback: FrameRequestCallback) => {
        callback(0)
        return 0
      })

    mockWindowSelection(overlaySelectionRange)

    fireEvent.mouseDown(overlayText)
    document.dispatchEvent(new Event("selectionchange"))
    fireEvent.mouseUp(overlayText)

    await act(async () => {
      await Promise.resolve()
    })

    requestAnimationFrameSpy.mockRestore()

    fireEvent.click(screen.getByRole("button", { name: "Close" }))
    fireEvent.click(toolbarTranslateButton)

    await waitFor(() => {
      expect(translateTextCoreMock).toHaveBeenCalledTimes(2)
    })

    expect(translateTextCoreMock.mock.calls[0]?.[0]).toMatchObject({
      text: "Original page selection",
    })
    expect(translateTextCoreMock.mock.calls[1]?.[0]).toMatchObject({
      text: "Original page selection",
    })
    expect(screen.getByTestId("footer-paragraphs").textContent).toBe("Original page paragraph with surrounding context.")
  })

  it("keeps an llm translation running across close and reopen without a duplicate request", async () => {
    const llmRun = createDeferredPromise<BackgroundTextStreamSnapshot>()
    const streamCalls: Array<{ signal?: AbortSignal, onChunk?: (data: BackgroundTextStreamSnapshot) => void }> = []

    streamManagedTranslationMock.mockImplementation((_payload, options: {
      signal?: AbortSignal
      onChunk?: (data: BackgroundTextStreamSnapshot) => void
    }) => {
      streamCalls.push({ signal: options.signal, onChunk: options.onChunk })
      return llmRun.promise
    })

    const store = createStore()
    const config = createStandardTranslateConfig()
    setSelectionToolbarTranslateProvider(config, MANAGED_CLOUD_PROVIDER_ID)
    store.set(configAtom, config)
    setSelectionState(store, { text: "Selected text" })
    renderWithProviders(<TranslateButton />, store)

    fireEvent.click(screen.getByRole("button", { name: "action.translation" }))

    await waitFor(() => {
      expect(streamManagedTranslationMock).toHaveBeenCalledTimes(1)
    })

    fireEvent.click(screen.getByRole("button", { name: "Close" }))

    expect(streamCalls[0]?.signal?.aborted).toBe(false)
    expect(screen.queryByTestId("translation-content")).toBeNull()

    fireEvent.click(screen.getByRole("button", { name: "action.translation" }))

    expect(streamManagedTranslationMock).toHaveBeenCalledTimes(1)

    await act(async () => {
      llmRun.resolve({
        output: "后台完成",
        thinking: {
          status: "complete",
          text: "",
        },
      })
      await Promise.resolve()
    })

    await waitFor(() => {
      expect(screen.getByTestId("translation-result").textContent).toBe("后台完成")
    })

    expect(saveTranslatedSelectionToVocabularyMock).toHaveBeenCalledWith(expect.objectContaining({
      sourceText: "Selected text",
      translatedText: "后台完成",
    }))
    expect(toastErrorMock).not.toHaveBeenCalled()
    expect(screen.queryByRole("alert")).toBeNull()
  })

  it("continues into llm streaming after the popover closes while webpage context is still loading", async () => {
    const pendingContext = createDeferredPromise<{
      url: string
      webTitle: string
      webContent: string
    } | null>()

    getOrCreateWebPageContextMock.mockImplementation(() => pendingContext.promise)
    streamManagedTranslationMock.mockResolvedValue({
      output: "Should not stream",
      thinking: {
        status: "complete",
        text: "",
      },
    })

    const store = createStore()
    const updatedConfig = cloneConfig(DEFAULT_CONFIG)
    setSelectionToolbarTranslateProvider(updatedConfig, MANAGED_CLOUD_PROVIDER_ID)
    store.set(configAtom, updatedConfig)
    setSelectionState(store, { text: "Selected text" })
    renderWithProviders(<TranslateButton />, store)

    fireEvent.click(screen.getByRole("button", { name: "action.translation" }))

    await waitFor(() => {
      expect(getOrCreateWebPageContextMock).toHaveBeenCalled()
    })

    fireEvent.click(screen.getByRole("button", { name: "Close" }))

    await act(async () => {
      pendingContext.resolve({
        url: "https://example.com/article",
        webTitle: "Article title",
        webContent: "Article body",
      })
      await Promise.resolve()
    })

    await waitFor(() => {
      expect(streamManagedTranslationMock).toHaveBeenCalledTimes(1)
    })
    expect(toastErrorMock).not.toHaveBeenCalled()
    expect(screen.queryByRole("alert")).toBeNull()
    expect(screen.queryByTestId("translation-content")).toBeNull()
  })

  it("renders translate errors inline and clears them after a successful rerun", async () => {
    translateTextCoreMock
      .mockRejectedValueOnce(new Error("Standard translation failed"))
      .mockResolvedValueOnce("Recovered translation")
    getOrCreateWebPageContextMock.mockResolvedValue(null)

    const store = createStore()
    store.set(configAtom, createStandardTranslateConfig())
    setSelectionState(store, { text: "Selected text" })
    renderWithProviders(<TranslateButton />, store)

    fireEvent.click(screen.getByRole("button", { name: "action.translation" }))

    const alert = await screen.findByRole("alert")
    expect(alert).toHaveTextContent("translationHub.translationFailed")
    expect(alert).toHaveTextContent("Standard translation failed")
    expect(toastErrorMock).not.toHaveBeenCalled()

    const translationContent = screen.getByTestId("translation-content")
    expect(translationContent.compareDocumentPosition(alert) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(alert.compareDocumentPosition(screen.getByRole("button", { name: "Regenerate" })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    fireEvent.click(screen.getByRole("button", { name: "Regenerate" }))

    await waitFor(() => {
      expect(translateTextCoreMock).toHaveBeenCalledTimes(2)
    })

    await waitFor(() => {
      expect(screen.getByTestId("translation-result").textContent).toBe("Recovered translation")
    })
    expect(screen.queryByRole("alert")).toBeNull()
  })

  it("keeps a successful translation visible when saving to vocabulary fails", async () => {
    translateTextCoreMock.mockResolvedValue("Translated text")
    saveTranslatedSelectionToVocabularyMock.mockRejectedValueOnce(new Error("Save failed"))
    getOrCreateWebPageContextMock.mockResolvedValue(null)

    const store = createStore()
    store.set(configAtom, createStandardTranslateConfig())
    setSelectionState(store, { text: "Selected text" })
    renderWithProviders(<TranslateButton />, store)

    fireEvent.click(screen.getByRole("button", { name: "action.translation" }))

    await waitFor(() => {
      expect(screen.getByTestId("translation-result").textContent).toBe("Translated text")
    })

    expect(saveTranslatedSelectionToVocabularyMock).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole("alert")).toBeNull()
    expect(toastErrorMock).not.toHaveBeenCalled()
  })

  it("starts the dictionary detail request while the main translation is still running", async () => {
    const translationRun = createDeferredPromise<string>()
    translateTextCoreMock.mockReturnValue(translationRun.promise)
    streamBackgroundStructuredObjectMock.mockResolvedValue(
      createStructuredObjectSnapshot({ term: "demonstrate", definition: "演示" }),
    )
    getOrCreateWebPageContextMock.mockResolvedValue(null)

    const store = createStore()
    store.set(configAtom, createStandardTranslateConfig())
    setSelectionState(store, { text: "demonstrate" })
    renderWithProviders(<TranslateButton />, store)

    fireEvent.click(screen.getByRole("button", { name: "action.translation" }))

    await waitFor(() => {
      expect(screen.getByTestId("translation-status").textContent).toBe("true")
    })

    expect(screen.queryByRole("alert")).toBeNull()
    await waitFor(() => {
      expect(streamBackgroundStructuredObjectMock).toHaveBeenCalledTimes(1)
    })
    expect(screen.getByTestId("translation-detailed-error").textContent).toBe("")

    await act(async () => {
      translationRun.resolve("演示")
      await Promise.resolve()
    })

    await waitFor(() => {
      expect(screen.getByTestId("translation-result").textContent).toBe("演示")
    })
  })

  it("keeps dictionary detail failures out of the translation UI after the main translation succeeds", async () => {
    translateTextCoreMock.mockResolvedValue("整合")
    streamBackgroundStructuredObjectMock.mockRejectedValue(new Error("dictionary failed"))
    getOrCreateWebPageContextMock.mockResolvedValue(null)

    const store = createStore()
    store.set(configAtom, createStandardTranslateConfig())
    setSelectionState(store, { text: "integrate" })
    renderWithProviders(<TranslateButton />, store)

    fireEvent.click(screen.getByRole("button", { name: "action.translation" }))

    await waitFor(() => {
      expect(screen.getByTestId("translation-result").textContent).toBe("整合")
    })

    await waitFor(() => {
      expect(screen.getByTestId("translation-status").textContent).toBe("false")
    })

    expect(screen.getByTestId("translation-detailed-error").textContent).toBe("")
    expect(screen.queryByRole("alert")).toBeNull()
    expect(toastErrorMock).not.toHaveBeenCalled()
  })

  it("reuses a saved vocabulary item until the user regenerates it", async () => {
    findVocabularyItemForSelectionMock.mockResolvedValue({
      id: "voc_existing",
      sourceText: "think",
      normalizedText: "think",
      lemma: "think",
      matchTerms: ["think", "thinking", "thinks", "thought"],
      translatedText: "思考",
      phonetic: "/theta-ng-k/",
      partOfSpeech: "verb",
      definition: "思考；认为",
      difficulty: "B1",
      sourceLang: "en",
      targetLang: "zh-CN",
      kind: "word",
      wordCount: 1,
      createdAt: 1,
      lastSeenAt: 2,
      hitCount: 3,
      updatedAt: 4,
      deletedAt: null,
    })
    translateTextCoreMock.mockResolvedValue("重新生成结果")
    streamBackgroundStructuredObjectMock.mockResolvedValue(
      createStructuredObjectSnapshot({ term: "think", definition: "重新生成释义" }),
    )
    getOrCreateWebPageContextMock.mockResolvedValue(null)

    const store = createStore()
    store.set(configAtom, createStandardTranslateConfig())
    setSelectionState(store, { text: "thinking" })
    renderWithProviders(<TranslateButton />, store)

    fireEvent.click(screen.getByRole("button", { name: "action.translation" }))

    await waitFor(() => {
      expect(findVocabularyItemForSelectionMock).toHaveBeenCalledWith({
        sourceText: "thinking",
        sourceLang: "auto",
        targetLang: "cmn",
      })
    })

    await waitFor(() => {
      expect(screen.getByTestId("translation-result").textContent).toBe("思考")
    })

    expect(screen.getByTestId("translation-detailed").textContent).toContain("\"definition\":\"思考；认为\"")
    expect(translateTextCoreMock).not.toHaveBeenCalled()
    expect(streamManagedTranslationMock).not.toHaveBeenCalled()
    expect(streamBackgroundStructuredObjectMock).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole("button", { name: "Regenerate" }))

    await waitFor(() => {
      expect(translateTextCoreMock).toHaveBeenCalledTimes(1)
    })

    await waitFor(() => {
      expect(streamBackgroundStructuredObjectMock).toHaveBeenCalledTimes(1)
    })
  })

  it("marks a mastered reused item as learning again when the user translates it again", async () => {
    findVocabularyItemForSelectionMock.mockResolvedValue({
      id: "voc_existing",
      sourceText: "think",
      normalizedText: "think",
      lemma: "think",
      matchTerms: ["think", "thinking", "thinks", "thought"],
      translatedText: "思考",
      phonetic: "/theta-ng-k/",
      partOfSpeech: "verb",
      definition: "思考；认为",
      difficulty: "B1",
      sourceLang: "en",
      targetLang: "zh-CN",
      kind: "word",
      wordCount: 1,
      createdAt: 1,
      lastSeenAt: 2,
      hitCount: 3,
      updatedAt: 4,
      deletedAt: null,
      masteredAt: 5,
    })
    getOrCreateWebPageContextMock.mockResolvedValue(null)

    const store = createStore()
    store.set(configAtom, createStandardTranslateConfig())
    setSelectionState(store, { text: "thinking" })
    renderWithProviders(<TranslateButton />, store)

    fireEvent.click(screen.getByRole("button", { name: "action.translation" }))

    await waitFor(() => {
      expect(findVocabularyItemForSelectionMock).toHaveBeenCalledWith({
        sourceText: "thinking",
        sourceLang: "auto",
        targetLang: "cmn",
      })
    })

    await waitFor(() => {
      expect(screen.getByTestId("translation-result").textContent).toBe("思考")
    })

    expect(setVocabularyItemMasteredMock).toHaveBeenCalledTimes(1)
    expect(setVocabularyItemMasteredMock).toHaveBeenCalledWith("voc_existing", false)
    expect(translateTextCoreMock).not.toHaveBeenCalled()
    expect(streamManagedTranslationMock).not.toHaveBeenCalled()
  })

  it("shows a precheck alert when the translate provider is unavailable", async () => {
    const store = createStore()
    const updatedConfig = cloneConfig(DEFAULT_CONFIG)
    updatedConfig.selectionToolbar.features.translate.providerId = "missing-provider-id"

    store.set(configAtom, updatedConfig)
    setSelectionState(store, { text: "Selected text" })
    renderWithProviders(<TranslateButton />, store)

    fireEvent.click(screen.getByRole("button", { name: "action.translation" }))

    const alert = await screen.findByRole("alert")
    expect(alert).toHaveTextContent("translationHub.translationFailed")
    expect(alert).toHaveTextContent("options.floatingButtonAndToolbar.selectionToolbar.errors.providerUnavailable")
    expect(translateTextCoreMock).not.toHaveBeenCalled()
    expect(streamManagedTranslationMock).not.toHaveBeenCalled()
  })

  it("shows translations identical to the original text", async () => {
    translateTextCoreMock.mockResolvedValue("Selected text")
    getOrCreateWebPageContextMock.mockResolvedValue(null)

    const store = createStore()
    store.set(configAtom, createStandardTranslateConfig())
    setSelectionState(store, { text: "Selected text" })
    renderWithProviders(<TranslateButton />, store)

    fireEvent.click(screen.getByRole("button", { name: "action.translation" }))

    await waitFor(() => {
      expect(translateTextCoreMock).toHaveBeenCalledTimes(1)
    })

    await waitFor(() => {
      expect(screen.getByTestId("translation-status").textContent).toBe("false")
    })

    expect(screen.getByTestId("translation-result").textContent).toBe("Selected text")
  })

  it("opens selection translation from the context menu and tracks the context-menu surface", async () => {
    translateTextCoreMock.mockResolvedValue("Context menu result")
    getOrCreateWebPageContextMock.mockResolvedValue(null)

    const paragraph = document.createElement("p")
    paragraph.textContent = "Selected text inside a paragraph."
    document.body.appendChild(paragraph)

    const store = createStore()
    store.set(configAtom, createStandardTranslateConfig())
    setSelectionState(store, { text: "Selected text", range: createRangeFor(paragraph) })
    renderWithProviders(<TranslateButton />, store)

    act(() => {
      paragraph.dispatchEvent(new MouseEvent("contextmenu", {
        bubbles: true,
        button: 2,
        clientX: 140,
        clientY: 180,
      }))
    })

    const handler = getRegisteredMessageHandler("openSelectionTranslationFromContextMenu")

    await act(async () => {
      handler({ data: { selectionText: "Selected text" } })
      await Promise.resolve()
    })

    await waitFor(() => {
      expect(translateTextCoreMock).toHaveBeenCalledTimes(1)
    })

    await waitFor(() => {
      expect(screen.getByTestId("translation-result").textContent).toBe("Context menu result")
    })

    const { sendMessage } = await import("@/utils/message")
    expect(vi.mocked(sendMessage)).toHaveBeenCalledWith(
      "trackFeatureUsedEvent",
      expect.objectContaining({
        feature: "selection_translation",
        surface: "context_menu",
        outcome: "success",
      }),
    )
  })

  it("reuses the same captured session for cross-node context-menu translation", async () => {
    translateTextCoreMock.mockResolvedValue("Cross-node result")
    getOrCreateWebPageContextMock.mockResolvedValue(null)

    const container = document.createElement("div")
    const firstBlock = document.createElement("div")
    firstBlock.textContent = "As long as you're alive,"
    const secondBlock = document.createElement("div")
    secondBlock.textContent = "there's no bad ending."
    container.append(firstBlock, secondBlock)
    document.body.appendChild(container)

    const startNode = firstBlock.firstChild
    const endNode = secondBlock.firstChild
    if (!(startNode instanceof Text) || !(endNode instanceof Text)) {
      throw new TypeError("Expected text nodes for cross-node selection test")
    }

    const store = createStore()
    store.set(configAtom, createStandardTranslateConfig())
    setSelectionState(store, {
      text: "As long as you're alive, there's no bad ending.",
      range: createRangeAcrossNodes(startNode, endNode),
    })
    renderWithProviders(<TranslateButton />, store)

    act(() => {
      container.dispatchEvent(new MouseEvent("contextmenu", {
        bubbles: true,
        button: 2,
        clientX: 180,
        clientY: 220,
      }))
    })

    const handler = getRegisteredMessageHandler("openSelectionTranslationFromContextMenu")

    await act(async () => {
      handler({
        data: {
          selectionText: "As long as you're alive,\nthere's no bad ending.",
        },
      })
      await Promise.resolve()
    })

    await waitFor(() => {
      expect(translateTextCoreMock).toHaveBeenCalledTimes(1)
    })

    expect(screen.getByTestId("translation-selection").textContent).toBe(
      "As long as you're alive, there's no bad ending.",
    )
    expect(screen.getByTestId("footer-paragraphs").textContent).toContain("As long as you're alive,")
    expect(screen.getByTestId("footer-paragraphs").textContent).toContain("there's no bad ending.")
    expect(toastErrorMock).not.toHaveBeenCalled()
  })

  it("shows a toast when the context menu request cannot recover a selection snapshot", async () => {
    const store = createStore()
    store.set(configAtom, createStandardTranslateConfig())
    renderWithProviders(<TranslateButton />, store)

    const handler = getRegisteredMessageHandler<{ selectionText: string }>("openSelectionTranslationFromContextMenu")

    act(() => {
      handler({ data: { selectionText: "Missing selection" } })
    })

    expect(toastErrorMock).toHaveBeenCalledWith(
      "options.floatingButtonAndToolbar.selectionToolbar.errors.missingSelection",
    )
    expect(translateTextCoreMock).not.toHaveBeenCalled()
  })

  it("shows translating then ready in the header status", async () => {
    const translationRun = createDeferredPromise<string>()
    translateTextCoreMock.mockReturnValueOnce(translationRun.promise)

    const store = createStore()
    store.set(configAtom, createStandardTranslateConfig())
    setSelectionState(store, { text: "Selected text" })
    renderWithProviders(<TranslateButton />, store)

    fireEvent.click(screen.getByRole("button", { name: "action.translation" }))

    await waitFor(() => {
      expect(screen.getByTestId("translation-header-status")).toHaveTextContent("translation.loadingStatus.translating")
    })

    await act(async () => {
      translationRun.resolve("译文")
      await Promise.resolve()
    })

    await waitFor(() => {
      expect(screen.getByTestId("translation-header-status")).toHaveTextContent("translation.loadingStatus.ready")
    })
  })

  it("shows failed in the header status when translation fails", async () => {
    translateTextCoreMock.mockRejectedValueOnce(new Error("network failed"))

    const store = createStore()
    store.set(configAtom, createStandardTranslateConfig())
    setSelectionState(store, { text: "Selected text" })
    renderWithProviders(<TranslateButton />, store)

    fireEvent.click(screen.getByRole("button", { name: "action.translation" }))

    await waitFor(() => {
      expect(screen.getByTestId("translation-header-status")).toHaveTextContent("translation.loadingStatus.failed")
    })
  })

  it("does not render a target-language switcher in the translation header", async () => {
    translateTextCoreMock.mockResolvedValueOnce("译文")

    const store = createStore()
    store.set(configAtom, createStandardTranslateConfig())
    setSelectionState(store, { text: "Selected text" })
    renderWithProviders(<TranslateButton />, store)

    fireEvent.click(screen.getByRole("button", { name: "action.translation" }))

    await waitFor(() => {
      expect(translateTextCoreMock).toHaveBeenCalledTimes(1)
    })

    expect(screen.queryByRole("combobox", { name: "side.targetLang" })).not.toBeInTheDocument()
  })

  it("reruns the built-in detailed explanation when the target language changes", async () => {
    translateTextCoreMock
      .mockResolvedValueOnce("图书馆")
      .mockResolvedValueOnce("Biblioteca")
    streamBackgroundStructuredObjectMock
      .mockResolvedValueOnce(createStructuredObjectSnapshot({ term: "library", definition: "图书馆" }))
      .mockResolvedValueOnce(createStructuredObjectSnapshot({ term: "library", definition: "biblioteca" }))
    getOrCreateWebPageContextMock.mockResolvedValue(null)

    const store = createStore()
    store.set(configAtom, createStandardTranslateConfig())
    setSelectionState(store, { text: "Library" })
    renderWithProviders(<TranslateButton />, store)

    fireEvent.click(screen.getByRole("button", { name: "action.translation" }))

    await waitFor(() => {
      expect(translateTextCoreMock).toHaveBeenCalledTimes(1)
      expect(streamBackgroundStructuredObjectMock).toHaveBeenCalledTimes(1)
    })

    const updatedConfig = cloneConfig(store.get(configAtom))
    updatedConfig.language = {
      ...updatedConfig.language,
      targetCode: "spa",
    }

    act(() => {
      store.set(configAtom, updatedConfig)
    })

    await waitFor(() => {
      expect(translateTextCoreMock).toHaveBeenCalledTimes(2)
      expect(streamBackgroundStructuredObjectMock).toHaveBeenCalledTimes(2)
    })

    expect(streamBackgroundStructuredObjectMock.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({
        prompt: expect.stringContaining("Target language: Spanish"),
        system: expect.stringContaining("Return the definition in Spanish"),
      }),
    )
  })

  it("reruns the built-in detailed explanation when the target language setter updates config", async () => {
    translateTextCoreMock
      .mockResolvedValueOnce("Persistence")
      .mockResolvedValueOnce("持久化")
    streamBackgroundStructuredObjectMock
      .mockResolvedValueOnce(createStructuredObjectSnapshot({ term: "persistence", definition: "粘り強さ" }))
      .mockResolvedValueOnce(createStructuredObjectSnapshot({ term: "persistence", definition: "持久化" }))
    getOrCreateWebPageContextMock.mockResolvedValue(null)

    const store = createStore()
    const initialConfig = createStandardTranslateConfig()
    initialConfig.language = {
      ...initialConfig.language,
      targetCode: "jpn",
    }
    store.set(configAtom, initialConfig)
    setSelectionState(store, { text: "Persistence" })
    renderWithProviders(<TranslateButton />, store)

    fireEvent.click(screen.getByRole("button", { name: "action.translation" }))

    await waitFor(() => {
      expect(translateTextCoreMock).toHaveBeenCalledTimes(1)
      expect(streamBackgroundStructuredObjectMock).toHaveBeenCalledTimes(1)
    })

    await act(async () => {
      await store.set(configFieldsAtomMap.language, { targetCode: "cmn" })
    })

    await waitFor(() => {
      expect(translateTextCoreMock).toHaveBeenCalledTimes(2)
      expect(streamBackgroundStructuredObjectMock).toHaveBeenCalledTimes(2)
    })

    expect(streamBackgroundStructuredObjectMock.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({
        prompt: expect.stringContaining("Target language: Simplified Mandarin Chinese"),
        system: expect.stringContaining("Return the definition in Simplified Mandarin Chinese"),
      }),
    )
  })

  it("opens a custom action from the context menu with the captured selection session", async () => {
    streamBackgroundStructuredObjectMock.mockResolvedValue(createStructuredObjectSnapshot({ summary: "Context menu result" }))

    const paragraph = document.createElement("p")
    paragraph.textContent = "Selected text inside a paragraph."
    document.body.appendChild(paragraph)

    const store = createStore()
    const { action, config } = createDefaultCustomActionConfig()
    store.set(configAtom, config)
    setSelectionState(store, { text: "Selected text", range: createRangeFor(paragraph) })
    renderWithProviders(<SelectionToolbarCustomActionButtons />, store)

    act(() => {
      paragraph.dispatchEvent(new MouseEvent("contextmenu", {
        bubbles: true,
        button: 2,
        clientX: 140,
        clientY: 180,
      }))
    })

    const handler = getRegisteredMessageHandler<{ actionId: string, selectionText: string }>(
      "openSelectionCustomActionFromContextMenu",
    )

    await act(async () => {
      handler({
        data: {
          actionId: action.id,
          selectionText: "Selected text",
        },
      })
      await Promise.resolve()
    })

    await waitFor(() => {
      expect(streamBackgroundStructuredObjectMock).toHaveBeenCalledTimes(1)
    })

    await waitFor(() => {
      expect(screen.getByText("{\"summary\":\"Context menu result\"}")).toBeInTheDocument()
    })

    expect(screen.getByTestId("footer-paragraphs").textContent).toContain("Selected text inside a paragraph.")
    expect(toastErrorMock).not.toHaveBeenCalled()

    const { sendMessage } = await import("@/utils/message")
    expect(vi.mocked(sendMessage)).toHaveBeenCalledWith(
      "trackFeatureUsedEvent",
      expect.objectContaining({
        feature: "custom_ai_action",
        surface: "context_menu",
        outcome: "success",
        action_id: action.id,
        action_name: action.name,
      }),
    )
  })

  it("renders a visible custom action trigger when the action is not internal", () => {
    streamBackgroundStructuredObjectMock.mockResolvedValue(
      createStructuredObjectSnapshot({ summary: "done" }),
    )

    const { action, config } = createVisibleCustomActionConfig()

    const store = createStore()
    store.set(configAtom, config)
    setSelectionState(store, { text: "Selected text" })
    renderWithProviders(<SelectionToolbarCustomActionButtons />, store)

    expect(screen.getByRole("button", { name: action.name })).toBeInTheDocument()
  })

  it("silently ignores a custom action context menu request when the selection snapshot is missing", async () => {
    const store = createStore()
    const { action, config } = createDefaultCustomActionConfig()
    store.set(configAtom, config)
    renderWithProviders(<SelectionToolbarCustomActionButtons />, store)

    const handler = getRegisteredMessageHandler<{ actionId: string, selectionText: string }>(
      "openSelectionCustomActionFromContextMenu",
    )

    act(() => {
      handler({
        data: {
          actionId: action.id,
          selectionText: "Missing selection",
        },
      })
    })

    expect(toastErrorMock).not.toHaveBeenCalled()
    expect(streamBackgroundStructuredObjectMock).not.toHaveBeenCalled()

    const { sendMessage } = await import("@/utils/message")
    expect(vi.mocked(sendMessage)).toHaveBeenCalledWith(
      "trackFeatureUsedEvent",
      expect.objectContaining({
        feature: "custom_ai_action",
        surface: "context_menu",
        outcome: "failure",
        action_id: action.id,
        action_name: action.name,
      }),
    )
  })

  it("does not rerun custom action requests on passive config refresh, but reruns when request values change", async () => {
    streamBackgroundStructuredObjectMock.mockResolvedValue(createStructuredObjectSnapshot({ summary: "done" }))
    const { action, config } = createDefaultCustomActionConfig()

    const store = createStore()
    store.set(configAtom, config)
    setSelectionState(store, { text: "Selected text" })
    renderWithProviders(
      <ToolbarCustomActionTestTrigger actionId={action.id} label={action.name} />,
      store,
    )

    fireEvent.click(screen.getByRole("button", { name: action.name }))

    await waitFor(() => {
      expect(streamBackgroundStructuredObjectMock).toHaveBeenCalledTimes(1)
    })

    act(() => {
      store.set(configAtom, cloneConfig(store.get(configAtom)))
    })

    await act(async () => {
      await Promise.resolve()
    })

    expect(streamBackgroundStructuredObjectMock).toHaveBeenCalledTimes(1)

    const updatedConfig = cloneConfig(store.get(configAtom))
    addAlternateManagedProvider(updatedConfig)
    const currentProviderId = updatedConfig.selectionToolbar.customActions[0]?.providerId ?? ""
    const nextProviderId = findAlternateLLMProviderId(updatedConfig, currentProviderId)
    if (!nextProviderId) {
      throw new Error("No alternate LLM provider available for custom action test")
    }
    updatedConfig.selectionToolbar.customActions[0] = {
      ...updatedConfig.selectionToolbar.customActions[0]!,
      providerId: nextProviderId,
    }

    act(() => {
      store.set(configAtom, updatedConfig)
    })

    await waitFor(() => {
      expect(streamBackgroundStructuredObjectMock).toHaveBeenCalledTimes(2)
    })
  })

  it("reruns custom action requests from the footer and aborts the previous run", async () => {
    const firstRun = createDeferredPromise<BackgroundStructuredObjectStreamSnapshot>()
    const secondRun = createDeferredPromise<BackgroundStructuredObjectStreamSnapshot>()
    const signals: AbortSignal[] = []

    streamBackgroundStructuredObjectMock
      .mockImplementationOnce((_payload, options: { signal?: AbortSignal }) => {
        signals.push(options.signal as AbortSignal)
        options.signal?.addEventListener("abort", () => {
          firstRun.reject(new DOMException("aborted", "AbortError"))
        })
        return firstRun.promise
      })
      .mockImplementationOnce((_payload, options: { signal?: AbortSignal }) => {
        signals.push(options.signal as AbortSignal)
        return secondRun.promise
      })

    const { action, config } = createDefaultCustomActionConfig()

    const store = createStore()
    store.set(configAtom, config)
    setSelectionState(store, { text: "Selected text" })
    renderWithProviders(
      <ToolbarCustomActionTestTrigger actionId={action.id} label={action.name} />,
      store,
    )

    fireEvent.click(screen.getByRole("button", { name: action.name }))

    await waitFor(() => {
      expect(streamBackgroundStructuredObjectMock).toHaveBeenCalledTimes(1)
    })

    fireEvent.click(screen.getByRole("button", { name: "Regenerate" }))

    await waitFor(() => {
      expect(streamBackgroundStructuredObjectMock).toHaveBeenCalledTimes(2)
    })

    expect(signals[0]?.aborted).toBe(true)

    await act(async () => {
      secondRun.resolve(createStructuredObjectSnapshot({ summary: "fresh" }))
      await Promise.resolve()
    })

    await waitFor(() => {
      expect(screen.getByText("{\"summary\":\"fresh\"}")).toBeInTheDocument()
    })
  })

  it("does not show a precheck alert when a custom action has no selected text", async () => {
    const { action, config } = createDefaultCustomActionConfig()

    const store = createStore()
    store.set(configAtom, config)
    setSelectionState(store, { text: "   " })
    renderWithProviders(
      <ToolbarCustomActionTestTrigger actionId={action.id} label={action.name} />,
      store,
    )

    fireEvent.click(screen.getByRole("button", { name: action.name }))

    await waitFor(() => {
      expect(screen.queryByRole("alert")).toBeNull()
    })
    expect(streamBackgroundStructuredObjectMock).not.toHaveBeenCalled()

    const { sendMessage } = await import("@/utils/message")
    expect(vi.mocked(sendMessage)).toHaveBeenCalledWith(
      "trackFeatureUsedEvent",
      expect.objectContaining({
        feature: "custom_ai_action",
        surface: "selection_toolbar",
        outcome: "failure",
        action_id: action.id,
        action_name: action.name,
      }),
    )
  })

  it("keeps custom action failures silent and still allows a successful rerun", async () => {
    streamBackgroundStructuredObjectMock
      .mockRejectedValueOnce(new Error("Structured output failed"))
      .mockResolvedValueOnce(createStructuredObjectSnapshot({ summary: "fresh" }))
    const { action, config } = createDefaultCustomActionConfig()

    const store = createStore()
    store.set(configAtom, config)
    setSelectionState(store, { text: "Selected text" })
    renderWithProviders(
      <ToolbarCustomActionTestTrigger actionId={action.id} label={action.name} />,
      store,
    )

    fireEvent.click(screen.getByRole("button", { name: action.name }))

    await waitFor(() => {
      expect(streamBackgroundStructuredObjectMock).toHaveBeenCalledTimes(1)
    })
    expect(screen.queryByRole("alert")).toBeNull()
    expect(toastErrorMock).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole("button", { name: "Regenerate" }))

    await waitFor(() => {
      expect(streamBackgroundStructuredObjectMock).toHaveBeenCalledTimes(2)
    })

    await waitFor(() => {
      expect(screen.getByText("{\"summary\":\"fresh\"}")).toBeInTheDocument()
    })
    expect(screen.queryByRole("alert")).toBeNull()
  })
})
