export const MIN_SIDE_CONTENT_WIDTH = 420 // px
export const DEFAULT_SIDE_CONTENT_WIDTH = 420 // px

export const DOWNLOAD_FILE_ITEMS = {
  md: {
    label: "Markdown",
  },
}

export const PARAGRAPH_DEPTH = 3

export enum MARKDOWN_TEMPLATE_TOKEN {
  title = "{{ Tupa: title }}",
  sentence = "{{ Tupa:sentence }}",
  words = "{{ Tupa:words }}",
  explanation = "{{ Tupa:explanation }}",
  originalSentence = "{{ Tupa:originalSentence }}",
  translatedSentence = "{{ Tupa:translatedSentence }}",
  word = "{{ Tupa:word }}",
  syntacticCategory = "{{ Tupa:syntacticCategory }}",
  wIndex = "{{ Tupa:wIndex }}",
  globalIndex = "{{ Tupa:globalIndex }}",
}

export const AST_TEMPLATE = `
# ${MARKDOWN_TEMPLATE_TOKEN.title}

${MARKDOWN_TEMPLATE_TOKEN.sentence}
`

export const SENTENCE_TEMPLATE = `
## Sentence ${MARKDOWN_TEMPLATE_TOKEN.globalIndex}

**${MARKDOWN_TEMPLATE_TOKEN.originalSentence}**

${MARKDOWN_TEMPLATE_TOKEN.translatedSentence}

### Key Words

${MARKDOWN_TEMPLATE_TOKEN.words}

### Explanation

${MARKDOWN_TEMPLATE_TOKEN.explanation}
`

export const WORDS_TEMPLATE = `${MARKDOWN_TEMPLATE_TOKEN.wIndex}. **${MARKDOWN_TEMPLATE_TOKEN.word}** ${MARKDOWN_TEMPLATE_TOKEN.syntacticCategory}
  ${MARKDOWN_TEMPLATE_TOKEN.explanation}
`
