import type { VocabularyItem } from "@/types/vocabulary"
import { storage } from "#imports"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useCallback, useEffect, useMemo } from "react"
import { VOCABULARY_ITEMS_STORAGE_KEY } from "@/utils/constants/config"
import { getActiveVocabularyItems, getLocalVocabularyItemsAndMeta } from "@/utils/vocabulary/storage"

interface UseVocabularyItemsOptions {
  includeDeleted?: boolean
}

export function useVocabularyItems(options: UseVocabularyItemsOptions = {}) {
  const { includeDeleted = false } = options
  const queryClient = useQueryClient()
  const queryKey = useMemo(() => ["vocabulary-items", includeDeleted] as const, [includeDeleted])

  const query = useQuery({
    queryKey,
    queryFn: async (): Promise<VocabularyItem[]> => {
      const { value } = await getLocalVocabularyItemsAndMeta()
      return includeDeleted ? value : getActiveVocabularyItems(value)
    },
  })

  const invalidate = useCallback(
    () => queryClient.invalidateQueries({ queryKey }),
    [queryClient, queryKey],
  )

  useEffect(() => {
    return storage.watch(`local:${VOCABULARY_ITEMS_STORAGE_KEY}`, () => {
      void invalidate()
    })
  }, [invalidate])

  return { query, invalidate }
}
