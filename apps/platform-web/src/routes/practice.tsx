import type { ChangeEvent as ReactChangeEvent, KeyboardEvent as ReactKeyboardEvent } from "react"
import type {
  PracticeResultResponse,
  VocabularyContextEntry,
  VocabularyItem,
  VocabularyPracticeDecision,
  VocabularyPracticeState,
} from "../app/platform-api"
import type { SiteLocale } from "../app/site-preferences"
import { useAuth } from "@clerk/clerk-react"
import { useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState } from "react"
import {
  BookIcon,
  CheckCircleIcon,
  ClockIcon,
  KeyboardIcon,
  RestartIcon,
  SpeakerIcon,
  SpeakerMutedIcon,
  SpeedIcon,
  SpinnerIcon,
  TargetIcon,
} from "../app/icons"
import { getPlatformPracticeSession, submitPlatformPracticeResult } from "../app/platform-api"
import { APP_ROUTES } from "../app/routes"
import { useSitePreferences } from "../app/site-preferences"
import { usePlatformTextToSpeech } from "../app/use-platform-text-to-speech"

const PRACTICE_ITEM_QUERY_KEY = "item"
const PRACTICE_START_QUERY_KEY = "start"
const FEEDBACK_RESET_MS = 160
const ADVANCE_DELAY_MS = 420
const ADVANCE_PULSE_RESET_MS = 320
const WORDS_PER_MINUTE_BASE = 5
const WHITESPACE_RE = /\s/u
const MULTIPLE_WHITESPACE_RE = /\s+/gu
const TRAILING_WHITESPACE_RE = /\s$/u
const SINGLE_QUOTE_RE = /[’‘]/gu
const DOUBLE_QUOTE_RE = /[“”]/gu
const DASH_RE = /[–—]/gu
const WORD_BOUNDARY_RE = /[A-Za-z0-9]/u
const WWW_PREFIX_RE = /^www\./u

type PracticeLoadState = "loading" | "ready" | "needs-sign-in" | "error"
type PracticeStage = "word" | "sentence" | "confirm" | "complete"
type FeedbackState = "idle" | "correct" | "wrong" | "advance"
type PracticeInputLayoutMode = "target-only" | "full-sentence"
type PracticeSoundEffect = "typing" | "advance" | "success" | "wrong"
type PracticeMode = "single" | "from-word" | "bank"

interface PracticeContextMatch {
  sentence: string
  translatedSentence?: string
  sourceUrl?: string
  sourceLabel: string
  matchedText: string
  matchStart: number
  matchEnd: number
}

interface PracticeQueueEntry {
  item: VocabularyItem
  context: PracticeContextMatch | null
}

interface PracticeMetrics {
  startedAt: number | null
  inputCount: number
  correctCount: number
  correctCharacterCount: number
  skippedSentenceCount: number
}

interface WindowWithWebkitAudio extends Window {
  webkitAudioContext?: typeof AudioContext
}

function getPracticeItemIdFromLocation(): string {
  const search = new URLSearchParams(window.location.search)
  return search.get(PRACTICE_ITEM_QUERY_KEY)?.trim() || ""
}

function getPracticeStartItemIdFromLocation(): string {
  const search = new URLSearchParams(window.location.search)
  return search.get(PRACTICE_START_QUERY_KEY)?.trim() || ""
}

function getVocabularyContexts(item: VocabularyItem): VocabularyContextEntry[] {
  if (item.contextEntries?.length) {
    return item.contextEntries
  }

  if (item.contextSentences?.length) {
    return item.contextSentences.map(sentence => ({ sentence }))
  }

  if (item.contextSentence?.trim()) {
    return [{ sentence: item.contextSentence }]
  }

  return []
}

function getVocabularyDefinition(item: VocabularyItem): string {
  return item.definition?.trim() || item.translatedText.trim() || "No definition available yet."
}

function getVocabularyPartOfSpeech(item: VocabularyItem): string {
  return item.partOfSpeech?.trim() || item.kind
}

function normalizeTypingCharacter(character: string): string {
  return character
    .replace(WHITESPACE_RE, " ")
    .replace(SINGLE_QUOTE_RE, "'")
    .replace(DOUBLE_QUOTE_RE, "\"")
    .replace(DASH_RE, "-")
    .toLocaleLowerCase()
}

function normalizeTypingText(value: string): string {
  return value
    .trim()
    .replace(MULTIPLE_WHITESPACE_RE, " ")
    .split("")
    .map(normalizeTypingCharacter)
    .join("")
}

function getNormalizedTypingLength(value: string): number {
  return normalizeTypingText(value).length
}

function isWordBoundary(character: string | undefined): boolean {
  return !character || !WORD_BOUNDARY_RE.test(character)
}

function getMatchTerms(item: VocabularyItem): string[] {
  const uniqueTerms = new Set<string>()

  for (const value of [item.sourceText, item.normalizedText, item.lemma ?? "", ...(item.matchTerms ?? [])]) {
    const term = value.trim()
    if (term) {
      uniqueTerms.add(term)
    }
  }

  return [...uniqueTerms].sort((left, right) => right.length - left.length)
}

function findSentenceMatch(sentence: string, item: VocabularyItem): Omit<PracticeContextMatch, "sentence" | "sourceLabel" | "sourceUrl"> | null {
  const lowerSentence = sentence.toLocaleLowerCase()
  const isWordItem = item.kind === "word"

  for (const term of getMatchTerms(item)) {
    const lowerTerm = term.toLocaleLowerCase()
    let fromIndex = 0

    while (fromIndex < lowerSentence.length) {
      const matchStart = lowerSentence.indexOf(lowerTerm, fromIndex)
      if (matchStart === -1) {
        break
      }

      const matchEnd = matchStart + term.length
      if (!isWordItem || (isWordBoundary(sentence[matchStart - 1]) && isWordBoundary(sentence[matchEnd]))) {
        return {
          matchedText: sentence.slice(matchStart, matchEnd),
          matchStart,
          matchEnd,
        }
      }

      fromIndex = matchStart + 1
    }
  }

  return null
}

function buildSourceLabel(sourceUrl: string | undefined, fallbackLabel: string): string {
  if (!sourceUrl) {
    return fallbackLabel
  }

  try {
    const hostname = new URL(sourceUrl).hostname.replace(WWW_PREFIX_RE, "")
    return hostname || fallbackLabel
  }
  catch {
    return fallbackLabel
  }
}

function buildPracticeQueueEntry(item: VocabularyItem, sourceFallbackLabel: string): PracticeQueueEntry {
  for (const entry of getVocabularyContexts(item)) {
    const sentence = entry.sentence.trim()
    if (!sentence) {
      continue
    }

    const match = findSentenceMatch(sentence, item)
    if (!match) {
      continue
    }

    return {
      item,
      context: {
        ...match,
        sentence,
        translatedSentence: entry.translatedSentence?.trim() || undefined,
        sourceUrl: entry.sourceUrl,
        sourceLabel: buildSourceLabel(entry.sourceUrl, sourceFallbackLabel),
      },
    }
  }

  return { item, context: null }
}

function getPracticeSpeechRequest(entry: PracticeQueueEntry, stage: PracticeStage): { playbackKey: string, text: string, language?: string } | null {
  if (stage === "word") {
    return {
      playbackKey: `${entry.item.id}:word`,
      text: entry.item.sourceText,
      language: entry.item.sourceLang,
    }
  }

  if (stage === "sentence" && entry.context) {
    return {
      playbackKey: `${entry.item.id}:sentence`,
      text: entry.context.sentence,
      language: entry.item.sourceLang,
    }
  }

  return null
}

