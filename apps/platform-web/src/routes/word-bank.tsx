import type {
  VocabularyContextEntry,
  VocabularyItem,
  VocabularyWordFamily,
} from "../app/platform-api"
import { useAuth } from "@clerk/clerk-react"
import { useCallback, useDeferredValue, useEffect, useMemo, useState } from "react"
import {
  PlayTriangleIcon,
  SearchIcon,
  SpeakerIcon,
  SpinnerIcon,
  StopSquareIcon,
} from "../app/icons"
import { getPlatformVocabularyItems } from "../app/platform-api"
import { APP_ROUTES, getPracticeStartHref } from "../app/routes"
import { useSitePreferences } from "../app/site-preferences"
import { usePlatformTextToSpeech } from "../app/use-platform-text-to-speech"

const WWW_PREFIX_RE = /^www\./
const WORD_FAMILY_GROUP_ORDER = ["core", "contrast", "related"] as const
const WORD_BANK_CACHE_KEY_PREFIX = "lexio.platform.word-bank.v1"

type WordFamilyGroupKey = (typeof WORD_FAMILY_GROUP_ORDER)[number]

interface WordBankCacheSnapshot {
  cachedAt: number
  items: VocabularyItem[]
}

function getItemSummary(item: VocabularyItem): string {
  return item.translatedText.trim() || item.definition?.trim() || item.sourceText
}

function getItemDefinition(item: VocabularyItem): string {
  return item.definition?.trim() || item.translatedText.trim()
}

function getItemPhonetic(item: VocabularyItem): string {
  return item.phonetic?.trim() || "/—/"
}

function getItemPartOfSpeech(item: VocabularyItem): string {
  return item.partOfSpeech?.trim() || item.kind
}

