// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const {
  apiClearVocabularyItemsMock,
  apiCreateVocabularyItemMock,
  apiDeleteVocabularyItemMock,
  apiGetVocabularyItemsMock,
  apiGetVocabularyMetaMock,
  pullPlatformSyncMock,
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
  pullPlatformSyncMock: vi.fn(),
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
  pullPlatformSync: (...args: unknown[]) => pullPlatformSyncMock(...args),
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
    pullPlatformSyncMock.mockResolvedValue({ settings: null, vocabularyItems: [] })
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

  it("includes the latest local vocabulary snapshot in change events", async () => {
    const { saveTranslatedSelectionToVocabulary, VOCABULARY_CHANGED_EVENT } = await import("../service")
    const changeEvents: CustomEvent[] = []
    const changedListener = (event: Event) => {
      changeEvents.push(event as CustomEvent)
    }
    document.addEventListener(VOCABULARY_CHANGED_EVENT, changedListener)

    await saveTranslatedSelectionToVocabulary({
      sourceText: "cloud",
      translatedText: "云",
      contextSentence: "The cloud is local.",
      sourceUrl: "https://example.com/cloud",
      sourceLang: "en",
      targetLang: "zh-CN",
      settings: {
        autoSave: true,
        highlightEnabled: true,
        maxPhraseWords: 3,
        highlightColor: "#fde68a",
      },
    })

    expect(changeEvents).toHaveLength(1)
    expect(changeEvents[0]?.detail).toEqual({
      items: [
        expect.objectContaining({
          sourceText: "cloud",
          translatedText: "云",
        }),
      ],
    })

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
      nuance: "强调主动推理和判断。",
      partOfSpeech: "verb",
      phonetic: "/theta-ng-k/",
      wordFamily: {
        core: [
          { term: "think", partOfSpeech: "verb", definition: "思考" },
          { term: "thinker", partOfSpeech: "noun", definition: "思考者" },
        ],
        contrast: [
          { term: "thoughtless", partOfSpeech: "adjective", definition: "欠考虑的" },
        ],
        related: [
          { term: "thought", partOfSpeech: "noun", definition: "想法" },
        ],
      },
    })

    expect(apiUpdateVocabularyItemMock).toHaveBeenCalledWith(expect.objectContaining({
      id: "voc_existing",
      normalizedText: "think",
      lemma: "think",
      nuance: "强调主动推理和判断。",
      partOfSpeech: "verb",
      definition: "思考；认为",
      phonetic: "/theta-ng-k/",
      wordFamily: {
        core: [
          { term: "think", partOfSpeech: "verb", definition: "思考" },
          { term: "thinker", partOfSpeech: "noun", definition: "思考者" },
        ],
        contrast: [
          { term: "thoughtless", partOfSpeech: "adjective", definition: "欠考虑的" },
        ],
        related: [
          { term: "thought", partOfSpeech: "noun", definition: "想法" },
        ],
      },
      matchTerms: expect.arrayContaining(["think", "thinking", "thinks", "thought"]),
    }))
    expect(updatedItem).toEqual(expect.objectContaining({
      id: "voc_existing",
      normalizedText: "think",
      lemma: "think",
      nuance: "强调主动推理和判断。",
      partOfSpeech: "verb",
      definition: "思考；认为",
      phonetic: "/theta-ng-k/",
      wordFamily: {
        core: [
          { term: "think", partOfSpeech: "verb", definition: "思考" },
          { term: "thinker", partOfSpeech: "noun", definition: "思考者" },
        ],
        contrast: [
          { term: "thoughtless", partOfSpeech: "adjective", definition: "欠考虑的" },
        ],
        related: [
          { term: "thought", partOfSpeech: "noun", definition: "想法" },
        ],
      },
      matchTerms: expect.arrayContaining(["think", "thinking", "thinks", "thought"]),
    }))
  })

  it("adds word family core terms to the vocabulary match terms", async () => {
    storageAdapterGetMock.mockResolvedValue([
      {
        id: "voc_existing",
        sourceText: "monetize",
        normalizedText: "monetize",
        matchTerms: ["monetize", "monetizes", "monetizing", "monetized"],
        translatedText: "变现",
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
      lemma: "monetize",
      wordFamily: {
        core: [
          { term: "Monetization", partOfSpeech: "noun", definition: "变现；货币化" },
          { term: "monetizable", partOfSpeech: "adjective", definition: "可变现的" },
        ],
        contrast: [
          { term: "demonetize", partOfSpeech: "verb", definition: "取消变现" },
        ],
        related: [
          { term: "revenue", partOfSpeech: "noun", definition: "收入" },
        ],
      },
    })

    const updatedPayload = apiUpdateVocabularyItemMock.mock.calls[0]?.[0] as { matchTerms?: string[] } | undefined
    expect(updatedPayload).toEqual(expect.objectContaining({
      id: "voc_existing",
      normalizedText: "monetize",
      matchTerms: expect.arrayContaining(["monetize", "monetization", "monetizable"]),
    }))
    expect(updatedPayload?.matchTerms).not.toContain("demonetize")
    expect(updatedPayload?.matchTerms).not.toContain("revenue")
    expect(updatedItem).toEqual(expect.objectContaining({
      id: "voc_existing",
      matchTerms: expect.arrayContaining(["monetize", "monetization", "monetizable"]),
    }))
  })

  it("stores nearby expressions for phrase vocabulary items in the word family field", async () => {
    storageAdapterGetMock.mockResolvedValue([
      {
        id: "voc_phrase",
        sourceText: "in favor of",
        normalizedText: "in favor of",
        translatedText: "支持",
        sourceLang: "en",
        targetLang: "zh-CN",
        kind: "phrase",
        wordCount: 3,
        createdAt: 1,
        lastSeenAt: 2,
        hitCount: 3,
        updatedAt: 4,
        deletedAt: null,
      },
    ])

    const { updateVocabularyItemDetails } = await import("../service")
    const nearbyExpressions = {
      core: [
        { term: "be in favor of", definition: "支持，赞成" },
      ],
      contrast: [
        { term: "be against", definition: "反对" },
      ],
      related: [
        { term: "support", partOfSpeech: "verb", definition: "支持" },
      ],
    }

    const updatedItem = await updateVocabularyItemDetails("voc_phrase", {
      definition: "支持；赞成",
      wordFamily: nearbyExpressions,
    })

    expect(apiUpdateVocabularyItemMock).toHaveBeenCalledWith(expect.objectContaining({
      id: "voc_phrase",
      definition: "支持；赞成",
      kind: "phrase",
      wordFamily: nearbyExpressions,
    }))
    expect(updatedItem).toEqual(expect.objectContaining({
      id: "voc_phrase",
      definition: "支持；赞成",
      kind: "phrase",
      wordFamily: nearbyExpressions,
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

  it("finds a saved item by a word family core term for the same language pair", async () => {
    storageAdapterGetMock.mockResolvedValue([
      {
        id: "voc_existing",
        sourceText: "monetize",
        normalizedText: "monetize",
        lemma: "monetize",
        matchTerms: ["monetize", "monetizes", "monetizing", "monetized"],
        wordFamily: {
          core: [
            { term: "Monetization", partOfSpeech: "noun", definition: "变现；货币化" },
          ],
          contrast: [
            { term: "demonetize", partOfSpeech: "verb", definition: "取消变现" },
          ],
          related: [
            { term: "revenue", partOfSpeech: "noun", definition: "收入" },
          ],
        },
        translatedText: "变现",
        phonetic: "/ˈmʌnətaɪz/",
        partOfSpeech: "verb",
        definition: "使变现；货币化",
        difficulty: "C1",
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
      sourceText: "Monetization",
      sourceLang: "en",
      targetLang: "zh-CN",
    })

    expect(matchedItem).toEqual(expect.objectContaining({
      id: "voc_existing",
      normalizedText: "monetize",
      lemma: "monetize",
      translatedText: "变现",
      matchTerms: expect.arrayContaining(["monetization"]),
    }))
    expect(getCachedVocabularyItems()).toEqual([
      expect.objectContaining({
        id: "voc_existing",
        matchTerms: expect.arrayContaining(["monetization"]),
      }),
    ])
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

  it("reuses guest vocabulary for signed-in local-only reads when the account cache is empty", async () => {
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
        return []
      }

      if (key === "vocabularyItems:guest") {
        return [
          {
            id: "voc_guest",
            sourceText: "cloud",
            normalizedText: "cloud",
            translatedText: "云",
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
    const items = await getVocabularyItems({ localOnly: true, skipRemoteProbe: true })

    expect(items).toEqual([
      expect.objectContaining({
        id: "voc_guest",
      }),
    ])
    expect(storageAdapterGetMock).toHaveBeenCalledWith(
      "vocabularyItems:guest",
      [],
      expect.anything(),
    )
    expect(storageAdapterSetMock).toHaveBeenCalledWith(
      "vocabularyItems:platform:user_1",
      expect.arrayContaining([
        expect.objectContaining({
          id: "voc_guest",
        }),
      ]),
      expect.anything(),
    )
    expect(apiGetVocabularyItemsMock).not.toHaveBeenCalled()
    expect(apiGetVocabularyMetaMock).not.toHaveBeenCalled()
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

  it("can return local signed-in items without starting a stale remote probe", async () => {
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
            sourceText: "cloud",
            normalizedText: "cloud",
            translatedText: "云",
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

    const { getVocabularyItems } = await import("../service")
    const items = await getVocabularyItems({ skipRemoteProbe: true })

    expect(items).toEqual([
      expect.objectContaining({
        id: "voc_local",
      }),
    ])
    expect(apiGetVocabularyMetaMock).not.toHaveBeenCalled()
    expect(apiGetVocabularyItemsMock).not.toHaveBeenCalled()
  })

  it("does not fetch remote vocabulary during signed-in local-only reads when local storage is empty", async () => {
    getPlatformAuthSessionMock.mockResolvedValue({
      token: "platform-token",
      user: {
        id: "user_1",
        email: "user@example.com",
      },
      updatedAt: 1,
    })
    storageAdapterGetMock.mockResolvedValue([])

    const { getVocabularyItems } = await import("../service")
    const items = await getVocabularyItems({ localOnly: true, skipRemoteProbe: true })

    expect(items).toEqual([])
    expect(apiGetVocabularyItemsMock).not.toHaveBeenCalled()
    expect(apiGetVocabularyMetaMock).not.toHaveBeenCalled()
  })

  it("bootstraps signed-in local cache from platform sync when storage is empty", async () => {
    getPlatformAuthSessionMock.mockResolvedValue({
      token: "platform-token",
      user: {
        id: "user_1",
        email: "user@example.com",
      },
      updatedAt: 1,
    })
    storageAdapterGetMock.mockResolvedValue([])
    pullPlatformSyncMock.mockResolvedValue({
      settings: null,
      vocabularyItems: [
        {
          id: "voc_synced",
          sourceText: "frustrating",
          normalizedText: "frustrating",
          translatedText: "令人懊恼的",
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
      ],
    })

    const { getVocabularyItems, getCachedVocabularyItems } = await import("../service")
    const items = await getVocabularyItems({ skipRemoteProbe: true })

    expect(items).toEqual([
      expect.objectContaining({
        id: "voc_synced",
      }),
    ])
    expect(getCachedVocabularyItems()).toEqual([
      expect.objectContaining({
        id: "voc_synced",
      }),
    ])
    expect(pullPlatformSyncMock).toHaveBeenCalledTimes(1)
    expect(apiGetVocabularyItemsMock).not.toHaveBeenCalled()
    expect(storageAdapterSetMock).toHaveBeenCalledWith(
      "vocabularyItems:platform:user_1",
      expect.arrayContaining([
        expect.objectContaining({
          id: "voc_synced",
        }),
      ]),
      expect.anything(),
    )
  })

  it("falls back to the vocabulary endpoint when platform sync bootstrap fails", async () => {
    getPlatformAuthSessionMock.mockResolvedValue({
      token: "platform-token",
      user: {
        id: "user_1",
        email: "user@example.com",
      },
      updatedAt: 1,
    })
    storageAdapterGetMock.mockResolvedValue([])
    pullPlatformSyncMock.mockRejectedValue(new Error("sync pull failed"))
    apiGetVocabularyItemsMock.mockResolvedValue([
      {
        id: "voc_remote",
        sourceText: "fundamental",
        normalizedText: "fundamental",
        translatedText: "基础的",
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

    const { getVocabularyItems } = await import("../service")
    const items = await getVocabularyItems({ skipRemoteProbe: true })

    expect(items).toEqual([
      expect.objectContaining({
        id: "voc_remote",
      }),
    ])
    expect(pullPlatformSyncMock).toHaveBeenCalledTimes(1)
    expect(apiGetVocabularyItemsMock).toHaveBeenCalledTimes(1)
  })

  it("checks signed-in vocabulary reuse without starting a stale remote probe", async () => {
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
            sourceText: "cloud",
            normalizedText: "cloud",
            translatedText: "云",
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

    const { findVocabularyItemForSelection } = await import("../service")
    const matchedItem = await findVocabularyItemForSelection({
      sourceText: "cloud",
      sourceLang: "en",
      targetLang: "zh-CN",
    })

    expect(matchedItem).toEqual(expect.objectContaining({
      id: "voc_local",
    }))
    await new Promise(resolve => window.setTimeout(resolve, 0))
    expect(apiGetVocabularyMetaMock).not.toHaveBeenCalled()
    expect(apiGetVocabularyItemsMock).not.toHaveBeenCalled()
  })

  it("does not let a stale remote probe clear local vocabulary saved after the probe started", async () => {
    let resolveRemoteMeta: ((meta: { updatedAt: number, count: number }) => void) | null = null
    let resolveCreate: ((value: { ok: true, id: string }) => void) | null = null

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
            id: "voc_existing",
            sourceText: "cloud",
            normalizedText: "cloud",
            translatedText: "云",
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
    apiGetVocabularyMetaMock.mockReturnValue(new Promise((resolve) => {
      resolveRemoteMeta = resolve
    }))
    apiGetVocabularyItemsMock.mockResolvedValue([])
    apiCreateVocabularyItemMock.mockReturnValue(new Promise((resolve) => {
      resolveCreate = resolve
    }))

    const { getCachedVocabularyItems, getVocabularyItems, saveTranslatedSelectionToVocabulary } = await import("../service")
    await expect(getVocabularyItems()).resolves.toEqual([
      expect.objectContaining({
        id: "voc_existing",
      }),
    ])
    await vi.waitFor(() => {
      expect(apiGetVocabularyMetaMock).toHaveBeenCalledTimes(1)
    })

    const savePromise = saveTranslatedSelectionToVocabulary({
      sourceText: "highlight",
      translatedText: "高亮",
      contextSentence: "The page keeps every highlight visible.",
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

    await vi.waitFor(() => {
      expect(getCachedVocabularyItems()).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: "voc_existing" }),
        expect.objectContaining({ sourceText: "highlight" }),
      ]))
    })

    if (!resolveRemoteMeta) {
      throw new Error("remote meta resolver was not captured")
    }

    const finishRemoteMeta = resolveRemoteMeta as (meta: { updatedAt: number, count: number }) => void
    finishRemoteMeta({ updatedAt: 99, count: 0 })
    await vi.waitFor(() => {
      expect(apiGetVocabularyItemsMock).toHaveBeenCalledTimes(1)
    })

    await new Promise(resolve => window.setTimeout(resolve, 0))
    expect(getCachedVocabularyItems()).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "voc_existing" }),
      expect.objectContaining({ sourceText: "highlight" }),
    ]))

    if (!resolveCreate) {
      throw new Error("create promise resolver was not captured")
    }

    const finishCreate = resolveCreate as (value: { ok: true, id: string }) => void
    finishCreate({ ok: true, id: "voc_created" })
    await expect(savePromise).resolves.toEqual(expect.objectContaining({
      sourceText: "highlight",
    }))
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
