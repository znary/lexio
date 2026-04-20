// @vitest-environment jsdom
/* eslint-disable react/no-context-provider */
import type { ReactNode } from "react"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { createContext, use, useState } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { VocabularyLibraryCard } from "../vocabulary-library"

const { invalidateMock, removeVocabularyItemsMock } = vi.hoisted(() => ({
  invalidateMock: vi.fn(),
  removeVocabularyItemsMock: vi.fn(),
}))

vi.mock("#imports", () => ({
  i18n: {
    t: (key: string) => {
      const messages: Record<string, string> = {
        "options.vocabulary.library.deleteSelected": "Delete selected",
        "options.vocabulary.library.selectedCount": "$1 selected",
        "options.vocabulary.library.deleteSelectedDialog.title": "Delete $1 selected items?",
        "options.vocabulary.library.deleteSelectedDialog.description": "This action cannot be undone. Selected items will be removed from your library.",
        "options.vocabulary.library.deleteSelectedDialog.confirm": "Delete selected items",
        "options.vocabulary.library.deleteSelectedDialog.cancel": "Cancel",
        "options.vocabulary.library.selectAll": "Select all visible items",
        "options.vocabulary.library.selectItem": "Select",
      }
      return messages[key] ?? key
    },
  },
}))

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
        {
          id: "voc_delete_2",
          sourceText: "world",
          translatedText: "世界",
          kind: "word",
          hitCount: 2,
          lastSeenAt: 1700000100000,
        },
      ],
    },
    invalidate: invalidateMock,
  }),
}))

vi.mock("@/utils/vocabulary/service", () => ({
  clearVocabularyItems: vi.fn(),
  removeVocabularyItems: (...args: unknown[]) => removeVocabularyItemsMock(...args),
}))

vi.mock("file-saver", () => ({
  saveAs: vi.fn(),
}))

vi.mock("@/components/ui/base-ui/alert-dialog", async () => {
  const React = await import("react")

  interface AlertDialogContextValue {
    open: boolean
    setOpen: (open: boolean) => void
  }

  const AlertDialogContext = createContext<AlertDialogContextValue | null>(null)

  function useAlertDialogContext() {
    const context = use(AlertDialogContext)
    if (!context) {
      throw new Error("AlertDialog components must be used within AlertDialog.")
    }
    return context
  }

  function AlertDialog({
    open,
    onOpenChange,
    children,
  }: {
    open?: boolean
    onOpenChange?: (open: boolean) => void
    children: ReactNode
  }) {
    const [localOpen, setLocalOpen] = useState(false)
    const resolvedOpen = open ?? localOpen
    const setOpen = onOpenChange ?? setLocalOpen

    return (
      <AlertDialogContext.Provider value={{ open: resolvedOpen, setOpen }}>
        {children}
      </AlertDialogContext.Provider>
    )
  }

  function AlertDialogContent({ children }: { children: ReactNode }) {
    const { open } = useAlertDialogContext()
    return open ? <div>{children}</div> : null
  }

  function AlertDialogHeader({ children }: { children: ReactNode }) {
    return <div>{children}</div>
  }

  function AlertDialogTitle({ children }: { children: ReactNode }) {
    return <h2>{children}</h2>
  }

  function AlertDialogDescription({ children }: { children: ReactNode }) {
    return <p>{children}</p>
  }

  function AlertDialogFooter({ children }: { children: ReactNode }) {
    return <div>{children}</div>
  }

  function AlertDialogAction(props: React.ComponentProps<"button">) {
    return <button type="button" {...props} />
  }

  function AlertDialogCancel({
    children,
    onClick,
    ...props
  }: React.ComponentProps<"button">) {
    const { setOpen } = useAlertDialogContext()
    return (
      <button
        type="button"
        onClick={(event) => {
          onClick?.(event)
          setOpen(false)
        }}
        {...props}
      >
        {children}
      </button>
    )
  }

  return {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
  }
})

describe("vocabulary library card", () => {
  beforeEach(() => {
    invalidateMock.mockReset()
    removeVocabularyItemsMock.mockReset()
  })

  it("asks for confirmation before deleting selected items", () => {
    render(<VocabularyLibraryCard />)

    fireEvent.click(screen.getByRole("checkbox", { name: "Select hello" }))
    fireEvent.click(screen.getByRole("checkbox", { name: "Select world" }))
    fireEvent.click(screen.getByRole("button", { name: "Delete selected (2)" }))

    expect(removeVocabularyItemsMock).not.toHaveBeenCalled()
    expect(screen.getByText("Delete 2 selected items?")).toBeInTheDocument()
    expect(screen.getByText("This action cannot be undone. Selected items will be removed from your library.")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Delete selected items" })).toBeInTheDocument()
  })

  it("locks the confirm action while deleting and avoids duplicate submits", async () => {
    let resolveDelete: (() => void) | null = null
    removeVocabularyItemsMock.mockReturnValue(new Promise<void>((resolve) => {
      resolveDelete = resolve
    }))

    render(<VocabularyLibraryCard />)

    fireEvent.click(screen.getByRole("checkbox", { name: "Select hello" }))
    fireEvent.click(screen.getByRole("button", { name: "Delete selected (1)" }))

    const confirmButton = screen.getByRole("button", { name: "Delete selected items" })
    fireEvent.click(confirmButton)

    expect(removeVocabularyItemsMock).toHaveBeenCalledTimes(1)
    expect(removeVocabularyItemsMock).toHaveBeenCalledWith(["voc_delete"])
    expect(confirmButton).toBeDisabled()

    fireEvent.click(confirmButton)
    expect(removeVocabularyItemsMock).toHaveBeenCalledTimes(1)

    if (!resolveDelete) {
      throw new Error("delete promise resolver was not captured")
    }

    const finishDelete = resolveDelete as () => void
    finishDelete()

    await waitFor(() => {
      expect(invalidateMock).not.toHaveBeenCalled()
    })
  })
})
