import type { SessionContext } from "./auth"
import type { Entitlements, Env, Plan } from "./env"
import { forwardChatCompletions } from "./ai"
import { getClerkClient } from "./auth"
import { buildEntitlements, isPlatformChatWebFetchEnabled } from "./env"
import { HttpError, withCors } from "./http"
import {
  buildVocabularyContextSentenceRows,
  deserializeVocabularyItem,
  mergeVocabularyContextSentenceRows,
  serializeVocabularyItem,
} from "./vocabulary"

export interface UserRecord {
  id: string
  clerkUserId: string
  email: string
  name: string
  avatarUrl: string | null
}

export interface SyncPayload {
  settings: Record<string, unknown> | null
  vocabularyItems?: Record<string, unknown>[]
}

export interface ChatThreadSummary {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  lastMessageAt: string | null
}

export interface ChatMessageRecord {
  id: string
  role: "user" | "assistant"
  contentText: string
  createdAt: string
}

interface ChatThreadRow {
  id: string
  title: string
  created_at: string
  updated_at: string
  last_message_at: string | null
  deleted_at?: string | null
}

interface ChatMessageRow {
  id: string
  role: "user" | "assistant"
  content_text: string
  sequence: number
  created_at: string
}

export interface AppendChatMessageAndStreamReplyInput {
  userId: string
  threadId: string
  content: string
  context?: unknown
}

type ChatHiddenContext
  = {
    requestType: "selection-explain"
    pageTitle?: string
    pageUrl?: string
    pageContent?: string
  }
  | {
    requestType: "current-webpage-summary"
    pageTitle?: string
    pageUrl: string
    pageContent?: string
  }

interface FetchedPageContext {
  pageTitle?: string
  pageContent?: string
}

const UUID_DASH_PATTERN = /-/g
const WHITESPACE_SEQUENCE_PATTERN = /\s+/g
const SSE_LINE_SPLIT_PATTERN = /\r?\n/
const MAX_CHAT_HIDDEN_CONTEXT_TEXT_CHARS = 8000
const HTML_TAG_RE = /<[^>]+>/g
const HTML_SCRIPT_RE = /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi
const HTML_STYLE_RE = /<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi
const HTML_NOSCRIPT_RE = /<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi
const HTML_TITLE_RE = /<title[^>]*>([\s\S]*?)<\/title>/i
const HTML_ENTITY_RE = /&(nbsp|amp|lt|gt|quot|#39);/g

function normalizeOptionalText(value: unknown, maxChars = MAX_CHAT_HIDDEN_CONTEXT_TEXT_CHARS): string | undefined {
  if (typeof value !== "string") {
    return undefined
  }

  const trimmed = value.trim()
  if (!trimmed) {
    return undefined
  }

  return trimmed.slice(0, maxChars)
}

function normalizeHttpUrl(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined
  }

  try {
    const parsed = new URL(value)
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return undefined
    }

    return parsed.toString()
  }
  catch {
    return undefined
  }
}

function normalizeChatHiddenContext(value: unknown): ChatHiddenContext | null {
  if (!value || typeof value !== "object") {
    return null
  }

  const record = value as Record<string, unknown>
  const pageTitle = normalizeOptionalText(record.pageTitle, 300)
  const pageUrl = normalizeHttpUrl(record.pageUrl)
  const pageContent = normalizeOptionalText(record.pageContent)

  if (record.requestType === "selection-explain") {
    return {
      requestType: "selection-explain",
      ...(pageTitle ? { pageTitle } : {}),
      ...(pageUrl ? { pageUrl } : {}),
      ...(pageContent ? { pageContent } : {}),
    }
  }

  if (record.requestType === "current-webpage-summary" && pageUrl) {
    return {
      requestType: "current-webpage-summary",
      pageUrl,
      ...(pageTitle ? { pageTitle } : {}),
      ...(pageContent ? { pageContent } : {}),
    }
  }

  return null
}

