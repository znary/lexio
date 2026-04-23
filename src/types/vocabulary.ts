import { z } from "zod"

export const vocabularyKindSchema = z.enum(["word", "phrase"])
export const vocabularyContextEntrySchema = z.object({
  sentence: z.string().min(1),
  translatedSentence: z.string().min(1).optional(),
  sourceUrl: z.string().min(1).optional(),
})

export const vocabularyWordFamilyEntrySchema = z.object({
  term: z.string().min(1),
  partOfSpeech: z.string().min(1).optional(),
  definition: z.string().min(1),
})

export const vocabularyWordFamilySchema = z.object({
  core: z.array(vocabularyWordFamilyEntrySchema),
  contrast: z.array(vocabularyWordFamilyEntrySchema),
  related: z.array(vocabularyWordFamilyEntrySchema),
})

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
  contextEntries: z.array(vocabularyContextEntrySchema).optional(),
  contextSentences: z.array(z.string().min(1)).optional(),
  contextSentence: z.string().min(1).optional(),
  lemma: z.string().min(1).optional(),
  matchTerms: z.array(z.string().min(1)).optional(),
  translatedText: z.string().min(1),
  phonetic: z.string().min(1).optional(),
  partOfSpeech: z.string().min(1).optional(),
  definition: z.string().min(1).optional(),
  difficulty: z.string().min(1).optional(),
  nuance: z.string().min(1).optional(),
  wordFamily: vocabularyWordFamilySchema.optional(),
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
export type VocabularyContextEntry = z.infer<typeof vocabularyContextEntrySchema>
export type VocabularyWordFamilyEntry = z.infer<typeof vocabularyWordFamilyEntrySchema>
export type VocabularyWordFamily = z.infer<typeof vocabularyWordFamilySchema>
export type VocabularySettings = z.infer<typeof vocabularySettingsSchema>
export type VocabularyItem = z.infer<typeof vocabularyItemSchema>
