import type { SessionContext } from "../lib/auth"
import type { Env } from "../lib/env"
import { syncUserFromClerk } from "../lib/db"
import { HttpError, json, readJson } from "../lib/http"
import { deserializeVocabularyItem, mergeVocabularyContextSentenceRows } from "../lib/vocabulary"

type VocabularyPracticeDecision = "mastered" | "review-again"

interface VocabularyPracticeStateRow {
  item_id: string
  last_practiced_at: number
  last_decision: string
  review_again_count: number
  updated_at: number
}

interface VocabularyPracticeResultPayload {
  decision?: unknown
  practicedAt?: unknown
}

function isVocabularyPracticeDecision(value: unknown): value is VocabularyPracticeDecision {
  return value === "mastered" || value === "review-again"
}

function readPracticedAt(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new HttpError(400, "practicedAt must be a positive number")
  }

  return Math.floor(value)
}

function serializeVocabularyPracticeState(row: VocabularyPracticeStateRow) {
  return {
    itemId: row.item_id,
    lastPracticedAt: row.last_practiced_at,
    lastDecision: row.last_decision,
    reviewAgainCount: row.review_again_count,
    updatedAt: row.updated_at,
  }
}

async function loadVocabularyContextSentenceRows(env: Env, userId: string) {
  const rows = await env.DB.prepare(`
    SELECT
      vocabulary_item_context_sentences.vocabulary_item_id,
      vocabulary_item_context_sentences.sentence,
      vocabulary_item_context_sentences.source_url,
      vocabulary_item_context_sentences.created_at,
      vocabulary_item_context_sentences.last_seen_at
    FROM vocabulary_item_context_sentences
    INNER JOIN vocabulary_items
      ON vocabulary_items.id = vocabulary_item_context_sentences.vocabulary_item_id
    WHERE vocabulary_items.user_id = ?1
    ORDER BY vocabulary_item_context_sentences.last_seen_at DESC,
             vocabulary_item_context_sentences.created_at DESC
  `).bind(userId).all()

  return (rows.results ?? []) as unknown as Parameters<typeof mergeVocabularyContextSentenceRows>[1]
}

export async function handlePracticeSession(_request: Request, env: Env, session: SessionContext) {
  const user = await syncUserFromClerk(env, session)
  const [vocabularyRows, contextSentenceRows, practiceStateRows] = await Promise.all([
    env.DB.prepare(`
      SELECT
        id,
        source_text,
        normalized_text,
        context_sentence,
        lemma,
        match_terms_json,
        translated_text,
        phonetic,
        part_of_speech,
        definition,
        difficulty,
        source_lang,
        target_lang,
        kind,
        word_count,
        created_at,
        last_seen_at,
        hit_count,
        updated_at,
        deleted_at,
        mastered_at
      FROM vocabulary_items
      WHERE user_id = ?1 AND deleted_at IS NULL
      ORDER BY last_seen_at DESC, updated_at DESC
    `).bind(user.id).all(),
    loadVocabularyContextSentenceRows(env, user.id),
    env.DB.prepare(`
      SELECT
        item_id,
        last_practiced_at,
        last_decision,
        review_again_count,
        updated_at
      FROM vocabulary_practice_states
      WHERE user_id = ?1
      ORDER BY updated_at DESC
    `).bind(user.id).all<VocabularyPracticeStateRow>(),
  ])

  return json({
    items: mergeVocabularyContextSentenceRows(
      (vocabularyRows.results ?? []).map(row => deserializeVocabularyItem(row as unknown as Parameters<typeof deserializeVocabularyItem>[0])),
      contextSentenceRows,
    ),
    practiceStates: ((practiceStateRows.results ?? []) as VocabularyPracticeStateRow[]).map(serializeVocabularyPracticeState),
  })
}

export async function handleVocabularyPracticeResult(
  request: Request,
  env: Env,
  session: SessionContext,
  itemId: string,
) {
  const normalizedItemId = itemId.trim()
  if (!normalizedItemId) {
    throw new HttpError(400, "itemId is required")
  }

  const payload = await readJson<VocabularyPracticeResultPayload>(request)
  if (!isVocabularyPracticeDecision(payload.decision)) {
    throw new HttpError(400, "decision must be either mastered or review-again")
  }

  const practicedAt = readPracticedAt(payload.practicedAt)
  const user = await syncUserFromClerk(env, session)

  const [itemRow, existingStateRow] = await Promise.all([
    env.DB.prepare(`
      SELECT id, mastered_at
      FROM vocabulary_items
      WHERE id = ?1 AND user_id = ?2 AND deleted_at IS NULL
      LIMIT 1
    `).bind(normalizedItemId, user.id).first<{ id: string, mastered_at: number | null }>(),
    env.DB.prepare(`
      SELECT review_again_count
      FROM vocabulary_practice_states
      WHERE user_id = ?1 AND item_id = ?2
      LIMIT 1
    `).bind(user.id, normalizedItemId).first<{ review_again_count?: number | null }>(),
  ])

  if (!itemRow) {
    throw new HttpError(404, "Vocabulary item not found")
  }

  const updatedAt = Date.now()
  const reviewAgainCount = payload.decision === "review-again"
    ? (typeof existingStateRow?.review_again_count === "number" ? existingStateRow.review_again_count : 0) + 1
    : (typeof existingStateRow?.review_again_count === "number" ? existingStateRow.review_again_count : 0)
  const masteredAt = payload.decision === "mastered"
    ? practicedAt
    : (typeof itemRow.mastered_at === "number" ? itemRow.mastered_at : null)

  if (payload.decision === "mastered") {
    await env.DB.prepare(`
      UPDATE vocabulary_items
      SET mastered_at = ?1,
          updated_at = ?2
      WHERE id = ?3 AND user_id = ?4
    `).bind(
      masteredAt,
      updatedAt,
      normalizedItemId,
      user.id,
    ).run()
  }

  await env.DB.prepare(`
    INSERT INTO vocabulary_practice_states (
      user_id,
      item_id,
      last_practiced_at,
      last_decision,
      review_again_count,
      updated_at
    )
    VALUES (?1, ?2, ?3, ?4, ?5, ?6)
    ON CONFLICT(user_id, item_id) DO UPDATE SET
      last_practiced_at = excluded.last_practiced_at,
      last_decision = excluded.last_decision,
      review_again_count = excluded.review_again_count,
      updated_at = excluded.updated_at
  `).bind(
    user.id,
    normalizedItemId,
    practicedAt,
    payload.decision,
    reviewAgainCount,
    updatedAt,
  ).run()

  return json({
    ok: true,
    masteredAt,
    practiceState: serializeVocabularyPracticeState({
      item_id: normalizedItemId,
      last_practiced_at: practicedAt,
      last_decision: payload.decision,
      review_again_count: reviewAgainCount,
      updated_at: updatedAt,
    }),
  })
}
