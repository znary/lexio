const CURLY_APOSTROPHES_RE = /[’‘]/g
const CURLY_QUOTES_RE = /[“”]/g
const DASH_RE = /[–—]/g
const WHITESPACE_RE = /\s+/g
const LATIN_LETTER_RE = /[A-Z]/i
const WORD_SPLIT_RE = /\s+/
const TOKEN_EDGE_PUNCTUATION_RE = /^[^A-Z0-9]+|[^A-Z0-9]+$/gi
const ENGLISH_VOWEL_RE = /[aeiou]/
const ENGLISH_CONSONANT_RE = /[a-z]/
const ENGLISH_ES_ENDING_RE = /(?:[osxz]|ch|sh)$/
const ENGLISH_KEEP_E_ING_ENDING_RE = /(?:ee|oe|ye)$/
const ENGLISH_ES_LEMMA_RE = /(?:ches|shes|sses|xes|zes|oes)$/

type EnglishInflectionOverrides = Partial<{
  extra: string[]
  past: string[]
  plural: string[]
  presentParticiple: string[]
  thirdPerson: string[]
}>

const ENGLISH_INFLECTION_OVERRIDES: Record<string, EnglishInflectionOverrides> = {
  be: {
    extra: ["am"],
    past: ["was", "were", "been"],
    plural: ["are"],
    presentParticiple: ["being"],
    thirdPerson: ["is"],
  },
  come: {
    past: ["came"],
  },
  do: {
    past: ["did", "done"],
    thirdPerson: ["does"],
  },
  eat: {
    past: ["ate", "eaten"],
  },
  feel: {
    past: ["felt"],
  },
  find: {
    past: ["found"],
  },
  get: {
    past: ["got", "gotten"],
  },
  give: {
    past: ["gave", "given"],
  },
  go: {
    past: ["went", "gone"],
    thirdPerson: ["goes"],
  },
  have: {
    past: ["had"],
    thirdPerson: ["has"],
  },
  know: {
    past: ["knew", "known"],
  },
  leave: {
    past: ["left"],
  },
  make: {
    past: ["made"],
  },
  mean: {
    past: ["meant"],
  },
  read: {
    past: ["read"],
  },
  run: {
    past: ["ran"],
  },
  say: {
    past: ["said"],
  },
  see: {
    past: ["saw", "seen"],
  },
  speak: {
    past: ["spoke", "spoken"],
  },
  take: {
    past: ["took", "taken"],
  },
  tell: {
    past: ["told"],
  },
  think: {
    past: ["thought"],
  },
  write: {
    past: ["wrote", "written"],
  },
}

const ENGLISH_IRREGULAR_LEMMA_BY_FORM = Object.entries(ENGLISH_INFLECTION_OVERRIDES).reduce<Record<string, string>>((accumulator, [lemma, overrides]) => {
  const forms = [
    ...(overrides.extra ?? []),
    ...(overrides.past ?? []),
    ...(overrides.plural ?? []),
    ...(overrides.presentParticiple ?? []),
    ...(overrides.thirdPerson ?? []),
  ]

  for (const form of forms) {
    accumulator[form] = lemma
  }

  return accumulator
}, {})

export interface VocabularyTermMetadata {
  lemma?: string
  matchTerms: string[]
  normalizedText: string
}

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

function isEnglishVowel(character: string | undefined): boolean {
  return !!character && ENGLISH_VOWEL_RE.test(character)
}

function isEnglishConsonant(character: string | undefined): boolean {
  return !!character && ENGLISH_CONSONANT_RE.test(character) && !isEnglishVowel(character)
}

function endsWithShortConsonantVowelConsonant(word: string): boolean {
  if (word.length < 3) {
    return false
  }

  const first = word.at(-3)
  const second = word.at(-2)
  const third = word.at(-1)
  return isEnglishConsonant(first) && isEnglishVowel(second) && isEnglishConsonant(third) && !"wxy".includes(third ?? "")
}

function hasTrailingDoubledConsonant(word: string): boolean {
  if (word.length < 2) {
    return false
  }

  const last = word.at(-1)
  const previous = word.at(-2)
  return !!last && last === previous && isEnglishConsonant(last) && !"wxy".includes(last)
}

function canRestoreSilentE(stem: string): boolean {
  if (stem.length < 2) {
    return false
  }

  return isEnglishConsonant(stem.at(-1)) && isEnglishVowel(stem.at(-2))
}

function buildEnglishSuffixedPluralOrThirdPerson(lemma: string): string {
  if (lemma.endsWith("y") && isEnglishConsonant(lemma.at(-2))) {
    return `${lemma.slice(0, -1)}ies`
  }

  if (ENGLISH_ES_ENDING_RE.test(lemma)) {
    return `${lemma}es`
  }

  return `${lemma}s`
}

function buildEnglishPresentParticiple(lemma: string): string {
  if (lemma.endsWith("ie")) {
    return `${lemma.slice(0, -2)}ying`
  }

  if (lemma.endsWith("e") && !ENGLISH_KEEP_E_ING_ENDING_RE.test(lemma)) {
    return `${lemma.slice(0, -1)}ing`
  }

  if (endsWithShortConsonantVowelConsonant(lemma)) {
    return `${lemma}${lemma.at(-1)}ing`
  }

  return `${lemma}ing`
}

