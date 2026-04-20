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
    }))

    document.removeEventListener(VOCABULARY_CHANGED_EVENT, changedListener)
  })

  it("updates an existing item instead of inserting it again", async () => {
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
    }))
    expect(apiCreateVocabularyItemMock).not.toHaveBeenCalled()
    expect(savedItem).toEqual(expect.objectContaining({
      id: "voc_existing",
      translatedText: "您好",
      hitCount: 4,
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
