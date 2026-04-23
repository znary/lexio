// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const {
  apiClearVocabularyItemsMock,
  apiCreateVocabularyItemMock,
  apiDeleteVocabularyItemMock,
  apiGetVocabularyItemsMock,
  apiGetVocabularyMetaMock,
  apiUpdateVocabularyItemMock,
  getPlatformAuthSessionMock,
  storageAdapterGetMock,
  storageAdapterSetMock,
  watchPlatformAuthSessionMock,
} = vi.hoisted(() => ({
  apiClearVocabularyItemsMock: vi.fn(),
  apiCreateVocabularyItemMock: vi.fn(),
  apiDeleteVocabularyItemMock: vi.fn(),
  apiGetVocabularyItemsMock: vi.fn(),
  apiGetVocabularyMetaMock: vi.fn(),
  apiUpdateVocabularyItemMock: vi.fn(),
  getPlatformAuthSessionMock: vi.fn(),
  storageAdapterGetMock: vi.fn(),
  storageAdapterSetMock: vi.fn(),
  watchPlatformAuthSessionMock: vi.fn(),
}))

vi.mock("@/utils/platform/api", () => ({
  clearVocabularyItems: (...args: unknown[]) => apiClearVocabularyItemsMock(...args),
  createVocabularyItem: (...args: unknown[]) => apiCreateVocabularyItemMock(...args),
  deleteVocabularyItem: (...args: unknown[]) => apiDeleteVocabularyItemMock(...args),
  getVocabularyItems: (...args: unknown[]) => apiGetVocabularyItemsMock(...args),
  getVocabularyMeta: (...args: unknown[]) => apiGetVocabularyMetaMock(...args),
  updateVocabularyItem: (...args: unknown[]) => apiUpdateVocabularyItemMock(...args),
}))

vi.mock("@/utils/platform/storage", () => ({
  getPlatformAuthSession: (...args: unknown[]) => getPlatformAuthSessionMock(...args),
  watchPlatformAuthSession: (...args: unknown[]) => watchPlatformAuthSessionMock(...args),
}))

vi.mock("@/utils/atoms/storage-adapter", () => ({
  storageAdapter: {
    get: (...args: unknown[]) => storageAdapterGetMock(...args),
    set: (...args: unknown[]) => storageAdapterSetMock(...args),
    setMeta: vi.fn(),
    watch: vi.fn(),
  },
}))