function sortBankPracticeItems(
  items: VocabularyItem[],
  practiceStateByItemId: ReadonlyMap<string, VocabularyPracticeState>,
): VocabularyItem[] {
  const reviewAgainItems: Array<{ item: VocabularyItem, state: VocabularyPracticeState }> = []
  const remainingItems: VocabularyItem[] = []

  for (const item of items) {
    if (item.masteredAt != null) {
      continue
    }

    const practiceState = practiceStateByItemId.get(item.id)
    if (practiceState?.lastDecision === "review-again") {
      reviewAgainItems.push({ item, state: practiceState })
      continue
    }

    remainingItems.push(item)
  }

  reviewAgainItems.sort((left, right) => {
    if (right.state.updatedAt !== left.state.updatedAt) {
      return right.state.updatedAt - left.state.updatedAt
    }

    return right.state.lastPracticedAt - left.state.lastPracticedAt
  })

  return [...reviewAgainItems.map(entry => entry.item), ...remainingItems]
}

function buildPracticeQueue(
  items: VocabularyItem[],
  requestedItem: VocabularyItem | null,
  singlePracticeItemId: string,
  startPracticeItemId: string,
  practiceStateByItemId: ReadonlyMap<string, VocabularyPracticeState>,
  sourceFallbackLabel: string,
): PracticeQueueEntry[] {
  if (singlePracticeItemId) {
    return requestedItem
      ? [buildPracticeQueueEntry(requestedItem, sourceFallbackLabel)]
      : []
  }

  if (startPracticeItemId) {
    const startIndex = items.findIndex(item => item.id === startPracticeItemId)
    if (startIndex === -1) {
      return []
    }

    return items
      .slice(startIndex)
      .map(item => buildPracticeQueueEntry(item, sourceFallbackLabel))
  }

  return sortBankPracticeItems(items, practiceStateByItemId).map(item => buildPracticeQueueEntry(item, sourceFallbackLabel))
}

function moveQueueEntryToEnd(queue: PracticeQueueEntry[], index: number): PracticeQueueEntry[] {
  if (index < 0 || index >= queue.length) {
    return queue
  }

  const nextQueue = [...queue]
  const [currentEntry] = nextQueue.splice(index, 1)
  nextQueue.push(currentEntry)
  return nextQueue
}

function upsertPracticeState(
  states: VocabularyPracticeState[],
  nextState: VocabularyPracticeState,
): VocabularyPracticeState[] {
  const stateIndex = states.findIndex(state => state.itemId === nextState.itemId)
  if (stateIndex === -1) {
    return [...states, nextState]
  }

  const nextStates = [...states]
  nextStates[stateIndex] = nextState
  return nextStates
}

function formatElapsedTime(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
}

function formatAccuracy(correctCount: number, inputCount: number): string {
  if (inputCount === 0) {
    return "100%"
  }

  const accuracy = (correctCount / inputCount) * 100
  const digits = accuracy >= 100 ? 0 : 1
  return `${accuracy.toFixed(digits)}%`
}

function formatSpeed(correctCount: number, milliseconds: number): string {
  if (milliseconds <= 0 || correctCount === 0) {
    return "0 wpm"
  }

  const minutes = milliseconds / 60000
  const wordsPerMinute = Math.round((correctCount / WORDS_PER_MINUTE_BASE) / minutes)
  return `${wordsPerMinute} wpm`
}

function createFreshMetrics(): PracticeMetrics {
  return {
    startedAt: null,
    inputCount: 0,
    correctCount: 0,
    correctCharacterCount: 0,
    skippedSentenceCount: 0,
  }
}

function getComposerWidthCh(target: string): number {
  return Math.min(Math.max(Array.from(target.trim()).length + 1, 6), 28)
}

function getSegmentWidthCh(segment: string): number {
  const normalizedSegment = segment.trim().toLocaleLowerCase()

  if (!normalizedSegment) {
    return 4
  }

  const letterWidths: Record<string, number> = {
    "w": 1.5,
    "m": 1.5,
    "s": 0.8,
    "t": 0.7,
    "r": 0.7,
    "f": 0.7,
    "j": 0.6,
    "i": 0.5,
    "l": 0.5,
    "u": 1.1,
    "o": 1.1,
    "p": 1.1,
    "q": 1.1,
    "n": 1.1,
    "h": 1.1,
    "g": 1.1,
    "d": 1.1,
    "b": 1.1,
    "z": 0.9,
    "y": 0.9,
    "x": 0.9,
    "v": 0.9,
    "c": 0.9,
    "'": 0.5,
  }

  const width = normalizedSegment
    .split("")
    .reduce((totalWidth, character) => totalWidth + (letterWidths[character] ?? 1), 0)

  return Math.max(Math.min(width + 1, 28), 4)
}

interface PracticeTargetSlotLayout {
  text: string
  widthCh: number
}

interface PracticeComposerProgress {
  activeIndex: number
  activeValue: string
  completedCount: number
  isReadyToAdvance: boolean
  isSegmentedTarget: boolean
  slotLayout: PracticeTargetSlotLayout[]
}

interface PracticeComposerMeasuredLayout {
  slotWidthsPx: number[]
}

function getTargetSlotLayout(target: string): PracticeTargetSlotLayout[] {
  const segments = target.trim().split(MULTIPLE_WHITESPACE_RE).filter(Boolean)
  const sourceSegments = segments.length > 0 ? segments : [target.trim()]

  return sourceSegments.map(segment => ({
    text: segment,
    widthCh: getSegmentWidthCh(segment),
  }))
}

function getComposerProgress(target: string, value: string): PracticeComposerProgress {
  const slotLayout = getTargetSlotLayout(target)
  const isSegmentedTarget = slotLayout.length > 1

  if (!isSegmentedTarget) {
    return {
      activeIndex: 0,
      activeValue: value,
      completedCount: 0,
      isReadyToAdvance: false,
      isSegmentedTarget,
      slotLayout,
    }
  }

  const typedSegments = value.trim()
    ? value.trim().split(MULTIPLE_WHITESPACE_RE).filter(Boolean)
    : []
  const hasTrailingWhitespace = TRAILING_WHITESPACE_RE.test(value)
  const completedCount = typedSegments.length === 0
    ? 0
    : Math.min(
        Math.max(0, typedSegments.length - (hasTrailingWhitespace ? 0 : 1)),
        slotLayout.length,
      )
  const activeIndex = Math.min(completedCount, Math.max(0, slotLayout.length - 1))
  const activeValue = hasTrailingWhitespace ? "" : (typedSegments.at(-1) ?? "")
  const activeTarget = slotLayout[activeIndex]?.text ?? ""

  return {
    activeIndex,
    activeValue,
    completedCount,
    isReadyToAdvance: normalizeTypingText(activeValue) === normalizeTypingText(activeTarget) && activeValue.trim().length > 0,
    isSegmentedTarget,
    slotLayout,
  }
}

function areMeasuredWidthsEqual(current: number[], next: number[]): boolean {
  if (current.length !== next.length) {
    return false
  }

  return current.every((width, index) => width === next[index])
}

