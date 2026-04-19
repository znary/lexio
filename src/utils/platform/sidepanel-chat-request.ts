import type { LangCodeISO6393 } from "@read-frog/definitions"
import { storage } from "#imports"
import { LANG_CODE_TO_EN_NAME } from "@read-frog/definitions"
import { z } from "zod"
import { getRandomUUID } from "../crypto-polyfill"
import { logger } from "../logger"

const SIDEPANEL_CHAT_REQUEST_STORAGE_KEY_PREFIX = "session:sidepanelChatRequest" as const
const MAX_PAGE_CONTENT_CHARS = 6000

const sidepanelChatRequestPayloadSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("selection-explain"),
    selectionText: z.string().trim().min(1),
    pageTitle: z.string().trim().min(1).optional(),
    pageUrl: z.string().trim().min(1).optional(),
  }),
  z.object({
    type: z.literal("current-webpage-summary"),
    pageTitle: z.string().trim().min(1).optional(),
    pageUrl: z.string().trim().min(1),
    pageContent: z.string().trim().min(1).optional(),
  }),
])

const sidepanelChatRequestSchema = z.object({
  id: z.string().min(1),
  payload: sidepanelChatRequestPayloadSchema,
})
const sidepanelChatRequestQueueSchema = z.array(sidepanelChatRequestSchema)

export type SidepanelChatRequestPayload = z.infer<typeof sidepanelChatRequestPayloadSchema>
export type SidepanelChatRequest = z.infer<typeof sidepanelChatRequestSchema>

function toBlockquote(value: string) {
  return value
    .split("\n")
    .map(line => `> ${line}`.trimEnd())
    .join("\n")
}

function buildReferenceBlock(pageTitle?: string, pageUrl?: string) {
  const lines = [
    pageTitle ? `Title: ${pageTitle}` : null,
    pageUrl ? `URL: ${pageUrl}` : null,
  ].filter(line => !!line)

  if (lines.length === 0) {
    return null
  }

  return toBlockquote(lines.join("\n"))
}

function getSidepanelChatRequestStorageKey(windowId: number) {
  return `${SIDEPANEL_CHAT_REQUEST_STORAGE_KEY_PREFIX}.${windowId}` as const
}

function clampPageContent(pageContent: string | undefined) {
  if (!pageContent) {
    return null
  }

  return pageContent.slice(0, MAX_PAGE_CONTENT_CHARS).trim() || null
}

export function createSidepanelChatRequest(payload: SidepanelChatRequestPayload): SidepanelChatRequest {
  return {
    id: getRandomUUID(),
    payload,
  }
}

export function buildSidepanelChatRequestPrompt(
  payload: SidepanelChatRequestPayload,
  targetCode: LangCodeISO6393,
): string {
  const targetLanguageName = LANG_CODE_TO_EN_NAME[targetCode]
  const referenceBlock = buildReferenceBlock(payload.pageTitle, payload.pageUrl)

  if (payload.type === "selection-explain") {
    return [
      `Answer in ${targetLanguageName}.`,
      "",
      "Explain the selected text below.",
      "",
      toBlockquote(payload.selectionText),
      referenceBlock ? "" : null,
      referenceBlock,
    ].filter(part => part != null).join("\n")
  }

  const pageContent = clampPageContent(payload.pageContent)
  return [
    `Answer in ${targetLanguageName}.`,
    "",
    "Summarize the main content of this web page.",
    referenceBlock ? "" : null,
    referenceBlock,
    pageContent ? "" : null,
    pageContent ? "Page excerpt:" : null,
    pageContent ? toBlockquote(pageContent) : null,
  ].filter(part => part != null).join("\n")
}

export async function getPendingSidepanelChatRequests(windowId: number): Promise<SidepanelChatRequest[]> {
  const value = await storage.getItem<unknown>(getSidepanelChatRequestStorageKey(windowId))
  const parsed = sidepanelChatRequestQueueSchema.safeParse(value)

  if (parsed.success) {
    return parsed.data
  }

  if (value != null) {
    logger.warn("Pending sidepanel chat request queue is invalid, clearing it", { windowId })
    await storage.removeItem(getSidepanelChatRequestStorageKey(windowId))
  }

  return []
}

export async function enqueuePendingSidepanelChatRequest(
  windowId: number,
  request: SidepanelChatRequest,
): Promise<void> {
  const currentQueue = await getPendingSidepanelChatRequests(windowId)
  await storage.setItem(getSidepanelChatRequestStorageKey(windowId), [...currentQueue, request])
}

export async function consumePendingSidepanelChatRequest(windowId: number, requestId: string): Promise<void> {
  const currentQueue = await getPendingSidepanelChatRequests(windowId)
  const nextQueue = currentQueue.filter(request => request.id !== requestId)

  if (nextQueue.length === currentQueue.length) {
    return
  }

  if (nextQueue.length === 0) {
    await storage.removeItem(getSidepanelChatRequestStorageKey(windowId))
    return
  }

  await storage.setItem(getSidepanelChatRequestStorageKey(windowId), nextQueue)
}

export function watchPendingSidepanelChatRequests(
  windowId: number,
  callback: (requests: SidepanelChatRequest[]) => void,
) {
  return storage.watch<unknown>(getSidepanelChatRequestStorageKey(windowId), (value) => {
    const parsed = sidepanelChatRequestQueueSchema.safeParse(value)
    callback(parsed.success ? parsed.data : [])
  })
}
