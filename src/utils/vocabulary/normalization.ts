const CURLY_APOSTROPHES_RE = /[’‘]/g
const CURLY_QUOTES_RE = /[“”]/g
const DASH_RE = /[–—]/g
const WHITESPACE_RE = /\s+/g
const LATIN_LETTER_RE = /[A-Z]/i
const WORD_SPLIT_RE = /\s+/
const TOKEN_EDGE_PUNCTUATION_RE = /^[^A-Z0-9]+|[^A-Z0-9]+$/gi

export function normalizeVocabularyText(value: string): string {
  return value
    .normalize("NFKC")
    .replace(CURLY_APOSTROPHES_RE, "'")
    .replace(CURLY_QUOTES_RE, "\"")
    .replace(DASH_RE, "-")
    .replace(WHITESPACE_RE, " ")
    .trim()
    .toLowerCase()
}

export function countVocabularyWords(value: string): number {
  const normalized = value
    .normalize("NFKC")
    .replace(CURLY_APOSTROPHES_RE, "'")
    .replace(DASH_RE, " ")
    .trim()

  if (!normalized) {
    return 0
  }

  return normalized
    .split(WORD_SPLIT_RE)
    .map(token => token.replace(TOKEN_EDGE_PUNCTUATION_RE, ""))
    .filter(Boolean)
    .length
}

export function isEnglishVocabularyCandidate(value: string): boolean {
  return LATIN_LETTER_RE.test(value)
}
