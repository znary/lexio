import type { VocabularyItem } from "@/types/vocabulary"
import { i18n } from "#imports"
import { IconBook2, IconDownload, IconTrash } from "@tabler/icons-react"
import { kebabCase } from "case-anything"
import { saveAs } from "file-saver"
import { useMemo, useState } from "react"
import { toast } from "sonner"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/base-ui/alert-dialog"
import { Badge } from "@/components/ui/base-ui/badge"
import { Button } from "@/components/ui/base-ui/button"
import { Checkbox } from "@/components/ui/base-ui/checkbox"
import { Input } from "@/components/ui/base-ui/input"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/base-ui/sheet"
import { Spinner } from "@/components/ui/base-ui/spinner"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/base-ui/tooltip"
import { VocabularyMasteryToggleButton } from "@/components/vocabulary/mastery-toggle-button"
import { useVocabularyItems } from "@/hooks/use-vocabulary-items"
import { APP_NAME } from "@/utils/constants/app"
import { clearVocabularyItems, removeVocabularyItems, setVocabularyItemMastered } from "@/utils/vocabulary/service"

function tVocabularyKey(key: string) {
  return i18n.t(key as never)
}

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString()
}

function buildMetaParts(item: VocabularyItem): string[] {
  return [
    item.lemma && item.lemma !== item.sourceText ? item.lemma : null,
    item.partOfSpeech,
    item.phonetic,
    `×${item.hitCount}`,
    formatDate(item.lastSeenAt),
  ].filter((value): value is string => Boolean(value))
}

