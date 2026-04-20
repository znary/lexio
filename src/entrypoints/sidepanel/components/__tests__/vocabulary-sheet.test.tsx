// @vitest-environment jsdom
/* eslint-disable react/no-context-provider */
import type { ReactNode } from "react"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { createContext, use, useState } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { VocabularySheet } from "../vocabulary-sheet"

const { removeVocabularyItemsMock } = vi.hoisted(() => ({
  removeVocabularyItemsMock: vi.fn(),
}))

vi.mock("#imports", () => ({
  i18n: {
    t: (key: string) => {
      const messages: Record<string, string> = {
        "options.vocabulary.library.title": "Vocabulary Library",
        "options.vocabulary.library.description": "Search, remove, clear, and export saved words.",
        "options.vocabulary.library.export": "Export",
        "options.vocabulary.library.clear": "Clear",
        "options.vocabulary.library.searchPlaceholder": "Search saved words or translations",
        "options.vocabulary.library.deleteSelected": "Delete",
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
          normalizedText: "hello",
          translatedText: "你好",
          kind: "word",
          sourceLang: "en",
          targetLang: "zh-CN",
          wordCount: 1,
          hitCount: 3,
          createdAt: 1700000000000,
          updatedAt: 1700000000000,
          lastSeenAt: 1700000000000,
          deletedAt: null,
        },
        {
          id: "voc_delete_2",
          sourceText: "world",
          normalizedText: "world",
          translatedText: "世界",
          kind: "word",
          sourceLang: "en",
          targetLang: "zh-CN",
          wordCount: 1,
          hitCount: 2,
          createdAt: 1700000100000,
          updatedAt: 1700000100000,
          lastSeenAt: 1700000100000,
          deletedAt: null,
        },
      ],
      isPending: false,
    },
  }),
}))

vi.mock("@/utils/vocabulary/service", () => ({
  clearVocabularyItems: vi.fn(),
  removeVocabularyItems: (...args: unknown[]) => removeVocabularyItemsMock(...args),
}))

vi.mock("file-saver", () => ({
  saveAs: vi.fn(),
}))

vi.mock("@/components/ui/base-ui/sheet", () => ({
  Sheet: ({ open, children }: { open: boolean, children: ReactNode }) => (open ? <div>{children}</div> : null),
  SheetContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SheetHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SheetTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
  SheetDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
}))

vi.mock("@/components/ui/base-ui/scroll-area", () => ({
  ScrollArea: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))

vi.mock("@/components/ui/base-ui/badge", () => ({
  Badge: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}))

vi.mock("@/components/ui/base-ui/checkbox", () => ({
  Checkbox: ({
    checked,
    onCheckedChange,
    ...props
  }: React.ComponentProps<"input"> & {
    checked?: boolean
    onCheckedChange?: (checked: boolean) => void
  }) => (
    <input
      type="checkbox"
      checked={Boolean(checked)}
      onChange={event => onCheckedChange?.(event.target.checked)}
      {...props}
    />
  ),
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
    return <h3>{children}</h3>
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

describe("vocabulary sheet", () => {
  beforeEach(() => {
    removeVocabularyItemsMock.mockReset()
  })

  it("asks for confirmation before deleting selected items", () => {
    render(<VocabularySheet open onOpenChange={vi.fn()} />)

    fireEvent.click(screen.getByRole("checkbox", { name: "options.vocabulary.library.selectItem hello" }))
    fireEvent.click(screen.getByRole("checkbox", { name: "options.vocabulary.library.selectItem world" }))
    fireEvent.click(screen.getByRole("button", { name: "options.vocabulary.library.deleteSelected (2)" }))

    expect(removeVocabularyItemsMock).not.toHaveBeenCalled()
    expect(screen.getByText("options.vocabulary.library.deleteSelectedDialog.title")).toBeInTheDocument()
    expect(screen.getByText("options.vocabulary.library.deleteSelectedDialog.description")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "options.vocabulary.library.deleteSelectedDialog.confirm" })).toBeInTheDocument()
  })

  it("locks the confirm action while deleting and avoids duplicate submits", async () => {
    let resolveDelete: (() => void) | null = null
    removeVocabularyItemsMock.mockReturnValue(new Promise<void>((resolve) => {
      resolveDelete = resolve
    }))

    render(<VocabularySheet open onOpenChange={vi.fn()} />)

    fireEvent.click(screen.getByRole("checkbox", { name: "options.vocabulary.library.selectItem hello" }))
    fireEvent.click(screen.getByRole("button", { name: "options.vocabulary.library.deleteSelected (1)" }))

    const confirmButton = screen.getByRole("button", { name: "options.vocabulary.library.deleteSelectedDialog.confirm" })
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
      expect(confirmButton).not.toBeInTheDocument()
    })
  })
})
