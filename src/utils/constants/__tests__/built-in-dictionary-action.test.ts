import { describe, expect, it, vi } from "vitest"
import { createBuiltInDictionaryAction, shouldUseBuiltInDictionary } from "../built-in-dictionary-action"

vi.mock("#imports", () => ({
  i18n: {
    t: (key: string) => key,
  },
}))

describe("built-in dictionary action", () => {
  it("keeps visible fields first and adds hidden enrichment fields", () => {
    const action = createBuiltInDictionaryAction("provider-1")

    expect(action.outputSchema.map(field => field.id)).toEqual([
      "dictionary-term",
      "dictionary-phonetic",
      "dictionary-part-of-speech",
      "dictionary-definition",
      "dictionary-difficulty",
      "dictionary-context-sentence-translation",
      "dictionary-nuance",
      "dictionary-word-family-core",
      "dictionary-word-family-contrast",
      "dictionary-word-family-related",
    ])
    expect(action.outputSchema.map(field => field.name)).toEqual([
      "term",
      "phonetic",
      "partOfSpeech",
      "definition",
      "difficulty",
      "contextSentenceTranslation",
      "nuance",
      "wordFamilyCore",
      "wordFamilyContrast",
      "wordFamilyRelated",
    ])
    expect(action.outputSchema.filter(field => field.hidden).map(field => field.name)).toEqual([
      "contextSentenceTranslation",
      "nuance",
      "wordFamilyCore",
      "wordFamilyContrast",
      "wordFamilyRelated",
    ])
  })

  it("asks the model to return only the hidden translated sentence for the context quote", () => {
    const action = createBuiltInDictionaryAction("provider-1")

    expect(action.systemPrompt).not.toContain("Paragraphs Translation")
    expect(action.systemPrompt).not.toContain("段落翻译")
    expect(action.systemPrompt).toContain("Translate the sentence that contains the selected text")
    expect(action.outputSchema.find(field => field.id === "dictionary-context-sentence-translation")).toMatchObject({
      hidden: true,
      name: "contextSentenceTranslation",
    })
  })

  it("keeps the lemma fields stable and only localizes the definition", () => {
    const action = createBuiltInDictionaryAction("provider-1")

    expect(action.systemPrompt).toContain("Return the lemma or canonical phrase in the source language")
    expect(action.systemPrompt).toContain("Return the phonetic transcription when it is natural")
    expect(action.systemPrompt).toContain("Return the definition in {{targetLanguage}}")
    expect(action.systemPrompt).toContain("Return a nuance note in {{targetLanguage}}")
    expect(action.systemPrompt).toContain("For a phrase, these fields contain nearby expressions")
    expect(action.systemPrompt).toContain("term || partOfSpeech || definition")
  })

  it("uses the built-in dictionary for words and short phrases", () => {
    expect(shouldUseBuiltInDictionary("planning")).toBe(true)
    expect(shouldUseBuiltInDictionary("plan-based")).toBe(true)
    expect(shouldUseBuiltInDictionary("Selected text")).toBe(true)
    expect(shouldUseBuiltInDictionary("in favor of")).toBe(true)
    expect(shouldUseBuiltInDictionary("hello, world")).toBe(false)
    expect(shouldUseBuiltInDictionary("one two three four five six seven eight nine")).toBe(false)
  })
})