function VocabularyIconAction({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="inline-flex" />}>
        {children}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

export function VocabularySheet({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { query } = useVocabularyItems()
  const [search, setSearch] = useState("")
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([])
  const [pendingDeleteItemIds, setPendingDeleteItemIds] = useState<string[] | null>(null)
  const [pendingMasteredItemIds, setPendingMasteredItemIds] = useState<string[]>([])
  const [deletingSelection, setDeletingSelection] = useState(false)
  const [clearingItems, setClearingItems] = useState(false)
  const items = useMemo(() => query.data ?? [], [query.data])
  const selectedItemIdSet = useMemo(() => new Set(selectedItemIds), [selectedItemIds])

  const filteredItems = useMemo(() => {
    const normalizedQuery = search.trim().toLowerCase()
    if (!normalizedQuery) {
      return items
    }

    return items.filter(item =>
      item.sourceText.toLowerCase().includes(normalizedQuery)
      || item.lemma?.toLowerCase().includes(normalizedQuery)
      || item.partOfSpeech?.toLowerCase().includes(normalizedQuery)
      || item.definition?.toLowerCase().includes(normalizedQuery)
      || item.contextSentences?.some(sentence => sentence.toLowerCase().includes(normalizedQuery))
      || item.translatedText.toLowerCase().includes(normalizedQuery),
    )
  }, [items, search])

  const selectedItems = useMemo(
    () => items.filter(item => selectedItemIdSet.has(item.id)),
    [items, selectedItemIdSet],
  )

  const selectedItemCount = selectedItems.length
  const selectedFilteredItemCount = filteredItems.filter(item => selectedItemIdSet.has(item.id)).length
  const isAllFilteredItemsSelected = filteredItems.length > 0 && selectedFilteredItemCount === filteredItems.length
  const deleteSelectedLabel = `${tVocabularyKey("options.vocabulary.library.deleteSelected")} (${selectedItemCount})`
  const deleteSelectedDialogTitle = tVocabularyKey("options.vocabulary.library.deleteSelectedDialog.title").replace("$1", String(selectedItemCount))

  function exportItems() {
    const blob = new Blob([JSON.stringify(filteredItems, null, 2)], { type: "application/json;charset=utf-8" })
    saveAs(blob, `${kebabCase(APP_NAME)}-vocabulary.json`)
  }

  function toggleVisibleSelection() {
    setSelectedItemIds((currentSelectedIds) => {
      const nextSelectedIds = new Set(currentSelectedIds)

      if (isAllFilteredItemsSelected) {
        for (const item of filteredItems) {
          nextSelectedIds.delete(item.id)
        }
      }
      else {
        for (const item of filteredItems) {
          nextSelectedIds.add(item.id)
        }
      }

      return [...nextSelectedIds]
    })
  }

  async function confirmDeleteItems() {
    if (!pendingDeleteItemIds || deletingSelection) {
      return
    }

    const deleteItemIds = pendingDeleteItemIds

    try {
      setDeletingSelection(true)
      await removeVocabularyItems(deleteItemIds)
      setSelectedItemIds(currentSelectedIds =>
        currentSelectedIds.filter(itemId => !deleteItemIds.includes(itemId)),
      )
      setPendingDeleteItemIds(null)
    }
    catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    }
    finally {
      setDeletingSelection(false)
    }
  }

  async function handleClearItems() {
    if (clearingItems) {
      return
    }

    try {
      setClearingItems(true)
      await clearVocabularyItems()
      setSelectedItemIds([])
    }
    catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    }
    finally {
      setClearingItems(false)
    }
  }

  async function handleToggleMastered(item: VocabularyItem) {
    if (pendingMasteredItemIds.includes(item.id)) {
      return
    }

    try {
      setPendingMasteredItemIds(currentItemIds => [...currentItemIds, item.id])
      await setVocabularyItemMastered(item.id, item.masteredAt == null)
    }
    catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    }
    finally {
      setPendingMasteredItemIds(currentItemIds => currentItemIds.filter(currentItemId => currentItemId !== item.id))
    }
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      setSearch("")
      setSelectedItemIds([])
      setPendingDeleteItemIds(null)
    }

    onOpenChange(nextOpen)
  }

  const isLoading = Boolean(query.isPending) && items.length === 0

  return (
    <>
      <Sheet open={open} onOpenChange={handleOpenChange}>
        <SheetContent
          side="bottom"
          showCloseButton={false}
          className="flex h-[82vh] max-h-[82vh] flex-col rounded-t-[28px] border-x-0 border-b-0 px-0 pt-0 shadow-2xl sm:max-w-none"
        >
          <SheetHeader className="shrink-0 gap-3 border-b border-border/70 px-4 pt-3 pb-4">
            <div className="mx-auto h-1.5 w-14 rounded-full bg-border/80" />
            <div className="space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <SheetTitle className="flex items-center gap-2 text-base">
                      <IconBook2 className="size-4 text-muted-foreground" />
                      {tVocabularyKey("options.vocabulary.library.title")}
                    </SheetTitle>
                    <Badge variant="outline" size="sm">
                      {items.length}
                    </Badge>
                  </div>
                  <SheetDescription>
                    {tVocabularyKey("options.vocabulary.library.description")}
                  </SheetDescription>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={exportItems}
                    disabled={filteredItems.length === 0}
                  >
                    <IconDownload className="size-4" />
                    {tVocabularyKey("options.vocabulary.library.export")}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    onClick={() => {
                      void handleClearItems()
                    }}
                    disabled={items.length === 0 || clearingItems}
                  >
                    {clearingItems ? <Spinner className="size-4" /> : <IconTrash className="size-4" />}
                    {tVocabularyKey("options.vocabulary.library.clear")}
                  </Button>
                </div>
              </div>

              <Input
                value={search}
                placeholder={tVocabularyKey("options.vocabulary.library.searchPlaceholder")}
                onChange={event => setSearch(event.target.value)}
              />
            </div>
          </SheetHeader>

          <div className="flex-1 overflow-y-auto px-4 pt-1 pb-6 scrollbar-thin">
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={toggleVisibleSelection}
                  disabled={filteredItems.length === 0}
                >
                  {tVocabularyKey("options.vocabulary.library.selectAll")}
                </Button>
                {selectedItemCount > 0
                  ? (
                      <Button
                        type="button"
                        variant="destructive"
                        size="sm"
                        onClick={() => setPendingDeleteItemIds(selectedItems.map(item => item.id))}
                        disabled={deletingSelection}
                      >
                        {deleteSelectedLabel}
                      </Button>
                    )
                  : null}
              </div>

              {isLoading
                ? (
                    <div className="flex items-center justify-center gap-2 rounded-2xl border border-dashed border-border/80 px-4 py-8 text-sm text-muted-foreground">
                      <Spinner className="size-4" />
                      {i18n.t("platform.quickAccess.status.loading")}
                    </div>
                  )
                : null}

              {!isLoading && filteredItems.length === 0
                ? (
                    <div className="rounded-2xl border border-dashed border-border/80 bg-muted/30 px-4 py-8 text-center text-sm text-muted-foreground">
                      {items.length === 0
                        ? tVocabularyKey("options.vocabulary.library.empty")
                        : tVocabularyKey("options.vocabulary.library.noResults")}
                    </div>
                  )
                : null}

              {!isLoading
                ? filteredItems.map((item) => {
                    const itemSelected = selectedItemIdSet.has(item.id)
                    const isMastered = item.masteredAt != null
                    const masteredActionLabel = isMastered
                      ? tVocabularyKey("options.vocabulary.library.unmarkMastered")
                      : tVocabularyKey("options.vocabulary.library.markMastered")
                    const masteringItem = pendingMasteredItemIds.includes(item.id)
                    const metaParts = buildMetaParts(item)

                    return (
                      <div
                        key={item.id}
                        className={`flex items-center gap-3 rounded-2xl border px-3 py-3 transition-colors ${
                          itemSelected
                            ? "border-primary/30 bg-primary/8"
                            : isMastered
                              ? "border-emerald-500/25 bg-emerald-500/6"
                              : "border-border/70 bg-background hover:bg-muted/40"
                        }`}
                      >
                        <Checkbox
                          aria-label={`${tVocabularyKey("options.vocabulary.library.selectItem")} ${item.sourceText}`}
                          checked={itemSelected}
                          onCheckedChange={(checked) => {
                            setSelectedItemIds((currentSelectedIds) => {
                              const nextSelectedIds = new Set(currentSelectedIds)
                              if (checked) {
                                nextSelectedIds.add(item.id)
                              }
                              else {
                                nextSelectedIds.delete(item.id)
                              }
                              return [...nextSelectedIds]
                            })
                          }}
                        />

                        <div className="min-w-0 flex-1 self-stretch">
                          <div className="flex h-full items-start gap-3">
                            <div className="min-w-0 flex-1 self-center">
                              <div className="truncate text-sm font-medium">{item.sourceText}</div>
                              <div className="mt-1 break-words text-sm text-muted-foreground">{item.translatedText}</div>

                              {metaParts.length > 0
                                ? (
                                    <div className="mt-2 flex flex-wrap gap-x-2 gap-y-1 text-xs text-muted-foreground">
                                      {metaParts.map(part => (
                                        <span key={`${item.id}-${part}`}>{part}</span>
                                      ))}
                                    </div>
                                  )
                                : null}

                              {item.definition
                                ? (
                                    <div className="mt-2 break-words text-xs text-muted-foreground">
                                      {item.definition}
                                    </div>
                                  )
                                : null}

                              {item.contextSentences?.length
                                ? (
                                    <div className="mt-2 space-y-1 text-xs italic text-muted-foreground">
                                      {item.contextSentences.map(sentence => (
                                        <div key={`${item.id}-${sentence}`} className="break-words">
                                          "
                                          {sentence}
                                          "
                                        </div>
                                      ))}
                                    </div>
                                  )
                                : null}
                            </div>

                            <div className="flex shrink-0 flex-col items-end gap-2 self-stretch">
                              <Badge variant="outline" size="sm" className="self-end">
                                {item.kind}
                              </Badge>

                              <div className="my-auto flex items-center gap-1">
                                <VocabularyIconAction label={masteredActionLabel}>
                                  <VocabularyMasteryToggleButton
                                    label={`${masteredActionLabel} ${item.sourceText}`}
                                    mastered={isMastered}
                                    pending={masteringItem}
                                    onClick={() => {
                                      void handleToggleMastered(item)
                                    }}
                                  />
                                </VocabularyIconAction>

                                <VocabularyIconAction label={tVocabularyKey("options.vocabulary.library.deleteSelected")}>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon-sm"
                                    className="text-muted-foreground hover:text-destructive"
                                    onClick={() => setPendingDeleteItemIds([item.id])}
                                    aria-label={`${tVocabularyKey("options.vocabulary.library.deleteSelected")} ${item.sourceText}`}
                                  >
                                    <IconTrash className="size-4" />
                                  </Button>
                                </VocabularyIconAction>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    )
                  })
                : null}
            </div>
          </div>
        </SheetContent>
      </Sheet>

      <AlertDialog
        open={pendingDeleteItemIds != null}
        onOpenChange={(nextOpen) => {
          if (!nextOpen && !deletingSelection) {
            setPendingDeleteItemIds(null)
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{deleteSelectedDialogTitle}</AlertDialogTitle>
            <AlertDialogDescription>
              {tVocabularyKey("options.vocabulary.library.deleteSelectedDialog.description")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingSelection}>
              {tVocabularyKey("options.vocabulary.library.deleteSelectedDialog.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                void confirmDeleteItems()
              }}
              disabled={deletingSelection}
            >
              {deletingSelection ? <Spinner className="mr-2" /> : null}
              {tVocabularyKey("options.vocabulary.library.deleteSelectedDialog.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
