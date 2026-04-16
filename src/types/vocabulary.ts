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
  translatedText: z.string().min(1),
  sourceLang: z.string().min(1),
  targetLang: z.string().min(1),
  kind: vocabularyKindSchema,
  wordCount: z.number().int().min(1),
  createdAt: z.number().int().nonnegative(),
  lastSeenAt: z.number().int().nonnegative(),
  hitCount: z.number().int().min(1),
  updatedAt: z.number().int().nonnegative(),
  deletedAt: z.number().int().nonnegative().nullable().default(null),
})

export const vocabularyItemsSchema = z.array(vocabularyItemSchema)

export type VocabularyKind = z.infer<typeof vocabularyKindSchema>
export type VocabularySettings = z.infer<typeof vocabularySettingsSchema>
export type VocabularyItem = z.infer<typeof vocabularyItemSchema>
