import type { ReactNode } from "react"
import type {
  VocabularyCardExtraField,
  VocabularyCardItem,
} from "./vocabulary-card-data"
import { Skeleton } from "@/components/ui/base-ui/skeleton"
import {
  getVocabularyCardContexts,
  getVocabularyCardDefinition,
  getVocabularyCardPartOfSpeech,
  getVocabularyCardPhonetic,
  getVocabularyCardWordFamily,
} from "./vocabulary-card-data"
import { VocabularyWordFamilyMindMap } from "./vocabulary-word-family-mind-map"
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
  definitionLoading?: boolean
  loading?: boolean
  showDefinition?: boolean
  showMasteredBadge?: boolean
  supportingContent?: ReactNode
  variant?: "page" | "popover"
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
  definitionLoading = false,
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
  const hasResolvedDefinition = definitionLoading
    ? Boolean(item.definition?.trim())
    : Boolean(item.definition?.trim() || item.translatedText?.trim())
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
                  {showLoadingSkeleton && !hasResolvedDefinition
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

        {hasWordFamily
          ? (
              <aside className="word-bank-family-column" aria-busy={showLoadingSkeleton && !wordFamily ? "true" : undefined}>
                {wordFamily && practiceHref
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

                <VocabularyWordFamilyMindMap
                  copy={copy}
                  item={item}
                  loading={showLoadingSkeleton}
                  wordFamily={wordFamily}
                />
              </aside>
            )
          : null}
      </div>
    </div>
  )
}
