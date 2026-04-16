// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { VocabularyLibraryCard } from "../vocabulary-library"

const invalidateMock = vi.fn()
const removeVocabularyItemMock = vi.fn()

vi.mock("@/hooks/use-vocabulary-items", () => ({
  useVocabularyItems: () => ({
    query: {
      data: [
        {
          id: "voc_delete",
          sourceText: "hello",
          translatedText: "你好",
          kind: "word",
          hitCount: 3,
          lastSeenAt: 1700000000000,
        },
      ],
    },
    invalidate: invalidateMock,
  }),
}))

vi.mock("@/utils/vocabulary/service", () => ({
  clearVocabularyItems: vi.fn(),
  removeVocabularyItem: (...args: unknown[]) => removeVocabularyItemMock(...args),
}))

vi.mock("file-saver", () => ({
  saveAs: vi.fn(),
}))

describe("vocabulary library card", () => {
  it("adds a delete label and calls the delete service", async () => {
    removeVocabularyItemMock.mockResolvedValue(undefined)

    render(<VocabularyLibraryCard />)

    const deleteButton = screen.getByRole("button", { name: "options.floatingButtonAndToolbar.selectionToolbar.customActions.form.delete: hello" })
    fireEvent.click(deleteButton)

    expect(removeVocabularyItemMock).toHaveBeenCalledWith("voc_delete")
    await waitFor(() => {
      expect(invalidateMock).toHaveBeenCalledTimes(1)
    })
  })
})