function buildEnglishPastTense(lemma: string): string {
  if (lemma.endsWith("e")) {
    return `${lemma}d`
  }

  if (lemma.endsWith("y") && isEnglishConsonant(lemma.at(-2))) {
    return `${lemma.slice(0, -1)}ied`
  }

  if (endsWithShortConsonantVowelConsonant(lemma)) {
    return `${lemma}${lemma.at(-1)}ed`
  }

  return `${lemma}ed`
}

function buildEnglishWordFamily(lemma: string): string[] {
  const overrides = ENGLISH_INFLECTION_OVERRIDES[lemma] ?? {}
  const family = new Set<string>([lemma])

  for (const plural of overrides.plural ?? [buildEnglishSuffixedPluralOrThirdPerson(lemma)]) {
    family.add(plural)
  }

  for (const thirdPerson of overrides.thirdPerson ?? [buildEnglishSuffixedPluralOrThirdPerson(lemma)]) {
    family.add(thirdPerson)
  }

  for (const presentParticiple of overrides.presentParticiple ?? [buildEnglishPresentParticiple(lemma)]) {
    family.add(presentParticiple)
  }

  for (const past of overrides.past ?? [buildEnglishPastTense(lemma)]) {
    family.add(past)
  }

  for (const extra of overrides.extra ?? []) {
    family.add(extra)
  }

  return [...family]
}

function getEnglishLemmaCandidates(surface: string): string[] {
  const candidates: string[] = []

  const pushCandidate = (value: string | undefined) => {
    if (!value) {
      return
    }

    const normalized = normalizeVocabularyText(value)
    if (!normalized || candidates.includes(normalized)) {
      return
    }

    candidates.push(normalized)
  }

  const irregularLemma = ENGLISH_IRREGULAR_LEMMA_BY_FORM[surface]
  if (irregularLemma) {
    pushCandidate(irregularLemma)
  }

  if (surface.endsWith("ying") && surface.length > 5) {
    pushCandidate(`${surface.slice(0, -4)}ie`)
  }

  if (surface.endsWith("ied") && surface.length > 4) {
    if (isEnglishVowel(surface.at(-4))) {
      pushCandidate(`${surface.slice(0, -1)}`)
    }
    else {
      pushCandidate(`${surface.slice(0, -3)}y`)
    }
  }

  if (surface.endsWith("ies") && surface.length > 4) {
    if (isEnglishVowel(surface.at(-4))) {
      pushCandidate(`${surface.slice(0, -1)}`)
    }
    else {
      pushCandidate(`${surface.slice(0, -3)}y`)
    }
  }

  if (surface.endsWith("ing") && surface.length > 5) {
    const stem = surface.slice(0, -3)
    pushCandidate(stem)

    if (hasTrailingDoubledConsonant(stem)) {
      pushCandidate(stem.slice(0, -1))
    }

    if (canRestoreSilentE(stem)) {
      pushCandidate(`${stem}e`)
    }
  }

  if (surface.endsWith("ed") && surface.length > 4) {
    const stem = surface.slice(0, -2)
    pushCandidate(stem)

    if (hasTrailingDoubledConsonant(stem)) {
      pushCandidate(stem.slice(0, -1))
    }

    if (canRestoreSilentE(stem)) {
      pushCandidate(`${stem}e`)
    }
  }

  if (surface.endsWith("es") && surface.length > 4) {
    if (ENGLISH_ES_LEMMA_RE.test(surface)) {
      pushCandidate(surface.slice(0, -2))
    }
    pushCandidate(surface.slice(0, -1))
  }

  if (surface.endsWith("s") && surface.length > 3 && !surface.endsWith("ss")) {
    pushCandidate(surface.slice(0, -1))
  }

  pushCandidate(surface)
  return candidates
}

function inferEnglishLemma(surface: string): string {
  const candidates = getEnglishLemmaCandidates(surface)

  for (const candidate of candidates) {
    const family = buildEnglishWordFamily(candidate)
    if (family.includes(surface)) {
      return candidate
    }
  }

  return surface
}

export function buildVocabularyTermMetadata(
  sourceText: string,
  options?: { preferredLemma?: string | null },
): VocabularyTermMetadata {
  const normalizedSourceText = normalizeVocabularyText(sourceText)
  const wordCount = countVocabularyWords(sourceText)

  if (!normalizedSourceText) {
    return {
      matchTerms: [],
      normalizedText: "",
    }
  }

  if (wordCount !== 1 || !isEnglishVocabularyCandidate(sourceText)) {
    return {
      matchTerms: [normalizedSourceText],
      normalizedText: normalizedSourceText,
    }
  }

  const preferredLemma = options?.preferredLemma ? normalizeVocabularyText(options.preferredLemma) : null
  const lemma = preferredLemma || inferEnglishLemma(normalizedSourceText)
  const matchTerms = new Set(buildEnglishWordFamily(lemma))
  matchTerms.add(normalizedSourceText)

  return {
    lemma,
    matchTerms: [...matchTerms],
    normalizedText: lemma,
  }
}
