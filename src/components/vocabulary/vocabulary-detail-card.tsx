import type { ReactNode } from "react"
import type {
  VocabularyCardExtraField,
  VocabularyCardItem,
  WordFamilyGroupKey,
} from "./vocabulary-card-data"
import { Skeleton } from "@/components/ui/base-ui/skeleton"
import {
  getVocabularyCardContexts,
  getVocabularyCardDefinition,
  getVocabularyCardPartOfSpeech,
  getVocabularyCardPhonetic,
  getVocabularyCardWordFamily,
  WORD_FAMILY_GROUP_ORDER,
} from "./vocabulary-card-data"
import "./vocabulary-detail-card.css"

interface VocabularyDetailCardCopy {
  definition: string
  inContext: string
  mastered: string
  missingContext: string
  practiceNow: string
  translation?: string
  moreInformation?: string
  wordFamily: string
  wordFamilyContrast: string
  wordFamilyCore: string
  wordFamilyRelated: string
}

interface SpeakRequest {
  index?: number
  key: string
  language?: string
  text: string
  type: "word" | "context"
}

export interface VocabularyDetailCardProps {
  copy: VocabularyDetailCardCopy
  extraFields?: VocabularyCardExtraField[]
  footerMeta?: ReactNode
  headerActions?: ReactNode
  item: VocabularyCardItem
  practiceHref?: string
  renderSpeakButton?: (request: SpeakRequest) => ReactNode
  loading?: boolean
  showDefinition?: boolean
  showMasteredBadge?: boolean
  supportingContent?: ReactNode
  variant?: "page" | "popover"
}

function getWordFamilyGroupLabel(copy: VocabularyDetailCardCopy, groupKey: WordFamilyGroupKey): string {
  switch (groupKey) {
    case "core":
      return copy.wordFamilyCore
    case "contrast":
      return copy.wordFamilyContrast
    case "related":
      return copy.wordFamilyRelated
  }
}

function getItemKey(item: VocabularyCardItem): string {
  return item.id?.trim() || item.sourceText.trim() || "vocabulary-card-item"
}

const WRAP_CLASS = "vocabulary-detail-card__wrap break-words [overflow-wrap:anywhere]"
const CJK_CHAR_RE = /[\u3040-\u30FF\u3400-\u9FFF\uF900-\uFAFF]/g
const LATIN_LETTER_RE = /[a-z]/gi
const CJK_TARGET_LANGUAGE_RE = /^(?:cmn|zh|zho|chi|yue|ja|jpn|ko|kor)(?:-|$)/i
const ENGLISH_SOURCE_LANGUAGE_RE = /^(?:auto|en|eng)(?:-|$)/i

function VocabularyDefinitionSkeleton() {
  return (
    <div className="vocabulary-detail-card__definition-skeleton" aria-hidden="true">
      <Skeleton className="h-7 w-[92%]" />
      <Skeleton className="h-7 w-[68%]" />
    </div>
  )
}

function VocabularyContextTranslationSkeleton() {
  return (
    <div className="context-block__translation-skeleton" aria-hidden="true">
      <Skeleton className="h-4 w-[92%]" />
      <Skeleton className="h-4 w-[68%]" />
    </div>
  )
}