describe("vocabulary service", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    apiGetVocabularyItemsMock.mockResolvedValue([])
    apiCreateVocabularyItemMock.mockResolvedValue({ ok: true, id: "voc_1" })
    apiUpdateVocabularyItemMock.mockResolvedValue({ ok: true })
    apiDeleteVocabularyItemMock.mockResolvedValue({ ok: true })
    apiClearVocabularyItemsMock.mockResolvedValue({ ok: true })
    apiGetVocabularyMetaMock.mockResolvedValue({ updatedAt: null, count: 0 })
    getPlatformAuthSessionMock.mockResolvedValue(null)
    storageAdapterGetMock.mockResolvedValue([])
    storageAdapterSetMock.mockResolvedValue(undefined)
    watchPlatformAuthSessionMock.mockReturnValue(() => {})
  })

  afterEach(() => {
    document.body.innerHTML = ""
  })

  it("updates the local cache before the create request finishes", async () => {
    let resolveCreate: ((value: { ok: true, id: string }) => void) | null = null
    apiCreateVocabularyItemMock.mockReturnValue(new Promise((resolve) => {
      resolveCreate = resolve
    }))

    const { getCachedVocabularyItems, saveTranslatedSelectionToVocabulary, VOCABULARY_CHANGED_EVENT } = await import("../service")
    const changedListener = vi.fn()
    document.addEventListener(VOCABULARY_CHANGED_EVENT, changedListener)

    const savePromise = saveTranslatedSelectionToVocabulary({
      sourceText: "hello",
      translatedText: "你好",
      contextSentence: "We said hello before the meeting.",
      sourceUrl: "https://example.com/meeting",
      sourceLang: "en",
      targetLang: "zh-CN",
      settings: {
        autoSave: true,
        highlightEnabled: true,
        maxPhraseWords: 3,
        highlightColor: "#fde68a",
      },
    })

    await vi.waitFor(() => {
      expect(getCachedVocabularyItems()).toEqual([
        expect.objectContaining({
          sourceText: "hello",
          translatedText: "你好",
          contextEntries: [
            {
              sentence: "We said hello before the meeting.",
              sourceUrl: "https://example.com/meeting",
            },
          ],
          contextSentences: ["We said hello before the meeting."],
          normalizedText: "hello",
        }),
      ])
      expect(changedListener).toHaveBeenCalledTimes(1)
    })

    if (!resolveCreate) {
      throw new Error("create promise resolver was not captured")
    }

    const finishCreate = resolveCreate as (value: { ok: true, id: string }) => void
    finishCreate({ ok: true, id: "voc_1" })
    await expect(savePromise).resolves.toEqual(expect.objectContaining({
      sourceText: "hello",
      translatedText: "你好",
      contextEntries: [
        {
          sentence: "We said hello before the meeting.",
          sourceUrl: "https://example.com/meeting",
        },
      ],
      contextSentences: ["We said hello before the meeting."],
    }))

    document.removeEventListener(VOCABULARY_CHANGED_EVENT, changedListener)
  })

  it("updates an existing item instead of inserting it again", async () => {
    storageAdapterGetMock.mockResolvedValue([
      {
        id: "voc_existing",
        sourceText: "hello",
        normalizedText: "hello",
        contextSentences: ["We said hello before the meeting."],
        translatedText: "你好",
        sourceLang: "en",
        targetLang: "zh-CN",
        kind: "word",
        wordCount: 1,
        createdAt: 1,
        lastSeenAt: 2,
        hitCount: 3,
        updatedAt: 4,
        deletedAt: null,
      },
    ])

    const { saveTranslatedSelectionToVocabulary } = await import("../service")
    const savedItem = await saveTranslatedSelectionToVocabulary({
      sourceText: "hello",
      translatedText: "您好",
      contextSentence: "I still want to say hello politely.",
      sourceUrl: "https://example.com/polite",
      sourceLang: "en",
      targetLang: "zh-CN",
      settings: {
        autoSave: true,
        highlightEnabled: true,
        maxPhraseWords: 3,
        highlightColor: "#fde68a",
      },
    })

    expect(apiUpdateVocabularyItemMock).toHaveBeenCalledWith(expect.objectContaining({
      id: "voc_existing",
      translatedText: "您好",
      contextEntries: [
        {
          sentence: "I still want to say hello politely.",
          sourceUrl: "https://example.com/polite",
        },
        {
          sentence: "We said hello before the meeting.",
        },
      ],
      contextSentences: [
        "I still want to say hello politely.",
        "We said hello before the meeting.",
      ],
      hitCount: 4,
    }))
    expect(apiCreateVocabularyItemMock).not.toHaveBeenCalled()
    expect(savedItem).toEqual(expect.objectContaining({
      id: "voc_existing",
      translatedText: "您好",
      contextEntries: [
        {
          sentence: "I still want to say hello politely.",
          sourceUrl: "https://example.com/polite",
        },
        {
          sentence: "We said hello before the meeting.",
        },
      ],
      contextSentences: [
        "I still want to say hello politely.",
        "We said hello before the meeting.",
      ],
      hitCount: 4,
    }))
  })

  it("keeps only the 10 most recent context sentences for the same item", async () => {
    storageAdapterGetMock.mockResolvedValue([
      {
        id: "voc_existing",
        sourceText: "hello",
        normalizedText: "hello",
        contextSentences: Array.from({ length: 10 }, (_, index) => `Old sentence ${index + 1}`),
        translatedText: "你好",
        sourceLang: "en",
        targetLang: "zh-CN",
        kind: "word",
        wordCount: 1,
        createdAt: 1,
        lastSeenAt: 2,
        hitCount: 3,
        updatedAt: 4,
        deletedAt: null,
      },
    ])

    const { saveTranslatedSelectionToVocabulary } = await import("../service")
    const savedItem = await saveTranslatedSelectionToVocabulary({
      sourceText: "hello",
      translatedText: "您好",
      contextSentence: "Newest sentence",
      sourceLang: "en",
      targetLang: "zh-CN",
      settings: {
        autoSave: true,
        highlightEnabled: true,
        maxPhraseWords: 3,
        highlightColor: "#fde68a",
      },
    })

    expect(savedItem?.contextSentences).toEqual([
      "Newest sentence",
      "Old sentence 1",
      "Old sentence 2",
      "Old sentence 3",
      "Old sentence 4",
      "Old sentence 5",
      "Old sentence 6",
      "Old sentence 7",
      "Old sentence 8",
      "Old sentence 9",
    ])
  })

  it("records the source url with the newest context sentence", async () => {
    const { saveTranslatedSelectionToVocabulary } = await import("../service")
    const savedItem = await saveTranslatedSelectionToVocabulary({
      sourceText: "article",
      translatedText: "文章",
      contextSentence: "I bookmarked this article yesterday.",
      translatedContextSentence: "我昨天收藏了这篇文章。",
      sourceUrl: "https://example.com/article",
      sourceLang: "en",
      targetLang: "zh-CN",
      settings: {
        autoSave: true,
        highlightEnabled: true,
        maxPhraseWords: 3,
        highlightColor: "#fde68a",
      },
    })

    expect(apiCreateVocabularyItemMock).toHaveBeenCalledWith(expect.objectContaining({
      contextEntries: [
        {
          sentence: "I bookmarked this article yesterday.",
          translatedSentence: "我昨天收藏了这篇文章。",
          sourceUrl: "https://example.com/article",
        },
      ],
    }))
    expect(savedItem?.contextEntries).toEqual([
      {
        sentence: "I bookmarked this article yesterday.",
        translatedSentence: "我昨天收藏了这篇文章。",
        sourceUrl: "https://example.com/article",
      },
    ])
  })

  it("updates a matching context sentence with its translated sentence without duplicating it", async () => {
    storageAdapterGetMock.mockResolvedValue([
      {
        id: "voc_existing",
        sourceText: "hello",
        normalizedText: "hello",
        translatedText: "你好",
        sourceLang: "en",
        targetLang: "zh-CN",
        kind: "word",
        wordCount: 1,
        createdAt: 1,
        lastSeenAt: 2,
        hitCount: 3,
        updatedAt: 4,
        deletedAt: null,
        contextEntries: [
          {
            sentence: "We said hello before the meeting.",
            sourceUrl: "https://example.com/meeting",
          },
        ],
        contextSentences: ["We said hello before the meeting."],
      },
    ])

    const { updateVocabularyItemContextTranslation } = await import("../service")
    const updatedItem = await updateVocabularyItemContextTranslation({
      itemId: "voc_existing",
      contextSentence: "We said hello before the meeting.",
      translatedSentence: "开会前我们打过招呼。",
      sourceUrl: "https://example.com/meeting",
    })

    expect(apiUpdateVocabularyItemMock).toHaveBeenCalledWith(expect.objectContaining({
      id: "voc_existing",
      contextEntries: [
        {
          sentence: "We said hello before the meeting.",
          translatedSentence: "开会前我们打过招呼。",
          sourceUrl: "https://example.com/meeting",
        },
      ],
      contextSentences: ["We said hello before the meeting."],
    }))
    expect(updatedItem).toEqual(expect.objectContaining({
      id: "voc_existing",
      contextEntries: [
        {
          sentence: "We said hello before the meeting.",
          translatedSentence: "开会前我们打过招呼。",
          sourceUrl: "https://example.com/meeting",
        },
      ],
      contextSentences: ["We said hello before the meeting."],
    }))
  })

  it("moves a mastered item back to learning when the same selection is translated again", async () => {
    storageAdapterGetMock.mockResolvedValue([
      {
        id: "voc_existing",
        sourceText: "hello",
        normalizedText: "hello",
        translatedText: "你好",
        sourceLang: "en",
        targetLang: "zh-CN",
        kind: "word",
        wordCount: 1,
        createdAt: 1,
        lastSeenAt: 2,
        hitCount: 3,
        updatedAt: 4,
        deletedAt: null,
        masteredAt: 5,
      },
    ])

    const { saveTranslatedSelectionToVocabulary } = await import("../service")
    const savedItem = await saveTranslatedSelectionToVocabulary({
      sourceText: "hello",
      translatedText: "您好",
      sourceLang: "en",
      targetLang: "zh-CN",
      settings: {
        autoSave: true,
        highlightEnabled: true,
        maxPhraseWords: 3,
        highlightColor: "#fde68a",
      },
    })

    expect(apiUpdateVocabularyItemMock).toHaveBeenCalledWith(expect.objectContaining({
      id: "voc_existing",
      translatedText: "您好",
      hitCount: 4,
      masteredAt: null,
    }))
    expect(savedItem).toEqual(expect.objectContaining({
      id: "voc_existing",
      translatedText: "您好",
      hitCount: 4,
      masteredAt: null,
    }))
  })

  it("stores english word variants under the same canonical entry", async () => {
    const { saveTranslatedSelectionToVocabulary } = await import("../service")
    const savedItem = await saveTranslatedSelectionToVocabulary({
      sourceText: "thinking",
      translatedText: "思考",
      sourceLang: "en",
      targetLang: "zh-CN",
      settings: {
        autoSave: true,
        highlightEnabled: true,
        maxPhraseWords: 3,
        highlightColor: "#fde68a",
      },
    })

    expect(apiCreateVocabularyItemMock).toHaveBeenCalledWith(expect.objectContaining({
      sourceText: "thinking",
      normalizedText: "think",
      matchTerms: expect.arrayContaining(["think", "thinking", "thinks", "thought"]),
    }))
    expect(savedItem).toEqual(expect.objectContaining({
      sourceText: "thinking",
      normalizedText: "think",
      matchTerms: expect.arrayContaining(["think", "thinking", "thinks", "thought"]),
    }))
  })

  it("reuses a legacy inflected item when saving its lemma later", async () => {
    storageAdapterGetMock.mockResolvedValue([
      {
        id: "voc_existing",
        sourceText: "thinking",
        normalizedText: "thinking",
        translatedText: "思考",
        sourceLang: "en",
        targetLang: "zh-CN",
        kind: "word",
        wordCount: 1,
        createdAt: 1,
        lastSeenAt: 2,
        hitCount: 3,
        updatedAt: 4,
        deletedAt: null,
      },
    ])

    const { saveTranslatedSelectionToVocabulary } = await import("../service")
    const savedItem = await saveTranslatedSelectionToVocabulary({
      sourceText: "think",
      translatedText: "思考",
      sourceLang: "en",
      targetLang: "zh-CN",
      settings: {
        autoSave: true,
        highlightEnabled: true,
        maxPhraseWords: 3,
        highlightColor: "#fde68a",
      },
    })

    expect(apiUpdateVocabularyItemMock).toHaveBeenCalledWith(expect.objectContaining({
      id: "voc_existing",
      normalizedText: "think",
      matchTerms: expect.arrayContaining(["think", "thinking", "thinks", "thought"]),
    }))
    expect(apiCreateVocabularyItemMock).not.toHaveBeenCalled()
    expect(savedItem).toEqual(expect.objectContaining({
      id: "voc_existing",
      normalizedText: "think",
      matchTerms: expect.arrayContaining(["think", "thinking", "thinks", "thought"]),
    }))
  })

  it("stores dictionary details on an existing vocabulary item", async () => {
    storageAdapterGetMock.mockResolvedValue([
      {
        id: "voc_existing",
        sourceText: "thinking",
        normalizedText: "thinking",
        translatedText: "思考",
        sourceLang: "en",
        targetLang: "zh-CN",
        kind: "word",
        wordCount: 1,
        createdAt: 1,
        lastSeenAt: 2,
        hitCount: 3,
        updatedAt: 4,
        deletedAt: null,
      },
    ])

    const { updateVocabularyItemDetails } = await import("../service")
    const updatedItem = await updateVocabularyItemDetails("voc_existing", {
      definition: "思考；认为",
      lemma: "think",
      partOfSpeech: "verb",
      phonetic: "/theta-ng-k/",
    })

    expect(apiUpdateVocabularyItemMock).toHaveBeenCalledWith(expect.objectContaining({
      id: "voc_existing",
      normalizedText: "think",
      lemma: "think",
      partOfSpeech: "verb",
      definition: "思考；认为",
      phonetic: "/theta-ng-k/",
      matchTerms: expect.arrayContaining(["think", "thinking", "thinks", "thought"]),
    }))
    expect(updatedItem).toEqual(expect.objectContaining({
      id: "voc_existing",
      normalizedText: "think",
      lemma: "think",
      partOfSpeech: "verb",
      definition: "思考；认为",
      phonetic: "/theta-ng-k/",
      matchTerms: expect.arrayContaining(["think", "thinking", "thinks", "thought"]),
    }))
  })

  it("marks an existing item as mastered with an optimistic cache update", async () => {
    storageAdapterGetMock.mockResolvedValue([
      {
        id: "voc_existing",
        sourceText: "thinking",
        normalizedText: "thinking",
        translatedText: "思考",
        sourceLang: "en",
        targetLang: "zh-CN",
        kind: "word",
        wordCount: 1,
        createdAt: 1,
        lastSeenAt: 2,
        hitCount: 3,
        updatedAt: 4,
        deletedAt: null,
      },
    ])

    let resolveUpdate: ((value: { ok: true }) => void) | null = null
    apiUpdateVocabularyItemMock.mockReturnValue(new Promise((resolve) => {
      resolveUpdate = resolve
    }))

    const { getCachedVocabularyItems, setVocabularyItemMastered, VOCABULARY_CHANGED_EVENT } = await import("../service")
    const changedListener = vi.fn()
    document.addEventListener(VOCABULARY_CHANGED_EVENT, changedListener)

    const updatePromise = setVocabularyItemMastered("voc_existing", true)

    await vi.waitFor(() => {
      expect(getCachedVocabularyItems()).toEqual([
        expect.objectContaining({
          id: "voc_existing",
          masteredAt: expect.any(Number),
        }),
      ])
      expect(changedListener).toHaveBeenCalledTimes(1)
    })

    if (!resolveUpdate) {
      throw new Error("update promise resolver was not captured")
    }

    const finishUpdate = resolveUpdate as (value: { ok: true }) => void
    finishUpdate({ ok: true })
    await expect(updatePromise).resolves.toEqual(expect.objectContaining({
      id: "voc_existing",
      masteredAt: expect.any(Number),
    }))

    expect(apiUpdateVocabularyItemMock).toHaveBeenCalledWith(expect.objectContaining({
      id: "voc_existing",
      masteredAt: expect.any(Number),
    }))

    document.removeEventListener(VOCABULARY_CHANGED_EVENT, changedListener)
  })

  it("sorts vocabulary items by last seen time so mastered toggles do not reorder the list", async () => {
    storageAdapterGetMock.mockResolvedValue([
      {
        id: "voc_older",
        sourceText: "hello",
        normalizedText: "hello",
        translatedText: "你好",
        sourceLang: "en",
        targetLang: "zh-CN",
        kind: "word",
        wordCount: 1,
        createdAt: 1,
        lastSeenAt: 2,
        hitCount: 3,
        updatedAt: 100,
        deletedAt: null,
      },
      {
        id: "voc_recent",
        sourceText: "world",
        normalizedText: "world",
        translatedText: "世界",
        sourceLang: "en",
        targetLang: "zh-CN",
        kind: "word",
        wordCount: 1,
        createdAt: 5,
        lastSeenAt: 6,
        hitCount: 2,
        updatedAt: 50,
        deletedAt: null,
      },
    ])

    const { getCachedVocabularyItems, getVocabularyItems, setVocabularyItemMastered } = await import("../service")

    await expect(getVocabularyItems()).resolves.toEqual([
      expect.objectContaining({ id: "voc_recent" }),
      expect.objectContaining({ id: "voc_older" }),
    ])

    await setVocabularyItemMastered("voc_older", true)

    expect(getCachedVocabularyItems()).toEqual([
      expect.objectContaining({ id: "voc_recent" }),
      expect.objectContaining({
        id: "voc_older",
        masteredAt: expect.any(Number),
      }),
    ])
  })

  it("finds a saved item by its lemma for the same language pair", async () => {
    storageAdapterGetMock.mockResolvedValue([
      {
        id: "voc_existing",
        sourceText: "think",
        normalizedText: "think",
        lemma: "think",
        matchTerms: ["think", "thinking", "thinks", "thought"],
        translatedText: "思考",
        phonetic: "/theta-ng-k/",
        partOfSpeech: "verb",
        definition: "思考；认为",
        difficulty: "B1",
        sourceLang: "en",
        targetLang: "zh-CN",
        kind: "word",
        wordCount: 1,
        createdAt: 1,
        lastSeenAt: 2,
        hitCount: 3,
        updatedAt: 4,
        deletedAt: null,
      },
    ])

    const { findVocabularyItemForSelection } = await import("../service")
    const matchedItem = await findVocabularyItemForSelection({
      sourceText: "thinking",
      sourceLang: "en",
      targetLang: "zh-CN",
    })

    expect(matchedItem).toEqual(expect.objectContaining({
      id: "voc_existing",
      normalizedText: "think",
      lemma: "think",
      definition: "思考；认为",
      translatedText: "思考",
    }))
    expect(apiGetVocabularyItemsMock).not.toHaveBeenCalled()
  })

  it("does not reuse a saved item from a different target language", async () => {
    storageAdapterGetMock.mockResolvedValue([
      {
        id: "voc_existing",
        sourceText: "think",
        normalizedText: "think",
        lemma: "think",
        matchTerms: ["think", "thinking", "thinks", "thought"],
        translatedText: "思考",
        definition: "思考；认为",
        sourceLang: "en",
        targetLang: "zh-CN",
        kind: "word",
        wordCount: 1,
        createdAt: 1,
        lastSeenAt: 2,
        hitCount: 3,
        updatedAt: 4,
        deletedAt: null,
      },
    ])

    const { findVocabularyItemForSelection } = await import("../service")
    const matchedItem = await findVocabularyItemForSelection({
      sourceText: "thinking",
      sourceLang: "en",
      targetLang: "ja",
    })

    expect(matchedItem).toBeNull()
  })

  it("bootstraps the local cache from remote vocabulary when local storage is empty", async () => {
    apiGetVocabularyItemsMock.mockResolvedValue([
      {
        id: "voc_remote",
        sourceText: "think",
        normalizedText: "think",
        lemma: "think",
        matchTerms: ["think", "thinking", "thinks", "thought"],
        translatedText: "思考",
        definition: "思考；认为",
        sourceLang: "en",
        targetLang: "zh-CN",
        kind: "word",
        wordCount: 1,
        createdAt: 1,
        lastSeenAt: 2,
        hitCount: 3,
        updatedAt: 4,
        deletedAt: null,
      },
    ])

    const { findVocabularyItemForSelection, getCachedVocabularyItems } = await import("../service")
    const matchedItem = await findVocabularyItemForSelection({
      sourceText: "thinking",
      sourceLang: "en",
      targetLang: "zh-CN",
    })

    expect(apiGetVocabularyItemsMock).toHaveBeenCalledTimes(1)
    expect(matchedItem).toEqual(expect.objectContaining({
      id: "voc_remote",
      lemma: "think",
      translatedText: "思考",
    }))
    expect(getCachedVocabularyItems()).toEqual([
      expect.objectContaining({
        id: "voc_remote",
      }),
    ])
    expect(storageAdapterSetMock).toHaveBeenCalledWith(
      "vocabularyItems:guest",
      expect.arrayContaining([
        expect.objectContaining({
          id: "voc_remote",
        }),
      ]),
      expect.anything(),
    )
  })

  it("stores signed-in vocabulary snapshots under an account-scoped storage key", async () => {
    getPlatformAuthSessionMock.mockResolvedValue({
      token: "platform-token",
      user: {
        id: "user_1",
        email: "user@example.com",
      },
      updatedAt: 1,
    })
    storageAdapterGetMock.mockImplementation(async (key: string) => {
      if (key === "vocabularyItems:platform:user_1") {
        return [
          {
            id: "voc_user_1",
            sourceText: "hello",
            normalizedText: "hello",
            translatedText: "你好",
            sourceLang: "en",
            targetLang: "zh-CN",
            kind: "word",
            wordCount: 1,
            createdAt: 1,
            lastSeenAt: 2,
            hitCount: 3,
            updatedAt: 4,
            deletedAt: null,
          },
        ]
      }

      return []
    })

    const { getVocabularyItems } = await import("../service")
    const items = await getVocabularyItems()

    expect(items).toEqual([
      expect.objectContaining({
        id: "voc_user_1",
      }),
    ])
    expect(storageAdapterGetMock).toHaveBeenCalledWith(
      "vocabularyItems:platform:user_1",
      [],
      expect.anything(),
    )
  })

  it("returns local items immediately and refreshes stale signed-in snapshots in the background", async () => {
    let resolveRemoteItems: ((items: Array<Record<string, unknown>>) => void) | null = null
    getPlatformAuthSessionMock.mockResolvedValue({
      token: "platform-token",
      user: {
        id: "user_1",
        email: "user@example.com",
      },
      updatedAt: 1,
    })
    storageAdapterGetMock.mockImplementation(async (key: string) => {
      if (key === "vocabularyItems:platform:user_1") {
        return [
          {
            id: "voc_local",
            sourceText: "think",
            normalizedText: "think",
            translatedText: "思考",
            sourceLang: "en",
            targetLang: "zh-CN",
            kind: "word",
            wordCount: 1,
            createdAt: 1,
            lastSeenAt: 2,
            hitCount: 3,
            updatedAt: 4,
            deletedAt: null,
          },
        ]
      }

      if (key === "vocabularyMeta:platform:user_1") {
        return {
          checkedAt: 1,
          fetchedAt: 1,
          remoteUpdatedAt: 4,
          count: 1,
        }
      }

      return []
    })
    apiGetVocabularyMetaMock.mockResolvedValue({
      updatedAt: 10,
      count: 1,
    })
    apiGetVocabularyItemsMock.mockReturnValue(new Promise((resolve) => {
      resolveRemoteItems = resolve as typeof resolveRemoteItems
    }))

    const { getCachedVocabularyItems, getVocabularyItems } = await import("../service")
    const items = await getVocabularyItems()

    expect(items).toEqual([
      expect.objectContaining({
        id: "voc_local",
      }),
    ])
    expect(getCachedVocabularyItems()).toEqual([
      expect.objectContaining({
        id: "voc_local",
      }),
    ])

    await vi.waitFor(() => {
      expect(apiGetVocabularyMetaMock).toHaveBeenCalledTimes(1)
      expect(apiGetVocabularyItemsMock).toHaveBeenCalledTimes(1)
    })

    if (!resolveRemoteItems) {
      throw new Error("remote vocabulary resolver was not captured")
    }

    const finishRemoteItems = resolveRemoteItems as (items: Array<Record<string, unknown>>) => void
    finishRemoteItems([
      {
        id: "voc_remote",
        sourceText: "think",
        normalizedText: "think",
        translatedText: "思维",
        sourceLang: "en",
        targetLang: "zh-CN",
        kind: "word",
        wordCount: 1,
        createdAt: 1,
        lastSeenAt: 2,
        hitCount: 8,
        updatedAt: 10,
        deletedAt: null,
      },
    ])

    await vi.waitFor(() => {
      expect(getCachedVocabularyItems()).toEqual([
        expect.objectContaining({
          id: "voc_remote",
          translatedText: "思维",
        }),
      ])
    })
  })

  it("removes an item from the local cache before the delete request finishes", async () => {
    storageAdapterGetMock.mockResolvedValue([
      {
        id: "voc_delete",
        sourceText: "hello",
        normalizedText: "hello",
        translatedText: "你好",
        sourceLang: "en",
        targetLang: "zh-CN",
        kind: "word",
        wordCount: 1,
        createdAt: 1,
        lastSeenAt: 2,
        hitCount: 3,
        updatedAt: 4,
        deletedAt: null,
      },
    ])

    let resolveDelete: ((value: { ok: true }) => void) | null = null
    apiDeleteVocabularyItemMock.mockReturnValue(new Promise((resolve) => {
      resolveDelete = resolve
    }))

    const { getCachedVocabularyItems, removeVocabularyItem, VOCABULARY_CHANGED_EVENT } = await import("../service")
    const changedListener = vi.fn()
    document.addEventListener(VOCABULARY_CHANGED_EVENT, changedListener)

    const deletePromise = removeVocabularyItem("voc_delete")

    await vi.waitFor(() => {
      expect(getCachedVocabularyItems()).toEqual([])
      expect(changedListener).toHaveBeenCalledTimes(1)
    })

    if (!resolveDelete) {
      throw new Error("delete promise resolver was not captured")
    }

    const finishDelete = resolveDelete as (value: { ok: true }) => void
    finishDelete({ ok: true })
    await expect(deletePromise).resolves.toBeUndefined()

    document.removeEventListener(VOCABULARY_CHANGED_EVENT, changedListener)
  })

  it("restores the cache when delete fails", async () => {
    storageAdapterGetMock.mockResolvedValue([
      {
        id: "voc_delete",
        sourceText: "hello",
        normalizedText: "hello",
        translatedText: "你好",
        sourceLang: "en",
        targetLang: "zh-CN",
        kind: "word",
        wordCount: 1,
        createdAt: 1,
        lastSeenAt: 2,
        hitCount: 3,
        updatedAt: 4,
        deletedAt: null,
      },
    ])
    apiDeleteVocabularyItemMock.mockRejectedValue(new Error("delete failed"))

    const { getCachedVocabularyItems, removeVocabularyItem } = await import("../service")

    await expect(removeVocabularyItem("voc_delete")).rejects.toThrow("delete failed")
    expect(getCachedVocabularyItems()).toEqual([
      expect.objectContaining({
        id: "voc_delete",
      }),
    ])
  })

  it("keeps successful batch deletes removed when one request fails", async () => {
    storageAdapterGetMock.mockResolvedValue([
      {
        id: "voc_delete",
        sourceText: "hello",
        normalizedText: "hello",
        translatedText: "你好",
        sourceLang: "en",
        targetLang: "zh-CN",
        kind: "word",
        wordCount: 1,
        createdAt: 1,
        lastSeenAt: 2,
        hitCount: 3,
        updatedAt: 4,
        deletedAt: null,
      },
      {
        id: "voc_delete_2",
        sourceText: "world",
        normalizedText: "world",
        translatedText: "世界",
        sourceLang: "en",
        targetLang: "zh-CN",
        kind: "word",
        wordCount: 1,
        createdAt: 5,
        lastSeenAt: 6,
        hitCount: 2,
        updatedAt: 7,
        deletedAt: null,
      },
    ])

    let resolveFirstDelete: ((value: { ok: true }) => void) | undefined
    apiDeleteVocabularyItemMock
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveFirstDelete = resolve
      }))
      .mockRejectedValueOnce(new Error("delete failed"))

    const { getCachedVocabularyItems, removeVocabularyItems } = await import("../service")

    const deletePromise = removeVocabularyItems(["voc_delete", "voc_delete_2"])

    await vi.waitFor(() => {
      expect(getCachedVocabularyItems()).toEqual([])
    })

    await vi.waitFor(() => {
      expect(resolveFirstDelete).toBeDefined()
    })

    resolveFirstDelete?.({ ok: true })

    await expect(deletePromise).rejects.toThrow("delete failed")
    expect(getCachedVocabularyItems()).toEqual([
      expect.objectContaining({
        id: "voc_delete_2",
      }),
    ])
  })
})
