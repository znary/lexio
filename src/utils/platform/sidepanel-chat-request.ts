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
    pageContent: z.string().trim().min(1).optional(),
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
export type SidepanelChatRequestHiddenContext
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

interface SidepanelRequestWebPageContext {
  url?: string | null
  webTitle?: string | null
  webContent?: string | null
  webContextContent?: string | null
}

function trimOptionalValue(value?: string | null) {
  return value?.trim() || undefined
}

function resolveSidepanelRequestPageContext({
  fallbackPageTitle,
  fallbackPageUrl,
  webPageContext,
}: {
  fallbackPageTitle?: string | null
  fallbackPageUrl?: string | null
  webPageContext?: SidepanelRequestWebPageContext | null
}) {
  const pageTitle = trimOptionalValue(webPageContext?.webTitle) ?? trimOptionalValue(fallbackPageTitle)
  const pageUrl = trimOptionalValue(webPageContext?.url) ?? trimOptionalValue(fallbackPageUrl)
  const pageContent = clampPageContent(
    trimOptionalValue(webPageContext?.webContextContent) ?? trimOptionalValue(webPageContext?.webContent),
  ) || undefined

  return {
    ...(pageTitle ? { pageTitle } : {}),
    ...(pageUrl ? { pageUrl } : {}),
    ...(pageContent ? { pageContent } : {}),
  }
}

function toBlockquote(value: string) {
  return value
    .split("\n")
    .map(line => `> ${line}`.trimEnd())
    .join("\n")
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

export function buildSelectionExplainRequestPayload({
  fallbackPageTitle,
  fallbackPageUrl,
  selectionText,
  webPageContext,
}: {
  fallbackPageTitle?: string | null
  fallbackPageUrl?: string | null
  selectionText: string
  webPageContext?: SidepanelRequestWebPageContext | null
}): SidepanelChatRequestPayload | null {
  const normalizedSelectionText = selectionText.trim()
  if (!normalizedSelectionText) {
    return null
  }

  return {
    type: "selection-explain",
    selectionText: normalizedSelectionText,
    ...resolveSidepanelRequestPageContext({
      fallbackPageTitle,
      fallbackPageUrl,
      webPageContext,
    }),
  }
}

export function buildCurrentWebPageSummaryRequestPayload({
  fallbackPageTitle,
  fallbackPageUrl,
  webPageContext,
}: {
  fallbackPageTitle?: string | null
  fallbackPageUrl?: string | null
  webPageContext?: SidepanelRequestWebPageContext | null
}): SidepanelChatRequestPayload | null {
  const pageContext = resolveSidepanelRequestPageContext({
    fallbackPageTitle,
    fallbackPageUrl,
    webPageContext,
  })

  if (!pageContext.pageUrl) {
    return null
  }

  return {
    type: "current-webpage-summary",
    pageUrl: pageContext.pageUrl,
    ...(pageContext.pageTitle ? { pageTitle: pageContext.pageTitle } : {}),
    ...(pageContext.pageContent ? { pageContent: pageContext.pageContent } : {}),
  }
}

export function buildSidepanelChatRequestPrompt(
  payload: SidepanelChatRequestPayload,
  targetCode: LangCodeISO6393,
): string {
  const targetLanguageName = LANG_CODE_TO_EN_NAME[targetCode]

  if (payload.type === "selection-explain") {
    return [
      `Answer in ${targetLanguageName}.`,
      "",
      "Explain the selected text below.",
      "",
      toBlockquote(payload.selectionText),
    ].filter(part => part != null).join("\n")
  }

  return [
    `Answer in ${targetLanguageName}.`,
    "",
    "Summarize the current web page in detail.",
  ].filter(part => part != null).join("\n")
}

export function buildSidepanelChatRequestHiddenContext(
  payload: SidepanelChatRequestPayload,
): SidepanelChatRequestHiddenContext {
  const pageTitle = payload.pageTitle?.trim() || undefined
  const pageUrl = payload.pageUrl?.trim() || undefined
  const pageContent = clampPageContent(payload.pageContent) || undefined

  if (payload.type === "selection-explain") {
    return {
      requestType: "selection-explain",
      ...(pageTitle ? { pageTitle } : {}),
      ...(pageUrl ? { pageUrl } : {}),
      ...(pageContent ? { pageContent } : {}),
    }
  }

  return {
    requestType: "current-webpage-summary",
    pageUrl: payload.pageUrl.trim(),
    ...(pageTitle ? { pageTitle } : {}),
    ...(pageContent ? { pageContent } : {}),
  }
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