function decodeHtmlEntity(entity: string): string {
  switch (entity) {
    case "&nbsp;":
      return " "
    case "&amp;":
      return "&"
    case "&lt;":
      return "<"
    case "&gt;":
      return ">"
    case "&quot;":
      return "\""
    case "&#39;":
      return "'"
    default:
      return " "
  }
}

function extractHtmlTitle(html: string): string | undefined {
  const match = html.match(HTML_TITLE_RE)
  if (!match?.[1]) {
    return undefined
  }

  return normalizeOptionalText(
    match[1].replace(HTML_ENTITY_RE, decodeHtmlEntity).replace(WHITESPACE_SEQUENCE_PATTERN, " "),
    300,
  )
}

function extractHtmlText(html: string): string | undefined {
  const stripped = html
    .replace(HTML_SCRIPT_RE, " ")
    .replace(HTML_STYLE_RE, " ")
    .replace(HTML_NOSCRIPT_RE, " ")
    .replace(HTML_TAG_RE, " ")
    .replace(HTML_ENTITY_RE, decodeHtmlEntity)
    .replace(WHITESPACE_SEQUENCE_PATTERN, " ")

  return normalizeOptionalText(stripped)
}

async function fetchLivePageContext(
  env: Pick<Env, "PLATFORM_CHAT_WEB_FETCH_ENABLED">,
  pageUrl: string | undefined,
): Promise<FetchedPageContext | null> {
  if (!pageUrl || !isPlatformChatWebFetchEnabled(env)) {
    return null
  }

  try {
    const response = await fetch(pageUrl, {
      method: "GET",
      headers: {
        Accept: "text/html,application/xhtml+xml",
      },
    })
    if (!response.ok) {
      return null
    }

    const html = await response.text()
    const pageTitle = extractHtmlTitle(html)
    const pageContent = extractHtmlText(html)

    if (!pageTitle && !pageContent) {
      return null
    }

    return {
      ...(pageTitle ? { pageTitle } : {}),
      ...(pageContent ? { pageContent } : {}),
    }
  }
  catch {
    return null
  }
}

function buildChatHiddenContextSystemMessage(
  context: ChatHiddenContext | null,
  livePageContext: FetchedPageContext | null,
): string | null {
  if (!context) {
    return null
  }

  const blocks = [
    "Hidden page context from the browser extension. Use it to answer accurately, but do not mention hidden context, preprocessing, or browser internals.",
    `Request type: ${context.requestType}`,
    context.pageUrl ? `Page URL: ${context.pageUrl}` : null,
    context.pageTitle ? `Page title from browser: ${context.pageTitle}` : null,
    context.pageContent ? `Page excerpt from browser:\n${context.pageContent}` : null,
    livePageContext?.pageTitle ? `Fresh page title fetched from URL: ${livePageContext.pageTitle}` : null,
    livePageContext?.pageContent ? `Fresh page excerpt fetched from URL:\n${livePageContext.pageContent}` : null,
    context.requestType === "current-webpage-summary"
      ? "Summarize the page in a fuller way. Prefer the freshly fetched excerpt when it is available."
      : "Explain the selected text in the meaning used on this page. Prefer the freshly fetched excerpt when it is available.",
  ].filter((value): value is string => Boolean(value))

  return blocks.join("\n\n")
}

