import { z } from "zod"

export const vocabularyKindSchema = z.enum(["word", "phrase"])

export const vocabularySettingsSchema = z.object({
  autoSave: z.boolean(),
  highlightEnabled: z.boolean(),
  maxPhraseWords: z.number().int().min(1).max(20),
  highlightColor: z.string().min(1),
})

export const vocabularyItemSchema = z.object({
  id: z.string().min(1),
  sourceText: z.string().min(1),
  normalizedText: z.string().min(1),
  contextSentences: z.array(z.string().min(1)).optional(),
  contextSentence: z.string().min(1).optional(),
  lemma: z.string().min(1).optional(),
  matchTerms: z.array(z.string().min(1)).optional(),
  translatedText: z.string().min(1),
  phonetic: z.string().min(1).optional(),
  partOfSpeech: z.string().min(1).optional(),
  definition: z.string().min(1).optional(),
  difficulty: z.string().min(1).optional(),
  sourceLang: z.string().min(1),
  targetLang: z.string().min(1),
  kind: vocabularyKindSchema,
  wordCount: z.number().int().min(1),
  createdAt: z.number().int().nonnegative(),
  lastSeenAt: z.number().int().nonnegative(),
  hitCount: z.number().int().min(1),
  updatedAt: z.number().int().nonnegative(),
  deletedAt: z.number().int().nonnegative().nullable().default(null),
  masteredAt: z.number().int().nonnegative().nullable().optional(),
})

export const vocabularyItemsSchema = z.array(vocabularyItemSchema)

export type VocabularyKind = z.infer<typeof vocabularyKindSchema>
export type VocabularySettings = z.infer<typeof vocabularySettingsSchema>
export type VocabularyItem = z.infer<typeof vocabularyItemSchema>
