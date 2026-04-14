import type { SessionContext } from "../lib/auth"
import type { Env } from "../lib/env"
import { pullSyncData, pushSyncData, syncUserFromClerk } from "../lib/db"
import { json, readJson } from "../lib/http"

export async function handleSyncPull(_request: Request, env: Env, session: SessionContext) {
  const user = await syncUserFromClerk(env, session)
  const payload = await pullSyncData(env, user.id)

  return json({
    settings: payload.settings,
    vocabularyItems: payload.vocabularyItems,
  })
}

export async function handleSyncPush(request: Request, env: Env, session: SessionContext) {
  const user = await syncUserFromClerk(env, session)
  const payload = await readJson<{
    settings?: Record<string, unknown> | null
    vocabularyItems?: Record<string, unknown>[]
  }>(request)

  await pushSyncData(env, user.id, {
    settings: payload.settings ?? null,
    vocabularyItems: payload.vocabularyItems ?? [],
  })

  return json({
    ok: true,
    syncedAt: new Date().toISOString(),
  })
}
