import type { WebPageContext } from "@/types/content"
import { Readability } from "@mozilla/readability"
import { removeDummyNodes } from "@/utils/content/utils"
import { logger } from "@/utils/logger"
import { truncateWebPageContent, truncateWebPageContextContent } from "./webpage-content"

export interface CachedWebPageContext extends WebPageContext {
  url: string
  webContent: string
  webContextContent: string
}

let cachedWebPageContext: CachedWebPageContext | null = null

async function extractWebpageContent(): Promise<string> {
  try {
    const documentClone = document.cloneNode(true) as Document
    await removeDummyNodes(documentClone)
    const article = new Readability(documentClone, { serializer: el => el }).parse()
    if (article?.textContent)
      return article.textContent
  }
  catch (error) {
    logger.warn("Readability parsing failed, falling back to body textContent:", error)
  }
  return document.body?.textContent || ""
}

export async function getOrCreateWebPageContext(): Promise<CachedWebPageContext | null> {
  if (typeof window === "undefined" || typeof document === "undefined")
    return null

  const currentUrl = window.location.href
  if (cachedWebPageContext?.url === currentUrl) {
    return cachedWebPageContext
  }

  cachedWebPageContext = {
    url: currentUrl,
    webTitle: document.title || "",
    webContent: "",
    webContextContent: "",
  }

  const extractedContent = await extractWebpageContent()
  cachedWebPageContext.webContent = truncateWebPageContent(extractedContent)
  cachedWebPageContext.webContextContent = truncateWebPageContextContent(extractedContent)

  return cachedWebPageContext
}
