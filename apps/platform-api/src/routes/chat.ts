import type { SessionContext } from "../lib/auth"
import type { Env } from "../lib/env"
import {
  appendChatMessageAndStreamReply,
  createChatThread,
  deleteChatThread,
  getChatThreadMessages,
  listChatThreads,
  syncUserFromClerk,
} from "../lib/db"
import { HttpError, json, readJson } from "../lib/http"

export async function handleChatThreadList(_request: Request, env: Env, session: SessionContext) {
  const user = await syncUserFromClerk(env, session)
  const threads = await listChatThreads(env, user.id)
  return json({ threads })
}

export async function handleChatThreadCreate(_request: Request, env: Env, session: SessionContext) {
  const user = await syncUserFromClerk(env, session)
  const thread = await createChatThread(env, user.id)
  return json({ thread })
}

export async function handleChatThreadMessages(_request: Request, env: Env, session: SessionContext, threadId: string) {
  const user = await syncUserFromClerk(env, session)
  const payload = await getChatThreadMessages(env, user.id, threadId)
  return json(payload)
}

export async function handleChatThreadMessageStream(request: Request, env: Env, session: SessionContext, threadId: string) {
  const user = await syncUserFromClerk(env, session)
  const body = await readJson<{ content?: string, context?: unknown }>(request)
  const content = body.content?.trim() ?? ""
  if (!content) {
    throw new HttpError(400, "content is required")
  }

  return await appendChatMessageAndStreamReply(env, {
    userId: user.id,
    threadId,
    content,
    context: body.context,
  }, request.signal)
}

export async function handleChatThreadDelete(_request: Request, env: Env, session: SessionContext, threadId: string) {
  const user = await syncUserFromClerk(env, session)
  const deleted = await deleteChatThread(env, user.id, threadId)
  if (!deleted) {
    throw new HttpError(404, "Chat thread not found")
  }

  return json({ ok: true })
}
