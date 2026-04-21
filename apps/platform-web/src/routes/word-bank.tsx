import type { VocabularyContextEntry, VocabularyItem } from "../app/platform-api"
import { useAuth } from "@clerk/clerk-react"
import { useDeferredValue, useEffect, useMemo, useState } from "react"
import {
  ChevronDownIcon,
  PlayTriangleIcon,
  PracticeSparkIcon,
  SearchIcon,
  SpeakerIcon,
} from "../app/icons"
import { getPlatformVocabularyItems } from "../app/platform-api"
import { APP_ROUTES } from "../app/routes"

const WWW_PREFIX_RE = /^www\./

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

function formatDetailDate(timestamp: number): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(timestamp)
}

function getSourceLabel(item: VocabularyItem): string {
  const firstSourceUrl = getItemContexts(item).find(entry => entry.sourceUrl)?.sourceUrl
  if (!firstSourceUrl) {
    return "Source unavailable"
  }

  try {
    const hostname = new URL(firstSourceUrl).hostname.replace(WWW_PREFIX_RE, "")
    return hostname || "Lexio Capture"
  }
  catch {
    return "Lexio Capture"
  }
}

export function WordBankPage() {
  const { getToken, isSignedIn } = useAuth()
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

      try {
        setIsLoading(true)
        const token = await getToken()
        if (!token) {
          throw new Error("Could not read your Lexio session.")
        }

        const nextItems = await getPlatformVocabularyItems(token)
        if (cancelled) {
          return
        }

        setItems(nextItems.filter(item => item.deletedAt == null))
      }
      catch {
        if (!cancelled) {
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
  }, [getToken, hasSignedInSession])

  const visibleItems = useMemo(() => {
    const normalizedQuery = deferredSearchText.trim().toLowerCase()
    if (!normalizedQuery) {
      return items
    }

    return items.filter((item) => {
      return [
        item.sourceText,
        item.definition ?? "",
        item.translatedText,
        item.phonetic ?? "",
      ].some(field => field.toLowerCase().includes(normalizedQuery))
    })
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

  const detailContexts = selectedItem ? getItemContexts(selectedItem).slice(0, 2) : []
  const normalizedQuery = deferredSearchText.trim()
  const listStatusMessage = !hasSignedInSession
    ? "Sign in to load your saved words."
    : isLoading
      ? "Loading your saved words…"
      : normalizedQuery
        ? "No words match this search."
        : "No saved words yet."
  const emptyState = !hasSignedInSession
    ? {
        badge: "Lexio Account",
        title: "Sign in to open your Word Bank",
        description: "Your saved words only appear after you sign in with the same Lexio account used by the extension.",
        actionHref: APP_ROUTES.signIn,
        actionLabel: "Sign In",
      }
    : normalizedQuery
      ? {
          badge: "Search",
          title: "No words match this search",
          description: "Try a shorter search term or clear the search field.",
        }
      : {
          badge: "Word Bank",
          title: "Your Word Bank is empty",
          description: "Save a word from the extension first, then refresh this page to review it here.",
        }

  return (
    <div className="word-bank-page">
      <header className="word-bank-toolbar">
        <div>
          <h1>Word Bank</h1>
          <p>Your curated collection of vocabulary from the web.</p>
        </div>

        <div className="word-bank-toolbar__actions">
          <label className="search-field">
            <SearchIcon className="search-field__icon" />
            <input
              type="text"
              value={searchText}
              onChange={event => setSearchText(event.target.value)}
              placeholder="Search words..."
            />
          </label>

          <button type="button" className="toolbar-button">
            <span>Recently Added</span>
            <ChevronDownIcon className="toolbar-chevron" />
          </button>

          <a className="primary-button" href={APP_ROUTES.practice}>
            <PracticeSparkIcon className="toolbar-practice-icon" />
            <span>Start Practice</span>
          </a>
        </div>
      </header>

      <div className="word-bank-layout">
        <aside className="word-bank-list">
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
        </aside>

        <article className={`word-bank-detail${selectedItem ? "" : " word-bank-detail--empty"}`}>
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
                <>
                  <header className="word-bank-detail__header">
                    <div>
                      <h2>{selectedItem.sourceText}</h2>
                      <div className="word-bank-meta">
                        <span className="word-chip">{getItemPartOfSpeech(selectedItem)}</span>
                        <span>{getItemPhonetic(selectedItem)}</span>
                        <button
                          type="button"
                          className="icon-button"
                          aria-label="Pronunciation unavailable"
                        >
                          <SpeakerIcon className="detail-speaker-icon" />
                        </button>
                      </div>
                    </div>

                    <div className="detail-actions">
                      <a className="primary-button" href={APP_ROUTES.practice}>
                        <PlayTriangleIcon className="detail-play-icon" />
                        <span>Practice Now</span>
                      </a>
                      {selectedItem.masteredAt
                        ? (
                            <div className="mastered-badge">
                              <span aria-hidden="true">●</span>
                              <span>Mastered</span>
                            </div>
                          )
                        : null}
                    </div>
                  </header>

                  <section className="detail-section">
                    <h3>Definition</h3>
                    <p className="detail-definition">{getItemDefinition(selectedItem)}</p>
                  </section>

                  <section className="detail-section">
                    <h3>In Context</h3>
                    {detailContexts.length > 0
                      ? (
                          <div className="context-stack">
                            {detailContexts.map((entry, index) => (
                              <blockquote
                                key={`${entry.sentence}-${entry.sourceUrl ?? "no-source"}`}
                                className={`context-block${index === 1 ? " context-block--muted" : ""}`}
                              >
                                &quot;
                                {entry.sentence}
                                &quot;
                              </blockquote>
                            ))}
                          </div>
                        )
                      : (
                          <div className="context-stack">
                            <blockquote className="context-block context-block--muted">
                              No context sentence has been synced for this word yet.
                            </blockquote>
                          </div>
                        )}
                  </section>

                  <footer className="detail-footer">
                    <div>
                      <h3>Source / Added</h3>
                      <p>
                        <span aria-hidden="true">📖</span>
                        <span>{getSourceLabel(selectedItem)}</span>
                        <span className="detail-separator">•</span>
                        <span>{formatDetailDate(selectedItem.createdAt)}</span>
                      </p>
                    </div>
                  </footer>
                </>
              )}
        </article>
      </div>
    </div>
  )
}
