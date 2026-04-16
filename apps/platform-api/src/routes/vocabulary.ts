import type { SessionContext } from "../lib/auth"
import type { Env } from "../lib/env"
import { syncUserFromClerk } from "../lib/db"
import { json, readJson } from "../lib/http"

export async function handleVocabularyList(_request: Request, env: Env, session: SessionContext) {
  const user = await syncUserFromClerk(env, session)
  const rows = await env.DB.prepare(`
    SELECT item_json
    FROM vocabulary_items
    WHERE user_id = ?1
    ORDER BY updated_at DESC
  `).bind(user.id).all<{ item_json: string }>()

  const items = (rows.results ?? []).map(row => JSON.parse(row.item_json) as Record<string, unknown>)

  return json({ items })
}

export async function handleVocabularyCreate(request: Request, env: Env, session: SessionContext) {
  const user = await syncUserFromClerk(env, session)
  const item = await readJson<Record<string, unknown>>(request)

  const id = typeof item.id === "string" ? item.id : crypto.randomUUID()
  const nextItem = { ...item, id }
  const normalizedText = typeof item.normalizedText === "string" ? item.normalizedText : ""
  const timestamp = new Date().toISOString()

  await env.DB.prepare(`
    INSERT INTO vocabulary_items (id, user_id, item_json, normalized_text, updated_at)
    VALUES (?1, ?2, ?3, ?4, ?5)
  `).bind(id, user.id, JSON.stringify(nextItem), normalizedText, timestamp).run()

  return json({ ok: true, id })
}

export async function handleVocabularyUpdate(request: Request, env: Env, session: SessionContext) {
  const user = await syncUserFromClerk(env, session)
  const item = await readJson<Record<string, unknown>>(request)

  const id = typeof item.id === "string" ? item.id : ""
  if (!id) {
    return json({ error: "id is required" }, { status: 400 })
  }

  const normalizedText = typeof item.normalizedText === "string" ? item.normalizedText : ""
  const timestamp = new Date().toISOString()

  const result = await env.DB.prepare(`
    UPDATE vocabulary_items
    SET item_json = ?1, normalized_text = ?2, updated_at = ?3
    WHERE id = ?4 AND user_id = ?5
  `).bind(JSON.stringify(item), normalizedText, timestamp, id, user.id).run()

  if (result.meta.changes === 0) {
    return json({ error: "not found" }, { status: 404 })
  }

  return json({ ok: true })
}

export async function handleVocabularyDelete(request: Request, env: Env, session: SessionContext, itemId: string) {
  const user = await syncUserFromClerk(env, session)

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
    DELETE FROM vocabulary_items
    WHERE user_id = ?1
  `).bind(user.id).run()

  return json({ ok: true })
}
