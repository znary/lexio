export const WEB_PAGE_CONTENT_CHAR_LIMIT = 2000
export const WEB_PAGE_CONTEXT_CONTENT_CHAR_LIMIT = 8000

export function truncateWebPageContent(text: string): string {
  return text.slice(0, WEB_PAGE_CONTENT_CHAR_LIMIT)
}

export function truncateWebPageContextContent(text: string): string {
  return text.slice(0, WEB_PAGE_CONTEXT_CONTENT_CHAR_LIMIT)
}
