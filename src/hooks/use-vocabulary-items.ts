import type { VocabularyItem } from "@/types/vocabulary"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useEffect } from "react"
import {
  getCachedVocabularyItems,
  getVocabularyItems,
  VOCABULARY_CHANGED_EVENT,
} from "@/utils/vocabulary/service"

const VOCABULARY_ITEMS_QUERY_KEY = ["vocabulary-items"] as const

export function useVocabularyItems() {
  const queryClient = useQueryClient()

  const query = useQuery({
    queryKey: VOCABULARY_ITEMS_QUERY_KEY,
    queryFn: () => getVocabularyItems({ forceRefresh: true }),
  })

  useEffect(() => {
    const handleVocabularyChanged = () => {
      const items = getCachedVocabularyItems()
      if (items != null) {
        queryClient.setQueryData<VocabularyItem[]>(VOCABULARY_ITEMS_QUERY_KEY, items)
        return
      }

      void queryClient.invalidateQueries({ queryKey: VOCABULARY_ITEMS_QUERY_KEY })
    }

    document.addEventListener(VOCABULARY_CHANGED_EVENT, handleVocabularyChanged)
    return () => {
      document.removeEventListener(VOCABULARY_CHANGED_EVENT, handleVocabularyChanged)
    }
  }, [queryClient])

  const invalidate = () => queryClient.invalidateQueries({ queryKey: VOCABULARY_ITEMS_QUERY_KEY })

  return { query, invalidate }
}
