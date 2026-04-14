import type { SessionContext } from "./auth"
import type { Entitlements, Env, Plan } from "./env"
import { getClerkClient } from "./auth"
import { buildEntitlements } from "./env"

export interface UserRecord {
  id: string
  clerkUserId: string
  email: string
  name: string
  avatarUrl: string | null
}

export interface SyncPayload {
  settings: Record<string, unknown> | null
  vocabularyItems: Record<string, unknown>[]
}

const UUID_DASH_PATTERN = /-/g

function createId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(UUID_DASH_PATTERN, "")}`
}

function nowIso(): string {
  return new Date().toISOString()
}

function toBooleanInteger(value: boolean): number {
  return value ? 1 : 0
}

export async function syncUserFromClerkId(env: Env, clerkUserId: string): Promise<UserRecord> {
  const clerk = getClerkClient(env)
  const clerkUser = await clerk.users.getUser(clerkUserId)
  const email = clerkUser.emailAddresses.find(item => item.id === clerkUser.primaryEmailAddressId)?.emailAddress
    ?? clerkUser.emailAddresses[0]?.emailAddress
    ?? `${clerkUser.id}@lexio.local`
  const name = [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(" ").trim()
    || clerkUser.username
    || email
  const avatarUrl = clerkUser.imageUrl ?? null
  const timestamp = nowIso()

  const existing = await env.DB.prepare(
    "SELECT id FROM users WHERE clerk_user_id = ?1",
  ).bind(clerkUser.id).first<{ id: string }>()

  const id = existing?.id ?? createId("usr")
  await env.DB.prepare(`
    INSERT INTO users (id, clerk_user_id, email, name, avatar_url, created_at, updated_at)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)
    ON CONFLICT(clerk_user_id) DO UPDATE SET
      email = excluded.email,
      name = excluded.name,
      avatar_url = excluded.avatar_url,
      updated_at = excluded.updated_at
  `).bind(id, clerkUser.id, email, name, avatarUrl, timestamp).run()

  await ensureEntitlements(env, id, "free")

  return {
    id,
    clerkUserId: clerkUser.id,
    email,
    name,
    avatarUrl,
  }
}

export async function syncUserFromClerk(env: Env, session: SessionContext): Promise<UserRecord> {
  return syncUserFromClerkId(env, session.clerkUserId)
}

export async function getPlanForUser(env: Env, userId: string): Promise<Plan> {
  const subscription = await env.DB.prepare(`
    SELECT plan
    FROM subscriptions
    WHERE user_id = ?1 AND status IN ('active', 'trialing', 'past_due')
    ORDER BY updated_at DESC
    LIMIT 1
  `).bind(userId).first<{ plan: Plan }>()

  return subscription?.plan ?? "free"
}

export async function ensureEntitlements(env: Env, userId: string, plan: Plan): Promise<Entitlements> {
  const existing = await env.DB.prepare(`
    SELECT plan, monthly_request_limit, monthly_token_limit, concurrent_request_limit
    FROM entitlements
    WHERE user_id = ?1
  `).bind(userId).first<{
    plan: Plan
    monthly_request_limit: number
    monthly_token_limit: number
    concurrent_request_limit: number
  }>()

  if (existing && existing.plan === plan) {
    return {
      plan: existing.plan,
      monthlyRequestLimit: existing.monthly_request_limit,
      monthlyTokenLimit: existing.monthly_token_limit,
      concurrentRequestLimit: existing.concurrent_request_limit,
    }
  }

  const next = buildEntitlements(plan)
  await env.DB.prepare(`
    INSERT INTO entitlements (user_id, plan, monthly_request_limit, monthly_token_limit, concurrent_request_limit, updated_at)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6)
    ON CONFLICT(user_id) DO UPDATE SET
      plan = excluded.plan,
      monthly_request_limit = excluded.monthly_request_limit,
      monthly_token_limit = excluded.monthly_token_limit,
      concurrent_request_limit = excluded.concurrent_request_limit,
      updated_at = excluded.updated_at
  `).bind(
    userId,
    next.plan,
    next.monthlyRequestLimit,
    next.monthlyTokenLimit,
    next.concurrentRequestLimit,
    nowIso(),
  ).run()

  return next
}

export async function getOrCreateSyncState(env: Env, userId: string) {
  const existing = await env.DB.prepare(`
    SELECT last_push_at, last_pull_at, last_sync_status, updated_at
    FROM sync_state
    WHERE user_id = ?1
  `).bind(userId).first<{
    last_push_at: string | null
    last_pull_at: string | null
    last_sync_status: string
    updated_at: string
  }>()

  if (existing) {
    return existing
  }

  const timestamp = nowIso()
  await env.DB.prepare(`
    INSERT INTO sync_state (user_id, last_push_at, last_pull_at, last_sync_status, updated_at)
    VALUES (?1, NULL, NULL, 'idle', ?2)
  `).bind(userId, timestamp).run()

  return {
    last_push_at: null,
    last_pull_at: null,
    last_sync_status: "idle",
    updated_at: timestamp,
  }
}

export async function pullSyncData(env: Env, userId: string): Promise<SyncPayload> {
  const settingsRow = await env.DB.prepare(`
    SELECT settings_json
    FROM user_settings
    WHERE user_id = ?1
  `).bind(userId).first<{ settings_json: string }>()

  const vocabularyRows = await env.DB.prepare(`
    SELECT item_json
    FROM vocabulary_items
    WHERE user_id = ?1
    ORDER BY updated_at DESC
  `).bind(userId).all<{ item_json: string }>()

  const now = nowIso()
  await env.DB.prepare(`
    INSERT INTO sync_state (user_id, last_push_at, last_pull_at, last_sync_status, updated_at)
    VALUES (?1, NULL, ?2, 'success', ?2)
    ON CONFLICT(user_id) DO UPDATE SET
      last_pull_at = excluded.last_pull_at,
      last_sync_status = excluded.last_sync_status,
      updated_at = excluded.updated_at
  `).bind(userId, now).run()

  return {
    settings: settingsRow?.settings_json ? JSON.parse(settingsRow.settings_json) as Record<string, unknown> : null,
    vocabularyItems: (vocabularyRows.results ?? []).map((row: { item_json: string }) => JSON.parse(row.item_json) as Record<string, unknown>),
  }
}

export async function pushSyncData(env: Env, userId: string, payload: SyncPayload): Promise<void> {
  const timestamp = nowIso()

  await env.DB.prepare(`
    INSERT INTO user_settings (user_id, settings_json, updated_at)
    VALUES (?1, ?2, ?3)
    ON CONFLICT(user_id) DO UPDATE SET
      settings_json = excluded.settings_json,
      updated_at = excluded.updated_at
  `).bind(userId, JSON.stringify(payload.settings ?? {}, null, 2), timestamp).run()

  const statements = [
    env.DB.prepare("DELETE FROM vocabulary_items WHERE user_id = ?1").bind(userId),
    ...payload.vocabularyItems.map((item) => {
      const normalizedText = typeof item.normalizedText === "string" ? item.normalizedText : ""
      const id = typeof item.id === "string" ? item.id : createId("voc")
      return env.DB.prepare(`
        INSERT INTO vocabulary_items (id, user_id, item_json, normalized_text, updated_at)
        VALUES (?1, ?2, ?3, ?4, ?5)
      `).bind(id, userId, JSON.stringify(item), normalizedText, timestamp)
    }),
    env.DB.prepare(`
      INSERT INTO sync_state (user_id, last_push_at, last_pull_at, last_sync_status, updated_at)
      VALUES (?1, ?2, NULL, 'success', ?2)
      ON CONFLICT(user_id) DO UPDATE SET
        last_push_at = excluded.last_push_at,
        last_sync_status = excluded.last_sync_status,
        updated_at = excluded.updated_at
    `).bind(userId, timestamp),
  ]

  await env.DB.batch(statements)
}

export async function recordUsage(
  env: Env,
  userId: string,
  feature: string,
  requestKind: string,
  requestCount: number,
  inputTokens = 0,
  outputTokens = 0,
): Promise<void> {
  await env.DB.prepare(`
    INSERT INTO usage_ledger (id, user_id, feature, request_kind, request_count, input_tokens, output_tokens, created_at)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
  `).bind(
    createId("use"),
    userId,
    feature,
    requestKind,
    requestCount,
    inputTokens,
    outputTokens,
    nowIso(),
  ).run()
}

export async function buildMePayload(env: Env, user: UserRecord) {
  const plan = await getPlanForUser(env, user.id)
  const entitlements = await ensureEntitlements(env, user.id, plan)
  const syncState = await getOrCreateSyncState(env, user.id)

  return {
    user,
    subscription: {
      plan,
      status: plan === "pro" ? "active" : "free",
    },
    entitlements,
    sync: {
      lastPushAt: syncState.last_push_at,
      lastPullAt: syncState.last_pull_at,
      lastStatus: syncState.last_sync_status,
      updatedAt: syncState.updated_at,
    },
  }
}

export async function upsertSubscriptionFromPaddle(
  env: Env,
  clerkUserId: string,
  paddleSubscriptionId: string,
  plan: Plan,
  status: string,
  currentPeriodStart: string | null,
  currentPeriodEnd: string | null,
  cancelAtPeriodEnd: boolean,
): Promise<void> {
  const existingUser = await env.DB.prepare(`
    SELECT id
    FROM users
    WHERE clerk_user_id = ?1
  `).bind(clerkUserId).first<{ id: string }>()
  const userId = existingUser?.id ?? (await syncUserFromClerkId(env, clerkUserId)).id

  const timestamp = nowIso()
  await env.DB.prepare(`
    INSERT INTO subscriptions (
      id,
      user_id,
      paddle_subscription_id,
      plan,
      status,
      current_period_start,
      current_period_end,
      cancel_at_period_end,
      created_at,
      updated_at
    )
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)
    ON CONFLICT(paddle_subscription_id) DO UPDATE SET
      plan = excluded.plan,
      status = excluded.status,
      current_period_start = excluded.current_period_start,
      current_period_end = excluded.current_period_end,
      cancel_at_period_end = excluded.cancel_at_period_end,
      updated_at = excluded.updated_at
  `).bind(
    createId("sub"),
    userId,
    paddleSubscriptionId,
    plan,
    status,
    currentPeriodStart,
    currentPeriodEnd,
    toBooleanInteger(cancelAtPeriodEnd),
    timestamp,
  ).run()

  await ensureEntitlements(env, userId, plan)
}
