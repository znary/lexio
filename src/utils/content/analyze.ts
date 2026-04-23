import type { LangCodeISO6393 } from "@read-frog/definitions"
import type { Config } from "@/types/config/config"
import type { DetectionSource } from "@/utils/content/language"
import { Readability } from "@mozilla/readability"
import { ISO6393_TO_6391, LANG_CODE_ISO6393_OPTIONS, LOCALE_TO_ISO6393 } from "@read-frog/definitions"
import { flattenToParagraphs } from "@/entrypoints/side.content/utils/article"
import { detectLanguageWithSource } from "@/utils/content/language"
import { getLocalConfig } from "../config/storage"
import { logger } from "../logger"
import { cleanText, removeDummyNodes } from "./utils"

export type { DetectionSource } from "@/utils/content/language"

const LANGUAGE_DETECTION_SAMPLE_LIMIT = 3000
const LANGUAGE_DETECTION_SAMPLE_ROOT_SELECTOR = "main, article, [role='main']"
const LANGUAGE_TAG_SPLIT_RE = /[-_]/
const LANGUAGE_DETECTION_SKIPPED_SELECTOR = [
  "script",
  "style",
  "noscript",
  "code",
  "pre",
  "textarea",
  "input",
  "select",
  "option",
  "button",
  "svg",
  "math",
  "[contenteditable='true']",
].join(", ")

const ISO6393_CODE_SET = new Set<LangCodeISO6393>(LANG_CODE_ISO6393_OPTIONS)
const ISO6391_TO_ISO6393 = new Map<string, LangCodeISO6393>()

for (const [code, locale] of Object.entries(ISO6393_TO_6391)) {
  if (locale && !ISO6391_TO_ISO6393.has(locale)) {
    ISO6391_TO_ISO6393.set(locale, code as LangCodeISO6393)
  }
}

for (const [locale, code] of Object.entries(LOCALE_TO_ISO6393)) {
  ISO6391_TO_ISO6393.set(locale, code)
}

function resolveDocumentLangCode(): LangCodeISO6393 | null {
  const rawDocumentLang = [
    document.documentElement?.getAttribute("lang"),
    document.documentElement?.getAttribute("xml:lang"),
    document.body?.getAttribute("lang"),
  ].find(value => value?.trim())

  if (!rawDocumentLang) {
    return null
  }

  const primarySubtag = rawDocumentLang.trim().toLowerCase().split(LANGUAGE_TAG_SPLIT_RE)[0]
  if (!primarySubtag) {
    return null
  }

  const mappedCode = ISO6391_TO_ISO6393.get(primarySubtag)
  if (mappedCode) {
    return mappedCode
  }

  if (ISO6393_CODE_SET.has(primarySubtag as LangCodeISO6393)) {
    return primarySubtag as LangCodeISO6393
  }

  return null
}

function shouldSkipLanguageDetectionText(parentElement: Element): boolean {
  return parentElement.matches(LANGUAGE_DETECTION_SKIPPED_SELECTOR)
    || parentElement.closest(LANGUAGE_DETECTION_SKIPPED_SELECTOR) !== null
}

function collectDocumentLanguageSample(maxLength: number = LANGUAGE_DETECTION_SAMPLE_LIMIT): string {
  const traversalRoot = document.querySelector(LANGUAGE_DETECTION_SAMPLE_ROOT_SELECTOR)
    ?? document.body
    ?? document.documentElement

  if (!traversalRoot) {
    return ""
  }

  const textParts: string[] = []
  let currentLength = 0
  const walker = document.createTreeWalker(traversalRoot, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parentElement = node.parentElement
      if (!parentElement || shouldSkipLanguageDetectionText(parentElement)) {
        return NodeFilter.FILTER_REJECT
      }

      return cleanText(node.textContent ?? "", maxLength) === ""
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT
    },
  })

  let currentNode = walker.nextNode()
  while (currentNode && currentLength < maxLength) {
    const remainingLength = maxLength - currentLength
    const text = cleanText(currentNode.textContent ?? "", remainingLength)
    if (text) {
      textParts.push(text)
      currentLength += text.length + 1
    }
    currentNode = walker.nextNode()
  }

  return cleanText(textParts.join(" "), maxLength)
}

export async function detectDocumentLanguageForBootstrap(configOverride?: Config | null): Promise<{
  detectedCodeOrUnd: LangCodeISO6393 | "und"
  detectionSource: DetectionSource
}> {
  const documentLangCode = resolveDocumentLangCode()
  if (documentLangCode) {
    logger.info("bootstrap detectionSource", "document")
    logger.info("bootstrap detectedCodeOrUnd", documentLangCode)
    return {
      detectedCodeOrUnd: documentLangCode,
      detectionSource: "document",
    }
  }

  const config = configOverride === undefined ? await getLocalConfig() : configOverride
  const hasAutoTranslateOrSkip = (config?.translate.page.autoTranslateLanguages?.length ?? 0) > 0
    || (config?.translate.page.skipLanguages?.length ?? 0) > 0
  const enableLLM = config?.languageDetection.mode === "llm" && hasAutoTranslateOrSkip
  const textForDetection = collectDocumentLanguageSample()
  const { code: detectedCodeOrUnd, source: detectionSource } = await detectLanguageWithSource(textForDetection, {
    enableLLM,
    maxLengthForLLM: 1500,
  })

  logger.info("bootstrap detectionSource", detectionSource)
  logger.info("bootstrap detectedCodeOrUnd", detectedCodeOrUnd)

  return {
    detectedCodeOrUnd,
    detectionSource,
  }
}

export async function getDocumentInfo(): Promise<{
  article: ReturnType<Readability<Node>["parse"]>
  paragraphs: string[]
  detectedCodeOrUnd: LangCodeISO6393 | "und"
  detectionSource: DetectionSource
}> {
  const documentClone = document.cloneNode(true)
  await removeDummyNodes(documentClone as Document)
  const article = new Readability(documentClone as Document, {
    serializer: el => el,
  }).parse()
  const paragraphs = article?.content
    ? flattenToParagraphs(article.content)
    : []

  logger.info("article", article)

  // Get config to check if LLM detection is enabled
  const config = await getLocalConfig()

  // Combine title and content for detection
  const title = article?.title || ""
  const content = article?.textContent || ""
  const textForDetection = `${title}\n\n${content}`

  // Detect language with optional LLM enhancement
  // Only use LLM when user has configured auto-translate or skip languages,
  // otherwise detecting page language with LLM is wasteful since nothing depends on the result.
  const hasAutoTranslateOrSkip = (config?.translate.page.autoTranslateLanguages?.length ?? 0) > 0
    || (config?.translate.page.skipLanguages?.length ?? 0) > 0
  const enableLLM = config?.languageDetection.mode === "llm" && hasAutoTranslateOrSkip
  const { code: detectedCodeOrUnd, source: detectionSource } = await detectLanguageWithSource(textForDetection, {
    enableLLM,
    maxLengthForLLM: 1500,
  })

  logger.info("final detectionSource", detectionSource)
  logger.info("final detectedCodeOrUnd", detectedCodeOrUnd)

  return {
    article,
    paragraphs,
    detectedCodeOrUnd,
    detectionSource,
  }
}