function getItemContexts(item: VocabularyItem): VocabularyContextEntry[] {
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

function getItemWordFamily(item: VocabularyItem): VocabularyWordFamily | null {
  const wordFamily = item.wordFamily
  if (!wordFamily) {
    return null
  }

  return WORD_FAMILY_GROUP_ORDER.some(groupKey => wordFamily[groupKey].length > 0)
    ? wordFamily
    : null
}

function getSourceLabel(item: VocabularyItem, unavailableLabel: string, fallbackLabel: string): string {
  const firstSourceUrl = getItemContexts(item).find(entry => entry.sourceUrl)?.sourceUrl
  if (!firstSourceUrl) {
    return unavailableLabel
  }

  try {
    const hostname = new URL(firstSourceUrl).hostname.replace(WWW_PREFIX_RE, "")
    return hostname || fallbackLabel
  }
  catch {
    return fallbackLabel
  }
}

function getSearchFields(item: VocabularyItem): string[] {
  const wordFamily = getItemWordFamily(item)
  const wordFamilyFields = wordFamily
    ? WORD_FAMILY_GROUP_ORDER.flatMap(groupKey =>
        wordFamily[groupKey].flatMap(entry => [entry.term, entry.partOfSpeech ?? "", entry.definition]),
      )
    : []

  return [
    item.sourceText,
    item.definition ?? "",
    item.translatedText,
    item.phonetic ?? "",
    item.nuance ?? "",
    ...wordFamilyFields,
  ]
}

function getWordFamilyGroupLabel(
  copy: {
    wordFamilyCore: string
    wordFamilyContrast: string
    wordFamilyRelated: string
  },
  groupKey: WordFamilyGroupKey,
): string {
  switch (groupKey) {
    case "core":
      return copy.wordFamilyCore
    case "contrast":
      return copy.wordFamilyContrast
    case "related":
      return copy.wordFamilyRelated
  }
}

function getWordBankCacheKey(userId: string): string {
  return `${WORD_BANK_CACHE_KEY_PREFIX}:${userId}`
}

function readWordBankCache(userId: string | null | undefined): VocabularyItem[] | null {
  if (!userId || typeof window === "undefined") {
    return null
  }

  try {
    const rawValue = window.sessionStorage.getItem(getWordBankCacheKey(userId))
    if (!rawValue) {
      return null
    }

    const snapshot = JSON.parse(rawValue) as Partial<WordBankCacheSnapshot>
    return Array.isArray(snapshot.items) ? snapshot.items : null
  }
  catch {
    return null
  }
}

function writeWordBankCache(userId: string | null | undefined, items: VocabularyItem[]): void {
  if (!userId || typeof window === "undefined") {
    return
  }

  const snapshot: WordBankCacheSnapshot = {
    cachedAt: Date.now(),
    items,
  }

  try {
    window.sessionStorage.setItem(getWordBankCacheKey(userId), JSON.stringify(snapshot))
  }
  catch {
    // Ignore cache write failures so the page can continue using live data.
  }
}

function SpeakControlButton({
  ariaLabel,
  className,
  state,
  onClick,
}: {
  ariaLabel: string
  className?: string
  state: "idle" | "fetching" | "playing"
  onClick: () => void
}) {
  return (
    <button
      type="button"
      className={`icon-button${className ? ` ${className}` : ""}${state === "playing" ? " is-active" : ""}`}
      aria-label={ariaLabel}
      onClick={onClick}
    >
      {state === "fetching"
        ? <SpinnerIcon className="detail-speaker-icon detail-speaker-icon--spinning" />
        : state === "playing"
          ? <StopSquareIcon className="detail-speaker-icon" />
          : <SpeakerIcon className="detail-speaker-icon" />}
    </button>
  )
}

export function WordBankPage() {
  const { getToken, isSignedIn, userId } = useAuth()
  const { copy, formatDate } = useSitePreferences()
  const commonCopy = copy.common
  const wordBankCopy = copy.wordBank
  const {
    activePlaybackKey,
    getAriaLabel,
    play,
    stop,
    state: playbackState,
  } = usePlatformTextToSpeech(wordBankCopy)
  const hasSignedInSession = Boolean(isSignedIn)
  const [items, setItems] = useState<VocabularyItem[]>([])
  const [selectedId, setSelectedId] = useState("")
  const [searchText, setSearchText] = useState("")
  const deferredSearchText = useDeferredValue(searchText)
  const [isLoading, setIsLoading] = useState(hasSignedInSession)

  useEffect(() => {
    let cancelled = false

    async function loadItems() {
      if (!hasSignedInSession) {
        setItems([])
        setSelectedId("")
        setIsLoading(false)
        return
      }

      const cachedItems = readWordBankCache(userId)
      if (cachedItems) {
        setItems(cachedItems.filter(item => item.deletedAt == null))
        setIsLoading(false)
      }
      else {
        setIsLoading(true)
      }

      try {
        const token = await getToken()
        if (!token) {
          throw new Error("Could not read your Lexio session.")
        }

        const nextItems = await getPlatformVocabularyItems(token)
        if (cancelled) {
          return
        }

        const nextVisibleItems = nextItems.filter(item => item.deletedAt == null)
        setItems(nextVisibleItems)
        writeWordBankCache(userId, nextVisibleItems)
      }
      catch {
        if (!cancelled && !cachedItems) {
          setItems([])
        }
      }
      finally {
        if (!cancelled) {
          setIsLoading(false)
        }
      }
    }

    void loadItems()

    return () => {
      cancelled = true
    }
  }, [getToken, hasSignedInSession, userId])

  const visibleItems = useMemo(() => {
    const normalizedQuery = deferredSearchText.trim().toLowerCase()
    if (!normalizedQuery) {
      return items
    }

    return items.filter(item =>
      getSearchFields(item).some(field => field.toLowerCase().includes(normalizedQuery)),
    )
  }, [deferredSearchText, items])

  const selectedItemId = useMemo(() => {
    if (visibleItems.some(item => item.id === selectedId)) {
      return selectedId
    }

    return visibleItems[0]?.id ?? ""
  }, [selectedId, visibleItems])

  const selectedItem = useMemo(() => {
    return visibleItems.find(item => item.id === selectedItemId) ?? null
  }, [selectedItemId, visibleItems])

  const selectedWordFamily = useMemo(() => {
    return selectedItem ? getItemWordFamily(selectedItem) : null
  }, [selectedItem])

  const detailContexts = selectedItem ? getItemContexts(selectedItem).slice(0, 2) : []
  const hasWordFamily = Boolean(selectedWordFamily)
  const normalizedQuery = deferredSearchText.trim()
  const listStatusMessage = !hasSignedInSession
    ? wordBankCopy.statusSignedOut
    : isLoading
      ? wordBankCopy.statusLoading
      : normalizedQuery
        ? wordBankCopy.statusNoMatch
        : wordBankCopy.statusEmpty
  const emptyState = !hasSignedInSession
    ? {
        badge: wordBankCopy.empty.accountBadge,
        title: wordBankCopy.empty.accountTitle,
        description: wordBankCopy.empty.accountDescription,
        actionHref: APP_ROUTES.signIn,
        actionLabel: wordBankCopy.empty.actionSignIn,
      }
    : normalizedQuery
      ? {
          badge: wordBankCopy.empty.searchBadge,
          title: wordBankCopy.empty.searchTitle,
          description: wordBankCopy.empty.searchDescription,
        }
      : {
          badge: wordBankCopy.empty.libraryBadge,
          title: wordBankCopy.empty.libraryTitle,
          description: wordBankCopy.empty.libraryDescription,
        }
  const selectedPracticeHref = selectedItem ? getPracticeStartHref(selectedItem.id) : APP_ROUTES.practice

  useEffect(() => {
    stop()
  }, [selectedItemId, stop])

  const handleSpeak = useCallback((playbackKey: string, text: string, language?: string) => {
    void play({
      playbackKey,
      text,
      language,
    })
  }, [play])

  function getButtonState(playbackKey: string): "idle" | "fetching" | "playing" {
    if (activePlaybackKey !== playbackKey) {
      return "idle"
    }

    return playbackState
  }

  return (
    <div className="word-bank-page">
      <div className="word-bank-layout">
        <aside className="word-bank-list-panel">
          <div className="word-bank-list__toolbar">
            <label className="search-field word-bank-list__search">
              <SearchIcon className="search-field__icon" />
              <input
                type="text"
                value={searchText}
                onChange={event => setSearchText(event.target.value)}
                placeholder={wordBankCopy.searchPlaceholder}
              />
            </label>
          </div>

          <div className="word-bank-list">
            {isLoading
              ? <div className="word-bank-list__status">{listStatusMessage}</div>
              : visibleItems.length > 0
                ? visibleItems.map(item => (
                    <button
                      key={item.id}
                      type="button"
                      className={`word-bank-item${selectedItem?.id === item.id ? " is-active" : ""}`}
                      onClick={() => setSelectedId(item.id)}
                    >
                      <div>
                        <strong>{item.sourceText}</strong>
                        <p>{getItemSummary(item)}</p>
                      </div>
                      <span className={`word-state${item.masteredAt ? " is-mastered" : ""}`} />
                    </button>
                  ))
                : <div className="word-bank-list__status">{listStatusMessage}</div>}
          </div>
        </aside>

        <article className={`word-bank-detail${selectedItem ? "" : " word-bank-detail--empty"}${selectedItem && hasWordFamily ? " word-bank-detail--with-family" : " word-bank-detail--single"}`}>
          <div className="word-bank-detail__glow" aria-hidden="true" />

          {!selectedItem
            ? (
                <div className="word-bank-empty">
                  <div className="word-bank-empty__badge">{emptyState.badge}</div>
                  <h2>{emptyState.title}</h2>
                  <p>{emptyState.description}</p>
                  {emptyState.actionHref
                    ? (
                        <a className="primary-link word-bank-empty__action" href={emptyState.actionHref}>
                          {emptyState.actionLabel}
                        </a>
                      )
                    : null}
                </div>
              )
            : (
                <div className="word-bank-detail__scroll">
                  <div className={`word-bank-detail__layout${hasWordFamily ? " has-family" : ""}`}>
                    <div className="word-bank-detail__main">
                      <header className="word-bank-detail__header">
                        <div className="word-bank-title-stack">
                          <h2>{selectedItem.sourceText}</h2>
                          <div className="word-bank-meta">
                            <span className="word-chip">{getItemPartOfSpeech(selectedItem)}</span>
                            <span>{getItemPhonetic(selectedItem)}</span>
                            <SpeakControlButton
                              ariaLabel={getAriaLabel(wordBankCopy.speakWord, `${selectedItem.id}:word`)}
                              state={getButtonState(`${selectedItem.id}:word`)}
                              onClick={() => handleSpeak(`${selectedItem.id}:word`, selectedItem.sourceText, selectedItem.sourceLang)}
                            />
                          </div>
                        </div>

                        {!hasWordFamily
                          ? (
                              <div className="detail-actions">
                                <a className="detail-practice-button" href={selectedPracticeHref}>
                                  <PlayTriangleIcon className="detail-play-icon" />
                                  <span>{wordBankCopy.practiceNow}</span>
                                </a>
                                {selectedItem.masteredAt
                                  ? (
                                      <div className="mastered-badge">
                                        <span aria-hidden="true">●</span>
                                        <span>{wordBankCopy.mastered}</span>
                                      </div>
                                    )
                                  : null}
                              </div>
                            )
                          : null}
                      </header>

                      <section className="detail-section">
                        <h3>{wordBankCopy.definition}</h3>
                        <p className="detail-definition">{getItemDefinition(selectedItem)}</p>
                      </section>

                      <section className="detail-section">
                        <h3>{wordBankCopy.inContext}</h3>
                        {detailContexts.length > 0
                          ? (
                              <div className="context-stack">
                                {detailContexts.map((entry, index) => (
                                  <blockquote
                                    key={`${entry.sentence}-${entry.sourceUrl ?? "no-source"}`}
                                    className={`context-block${index === 1 ? " context-block--muted" : ""}`}
                                  >
                                    <div className="context-block__row">
                                      <p className="context-block__quote">
                                        &quot;
                                        {entry.sentence}
                                        &quot;
                                      </p>
                                      <SpeakControlButton
                                        className="context-speak-button"
                                        ariaLabel={getAriaLabel(wordBankCopy.speakSentence, `${selectedItem.id}:context:${index}`)}
                                        state={getButtonState(`${selectedItem.id}:context:${index}`)}
                                        onClick={() => handleSpeak(`${selectedItem.id}:context:${index}`, entry.sentence, selectedItem.sourceLang)}
                                      />
                                    </div>
                                  </blockquote>
                                ))}
                              </div>
                            )
                          : (
                              <div className="context-stack">
                                <blockquote className="context-block context-block--muted">
                                  {wordBankCopy.missingContext}
                                </blockquote>
                              </div>
                            )}
                      </section>

                      <footer className="detail-footer">
                        <p>
                          <span aria-hidden="true">📖</span>
                          <span>{getSourceLabel(selectedItem, commonCopy.labels.sourceUnavailable, commonCopy.labels.lexioCapture)}</span>
                          <span className="detail-separator">•</span>
                          <span>{formatDate(selectedItem.createdAt)}</span>
                        </p>
                      </footer>
                    </div>

                    {selectedWordFamily
                      ? (
                          <aside className="word-bank-family-column">
                            <div className="detail-actions detail-actions--family">
                              <a className="detail-practice-button" href={selectedPracticeHref}>
                                <PlayTriangleIcon className="detail-play-icon" />
                                <span>{wordBankCopy.practiceNow}</span>
                              </a>
                              {selectedItem.masteredAt
                                ? (
                                    <div className="mastered-badge">
                                      <span aria-hidden="true">●</span>
                                      <span>{wordBankCopy.mastered}</span>
                                    </div>
                                  )
                                : null}
                            </div>

                            <div className="word-bank-family" aria-label={wordBankCopy.wordFamily}>
                              <div className="word-bank-family__header">{wordBankCopy.wordFamily}</div>

                              {WORD_FAMILY_GROUP_ORDER.map((groupKey) => {
                                const entries = selectedWordFamily[groupKey]
                                if (entries.length === 0) {
                                  return null
                                }

                                return (
                                  <section key={groupKey} className="word-bank-family__group">
                                    <div className="word-bank-family__group-label">
                                      <span className="word-bank-family__group-dot" />
                                      <span>{getWordFamilyGroupLabel(wordBankCopy, groupKey)}</span>
                                    </div>

                                    <div className="word-bank-family__group-list">
                                      {entries.map((entry, index) => (
                                        <div key={`${groupKey}-${entry.term}-${index}`} className="word-bank-family__entry">
                                          <div className="word-bank-family__entry-surface">
                                            <div className="word-bank-family__entry-copy">
                                              <span className="word-bank-family__entry-term">{entry.term}</span>
                                              {entry.definition
                                                ? <span className="word-bank-family__entry-definition">{entry.definition}</span>
                                                : null}
                                            </div>
                                            {entry.partOfSpeech
                                              ? <span className="word-bank-family__entry-meta">{entry.partOfSpeech}</span>
                                              : null}
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  </section>
                                )
                              })}
                            </div>
                          </aside>
                        )
                      : null}
                  </div>
                </div>
              )}
        </article>
      </div>
    </div>
  )
}
