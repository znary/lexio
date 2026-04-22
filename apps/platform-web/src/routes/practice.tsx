import type { KeyboardEvent as ReactKeyboardEvent } from "react"
import type { VocabularyContextEntry, VocabularyItem } from "../app/platform-api"
import type { SiteLocale } from "../app/site-preferences"
import { useAuth } from "@clerk/clerk-react"
import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react"
import {
  BookIcon,
  CheckCircleIcon,
  ClockIcon,
  KeyboardIcon,
  RestartIcon,
  SpeedIcon,
  TargetIcon,
  TuningIcon,
} from "../app/icons"
import { getPlatformVocabularyItems } from "../app/platform-api"
import { APP_ROUTES } from "../app/routes"
import { useSitePreferences } from "../app/site-preferences"

const PRACTICE_ITEM_QUERY_KEY = "item"
const FEEDBACK_RESET_MS = 160
const ADVANCE_DELAY_MS = 420
const WORDS_PER_MINUTE_BASE = 5
const WHITESPACE_RE = /\s/u
const SINGLE_QUOTE_RE = /[’‘]/gu
const DOUBLE_QUOTE_RE = /[“”]/gu
const DASH_RE = /[–—]/gu
const WORD_BOUNDARY_RE = /[A-Za-z0-9]/u
const WWW_PREFIX_RE = /^www\./u

type PracticeLoadState = "loading" | "ready" | "needs-sign-in" | "error"
type PracticeStage = "word" | "sentence"
type FeedbackState = "idle" | "correct" | "wrong"

interface PracticeContextMatch {
  sentence: string
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
  skippedSentenceCount: number
}

interface WindowWithWebkitAudio extends Window {
  webkitAudioContext?: typeof AudioContext
}

function getPracticeItemIdFromLocation(): string {
  const search = new URLSearchParams(window.location.search)
  return search.get(PRACTICE_ITEM_QUERY_KEY)?.trim() || ""
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
        sourceUrl: entry.sourceUrl,
        sourceLabel: buildSourceLabel(entry.sourceUrl, sourceFallbackLabel),
      },
    }
  }

  return { item, context: null }
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
    skippedSentenceCount: 0,
  }
}

function PracticeWordDisplay({ target, typedCount }: { target: string, typedCount: number }) {
  const typedText = target.slice(0, typedCount)
  const restText = target.slice(typedCount)

  return (
    <div className="practice-word-display" aria-label={target}>
      <span aria-hidden="true" className="practice-word-display__visual">
        {typedText
          ? <span className="practice-word-display__typed">{typedText}</span>
          : null}
        <span className="practice-word-display__cursor" />
        {restText
          ? <span className="practice-word-display__rest">{restText}</span>
          : null}
      </span>
    </div>
  )
}