function PracticeTargetComposer({
  ariaLabel,
  hasError,
  inputRef,
  layoutMode,
  onChange,
  onKeyDown,
  pulseSlotIndex,
  target,
  value,
}: {
  ariaLabel: string
  hasError: boolean
  inputRef: React.RefObject<HTMLInputElement | null>
  layoutMode: "block" | "inline"
  onChange: (event: ReactChangeEvent<HTMLInputElement>) => void
  onKeyDown: (event: ReactKeyboardEvent<HTMLInputElement>) => void
  pulseSlotIndex: number | null
  target: string
  value: string
}) {
  const composerProgress = getComposerProgress(target, value)
  const {
    activeIndex,
    activeValue,
    completedCount,
    isReadyToAdvance,
    isSegmentedTarget,
    slotLayout,
  } = composerProgress
  const measureSlotRefs = useRef<Array<HTMLSpanElement | null>>([])
  const [measuredLayout, setMeasuredLayout] = useState<PracticeComposerMeasuredLayout>({
    slotWidthsPx: [],
  })

  useLayoutEffect(() => {
    function syncMeasuredLayout() {
      const nextSlotWidthsPx = slotLayout.map((_, index) => {
        const measureSlot = measureSlotRefs.current[index]
        const measuredWidth = measureSlot?.getBoundingClientRect().width ?? 0
        return measuredWidth > 0 ? Math.ceil(measuredWidth) : 0
      })

      if (!nextSlotWidthsPx.some(width => width > 0)) {
        return
      }

      setMeasuredLayout((currentLayout) => {
        if (areMeasuredWidthsEqual(currentLayout.slotWidthsPx, nextSlotWidthsPx)) {
          return currentLayout
        }

        return {
          slotWidthsPx: nextSlotWidthsPx,
        }
      })
    }

    syncMeasuredLayout()

    const handleResize = () => {
      syncMeasuredLayout()
    }

    window.addEventListener("resize", handleResize)

    let isDisposed = false
    const fontSet = document.fonts
    const handleFontLoadingDone = () => {
      syncMeasuredLayout()
    }

    if (fontSet) {
      void fontSet.ready.then(() => {
        if (!isDisposed) {
          syncMeasuredLayout()
        }
      })
      fontSet.addEventListener?.("loadingdone", handleFontLoadingDone)
    }

    return () => {
      isDisposed = true
      window.removeEventListener("resize", handleResize)
      fontSet?.removeEventListener?.("loadingdone", handleFontLoadingDone)
    }
  }, [isSegmentedTarget, target])

  const blockComposerWidthCh = Math.max(getComposerWidthCh(target), 8)
  const containerStyle = isSegmentedTarget
    ? { maxWidth: "100%" }
    : {
        width: `${layoutMode === "block" ? blockComposerWidthCh : getComposerWidthCh(target)}ch`,
        maxWidth: "100%",
      }

  return (
    <label
      className={`practice-target-composer practice-target-composer--${layoutMode}${isSegmentedTarget ? " practice-target-composer--segmented" : ""}${hasError ? " is-error" : ""}`}
      style={containerStyle}
      onMouseDown={(event) => {
        if (event.target !== inputRef.current) {
          event.preventDefault()
          inputRef.current?.focus({ preventScroll: true })
        }
      }}
    >
      <span className="practice-target-composer__measure" aria-hidden="true">
        {slotLayout.map((slot, index) => (
          <span
            key={`${slot.text}-measure-${index}`}
            ref={(node) => {
              measureSlotRefs.current[index] = node
            }}
            data-measure-text={slot.text}
            className="practice-target-composer__slot practice-target-composer__slot--measure"
          />
        ))}
      </span>
      {isSegmentedTarget && layoutMode === "block"
        ? (
            <span className="practice-target-composer__progress" aria-hidden="true">
              {slotLayout.map((slot, index) => (
                <span
                  key={`${slot.text}-progress-${index}`}
                  className={`practice-target-composer__progress-dot${index < completedCount ? " is-complete" : ""}${index === activeIndex ? " is-active" : ""}`}
                />
              ))}
            </span>
          )
        : null}
      <span className="practice-target-composer__slots" aria-hidden="true">
        {slotLayout.map((slot, index) => {
          const isComplete = isSegmentedTarget && index < completedCount
          const isActive = !isSegmentedTarget || index === activeIndex
          const slotStateClass = isSegmentedTarget
            ? isComplete
              ? " is-complete"
              : isActive
                ? " is-active"
                : " is-upcoming"
            : " is-active"
          const isPulseSlot = pulseSlotIndex === index
          const showReadyState = isSegmentedTarget && isActive && isReadyToAdvance
          const slotValue = !isSegmentedTarget
            ? value
            : isComplete
              ? slot.text
              : isActive
                ? activeValue
                : ""

          return (
            <span
              key={`${slot.text}-${index}`}
              className={`practice-target-composer__slot${slotStateClass}${showReadyState ? " is-ready" : ""}${isPulseSlot ? " is-pulse" : ""}`}
              style={isSegmentedTarget
                ? { width: measuredLayout.slotWidthsPx[index] != null && measuredLayout.slotWidthsPx[index] > 0 ? `${measuredLayout.slotWidthsPx[index]}px` : `${slot.widthCh}ch` }
                : undefined}
            >
              <span className="practice-target-composer__slot-text">{slotValue}</span>
            </span>
          )
        })}
      </span>
      {isSegmentedTarget && layoutMode === "block"
        ? (
            <span className="practice-target-composer__hint" aria-hidden="true">
              <span className="practice-target-composer__keycap">Space</span>
              <span className="practice-target-composer__hint-progress">{`${Math.min(activeIndex + 1, slotLayout.length)} / ${slotLayout.length}`}</span>
            </span>
          )
        : null}
      <input
        ref={inputRef}
        className="practice-target-composer__input"
        type="text"
        value={value}
        autoCapitalize="off"
        autoCorrect="off"
        autoComplete="off"
        spellCheck={false}
        inputMode="text"
        enterKeyHint="done"
        aria-label={ariaLabel}
        onChange={onChange}
        onKeyDown={onKeyDown}
      />
    </label>
  )
}

function PracticeWordDisplay({ target }: { target: string }) {
  return (
    <div className="practice-word-display practice-word-display--hidden" aria-hidden="true">
      <span aria-hidden="true" className="practice-word-display__visual">
        {target}
      </span>
    </div>
  )
}

function PracticeConfirmationDisplay({
  item,
  decisionError,
  isDecisionPending,
  prompt,
  masteredLabel,
  reviewAgainLabel,
  onMastered,
  onReviewAgain,
}: {
  item: VocabularyItem
  decisionError: string
  isDecisionPending: boolean
  prompt: string
  masteredLabel: string
  reviewAgainLabel: string
  onMastered: () => void
  onReviewAgain: () => void
}) {
  return (
    <div className="practice-confirmation" onPointerDown={event => event.stopPropagation()}>
      <div className="practice-confirmation__copy">
        <h1 className="practice-confirmation__word">{item.sourceText}</h1>
        <p className="practice-confirmation__definition">{getVocabularyDefinition(item)}</p>
      </div>

      <div className="practice-confirmation__actions-block">
        <h2 className="practice-confirmation__prompt">{prompt}</h2>
        <div className="practice-confirmation__actions">
          <button
            type="button"
            className="practice-confirmation__button practice-confirmation__button--primary"
            disabled={isDecisionPending}
            onClick={onMastered}
          >
            <span className="practice-confirmation__button-index">1</span>
            <span>{masteredLabel}</span>
          </button>
          <button
            type="button"
            className="practice-confirmation__button"
            disabled={isDecisionPending}
            onClick={onReviewAgain}
          >
            <span className="practice-confirmation__button-index">2</span>
            <span>{reviewAgainLabel}</span>
          </button>
        </div>
        {decisionError
          ? <p className="practice-confirmation__error">{decisionError}</p>
          : null}
      </div>
    </div>
  )
}

