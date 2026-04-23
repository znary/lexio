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
      "nuance",
      "wordFamilyCore",
      "wordFamilyContrast",
      "wordFamilyRelated",
    ])
    expect(action.outputSchema.filter(field => field.hidden).map(field => field.name)).toEqual([
      "nuance",
      "wordFamilyCore",
      "wordFamilyContrast",
      "wordFamilyRelated",
    ])
  })

  it("does not ask the model to return paragraph fields", () => {
    const action = createBuiltInDictionaryAction("provider-1")

    expect(action.systemPrompt).not.toContain("Paragraphs Translation")
    expect(action.systemPrompt).not.toContain("段落翻译")
    expect(action.systemPrompt).not.toContain("段落内容：")
    expect(action.outputSchema.some(field => field.id.includes("context"))).toBe(false)
  })

  it("keeps the lemma fields stable and only localizes the definition", () => {
    const action = createBuiltInDictionaryAction("provider-1")

    expect(action.systemPrompt).toContain("Return the lemma in the source language")
    expect(action.systemPrompt).toContain("Return the phonetic transcription for that source-language lemma")
    expect(action.systemPrompt).toContain("Return the definition in {{targetLanguage}}")
    expect(action.systemPrompt).toContain("Return a nuance note in {{targetLanguage}}")
    expect(action.systemPrompt).toContain("term || partOfSpeech || definition")
  })

  it("uses the built-in dictionary only for single-term selections", () => {
    expect(shouldUseBuiltInDictionary("planning")).toBe(true)
    expect(shouldUseBuiltInDictionary("plan-based")).toBe(true)
    expect(shouldUseBuiltInDictionary("Selected text")).toBe(false)
    expect(shouldUseBuiltInDictionary("hello, world")).toBe(false)
  })
})
