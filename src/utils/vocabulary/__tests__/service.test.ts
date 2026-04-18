// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const {
  apiClearVocabularyItemsMock,
  apiCreateVocabularyItemMock,
  apiDeleteVocabularyItemMock,
  apiGetVocabularyItemsMock,
  apiUpdateVocabularyItemMock,
} = vi.hoisted(() => ({
  apiClearVocabularyItemsMock: vi.fn(),
  apiCreateVocabularyItemMock: vi.fn(),
  apiDeleteVocabularyItemMock: vi.fn(),
  apiGetVocabularyItemsMock: vi.fn(),
  apiUpdateVocabularyItemMock: vi.fn(),
}))

vi.mock("@/utils/platform/api", () => ({
  clearVocabularyItems: (...args: unknown[]) => apiClearVocabularyItemsMock(...args),
  createVocabularyItem: (...args: unknown[]) => apiCreateVocabularyItemMock(...args),
  deleteVocabularyItem: (...args: unknown[]) => apiDeleteVocabularyItemMock(...args),
  getVocabularyItems: (...args: unknown[]) => apiGetVocabularyItemsMock(...args),
  updateVocabularyItem: (...args: unknown[]) => apiUpdateVocabularyItemMock(...args),
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

    await Promise.resolve()
    await Promise.resolve()

    expect(getCachedVocabularyItems()).toEqual([
      expect.objectContaining({
        sourceText: "hello",
        translatedText: "你好",
        normalizedText: "hello",
      }),
    ])
    expect(changedListener).toHaveBeenCalledTimes(1)

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
    apiGetVocabularyItemsMock.mockResolvedValue([
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
    apiGetVocabularyItemsMock.mockResolvedValue([
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
    apiGetVocabularyItemsMock.mockResolvedValue([
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
    apiGetVocabularyItemsMock.mockResolvedValue([
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
  })

  it("does not reuse a saved item from a different target language", async () => {
    apiGetVocabularyItemsMock.mockResolvedValue([
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

  it("removes an item from the local cache before the delete request finishes", async () => {
    apiGetVocabularyItemsMock.mockResolvedValue([
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

    await Promise.resolve()
    await Promise.resolve()

    expect(getCachedVocabularyItems()).toEqual([])
    expect(changedListener).toHaveBeenCalledTimes(1)

    if (!resolveDelete) {
      throw new Error("delete promise resolver was not captured")
    }

    const finishDelete = resolveDelete as (value: { ok: true }) => void
    finishDelete({ ok: true })
    await expect(deletePromise).resolves.toBeUndefined()

    document.removeEventListener(VOCABULARY_CHANGED_EVENT, changedListener)
  })

  it("restores the cache when delete fails", async () => {
    apiGetVocabularyItemsMock.mockResolvedValue([
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
})
