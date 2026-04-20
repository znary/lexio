import { i18n } from "#imports"
import { IconDownload, IconTrash } from "@tabler/icons-react"
import { kebabCase } from "case-anything"
import { saveAs } from "file-saver"
import { useEffect, useMemo, useState } from "react"
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
import { Button } from "@/components/ui/base-ui/button"
import { Checkbox } from "@/components/ui/base-ui/checkbox"
import { Input } from "@/components/ui/base-ui/input"
import { Spinner } from "@/components/ui/base-ui/spinner"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/base-ui/table"
import { useVocabularyItems } from "@/hooks/use-vocabulary-items"
import { APP_NAME } from "@/utils/constants/app"
import { clearVocabularyItems, removeVocabularyItems } from "@/utils/vocabulary/service"
import { ConfigCard } from "../../components/config-card"

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleString()
}

export function VocabularyLibraryCard() {
  const { query } = useVocabularyItems()
  const [search, setSearch] = useState("")
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([])
  const [pendingDeleteItemIds, setPendingDeleteItemIds] = useState<string[] | null>(null)
  const [deletingSelection, setDeletingSelection] = useState(false)
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

  useEffect(() => {
    setSelectedItemIds(currentSelectedIds =>
      currentSelectedIds.filter(itemId => items.some(item => item.id === itemId)),
    )
  }, [items])

  const exportItems = () => {
    const blob = new Blob([JSON.stringify(filteredItems, null, 2)], { type: "application/json;charset=utf-8" })
    saveAs(blob, `${kebabCase(APP_NAME)}-vocabulary.json`)
  }

  const deleteSelectedLabel = `${i18n.t("options.vocabulary.library.deleteSelected")} (${selectedItemCount})`
  const deleteSelectedDialogTitle = i18n.t("options.vocabulary.library.deleteSelectedDialog.title").replace("$1", String(selectedItemCount))
  const selectedCountLabel = i18n.t("options.vocabulary.library.selectedCount").replace("$1", String(selectedItemCount))

  async function confirmDeleteItems() {
    if (!pendingDeleteItemIds || deletingSelection) {
      return
    }

    const deleteItemIds = pendingDeleteItemIds

    try {
      setDeletingSelection(true)
      await removeVocabularyItems(deleteItemIds)
    }
    catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    }
    finally {
      setDeletingSelection(false)
      setPendingDeleteItemIds(null)
      setSelectedItemIds(currentSelectedIds =>
        currentSelectedIds.filter(itemId => !deleteItemIds.includes(itemId)),
      )
    }
  }

  return (
    <ConfigCard
      id="vocabulary-library"
      title={i18n.t("options.vocabulary.library.title")}
      description={i18n.t("options.vocabulary.library.description")}
    >
      <div className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row">
          <Input
            value={search}
            placeholder={i18n.t("options.vocabulary.library.searchPlaceholder")}
            onChange={event => setSearch(event.target.value)}
          />
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" onClick={exportItems} disabled={filteredItems.length === 0}>
              <IconDownload className="size-4" />
              {i18n.t("options.vocabulary.library.export")}
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => {
                void clearVocabularyItems()
              }}
              disabled={items.length === 0}
            >
              <IconTrash className="size-4" />
              {i18n.t("options.vocabulary.library.clear")}
            </Button>
          </div>
        </div>

        {selectedItemCount > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-sm">
            <div className="text-muted-foreground">
              {selectedCountLabel}
            </div>
            <Button
              type="button"
              variant="destructive"
              onClick={() => setPendingDeleteItemIds(selectedItems.map(item => item.id))}
              disabled={deletingSelection}
            >
              {deleteSelectedLabel}
            </Button>
          </div>
        )}

        {filteredItems.length === 0
          ? (
              <div className="rounded-md border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
                {items.length === 0
                  ? i18n.t("options.vocabulary.library.empty")
                  : i18n.t("options.vocabulary.library.noResults")}
              </div>
            )
          : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">
                      <Checkbox
                        aria-label={i18n.t("options.vocabulary.library.selectAll")}
                        checked={isAllFilteredItemsSelected}
                        onCheckedChange={(checked) => {
                          setSelectedItemIds((currentSelectedIds) => {
                            const nextSelectedIds = new Set(currentSelectedIds)

                            if (checked) {
                              for (const item of filteredItems) {
                                nextSelectedIds.add(item.id)
                              }
                            }
                            else {
                              for (const item of filteredItems) {
                                nextSelectedIds.delete(item.id)
                              }
                            }

                            return [...nextSelectedIds]
                          })
                        }}
                      />
                    </TableHead>
                    <TableHead>{i18n.t("options.vocabulary.library.columns.source")}</TableHead>
                    <TableHead>{i18n.t("options.vocabulary.library.columns.translation")}</TableHead>
                    <TableHead>{i18n.t("options.vocabulary.library.columns.type")}</TableHead>
                    <TableHead>{i18n.t("options.vocabulary.library.columns.hitCount")}</TableHead>
                    <TableHead>{i18n.t("options.vocabulary.library.columns.lastSeenAt")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredItems.map((item) => {
                    const itemSelected = selectedItemIdSet.has(item.id)

                    return (
                      <TableRow key={item.id}>
                        <TableCell className="w-10">
                          <Checkbox
                            aria-label={`${i18n.t("options.vocabulary.library.selectItem")} ${item.sourceText}`}
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
                        </TableCell>
                        <TableCell className="max-w-56 whitespace-normal break-words">
                          <div className="space-y-0.5">
                            <div>{item.sourceText}</div>
                            {(item.lemma || item.partOfSpeech) && (
                              <div className="text-xs text-muted-foreground">
                                {[item.lemma && item.lemma !== item.sourceText ? item.lemma : null, item.partOfSpeech].filter(Boolean).join(" · ")}
                              </div>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="max-w-56 whitespace-normal break-words">{item.translatedText}</TableCell>
                        <TableCell>{item.kind}</TableCell>
                        <TableCell>{item.hitCount}</TableCell>
                        <TableCell>{formatDate(item.lastSeenAt)}</TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            )}
      </div>

      <AlertDialog
        open={pendingDeleteItemIds != null}
        onOpenChange={(open) => {
          if (!open && !deletingSelection) {
            setPendingDeleteItemIds(null)
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{deleteSelectedDialogTitle}</AlertDialogTitle>
            <AlertDialogDescription>
              {i18n.t("options.vocabulary.library.deleteSelectedDialog.description")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingSelection}>
              {i18n.t("options.vocabulary.library.deleteSelectedDialog.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => void confirmDeleteItems()} disabled={deletingSelection}>
              {deletingSelection && <Spinner className="mr-2" />}
              {i18n.t("options.vocabulary.library.deleteSelectedDialog.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ConfigCard>
  )
}