function createId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(UUID_DASH_PATTERN, "")}`
}

function nowIso(): string {
  return new Date().toISOString()
}

function toBooleanInteger(value: boolean): number {
  return value ? 1 : 0
}

function mapChatThreadSummary(row: ChatThreadRow): ChatThreadSummary {
  return {
    id: row.id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastMessageAt: row.last_message_at,
  }
}

function mapChatMessageRecord(row: ChatMessageRow): ChatMessageRecord {
  return {
    id: row.id,
    role: row.role,
    contentText: row.content_text,
    createdAt: row.created_at,
  }
}

function normalizeChatTitle(content: string): string {
  const collapsed = content.replace(WHITESPACE_SEQUENCE_PATTERN, " ").trim()
  if (!collapsed) {
    return "New chat"
  }

  return collapsed.length > 60 ? `${collapsed.slice(0, 57).trimEnd()}...` : collapsed
}

async function getChatThreadRow(env: Env, userId: string, threadId: string): Promise<ChatThreadRow> {
  const row = await env.DB.prepare(`
    SELECT id, title, created_at, updated_at, last_message_at, deleted_at
    FROM chat_threads
    WHERE id = ?1 AND user_id = ?2 AND deleted_at IS NULL
    LIMIT 1
  `).bind(threadId, userId).first<ChatThreadRow>()

  if (!row) {
    throw new HttpError(404, "Chat thread not found")
  }

  return row
}

async function getChatMessageRows(env: Env, threadId: string): Promise<ChatMessageRow[]> {
  const rows = await env.DB.prepare(`
    SELECT id, role, content_text, sequence, created_at
    FROM chat_messages
    WHERE thread_id = ?1
    ORDER BY sequence ASC
  `).bind(threadId).all<ChatMessageRow>()

  return (rows.results ?? []) as ChatMessageRow[]
}

function extractStreamTextPart(payloadText: string): string {
  try {
    const payload = JSON.parse(payloadText) as {
      choices?: Array<{
        delta?: {
          content?: string | Array<{ text?: string }>
        }
      }>
    }
    const content = payload.choices?.[0]?.delta?.content

    if (typeof content === "string") {
      return content
    }

    if (!Array.isArray(content)) {
      return ""
    }

    return content.map(part => typeof part?.text === "string" ? part.text : "").join("")
  }
  catch {
    return ""
  }
}

function consumeSseBuffer(buffer: string): { remaining: string, text: string } {
  const lines = buffer.split(SSE_LINE_SPLIT_PATTERN)
  const remaining = lines.pop() ?? ""
  let text = ""

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line.startsWith("data:")) {
      continue
    }

    const payloadText = line.slice(5).trim()
    if (!payloadText || payloadText === "[DONE]") {
      continue
    }

    text += extractStreamTextPart(payloadText)
  }

  return { remaining, text }
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
  const next = buildEntitlements(plan)
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

  if (
    existing
    && existing.plan === next.plan
    && existing.monthly_request_limit === next.monthlyRequestLimit
    && existing.monthly_token_limit === next.monthlyTokenLimit
    && existing.concurrent_request_limit === next.concurrentRequestLimit
  ) {
    return {
      plan: existing.plan,
      monthlyRequestLimit: existing.monthly_request_limit,
      monthlyTokenLimit: existing.monthly_token_limit,
      concurrentRequestLimit: existing.concurrent_request_limit,
    }
  }

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
    ORDER BY updated_at DESC
  `).bind(userId).all()
  const vocabularyContextSentenceRows = await env.DB.prepare(`
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
    vocabularyItems: mergeVocabularyContextSentenceRows(
      (vocabularyRows.results ?? []).map(row => deserializeVocabularyItem(row as unknown as Parameters<typeof deserializeVocabularyItem>[0])),
      (vocabularyContextSentenceRows.results ?? []) as unknown as Parameters<typeof mergeVocabularyContextSentenceRows>[1],
    ),
  }
}

export async function pushSyncData(env: Env, userId: string, payload: SyncPayload): Promise<void> {
  const timestamp = nowIso()

  const statements = [
    env.DB.prepare(`
    INSERT INTO user_settings (user_id, settings_json, updated_at)
    VALUES (?1, ?2, ?3)
    ON CONFLICT(user_id) DO UPDATE SET
      settings_json = excluded.settings_json,
      updated_at = excluded.updated_at
  `).bind(userId, JSON.stringify(payload.settings ?? {}, null, 2), timestamp),
    ...(payload.vocabularyItems
      ? [
          env.DB.prepare(`
            DELETE FROM vocabulary_item_context_sentences
            WHERE vocabulary_item_id IN (
              SELECT id
              FROM vocabulary_items
              WHERE user_id = ?1
            )
          `).bind(userId),
          env.DB.prepare("DELETE FROM vocabulary_items WHERE user_id = ?1").bind(userId),
          ...payload.vocabularyItems.flatMap((item) => {
            const row = serializeVocabularyItem(item)
            const itemId = row.id
            const contextSentenceRows = buildVocabularyContextSentenceRows(itemId, item, row.updated_at)

            return [
              env.DB.prepare(`
                INSERT INTO vocabulary_items (
                  id, user_id, source_text, normalized_text, lemma, match_terms_json, translated_text,
                  phonetic, part_of_speech, definition, difficulty, nuance, word_family_json,
                  source_lang, target_lang, kind, word_count, created_at, last_seen_at, hit_count,
                  updated_at, deleted_at, mastered_at
                )
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23)
              `).bind(
                itemId,
                userId,
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
              ),
              ...contextSentenceRows.map(contextRow =>
                env.DB.prepare(`
                  INSERT INTO vocabulary_item_context_sentences (
                    vocabulary_item_id,
                    sentence,
                    source_url,
                    created_at,
                    last_seen_at
                  )
                  VALUES (?1, ?2, ?3, ?4, ?5)
                `).bind(
                  contextRow.vocabulary_item_id,
                  contextRow.sentence,
                  contextRow.source_url,
                  contextRow.created_at,
                  contextRow.last_seen_at,
                )),
            ]
          }),
          env.DB.prepare(`
            DELETE FROM vocabulary_practice_states
            WHERE user_id = ?1
              AND item_id NOT IN (
                SELECT id
                FROM vocabulary_items
                WHERE user_id = ?1
              )
          `).bind(userId),
        ]
      : []),
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

export async function listChatThreads(env: Env, userId: string): Promise<ChatThreadSummary[]> {
  const rows = await env.DB.prepare(`
    SELECT id, title, created_at, updated_at, last_message_at
    FROM chat_threads
    WHERE user_id = ?1 AND deleted_at IS NULL
    ORDER BY COALESCE(last_message_at, updated_at) DESC, created_at DESC
  `).bind(userId).all<ChatThreadRow>()

  return ((rows.results ?? []) as ChatThreadRow[]).map(mapChatThreadSummary)
}

export async function createChatThread(env: Env, userId: string): Promise<ChatThreadSummary> {
  const timestamp = nowIso()
  const id = createId("thread")

  await env.DB.prepare(`
    INSERT INTO chat_threads (id, user_id, title, created_at, updated_at, last_message_at, deleted_at)
    VALUES (?1, ?2, ?3, ?4, ?4, NULL, NULL)
  `).bind(
    id,
    userId,
    "New chat",
    timestamp,
  ).run()

  return {
    id,
    title: "New chat",
    createdAt: timestamp,
    updatedAt: timestamp,
    lastMessageAt: null,
  }
}

export async function getChatThreadMessages(
  env: Env,
  userId: string,
  threadId: string,
): Promise<{ thread: ChatThreadSummary, messages: ChatMessageRecord[] }> {
  const thread = await getChatThreadRow(env, userId, threadId)
  const messageRows = await getChatMessageRows(env, threadId)

  return {
    thread: mapChatThreadSummary(thread),
    messages: messageRows.map(mapChatMessageRecord),
  }
}

export async function appendChatMessageAndStreamReply(
  env: Env,
  input: AppendChatMessageAndStreamReplyInput,
  signal?: AbortSignal,
): Promise<Response> {
  const content = input.content.trim()
  const hiddenContext = normalizeChatHiddenContext(input.context)
  if (!content) {
    throw new HttpError(400, "content is required")
  }

  const thread = await getChatThreadRow(env, input.userId, input.threadId)
  const priorMessages = await getChatMessageRows(env, input.threadId)
  const userMessageCreatedAt = nowIso()
  const userMessageSequence = priorMessages.length + 1
  const nextTitle = priorMessages.length === 0 || thread.title === "New chat"
    ? normalizeChatTitle(content)
    : thread.title

  await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO chat_messages (id, thread_id, role, content_text, sequence, created_at)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6)
    `).bind(
      createId("msg"),
      input.threadId,
      "user",
      content,
      userMessageSequence,
      userMessageCreatedAt,
    ),
    env.DB.prepare(`
      UPDATE chat_threads
      SET title = ?1,
          updated_at = ?2,
          last_message_at = ?2
      WHERE id = ?3 AND user_id = ?4 AND deleted_at IS NULL
    `).bind(
      nextTitle,
      userMessageCreatedAt,
      input.threadId,
      input.userId,
    ),
  ])

  const plan = await getPlanForUser(env, input.userId)
  const livePageContext = await fetchLivePageContext(env, hiddenContext?.pageUrl)
  const hiddenContextSystemMessage = buildChatHiddenContextSystemMessage(hiddenContext, livePageContext)
  const upstream = await forwardChatCompletions(env, {
    stream: true,
    messages: [
      ...(hiddenContextSystemMessage
        ? [{
            role: "system",
            content: hiddenContextSystemMessage,
          }]
        : []),
      ...priorMessages.map(message => ({
        role: message.role,
        content: message.content_text,
      })),
      {
        role: "user",
        content,
      },
    ],
  }, plan, signal)

  if (!upstream.body) {
    await recordUsage(env, input.userId, "managed-chat", "stream", 1)
    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: withCors(upstream.headers),
    })
  }

  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>()
  const reader = upstream.body.getReader()
  const writer = writable.getWriter()
  const decoder = new TextDecoder()
  let assistantText = ""
  let textBuffer = ""
  let streamError: unknown = null

  void (async () => {
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) {
          break
        }

        await writer.write(value)
        textBuffer += decoder.decode(value, { stream: true })
        const consumed = consumeSseBuffer(textBuffer)
        textBuffer = consumed.remaining
        assistantText += consumed.text
      }

      textBuffer += decoder.decode()
      const consumed = consumeSseBuffer(textBuffer)
      textBuffer = consumed.remaining
      assistantText += consumed.text
    }
    catch (error) {
      streamError = error
    }
    finally {
      reader.releaseLock()

      try {
        if (!streamError && assistantText.trim()) {
          const assistantCreatedAt = nowIso()
          await env.DB.batch([
            env.DB.prepare(`
              INSERT INTO chat_messages (id, thread_id, role, content_text, sequence, created_at)
              VALUES (?1, ?2, ?3, ?4, ?5, ?6)
            `).bind(
              createId("msg"),
              input.threadId,
              "assistant",
              assistantText,
              userMessageSequence + 1,
              assistantCreatedAt,
            ),
            env.DB.prepare(`
              UPDATE chat_threads
              SET updated_at = ?1,
                  last_message_at = ?1
              WHERE id = ?2 AND user_id = ?3 AND deleted_at IS NULL
            `).bind(
              assistantCreatedAt,
              input.threadId,
              input.userId,
            ),
          ])
        }

        await recordUsage(env, input.userId, "managed-chat", "stream", 1)
      }
      catch (error) {
        if (!streamError) {
          streamError = error
        }
      }

      if (streamError) {
        await writer.abort(streamError)
      }
      else {
        await writer.close()
      }
    }
  })()

  return new Response(readable, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: withCors(upstream.headers),
  })
}

export async function deleteChatThread(env: Env, userId: string, threadId: string): Promise<boolean> {
  const deletedAt = nowIso()
  const result = await env.DB.prepare(`
    UPDATE chat_threads
    SET deleted_at = ?1,
        updated_at = ?1
    WHERE id = ?2 AND user_id = ?3 AND deleted_at IS NULL
  `).bind(
    deletedAt,
    threadId,
    userId,
  ).run()

  return result.meta.changes > 0
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