function formatBankCompletionDescription(locale: SiteLocale, count: number): string {
  switch (locale) {
    case "zh-CN":
      return `这一轮一共完成了 ${count} 个已保存${count === 1 ? "词条" : "词条"}。`
    case "ja-JP":
      return `今回のセッションでは保存済みの${count}語を終えました。`
    case "en-US":
    default:
      return `You finished ${count} saved ${count === 1 ? "word" : "words"} in this session.`
  }
}

function formatFromWordCompletionDescription(locale: SiteLocale, count: number): string {
  switch (locale) {
    case "zh-CN":
      return `这一轮从当前词开始，一共完成了 ${count} 个已保存词条。`
    case "ja-JP":
      return `この単語から始めて、今回のセッションでは保存済みの${count}語を終えました。`
    case "en-US":
    default:
      return `Starting from this word, you finished ${count} saved ${count === 1 ? "word" : "words"} in this session.`
  }
}

function formatSkippedSentenceDescription(locale: SiteLocale, count: number): string {
  switch (locale) {
    case "zh-CN":
      return `有 ${count} 个词因为没有精确匹配的远程语境，跳过了句子阶段。`
    case "ja-JP":
      return `${count}語は一致するリモート文脈がなかったため、文脈ステージをスキップしました。`
    case "en-US":
    default:
      return `${count} ${count === 1 ? "word skipped" : "words skipped"} the sentence stage because no exact remote context matched.`
  }
}

function PracticeSentenceDisplay({
  composerAriaLabel,
  context,
  hasError,
  inputRef,
  layoutMode,
  onChange,
  onKeyDown,
  pulseSlotIndex,
  value,
}: {
  composerAriaLabel: string
  context: PracticeContextMatch
  hasError: boolean
  inputRef: React.RefObject<HTMLInputElement | null>
  layoutMode: PracticeInputLayoutMode
  onChange: (event: ReactChangeEvent<HTMLInputElement>) => void
  onKeyDown: (event: ReactKeyboardEvent<HTMLInputElement>) => void
  pulseSlotIndex: number | null
  value: string
}) {
  if (layoutMode === "full-sentence") {
    return <p className="practice-sentence-display" aria-label={context.sentence}>{context.sentence}</p>
  }

  const beforeText = context.sentence.slice(0, context.matchStart)
  const afterText = context.sentence.slice(context.matchEnd)

  return (
    <p className="practice-sentence-display" aria-label={context.sentence}>
      <span className="practice-sentence-display__lead">{beforeText}</span>
      <span className="practice-sentence-display__focus practice-sentence-display__focus--slot">
        <PracticeTargetComposer
          ariaLabel={composerAriaLabel}
          hasError={hasError}
          inputRef={inputRef}
          layoutMode="inline"
          onChange={onChange}
          onKeyDown={onKeyDown}
          pulseSlotIndex={pulseSlotIndex}
          target={context.matchedText}
          value={value}
        />
      </span>
      <span className="practice-sentence-display__trail">{afterText}</span>
    </p>
  )
}

