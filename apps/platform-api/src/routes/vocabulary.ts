import type { SessionContext } from "../lib/auth"
import type { Env } from "../lib/env"
import { syncUserFromClerk } from "../lib/db"
import { json, readJson } from "../lib/http"
import {
  buildVocabularyContextSentenceRows,
  deserializeVocabularyItem,
  mergeVocabularyContextSentenceRows,
  serializeVocabularyItem,
} from "../lib/vocabulary"

async function loadVocabularyContextSentenceRows(env: Env, userId: string) {
  const rows = await env.DB.prepare(`
    SELECT
      vocabulary_item_context_sentences.vocabulary_item_id,
      vocabulary_item_context_sentences.sentence,
      vocabulary_item_context_sentences.translated_sentence,
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

async function replaceVocabularyContextSentences(env: Env, itemId: string, item: Record<string, unknown>, baseTimestamp: number) {
  await env.DB.prepare(`
    DELETE FROM vocabulary_item_context_sentences
    WHERE vocabulary_item_id = ?1
  `).bind(itemId).run()

  const contextSentenceRows = buildVocabularyContextSentenceRows(itemId, item, baseTimestamp)
  for (const row of contextSentenceRows) {
    await env.DB.prepare(`
      INSERT INTO vocabulary_item_context_sentences (
        vocabulary_item_id,
        sentence,
        translated_sentence,
        source_url,
        created_at,
        last_seen_at
      )
      VALUES (?1, ?2, ?3, ?4, ?5, ?6)
    `).bind(
      row.vocabulary_item_id,
      row.sentence,
      row.translated_sentence,
      row.source_url,
      row.created_at,
      row.last_seen_at,
    ).run()
  }
}

export async function handleVocabularyList(_request: Request, env: Env, session: SessionContext) {
  const user = await syncUserFromClerk(env, session)
  const rows = await env.DB.prepare(`
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
      nuance,
      word_family_json,
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
    WHERE user_id = ?1
    ORDER BY last_seen_at DESC, updated_at DESC
  `).bind(user.id).all()

  const items = (rows.results ?? []).map(row => deserializeVocabularyItem(row as unknown as Parameters<typeof deserializeVocabularyItem>[0]))
  const contextSentenceRows = await loadVocabularyContextSentenceRows(env, user.id)

  return json({ items: mergeVocabularyContextSentenceRows(items, contextSentenceRows) })
}

export async function handleVocabularyMeta(_request: Request, env: Env, session: SessionContext) {
  const user = await syncUserFromClerk(env, session)
  const row = await env.DB.prepare(`
    SELECT
      MAX(updated_at) AS updated_at,
      COUNT(*) AS count
    FROM vocabulary_items
    WHERE user_id = ?1
  `).bind(user.id).first<{ updated_at?: number | null, count?: number | null }>()

  return json({
    updatedAt: typeof row?.updated_at === "number" ? row.updated_at : null,
    count: typeof row?.count === "number" ? row.count : 0,
  })
}

export async function handleVocabularyCreate(request: Request, env: Env, session: SessionContext) {
  const user = await syncUserFromClerk(env, session)
  const item = await readJson<Record<string, unknown>>(request)
  const row = serializeVocabularyItem(item)

  await env.DB.prepare(`
    INSERT INTO vocabulary_items (
      id, user_id, source_text, normalized_text, lemma, match_terms_json, translated_text,
      phonetic, part_of_speech, definition, difficulty, nuance, word_family_json,
      source_lang, target_lang, kind, word_count, created_at, last_seen_at, hit_count,
      updated_at, deleted_at, mastered_at
    )
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23)
  `).bind(
    row.id,
    user.id,
    row.source_text,
    row.normalized_text,
    row.lemma,
    row.match_terms_json,
    row.translated_text,
    row.phonetic,
    row.part_of_speech,
    row.definition,
    row.difficulty,
    row.nuance,
    row.word_family_json,
    row.source_lang,
    row.target_lang,
    row.kind,
    row.word_count,
    row.created_at,
    row.last_seen_at,
    row.hit_count,
    row.updated_at,
    row.deleted_at,
    row.mastered_at,
  ).run()
  await replaceVocabularyContextSentences(env, row.id, item, row.updated_at)

  return json({ ok: true, id: row.id })
}

export async function handleVocabularyUpdate(request: Request, env: Env, session: SessionContext) {
  const user = await syncUserFromClerk(env, session)
  const item = await readJson<Record<string, unknown>>(request)

  const id = typeof item.id === "string" ? item.id : ""
  if (!id) {
    return json({ error: "id is required" }, { status: 400 })
  }
  const row = serializeVocabularyItem(item)

  const result = await env.DB.prepare(`
    UPDATE vocabulary_items
    SET source_text = ?1,
        normalized_text = ?2,
        lemma = ?3,
        match_terms_json = ?4,
        translated_text = ?5,
        phonetic = ?6,
        part_of_speech = ?7,
        definition = ?8,
        difficulty = ?9,
        nuance = ?10,
        word_family_json = ?11,
        source_lang = ?12,
        target_lang = ?13,
        kind = ?14,
        word_count = ?15,
        created_at = ?16,
        last_seen_at = ?17,
        hit_count = ?18,
        updated_at = ?19,
        deleted_at = ?20,
        mastered_at = ?21
    WHERE id = ?22 AND user_id = ?23
  `).bind(
    row.source_text,
    row.normalized_text,
    row.lemma,
    row.match_terms_json,
    row.translated_text,
    row.phonetic,
    row.part_of_speech,
    row.definition,
    row.difficulty,
    row.nuance,
    row.word_family_json,
    row.source_lang,
    row.target_lang,
    row.kind,
    row.word_count,
    row.created_at,
    row.last_seen_at,
    row.hit_count,
    row.updated_at,
    row.deleted_at,
    row.mastered_at,
    id,
    user.id,
  ).run()

  if (result.meta.changes === 0) {
    return json({ error: "not found" }, { status: 404 })
  }

  await replaceVocabularyContextSentences(env, id, item, row.updated_at)

  return json({ ok: true })
}

export async function handleVocabularyDelete(request: Request, env: Env, session: SessionContext, itemId: string) {
  const user = await syncUserFromClerk(env, session)

  await env.DB.prepare(`
    DELETE FROM vocabulary_practice_states
    WHERE user_id = ?1 AND item_id = ?2
  `).bind(user.id, itemId).run()

  await env.DB.prepare(`
    DELETE FROM vocabulary_item_context_sentences
    WHERE vocabulary_item_id = ?1
  `).bind(itemId).run()

  const result = await env.DB.prepare(`
    DELETE FROM vocabulary_items
    WHERE id = ?1 AND user_id = ?2
  `).bind(itemId, user.id).run()

  if (result.meta.changes === 0) {
    return json({ error: "not found" }, { status: 404 })
  }

  return json({ ok: true })
}

export async function handleVocabularyClear(_request: Request, env: Env, session: SessionContext) {
  const user = await syncUserFromClerk(env, session)

  await env.DB.prepare(`
    DELETE FROM vocabulary_practice_states
    WHERE user_id = ?1
  `).bind(user.id).run()

  await env.DB.prepare(`
    DELETE FROM vocabulary_item_context_sentences
    WHERE vocabulary_item_id IN (
      SELECT id
      FROM vocabulary_items
      WHERE user_id = ?1
    )
  `).bind(user.id).run()

  await env.DB.prepare(`
    DELETE FROM vocabulary_items
    WHERE user_id = ?1
  `).bind(user.id).run()

  return json({ ok: true })
}