function VocabularyWordFamilySkeleton({ copy }: { copy: VocabularyDetailCardCopy }) {
  return (
    <aside className="word-bank-family-column" aria-busy="true">
      <div className="word-bank-family word-bank-family--skeleton" aria-label={copy.wordFamily}>
        <div className="word-bank-family__header">{copy.wordFamily}</div>
        {(["core", "contrast", "related"] as const).map((groupKey, groupIndex) => (
          <section key={groupKey} className="word-bank-family__group">
            <div className="word-bank-family__group-label">
              <span className="word-bank-family__group-dot" />
              <span>{getWordFamilyGroupLabel(copy, groupKey)}</span>
            </div>
            <div className="word-bank-family__group-list">
              {Array.from({ length: groupIndex === 0 ? 3 : 2 }, (_, index) => (
                <div key={`${groupKey}-${index}`} className="word-bank-family__entry">
                  <div className="word-bank-family__entry-surface">
                    <div className="word-bank-family__entry-copy word-bank-family__entry-copy--skeleton">
                      <Skeleton className="h-5 w-[86%]" />
                      <Skeleton className="h-4 w-[68%]" />
                    </div>
                    <Skeleton className="h-4 w-14 shrink-0" />
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </aside>
  )
}

function isLikelyTargetLanguageContext(item: VocabularyCardItem, sentence: string) {
  if (!CJK_TARGET_LANGUAGE_RE.test(item.targetLang ?? "")) {
    return false
  }

  if (item.sourceLang && !ENGLISH_SOURCE_LANGUAGE_RE.test(item.sourceLang)) {
    return false
  }

  const cjkCount = sentence.match(CJK_CHAR_RE)?.length ?? 0
  if (cjkCount === 0) {
    return false
  }

  const latinCount = sentence.match(LATIN_LETTER_RE)?.length ?? 0
  return cjkCount >= 8 && cjkCount * 2 >= latinCount
}

function getVisibleContexts(item: VocabularyCardItem, limit: number, filterTargetLanguageContext: boolean) {
  const contexts = getVocabularyCardContexts(item)
  return (filterTargetLanguageContext
    ? contexts.filter(entry => !isLikelyTargetLanguageContext(item, entry.sentence))
    : contexts
  ).slice(0, limit)
}

export function VocabularyDetailCard({
  copy,
  extraFields = [],
  footerMeta,
  headerActions,
  item,
  practiceHref,
  renderSpeakButton,
  loading = false,
  showDefinition = true,
  showMasteredBadge = true,
  supportingContent,
  variant = "page",
}: VocabularyDetailCardProps) {
  const wordFamily = getVocabularyCardWordFamily(item)
  const contexts = getVisibleContexts(item, variant === "popover" ? 3 : 2, variant === "popover")
  const showLoadingSkeleton = loading && variant === "popover"
  const hasWordFamily = Boolean(wordFamily) || showLoadingSkeleton
  const itemKey = getItemKey(item)
  const definition = getVocabularyCardDefinition(item)
  const partOfSpeech = getVocabularyCardPartOfSpeech(item)
  const phonetic = getVocabularyCardPhonetic(item)
  const wordSpeakButton = renderSpeakButton?.({
    key: `${itemKey}:word`,
    language: item.sourceLang,
    text: item.sourceText,
    type: "word",
  })
  const shouldShowHeaderActions = Boolean(headerActions || (!hasWordFamily && practiceHref) || (!hasWordFamily && showMasteredBadge && item.masteredAt))
  const moreInformationLabel = copy.moreInformation ?? "More information"
  const rootClassName = [
    "vocabulary-detail-card",
    `vocabulary-detail-card--${variant}`,
    "word-bank-detail__scroll",
    variant === "popover" ? "word-bank-detail word-bank-detail--single" : null,
  ].filter(Boolean).join(" ")

  return (
    <div
      className={rootClassName}
      data-testid="vocabulary-detail-card"
      data-variant={variant}
    >
      <div className={`word-bank-detail__layout${hasWordFamily ? " has-family" : ""}`}>
        <div className="word-bank-detail__main">
          <header className="word-bank-detail__header">
            <div className="word-bank-title-stack">
              <h2 className={WRAP_CLASS}>{item.sourceText}</h2>
              <div className="word-bank-meta">
                <span className={`word-chip ${WRAP_CLASS}`}>{partOfSpeech}</span>
                <span className={WRAP_CLASS}>{phonetic}</span>
                {wordSpeakButton}
              </div>
            </div>

            {shouldShowHeaderActions
              ? (
                  <div className="detail-actions">
                    {headerActions}
                    {!hasWordFamily && practiceHref
                      ? (
                          <a className="detail-practice-button" href={practiceHref}>
                            <span>{copy.practiceNow}</span>
                          </a>
                        )
                      : null}
                    {!hasWordFamily && showMasteredBadge && item.masteredAt
                      ? (
                          <div className="mastered-badge">
                            <span aria-hidden="true">●</span>
                            <span>{copy.mastered}</span>
                          </div>
                        )
                      : null}
                  </div>
                )
              : null}
          </header>

          {supportingContent
            ? (
                <div className="detail-supporting-content">
                  {supportingContent}
                </div>
              )
            : null}

          {showDefinition
            ? (
                <section className="detail-section">
                  <h3>{copy.definition}</h3>
                  {showLoadingSkeleton
                    ? <VocabularyDefinitionSkeleton />
                    : <p className={`detail-definition ${WRAP_CLASS}`}>{definition}</p>}
                </section>
              )
            : null}

          {extraFields.length > 0
            ? (
                <section className="detail-section" data-slot="vocabulary-card-extra-fields">
                  <h3>{moreInformationLabel}</h3>
                  <div className="context-stack">
                    {extraFields.map(field => (
                      <div key={field.id} className="context-block context-block--muted">
                        <div className="context-block__row">
                          <p className={`context-block__quote ${WRAP_CLASS}`}>
                            <strong>{field.label}</strong>
                            {": "}
                            {field.value}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              )
            : null}

          <section className="detail-section">
            <h3>{copy.inContext}</h3>
            {contexts.length > 0
              ? (
                  <div className="context-stack">
                    {contexts.map((entry, index) => (
                      <blockquote
                        key={`${entry.sentence}-${entry.translatedSentence ?? ""}-${entry.sourceUrl ?? "no-source"}`}
                        className={`context-block${index === 1 ? " context-block--muted" : ""}`}
                      >
                        <div className="context-block__row">
                          <div className="context-block__text">
                            <p className={`context-block__quote ${WRAP_CLASS}`}>
                              &quot;
                              {entry.sentence}
                              &quot;
                            </p>
                            {entry.translatedSentence?.trim()
                              ? (
                                  <p className={`context-block__translation ${WRAP_CLASS}`}>
                                    {entry.translatedSentence.trim()}
                                  </p>
                                )
                              : showLoadingSkeleton
                                ? <VocabularyContextTranslationSkeleton />
                                : null}
                          </div>
                          {renderSpeakButton?.({
                            index,
                            key: `${itemKey}:context:${index}`,
                            language: item.sourceLang,
                            text: entry.sentence,
                            type: "context",
                          })}
                        </div>
                      </blockquote>
                    ))}
                  </div>
                )
              : (
                  <div className="context-stack">
                    <blockquote className={`context-block context-block--muted ${WRAP_CLASS}`}>
                      {copy.missingContext}
                    </blockquote>
                  </div>
                )}
          </section>

          {footerMeta
            ? (
                <footer className="detail-footer">
                  {footerMeta}
                </footer>
              )
            : null}
        </div>

        {showLoadingSkeleton
          ? <VocabularyWordFamilySkeleton copy={copy} />
          : wordFamily
            ? (
                <aside className="word-bank-family-column">
                  {practiceHref
                    ? (
                        <div className="detail-actions detail-actions--family">
                          <a className="detail-practice-button" href={practiceHref}>
                            <span>{copy.practiceNow}</span>
                          </a>
                          {showMasteredBadge && item.masteredAt
                            ? (
                                <div className="mastered-badge">
                                  <span aria-hidden="true">●</span>
                                  <span>{copy.mastered}</span>
                                </div>
                              )
                            : null}
                        </div>
                      )
                    : null}

                  <div className="word-bank-family" aria-label={copy.wordFamily}>
                    <div className="word-bank-family__header">{copy.wordFamily}</div>

                    {WORD_FAMILY_GROUP_ORDER.map((groupKey) => {
                      const entries = wordFamily[groupKey]
                      if (entries.length === 0) {
                        return null
                      }

                      return (
                        <section key={groupKey} className="word-bank-family__group">
                          <div className="word-bank-family__group-label">
                            <span className="word-bank-family__group-dot" />
                            <span>{getWordFamilyGroupLabel(copy, groupKey)}</span>
                          </div>

                          <div className="word-bank-family__group-list">
                            {entries.map(entry => (
                              <div key={`${groupKey}-${entry.term}-${entry.partOfSpeech ?? ""}-${entry.definition}`} className="word-bank-family__entry">
                                <div className="word-bank-family__entry-surface">
                                  <div className="word-bank-family__entry-copy">
                                    <span className={`word-bank-family__entry-term ${WRAP_CLASS}`}>{entry.term}</span>
                                    {entry.definition
                                      ? <span className={`word-bank-family__entry-definition ${WRAP_CLASS}`}>{entry.definition}</span>
                                      : null}
                                  </div>
                                  {entry.partOfSpeech
                                    ? <span className={`word-bank-family__entry-meta ${WRAP_CLASS}`}>{entry.partOfSpeech}</span>
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
  )
}