export function PracticePage() {
  const { getToken, isLoaded, isSignedIn } = useAuth()
  const { copy, locale } = useSitePreferences()
  const commonCopy = copy.common
  const wordBankCopy = copy.wordBank
  const practiceCopy = copy.practice
  const {
    activePlaybackKey: activeSpeechPlaybackKey,
    play: playSpeech,
    preload: preloadSpeech,
    state: speechPlaybackState,
    stop: stopSpeech,
  } = usePlatformTextToSpeech(wordBankCopy)
  const practiceSingleItemId = useMemo(() => getPracticeItemIdFromLocation(), [])
  const practiceStartItemId = useMemo(() => getPracticeStartItemIdFromLocation(), [])
  const requestedItemId = practiceStartItemId || practiceSingleItemId
  const practiceMode: PracticeMode = practiceSingleItemId
    ? "single"
    : practiceStartItemId
      ? "from-word"
      : "bank"
  const hasSignedInSession = Boolean(isSignedIn)

  const [items, setItems] = useState<VocabularyItem[]>([])
  const [practiceStates, setPracticeStates] = useState<VocabularyPracticeState[]>([])
  const [sessionQueue, setSessionQueue] = useState<PracticeQueueEntry[]>([])
  const [loadState, setLoadState] = useState<PracticeLoadState>("loading")
  const [loadError, setLoadError] = useState("")
  const [currentIndex, setCurrentIndex] = useState(0)
  const [stage, setStage] = useState<PracticeStage>("word")
  const [composerValue, setComposerValue] = useState("")
  const [composerHasError, setComposerHasError] = useState(false)
  const [metrics, setMetrics] = useState<PracticeMetrics>(() => createFreshMetrics())
  const [now, setNow] = useState(() => Date.now())
  const [feedbackState, setFeedbackState] = useState<FeedbackState>("idle")
  const [soundEnabled, setSoundEnabled] = useState(true)
  const [decisionError, setDecisionError] = useState("")
  const [isDecisionPending, setIsDecisionPending] = useState(false)
  const [pulseSlotIndex, setPulseSlotIndex] = useState<number | null>(null)

  const inputRef = useRef<HTMLInputElement | null>(null)
  const feedbackTimerRef = useRef<number | null>(null)
  const advanceTimerRef = useRef<number | null>(null)
  const pulseTimerRef = useRef<number | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const hasInitializedSessionRef = useRef(false)
  const autoPlayedSpeechKeyRef = useRef("")

  useEffect(() => {
    let cancelled = false

    async function loadPracticeSession() {
      if (!isLoaded) {
        setLoadState("loading")
        return
      }

      if (!hasSignedInSession) {
        setItems([])
        setPracticeStates([])
        setSessionQueue([])
        setLoadError("")
        setLoadState("needs-sign-in")
        return
      }

      try {
        setLoadState("loading")
        setLoadError("")
        const token = await getToken()
        if (!token) {
          throw new Error("Could not read your Lexio session.")
        }

        const nextSession = await getPlatformPracticeSession(token)
        if (cancelled) {
          return
        }

        hasInitializedSessionRef.current = false
        setItems(nextSession.items.filter(item => item.deletedAt == null))
        setPracticeStates(nextSession.practiceStates)
        setLoadState("ready")
      }
      catch (error) {
        if (cancelled) {
          return
        }

        setItems([])
        setPracticeStates([])
        setSessionQueue([])
        setLoadError(error instanceof Error ? error.message : practiceCopy.errorTitle)
        setLoadState("error")
      }
    }

    void loadPracticeSession()

    return () => {
      cancelled = true
    }
  }, [getToken, hasSignedInSession, isLoaded, practiceCopy.errorTitle])

  const requestedItem = useMemo(() => {
    if (!requestedItemId) {
      return null
    }

    return items.find(item => item.id === requestedItemId) ?? null
  }, [items, requestedItemId])

  const practiceStateByItemId = useMemo(() => {
    return new Map(practiceStates.map(state => [state.itemId, state]))
  }, [practiceStates])

  const queueSeed = useMemo(() => {
    return buildPracticeQueue(
      items,
      requestedItem,
      practiceSingleItemId,
      practiceStartItemId,
      practiceStateByItemId,
      commonCopy.labels.lexioContext,
    )
  }, [commonCopy.labels.lexioContext, items, practiceSingleItemId, practiceStartItemId, practiceStateByItemId, requestedItem])

  function clearTransientTimers() {
    if (feedbackTimerRef.current != null) {
      window.clearTimeout(feedbackTimerRef.current)
      feedbackTimerRef.current = null
    }

    if (advanceTimerRef.current != null) {
      window.clearTimeout(advanceTimerRef.current)
      advanceTimerRef.current = null
    }

    if (pulseTimerRef.current != null) {
      window.clearTimeout(pulseTimerRef.current)
      pulseTimerRef.current = null
    }
  }

  function focusComposer() {
    inputRef.current?.focus({ preventScroll: true })
  }

  function handleComposerChange(event: ReactChangeEvent<HTMLInputElement>) {
    setComposerValue(event.currentTarget.value)
    if (composerHasError) {
      setComposerHasError(false)
    }
  }

  function toggleSoundEnabled() {
    setSoundEnabled((enabled) => {
      if (enabled) {
        stopSpeech()
      }

      return !enabled
    })
  }

  function pulseNextSlot(index: number) {
    if (index < 0) {
      return
    }

    if (pulseTimerRef.current != null) {
      window.clearTimeout(pulseTimerRef.current)
    }

    setPulseSlotIndex(index)
    pulseTimerRef.current = window.setTimeout(() => {
      setPulseSlotIndex(null)
      pulseTimerRef.current = null
    }, ADVANCE_PULSE_RESET_MS)
  }

  function resetTransientSessionState(nextQueue: PracticeQueueEntry[]) {
    clearTransientTimers()
    setSessionQueue(nextQueue)
    setCurrentIndex(0)
    setStage(nextQueue.length > 0 ? "word" : "complete")
    setComposerValue("")
    setComposerHasError(false)
    setMetrics(createFreshMetrics())
    setFeedbackState("idle")
    setNow(Date.now())
    setDecisionError("")
    setIsDecisionPending(false)
    setPulseSlotIndex(null)
    autoPlayedSpeechKeyRef.current = ""
    focusComposer()
  }

  // useEffectEvent is the intended reset path here; this rule treats it like a plain effect.
  /* eslint-disable react-hooks-extra/no-direct-set-state-in-use-effect */
  const syncNowFromEffect = useEffectEvent(() => {
    setNow(Date.now())
  })

  const initializePracticeSessionFromEffect = useEffectEvent((nextQueue: PracticeQueueEntry[]) => {
    resetTransientSessionState(nextQueue)
  })
  /* eslint-enable react-hooks-extra/no-direct-set-state-in-use-effect */

  function resetPracticeSession() {
    resetTransientSessionState(queueSeed)
  }

  useEffect(() => {
    if (loadState !== "ready") {
      hasInitializedSessionRef.current = false
      return
    }

    if (hasInitializedSessionRef.current) {
      return
    }

    hasInitializedSessionRef.current = true
    initializePracticeSessionFromEffect(queueSeed)
  }, [initializePracticeSessionFromEffect, loadState, queueSeed])

  const activeEntry = sessionQueue[currentIndex] ?? null
  const isPracticeComplete = stage === "complete"
  const activeTarget = activeEntry
    ? stage === "sentence" && activeEntry.context
      ? activeEntry.context.matchedText
      : (stage === "word" ? activeEntry.item.sourceText : "")
    : ""
  const nextEntry = sessionQueue[currentIndex + 1] ?? null
  const elapsedMilliseconds = metrics.startedAt ? now - metrics.startedAt : 0
  const hasSavedItems = items.length > 0
  const hasLiveSession = sessionQueue.length > 0 || isPracticeComplete
  const composerAriaLabel = WHITESPACE_RE.test(activeTarget.trim())
    ? practiceCopy.currentPhrase
    : practiceCopy.currentWord
  const currentSpeechRequest = useMemo(() => {
    if (!activeEntry) {
      return null
    }

    return getPracticeSpeechRequest(activeEntry, stage)
  }, [activeEntry, stage])
  const preloadSpeechRequests = useMemo(() => {
    if (!activeEntry) {
      return []
    }

    const requests = new Map<string, { text: string, language?: string }>()
    const currentRequest = getPracticeSpeechRequest(activeEntry, stage)
    if (currentRequest) {
      requests.set(`${currentRequest.language ?? ""}::${currentRequest.text}`, {
        text: currentRequest.text,
        language: currentRequest.language,
      })
    }

    if (stage === "word" && activeEntry.context) {
      requests.set(`${activeEntry.item.sourceLang}::${activeEntry.context.sentence}`, {
        text: activeEntry.context.sentence,
        language: activeEntry.item.sourceLang,
      })
    }

    if (nextEntry) {
      requests.set(`${nextEntry.item.sourceLang}::${nextEntry.item.sourceText}`, {
        text: nextEntry.item.sourceText,
        language: nextEntry.item.sourceLang,
      })
    }

    return [...requests.values()]
  }, [activeEntry, nextEntry, stage])
  const isCurrentSpeechBusy = currentSpeechRequest != null
    && activeSpeechPlaybackKey === currentSpeechRequest.playbackKey
    && speechPlaybackState !== "idle"

  function playPracticeSound(effect: PracticeSoundEffect) {
    if (!soundEnabled) {
      return
    }

    const AudioContextClass = window.AudioContext || (window as WindowWithWebkitAudio).webkitAudioContext
    if (!AudioContextClass) {
      return
    }

    const audioContext = audioContextRef.current ?? new AudioContextClass()
    audioContextRef.current = audioContext

    if (audioContext.state === "suspended") {
      void audioContext.resume()
    }

    const currentTime = audioContext.currentTime
    const destination = audioContext.destination

    function playTone({
      duration,
      frequency,
      peakGain,
      startAt = 0,
      sweepTo,
      type,
    }: {
      duration: number
      frequency: number
      peakGain: number
      startAt?: number
      sweepTo?: number
      type: OscillatorType
    }) {
      const oscillator = audioContext.createOscillator()
      const gainNode = audioContext.createGain()
      const startTime = currentTime + startAt

      oscillator.type = type
      oscillator.frequency.setValueAtTime(frequency, startTime)
      if (typeof sweepTo === "number") {
        oscillator.frequency.exponentialRampToValueAtTime(sweepTo, startTime + duration)
      }

      gainNode.gain.setValueAtTime(0.0001, startTime)
      gainNode.gain.exponentialRampToValueAtTime(peakGain, startTime + Math.min(0.01, duration / 2))
      gainNode.gain.exponentialRampToValueAtTime(0.0001, startTime + duration)

      oscillator.connect(gainNode)
      gainNode.connect(destination)
      oscillator.start(startTime)
      oscillator.stop(startTime + duration)
    }

    switch (effect) {
      case "typing":
        playTone({
          duration: 0.024,
          frequency: 860,
          peakGain: 0.006,
          sweepTo: 680,
          type: "square",
        })
        break
      case "advance":
        playTone({
          duration: 0.05,
          frequency: 420,
          peakGain: 0.012,
          sweepTo: 540,
          type: "square",
        })
        playTone({
          duration: 0.06,
          frequency: 620,
          peakGain: 0.009,
          startAt: 0.032,
          sweepTo: 760,
          type: "triangle",
        })
        break
      case "success":
        playTone({
          duration: 0.05,
          frequency: 520,
          peakGain: 0.012,
          sweepTo: 650,
          type: "square",
        })
        playTone({
          duration: 0.065,
          frequency: 660,
          peakGain: 0.01,
          startAt: 0.045,
          sweepTo: 840,
          type: "sine",
        })
        playTone({
          duration: 0.09,
          frequency: 840,
          peakGain: 0.008,
          startAt: 0.1,
          sweepTo: 1040,
          type: "triangle",
        })
        break
      case "wrong":
        playTone({
          duration: 0.085,
          frequency: 160,
          peakGain: 0.02,
          sweepTo: 122,
          type: "triangle",
        })
        break
    }
  }

  function flashFeedback(nextState: FeedbackState) {
    setFeedbackState(nextState)
    if (feedbackTimerRef.current != null) {
      window.clearTimeout(feedbackTimerRef.current)
    }

    feedbackTimerRef.current = window.setTimeout(() => {
      setFeedbackState("idle")
      feedbackTimerRef.current = null
    }, FEEDBACK_RESET_MS)
  }

  function showConfirmationStage() {
    clearTransientTimers()
    setStage("confirm")
    setComposerValue("")
    setComposerHasError(false)
    setFeedbackState("idle")
    setDecisionError("")
    setPulseSlotIndex(null)
    focusComposer()
  }

  function moveToNextEntry(nextQueue: PracticeQueueEntry[], nextIndex: number) {
    clearTransientTimers()
    setSessionQueue(nextQueue)
    setComposerValue("")
    setComposerHasError(false)
    setFeedbackState("idle")
    setDecisionError("")
    setPulseSlotIndex(null)

    if (nextIndex >= nextQueue.length) {
      setNow(Date.now())
      setCurrentIndex(nextQueue.length)
      setStage("complete")
      return
    }

    setCurrentIndex(nextIndex)
    setStage("word")
    focusComposer()
  }

  function advancePractice() {
    if (!activeEntry) {
      return
    }

    if (stage === "word" && activeEntry.context) {
      clearTransientTimers()
      setStage("sentence")
      setComposerValue("")
      setComposerHasError(false)
      setFeedbackState("idle")
      setPulseSlotIndex(null)
      focusComposer()
      return
    }

    if (stage === "word" && !activeEntry.context) {
      setMetrics(currentMetrics => ({
        ...currentMetrics,
        skippedSentenceCount: currentMetrics.skippedSentenceCount + 1,
      }))
      showConfirmationStage()
      return
    }

    if (stage === "sentence") {
      showConfirmationStage()
    }
  }

  function scheduleAdvance() {
    if (advanceTimerRef.current != null) {
      window.clearTimeout(advanceTimerRef.current)
    }

    advanceTimerRef.current = window.setTimeout(() => {
      advancePractice()
      advanceTimerRef.current = null
    }, ADVANCE_DELAY_MS)
  }

  async function getRequiredToken(): Promise<string> {
    const token = await getToken()
    if (!token) {
      throw new Error("Could not read your Lexio session.")
    }

    return token
  }

  function applyPracticeDecisionResponse(
    entry: PracticeQueueEntry,
    decision: VocabularyPracticeDecision,
    response: PracticeResultResponse,
  ) {
    setPracticeStates(currentStates => upsertPracticeState(currentStates, response.practiceState))

    if (decision === "mastered") {
      setItems(currentItems => currentItems.map(item => item.id === entry.item.id
        ? {
            ...item,
            masteredAt: response.masteredAt,
            updatedAt: response.practiceState.updatedAt,
          }
        : item))
    }
  }

  async function handlePracticeDecision(decision: VocabularyPracticeDecision) {
    if (loadState !== "ready" || !activeEntry || stage !== "confirm" || isDecisionPending) {
      return
    }

    setIsDecisionPending(true)
    setDecisionError("")
    const practicedAt = Date.now()

    try {
      const token = await getRequiredToken()
      const response = await submitPlatformPracticeResult(token, activeEntry.item.id, {
        decision,
        practicedAt,
      })

      applyPracticeDecisionResponse(activeEntry, decision, response)

      if (decision === "mastered") {
        moveToNextEntry(sessionQueue, currentIndex + 1)
        return
      }

      if (practiceMode === "single") {
        clearTransientTimers()
        setSessionQueue(sessionQueue)
        setCurrentIndex(0)
        setStage("word")
        setComposerValue("")
        setComposerHasError(false)
        setFeedbackState("idle")
        setDecisionError("")
        focusComposer()
        return
      }

      const nextQueue = moveQueueEntryToEnd(sessionQueue, currentIndex)
      const nextIndex = Math.min(currentIndex, Math.max(0, nextQueue.length - 1))
      moveToNextEntry(nextQueue, nextIndex)
    }
    catch (error) {
      setDecisionError(error instanceof Error && error.message ? error.message : practiceCopy.decisionError)
    }
    finally {
      setIsDecisionPending(false)
    }
  }

  useEffect(() => {
    if (!metrics.startedAt || isPracticeComplete) {
      return
    }

    syncNowFromEffect()
    const intervalId = window.setInterval(() => {
      syncNowFromEffect()
    }, 250)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [isPracticeComplete, metrics.startedAt, syncNowFromEffect])

  useEffect(() => {
    if (loadState !== "ready" || !activeEntry || isPracticeComplete) {
      return
    }

    inputRef.current?.focus({ preventScroll: true })
  }, [activeEntry, isPracticeComplete, loadState, stage])

  useEffect(() => {
    if (!soundEnabled || loadState !== "ready" || isPracticeComplete || stage === "confirm") {
      stopSpeech()
      autoPlayedSpeechKeyRef.current = ""
      return
    }

    if (preloadSpeechRequests.length === 0) {
      return
    }

    void preloadSpeech(preloadSpeechRequests)
  }, [isPracticeComplete, loadState, preloadSpeech, preloadSpeechRequests, soundEnabled, stage, stopSpeech])

  useEffect(() => {
    if (!soundEnabled || loadState !== "ready" || isPracticeComplete || !currentSpeechRequest) {
      autoPlayedSpeechKeyRef.current = ""
      return
    }

    const autoplaySignature = `${currentIndex}:${stage}:${currentSpeechRequest.playbackKey}:${currentSpeechRequest.text}`
    if (autoPlayedSpeechKeyRef.current === autoplaySignature) {
      return
    }

    autoPlayedSpeechKeyRef.current = autoplaySignature
    void playSpeech({
      ...currentSpeechRequest,
      suppressErrors: true,
    })
  }, [currentIndex, currentSpeechRequest, isPracticeComplete, loadState, playSpeech, soundEnabled, stage])

  useEffect(() => {
    return () => {
      if (feedbackTimerRef.current != null) {
        window.clearTimeout(feedbackTimerRef.current)
        feedbackTimerRef.current = null
      }

      if (advanceTimerRef.current != null) {
        window.clearTimeout(advanceTimerRef.current)
        advanceTimerRef.current = null
      }

      if (pulseTimerRef.current != null) {
        window.clearTimeout(pulseTimerRef.current)
        pulseTimerRef.current = null
      }

      audioContextRef.current?.close().catch(() => undefined)
    }
  }, [])

  function shouldPlayTypingSound(event: ReactKeyboardEvent<HTMLInputElement>, usesPhraseInput: boolean): boolean {
    if (event.ctrlKey || event.metaKey || event.altKey) {
      return false
    }

    if (event.key === "Backspace" || event.key === "Delete") {
      return true
    }

    if (event.key === " " || event.key === "Enter" || event.key === "Tab" || event.key === "Escape") {
      return false
    }

    if (usesPhraseInput && event.key === " ") {
      return false
    }

    return event.key.length === 1
  }

  function handleComposerKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (loadState !== "ready" || isPracticeComplete) {
      return
    }

    if (event.nativeEvent.isComposing) {
      return
    }

    if (event.key === "Escape") {
      event.preventDefault()
      resetPracticeSession()
      return
    }

    if (stage === "confirm") {
      if (event.key === "1") {
        event.preventDefault()
        void handlePracticeDecision("mastered")
        return
      }

      if (event.key === "2") {
        event.preventDefault()
        void handlePracticeDecision("review-again")
      }
      return
    }

    if (!activeEntry) {
      return
    }

    const usesPhraseInput = WHITESPACE_RE.test(activeTarget.trim())
    const composerProgress = getComposerProgress(activeTarget, composerValue)

    if (shouldPlayTypingSound(event, usesPhraseInput)) {
      playPracticeSound("typing")
    }

    if (usesPhraseInput && event.key === " ") {
      event.preventDefault()

      const activeSlot = composerProgress.slotLayout[composerProgress.activeIndex]
      const normalizedSegment = normalizeTypingText(composerProgress.activeValue)
      const normalizedActiveSlot = normalizeTypingText(activeSlot?.text ?? "")

      if (!normalizedSegment || !activeSlot) {
        return
      }

      if (normalizedSegment !== normalizedActiveSlot) {
        setComposerHasError(true)
        flashFeedback("wrong")
        playPracticeSound("wrong")
        return
      }

      const committedValue = composerProgress.slotLayout
        .slice(0, composerProgress.activeIndex + 1)
        .map(slot => slot.text)
        .join(" ")

      setComposerHasError(false)

      if (composerProgress.activeIndex < composerProgress.slotLayout.length - 1) {
        setComposerValue(`${committedValue} `)
        flashFeedback("advance")
        playPracticeSound("advance")
        pulseNextSlot(composerProgress.activeIndex + 1)
        return
      }

      setMetrics(currentMetrics => ({
        ...currentMetrics,
        startedAt: currentMetrics.startedAt ?? Date.now(),
        inputCount: currentMetrics.inputCount + 1,
        correctCount: currentMetrics.correctCount + 1,
        correctCharacterCount: currentMetrics.correctCharacterCount + getNormalizedTypingLength(activeTarget),
      }))
      setComposerValue(committedValue)
      flashFeedback("correct")
      playPracticeSound("success")
      scheduleAdvance()
      return
    }

    const isEnterSubmit = event.key === "Enter"
    const isSpaceSubmit = event.key === " " && !usesPhraseInput

    if (!isEnterSubmit && !isSpaceSubmit) {
      return
    }

    event.preventDefault()

    const normalizedValue = normalizeTypingText(composerValue)
    const normalizedTarget = normalizeTypingText(activeTarget)
    if (!normalizedValue || !normalizedTarget) {
      return
    }

    const matches = normalizedValue === normalizedTarget

    setMetrics(currentMetrics => ({
      ...currentMetrics,
      startedAt: currentMetrics.startedAt ?? Date.now(),
      inputCount: currentMetrics.inputCount + 1,
      correctCount: currentMetrics.correctCount + (matches ? 1 : 0),
      correctCharacterCount: currentMetrics.correctCharacterCount + (matches ? getNormalizedTypingLength(activeTarget) : 0),
    }))

    if (!matches) {
      setComposerHasError(true)
      flashFeedback("wrong")
      playPracticeSound("wrong")
      return
    }

    setComposerValue(activeTarget)
    setComposerHasError(false)
    flashFeedback("correct")
    playPracticeSound("success")
    scheduleAdvance()
  }

  if (loadState === "loading") {
    return (
      <div className="practice-page practice-page--state">
        <section className="practice-state-card">
          <div className="practice-state-card__badge">{practiceCopy.loadingBadge}</div>
          <h1>{practiceCopy.loadingTitle}</h1>
          <p>{practiceCopy.loadingDescription}</p>
        </section>
      </div>
    )
  }

  if (loadState === "needs-sign-in") {
    return (
      <div className="practice-page practice-page--state">
        <section className="practice-state-card">
          <div className="practice-state-card__badge">{practiceCopy.signInBadge}</div>
          <h1>{practiceCopy.signInTitle}</h1>
          <p>{practiceCopy.signInDescription}</p>
          <div className="practice-state-card__actions">
            <a className="primary-button" href={APP_ROUTES.signIn}>{commonCopy.actions.signIn}</a>
            <a className="ghost-button" href={APP_ROUTES.wordBank}>{commonCopy.actions.openWordBank}</a>
          </div>
        </section>
      </div>
    )
  }

  if (loadState === "error") {
    return (
      <div className="practice-page practice-page--state">
        <section className="practice-state-card">
          <div className="practice-state-card__badge">{practiceCopy.errorBadge}</div>
          <h1>{practiceCopy.errorTitle}</h1>
          <p>{loadError || commonCopy.actions.reload}</p>
          <div className="practice-state-card__actions">
            <button type="button" className="primary-button" onClick={() => window.location.reload()}>
              {commonCopy.actions.reload}
            </button>
            <a className="ghost-button" href={APP_ROUTES.wordBank}>{commonCopy.actions.backToWordBank}</a>
          </div>
        </section>
      </div>
    )
  }

  if (requestedItemId && !requestedItem) {
    return (
      <div className="practice-page practice-page--state">
        <section className="practice-state-card">
          <div className="practice-state-card__badge">{practiceCopy.missingItemBadge}</div>
          <h1>{practiceCopy.missingItemTitle}</h1>
          <p>{practiceCopy.missingItemDescription}</p>
          <div className="practice-state-card__actions">
            <a className="primary-button" href={APP_ROUTES.wordBank}>{commonCopy.actions.openWordBank}</a>
            <a className="ghost-button" href={APP_ROUTES.practice}>{commonCopy.actions.practiceAllWords}</a>
          </div>
        </section>
      </div>
    )
  }

  if (!hasLiveSession && practiceMode === "bank" && queueSeed.length === 0 && hasSavedItems) {
    return (
      <div className="practice-page practice-page--state">
        <section className="practice-state-card">
          <div className="practice-state-card__badge">{practiceCopy.clearedBadge}</div>
          <h1>{practiceCopy.clearedTitle}</h1>
          <p>{practiceCopy.clearedDescription}</p>
          <div className="practice-state-card__actions">
            <a className="primary-button" href={APP_ROUTES.wordBank}>{commonCopy.actions.openWordBank}</a>
          </div>
        </section>
      </div>
    )
  }

  if (!hasLiveSession && queueSeed.length === 0) {
    return (
      <div className="practice-page practice-page--state">
        <section className="practice-state-card">
          <div className="practice-state-card__badge">{practiceCopy.emptyBadge}</div>
          <h1>{practiceCopy.emptyTitle}</h1>
          <p>{practiceCopy.emptyDescription}</p>
          <div className="practice-state-card__actions">
            <a className="primary-button" href={APP_ROUTES.wordBank}>{commonCopy.actions.openWordBank}</a>
          </div>
        </section>
      </div>
    )
  }

  return (
    <div className={`practice-page practice-page--live practice-page--${stage}`}>
      <section className={`practice-session ${feedbackState === "idle" ? "" : `is-${feedbackState}`}`}>
        <div className="practice-session__topbar">
          <div className="practice-session__actions">
            <button type="button" className="practice-session__utility" onClick={resetPracticeSession}>
              <RestartIcon className="practice-session__utility-icon" />
              <span>{commonCopy.actions.restart}</span>
            </button>
            <button
              type="button"
              className={`practice-session__utility practice-session__utility--icon${soundEnabled ? " is-active" : ""}${isCurrentSpeechBusy ? " is-speaking" : ""}`}
              aria-label={soundEnabled ? practiceCopy.muteAudioLabel : practiceCopy.unmuteAudioLabel}
              aria-pressed={soundEnabled}
              onClick={toggleSoundEnabled}
            >
              {!soundEnabled
                ? <SpeakerMutedIcon className="practice-session__utility-icon" />
                : isCurrentSpeechBusy && speechPlaybackState === "fetching"
                  ? <SpinnerIcon className="practice-session__utility-icon practice-session__utility-icon--spinning" />
                  : <SpeakerIcon className="practice-session__utility-icon" />}
            </button>
          </div>
        </div>

        <div className="practice-session__canvas">
          {isPracticeComplete
            ? (
                <div className="practice-finish-card">
                  <div className="practice-finish-card__badge">{practiceCopy.sessionCompleteBadge}</div>
                  <h1>
                    {practiceMode === "single"
                      ? practiceCopy.singleCompleteTitle
                      : practiceMode === "from-word"
                        ? practiceCopy.fromWordCompleteTitle
                        : practiceCopy.bankCompleteTitle}
                  </h1>
                  <p>
                    {practiceMode === "single"
                      ? practiceCopy.singleCompleteDescription
                      : practiceMode === "from-word"
                        ? formatFromWordCompletionDescription(locale, sessionQueue.length)
                        : formatBankCompletionDescription(locale, sessionQueue.length)}
                  </p>
                  <div className="practice-finish-card__summary">
                    <div>
                      <span>{practiceCopy.accuracy}</span>
                      <strong>{formatAccuracy(metrics.correctCount, metrics.inputCount)}</strong>
                    </div>
                    <div>
                      <span>{practiceCopy.speed}</span>
                      <strong>{formatSpeed(metrics.correctCharacterCount, elapsedMilliseconds)}</strong>
                    </div>
                    <div>
                      <span>{practiceCopy.time}</span>
                      <strong>{formatElapsedTime(elapsedMilliseconds)}</strong>
                    </div>
                  </div>
                  {metrics.skippedSentenceCount > 0
                    ? (
                        <p className="practice-finish-card__note">
                          {formatSkippedSentenceDescription(locale, metrics.skippedSentenceCount)}
                        </p>
                      )
                    : null}
                  <div className="practice-finish-card__actions">
                    <button type="button" className="primary-button" onClick={resetPracticeSession}>
                      {commonCopy.actions.practiceAgain}
                    </button>
                    <a className="ghost-button" href={APP_ROUTES.wordBank}>{commonCopy.actions.backToWordBank}</a>
                  </div>
                </div>
              )
            : activeEntry
              ? (
                  <div className="practice-stage" onPointerDown={focusComposer}>
                    {stage === "word"
                      ? (
                          <div className="practice-stage__body practice-stage__body--word">
                            <PracticeWordDisplay target={activeTarget} />
                            <PracticeTargetComposer
                              ariaLabel={composerAriaLabel}
                              hasError={composerHasError}
                              inputRef={inputRef}
                              layoutMode="block"
                              onChange={handleComposerChange}
                              onKeyDown={handleComposerKeyDown}
                              pulseSlotIndex={pulseSlotIndex}
                              target={activeTarget}
                              value={composerValue}
                            />
                            <p className="practice-stage__definition">
                              <span>{`${getVocabularyPartOfSpeech(activeEntry.item)}:`}</span>
                              <span>{getVocabularyDefinition(activeEntry.item)}</span>
                            </p>
                          </div>
                        )
                      : stage === "sentence" && activeEntry.context
                        ? (
                            <div className="practice-stage__body practice-stage__body--sentence">
                              <PracticeSentenceDisplay
                                composerAriaLabel={composerAriaLabel}
                                context={activeEntry.context}
                                hasError={composerHasError}
                                inputRef={inputRef}
                                layoutMode="target-only"
                                onChange={handleComposerChange}
                                onKeyDown={handleComposerKeyDown}
                                pulseSlotIndex={pulseSlotIndex}
                                value={composerValue}
                              />
                              <p className="practice-stage__translation">
                                {activeEntry.context.translatedSentence || getVocabularyDefinition(activeEntry.item)}
                              </p>
                              <div className="practice-stage__source">
                                <BookIcon className="practice-stage__source-icon" />
                                <span>{activeEntry.context.sourceLabel}</span>
                              </div>
                            </div>
                          )
                        : (
                            <PracticeConfirmationDisplay
                              item={activeEntry.item}
                              decisionError={decisionError}
                              isDecisionPending={isDecisionPending}
                              prompt={practiceCopy.confirmPrompt}
                              masteredLabel={practiceCopy.confirmMastered}
                              reviewAgainLabel={practiceCopy.confirmReviewAgain}
                              onMastered={() => { void handlePracticeDecision("mastered") }}
                              onReviewAgain={() => { void handlePracticeDecision("review-again") }}
                            />
                          )}
                  </div>
                )
              : null}
        </div>

        {stage === "confirm"
          ? (
              <input
                ref={inputRef}
                className="practice-hidden-input"
                type="text"
                value=""
                autoCapitalize="off"
                autoCorrect="off"
                autoComplete="off"
                spellCheck={false}
                inputMode="text"
                aria-label={practiceCopy.confirmPrompt}
                onChange={() => {}}
                onKeyDown={handleComposerKeyDown}
              />
            )
          : null}
      </section>

      <footer className="practice-stats-bar">
        <div className="practice-stats-bar__item">
          <ClockIcon className="practice-stats-bar__icon" />
          <span>{practiceCopy.time}</span>
          <strong>{formatElapsedTime(elapsedMilliseconds)}</strong>
        </div>
        <div className="practice-stats-bar__item">
          <KeyboardIcon className="practice-stats-bar__icon" />
          <span>{practiceCopy.input}</span>
          <strong>{metrics.inputCount}</strong>
        </div>
        <div className="practice-stats-bar__item">
          <SpeedIcon className="practice-stats-bar__icon" />
          <span>{practiceCopy.speed}</span>
          <strong>{formatSpeed(metrics.correctCharacterCount, elapsedMilliseconds)}</strong>
        </div>
        <div className="practice-stats-bar__item">
          <CheckCircleIcon className="practice-stats-bar__icon" />
          <span>{practiceCopy.correct}</span>
          <strong>{metrics.correctCount}</strong>
        </div>
        <div className="practice-stats-bar__item practice-stats-bar__item--accuracy">
          <TargetIcon className="practice-stats-bar__icon" />
          <span>{practiceCopy.accuracy}</span>
          <strong>{formatAccuracy(metrics.correctCount, metrics.inputCount)}</strong>
        </div>
      </footer>
    </div>
  )
}