function getDefaultEnglishLabel(locale: SiteLocale): string {
  switch (locale) {
    case "zh-CN":
      return "英语"
    case "ja-JP":
      return "英語"
    case "en-US":
    default:
      return "English"
  }
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

function PracticeSentenceDisplay({ context, typedCount }: { context: PracticeContextMatch, typedCount: number }) {
  const beforeText = context.sentence.slice(0, context.matchStart)
  const afterText = context.sentence.slice(context.matchEnd)
  const typedText = context.matchedText.slice(0, typedCount)
  const restText = context.matchedText.slice(typedCount)

  return (
    <p className="practice-sentence-display" aria-label={context.sentence}>
      <span className="practice-sentence-display__lead">{beforeText}</span>
      <span className="practice-sentence-display__focus">
        {typedText
          ? <span className="practice-sentence-display__typed">{typedText}</span>
          : null}
        <span className="practice-sentence-display__cursor" />
        {restText
          ? <span className="practice-sentence-display__rest">{restText}</span>
          : null}
      </span>
      <span className="practice-sentence-display__trail">{afterText}</span>
    </p>
  )
}

export function PracticePage() {
  const { getToken, isLoaded, isSignedIn } = useAuth()
  const { copy, getLanguageLabel, locale } = useSitePreferences()
  const commonCopy = copy.common
  const practiceCopy = copy.practice
  const practiceItemId = useMemo(() => getPracticeItemIdFromLocation(), [])
  const practiceMode = practiceItemId ? "single" : "bank"
  const hasSignedInSession = Boolean(isSignedIn)

  const [items, setItems] = useState<VocabularyItem[]>([])
  const [loadState, setLoadState] = useState<PracticeLoadState>("loading")
  const [loadError, setLoadError] = useState("")
  const [currentIndex, setCurrentIndex] = useState(0)
  const [stage, setStage] = useState<PracticeStage>("word")
  const [typedCount, setTypedCount] = useState(0)
  const [metrics, setMetrics] = useState<PracticeMetrics>(() => createFreshMetrics())
  const [now, setNow] = useState(() => Date.now())
  const [feedbackState, setFeedbackState] = useState<FeedbackState>("idle")
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [soundEnabled, setSoundEnabled] = useState(true)

  const inputRef = useRef<HTMLInputElement | null>(null)
  const feedbackTimerRef = useRef<number | null>(null)
  const advanceTimerRef = useRef<number | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)

  useEffect(() => {
    let cancelled = false

    async function loadVocabularyItems() {
      if (!isLoaded) {
        setLoadState("loading")
        return
      }

      if (!hasSignedInSession) {
        setItems([])
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

        const nextItems = await getPlatformVocabularyItems(token)
        if (cancelled) {
          return
        }

        setItems(nextItems.filter(item => item.deletedAt == null))
        setLoadState("ready")
      }
      catch (error) {
        if (cancelled) {
          return
        }

        setItems([])
        setLoadError(error instanceof Error ? error.message : practiceCopy.errorTitle)
        setLoadState("error")
      }
    }

    void loadVocabularyItems()

    return () => {
      cancelled = true
    }
  }, [getToken, hasSignedInSession, isLoaded, practiceCopy.errorTitle])

  const requestedItem = useMemo(() => {
    if (!practiceItemId) {
      return null
    }

    return items.find(item => item.id === practiceItemId) ?? null
  }, [items, practiceItemId])

  const queue = useMemo(() => {
    if (practiceItemId) {
      return requestedItem
        ? [buildPracticeQueueEntry(requestedItem, commonCopy.labels.lexioContext)]
        : []
    }

    return items.map(item => buildPracticeQueueEntry(item, commonCopy.labels.lexioContext))
  }, [commonCopy.labels.lexioContext, items, practiceItemId, requestedItem])

  const queueSignature = useMemo(() => {
    return queue.map(entry => entry.item.id).join(":")
  }, [queue])

  const activeEntry = queue[currentIndex] ?? null
  const isPracticeComplete = loadState === "ready" && queue.length > 0 && currentIndex >= queue.length
  const activeTarget = activeEntry
    ? stage === "sentence" && activeEntry.context
      ? activeEntry.context.matchedText
      : activeEntry.item.sourceText
    : ""
  const activeLanguage = activeEntry
    ? getLanguageLabel(activeEntry.item.sourceLang, getDefaultEnglishLabel(locale))
    : getDefaultEnglishLabel(locale)
  const nextWords = useMemo(() => {
    return queue.slice(currentIndex + 1, currentIndex + 4).map(entry => entry.item.sourceText)
  }, [currentIndex, queue])
  const elapsedMilliseconds = metrics.startedAt ? now - metrics.startedAt : 0

  function clearTransientTimers() {
    if (feedbackTimerRef.current != null) {
      window.clearTimeout(feedbackTimerRef.current)
      feedbackTimerRef.current = null
    }

    if (advanceTimerRef.current != null) {
      window.clearTimeout(advanceTimerRef.current)
      advanceTimerRef.current = null
    }
  }

  function focusComposer() {
    inputRef.current?.focus({ preventScroll: true })
  }

  function playTypingTone(tone: "correct" | "wrong") {
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

    const oscillator = audioContext.createOscillator()
    const gainNode = audioContext.createGain()
    const currentTime = audioContext.currentTime
    const duration = tone === "wrong" ? 0.08 : 0.05

    oscillator.type = tone === "wrong" ? "triangle" : "square"
    oscillator.frequency.setValueAtTime(tone === "wrong" ? 160 : 420, currentTime)
    gainNode.gain.setValueAtTime(0.0001, currentTime)
    gainNode.gain.exponentialRampToValueAtTime(tone === "wrong" ? 0.02 : 0.012, currentTime + 0.004)
    gainNode.gain.exponentialRampToValueAtTime(0.0001, currentTime + duration)

    oscillator.connect(gainNode)
    gainNode.connect(audioContext.destination)
    oscillator.start(currentTime)
    oscillator.stop(currentTime + duration)
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

  function advancePractice() {
    if (!activeEntry) {
      return
    }

    if (stage === "word" && activeEntry.context) {
      setStage("sentence")
      setTypedCount(0)
      setFeedbackState("idle")
      focusComposer()
      return
    }

    if (stage === "word" && !activeEntry.context) {
      setMetrics(currentMetrics => ({
        ...currentMetrics,
        skippedSentenceCount: currentMetrics.skippedSentenceCount + 1,
      }))
    }

    setCurrentIndex(index => index + 1)
    setStage("word")
    setTypedCount(0)
    setFeedbackState("idle")
    focusComposer()
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

  // useEffectEvent is the intended reset path here; this rule treats it like a plain effect.
  /* eslint-disable react-hooks-extra/no-direct-set-state-in-use-effect */
  const syncNowFromEffect = useEffectEvent(() => {
    setNow(Date.now())
  })

  const resetPracticeSessionFromEffect = useEffectEvent(() => {
    clearTransientTimers()
    setCurrentIndex(0)
    setStage("word")
    setTypedCount(0)
    setMetrics(createFreshMetrics())
    setFeedbackState("idle")
    setNow(Date.now())
    setSettingsOpen(false)
    focusComposer()
  })
  /* eslint-enable react-hooks-extra/no-direct-set-state-in-use-effect */

  function resetPracticeSession() {
    clearTransientTimers()
    setCurrentIndex(0)
    setStage("word")
    setTypedCount(0)
    setMetrics(createFreshMetrics())
    setFeedbackState("idle")
    setNow(Date.now())
    setSettingsOpen(false)
    focusComposer()
  }

  useEffect(() => {
    if (loadState !== "ready") {
      return
    }

    resetPracticeSessionFromEffect()
  }, [loadState, queueSignature])

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
  }, [isPracticeComplete, metrics.startedAt])

  useEffect(() => {
    if (loadState !== "ready" || !activeEntry || isPracticeComplete) {
      return
    }

    inputRef.current?.focus({ preventScroll: true })
  }, [activeEntry, isPracticeComplete, loadState, stage])

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

      audioContextRef.current?.close().catch(() => undefined)
    }
  }, [])

  function handleComposerKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (loadState !== "ready" || !activeEntry || isPracticeComplete) {
      return
    }

    if (event.nativeEvent.isComposing) {
      return
    }

    if (event.key === "Escape") {
      event.preventDefault()
      if (settingsOpen) {
        setSettingsOpen(false)
      }
      else {
        resetPracticeSession()
      }
      return
    }

    if (event.key === "Backspace") {
      event.preventDefault()
      return
    }

    if (event.key.length !== 1 || typedCount >= activeTarget.length) {
      return
    }

    event.preventDefault()
    const expectedCharacter = activeTarget[typedCount]
    const matches = normalizeTypingCharacter(event.key) === normalizeTypingCharacter(expectedCharacter)

    setMetrics(currentMetrics => ({
      ...currentMetrics,
      startedAt: currentMetrics.startedAt ?? Date.now(),
      inputCount: currentMetrics.inputCount + 1,
      correctCount: currentMetrics.correctCount + (matches ? 1 : 0),
    }))

    if (!matches) {
      flashFeedback("wrong")
      playTypingTone("wrong")
      return
    }

    const nextTypedCount = typedCount + 1
    setTypedCount(nextTypedCount)
    flashFeedback("correct")
    playTypingTone("correct")

    if (nextTypedCount >= activeTarget.length) {
      scheduleAdvance()
    }
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

  if (practiceItemId && !requestedItem) {
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

  if (queue.length === 0) {
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
              className={`practice-session__utility${settingsOpen ? " is-active" : ""}`}
              onClick={() => setSettingsOpen(open => !open)}
            >
              <TuningIcon className="practice-session__utility-icon" />
              <span>{commonCopy.actions.settings}</span>
            </button>
          </div>

          <div className="practice-session__meta">
            <span>{activeLanguage}</span>
            <span className="practice-session__meta-divider" />
            <span>{`${Math.min(currentIndex + 1, queue.length)} / ${queue.length}`}</span>
          </div>
        </div>

        {settingsOpen
          ? (
              <div className="practice-settings-panel">
                <div className="practice-settings-panel__row">
                  <div>
                    <strong>{practiceCopy.typingSoundTitle}</strong>
                    <p>{practiceCopy.typingSoundDescription}</p>
                  </div>
                  <button
                    type="button"
                    className={`practice-toggle${soundEnabled ? " is-on" : ""}`}
                    onClick={() => setSoundEnabled(enabled => !enabled)}
                  >
                    {soundEnabled ? commonCopy.actions.soundOn : commonCopy.actions.soundOff}
                  </button>
                </div>
                <div className="practice-settings-panel__row">
                  <div>
                    <strong>{practiceCopy.modeTitle}</strong>
                    <p>{practiceMode === "single" ? practiceCopy.modeSingleDescription : practiceCopy.modeBankDescription}</p>
                  </div>
                  <span className="practice-settings-panel__value">
                    {practiceMode === "single" ? practiceCopy.singleModeLabel : practiceCopy.bankModeLabel}
                  </span>
                </div>
              </div>
            )
          : null}

        <div className="practice-session__canvas">
          {isPracticeComplete
            ? (
                <div className="practice-finish-card">
                  <div className="practice-finish-card__badge">{practiceCopy.sessionCompleteBadge}</div>
                  <h1>{practiceMode === "single" ? practiceCopy.singleCompleteTitle : practiceCopy.bankCompleteTitle}</h1>
                  <p>
                    {practiceMode === "single"
                      ? practiceCopy.singleCompleteDescription
                      : formatBankCompletionDescription(locale, queue.length)}
                  </p>
                  <div className="practice-finish-card__summary">
                    <div>
                      <span>{practiceCopy.accuracy}</span>
                      <strong>{formatAccuracy(metrics.correctCount, metrics.inputCount)}</strong>
                    </div>
                    <div>
                      <span>{practiceCopy.speed}</span>
                      <strong>{formatSpeed(metrics.correctCount, elapsedMilliseconds)}</strong>
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
                            <div className="practice-stage__eyebrow">
                              {activeEntry.item.kind === "phrase" ? practiceCopy.currentPhrase : practiceCopy.currentWord}
                            </div>
                            <PracticeWordDisplay target={activeTarget} typedCount={typedCount} />
                            <p className="practice-stage__definition">
                              <span>{`${getVocabularyPartOfSpeech(activeEntry.item)}:`}</span>
                              <span>{getVocabularyDefinition(activeEntry.item)}</span>
                            </p>
                            {nextWords.length > 0
                              ? (
                                  <div className="practice-stage__queue" aria-label="Upcoming words">
                                    {nextWords.map(word => (
                                      <span key={word}>{word}</span>
                                    ))}
                                  </div>
                                )
                              : null}
                          </div>
                        )
                      : activeEntry.context
                        ? (
                            <div className="practice-stage__body practice-stage__body--sentence">
                              <PracticeSentenceDisplay context={activeEntry.context} typedCount={typedCount} />
                              <div className="practice-stage__source">
                                <BookIcon className="practice-stage__source-icon" />
                                <span>{activeEntry.context.sourceLabel}</span>
                              </div>
                            </div>
                          )
                        : null}
                  </div>
                )
              : null}
        </div>

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
          aria-label={practiceCopy.currentWord}
          onChange={() => {}}
          onKeyDown={handleComposerKeyDown}
        />
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
          <strong>{formatSpeed(metrics.correctCount, elapsedMilliseconds)}</strong>
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
