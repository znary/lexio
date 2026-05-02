import type {
  VocabularyItem,
} from "../app/platform-api"
import { useAuth } from "@clerk/clerk-react"
import { useCallback, useDeferredValue, useEffect, useMemo, useState } from "react"
import {
  getVocabularyCardWordFamily as getItemWordFamily,
  getVocabularyCardSourceLabel as getSourceLabel,
  WORD_FAMILY_GROUP_ORDER,
} from "@/components/vocabulary/vocabulary-card-data"
import { VocabularyDetailCard } from "@/components/vocabulary/vocabulary-detail-card"
import {
  SearchIcon,
  SpeakerIcon,
  SpinnerIcon,
  StopSquareIcon,
} from "../app/icons"
import { getPlatformVocabularyItems } from "../app/platform-api"
import { APP_ROUTES, getPracticeStartHref } from "../app/routes"
import { useSitePreferences } from "../app/site-preferences"
import { usePlatformTextToSpeech } from "../app/use-platform-text-to-speech"

const WORD_BANK_CACHE_KEY_PREFIX = "lexio.platform.word-bank.v1"

interface WordBankCacheSnapshot {
  cachedAt: number
  items: VocabularyItem[]
}

function getItemSummary(item: VocabularyItem): string {
  return item.translatedText.trim() || item.definition?.trim() || item.sourceText
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
                <VocabularyDetailCard
                  variant="page"
                  copy={{
                    definition: wordBankCopy.definition,
                    inContext: wordBankCopy.inContext,
                    mastered: wordBankCopy.mastered,
                    missingContext: wordBankCopy.missingContext,
                    practiceNow: wordBankCopy.practiceNow,
                    wordFamily: wordBankCopy.wordFamily,
                    wordFamilyContrast: wordBankCopy.wordFamilyContrast,
                    wordFamilyCore: wordBankCopy.wordFamilyCore,
                    wordFamilyRelated: wordBankCopy.wordFamilyRelated,
                  }}
                  item={selectedItem}
                  practiceHref={selectedPracticeHref}
                  renderSpeakButton={({ key, language, text, type }) => (
                    <SpeakControlButton
                      className={type === "context" ? "context-speak-button" : undefined}
                      ariaLabel={getAriaLabel(type === "word" ? wordBankCopy.speakWord : wordBankCopy.speakSentence, key)}
                      state={getButtonState(key)}
                      onClick={() => handleSpeak(key, text, language ?? selectedItem.sourceLang)}
                    />
                  )}
                  footerMeta={(
                    <p>
                      <span aria-hidden="true">📖</span>
                      <span>{getSourceLabel(selectedItem, commonCopy.labels.sourceUnavailable, commonCopy.labels.lexioCapture)}</span>
                      <span className="detail-separator">•</span>
                      <span>{formatDate(selectedItem.createdAt)}</span>
                    </p>
                  )}
                />
              )}
        </article>
      </div>
    </div>
  )
}
