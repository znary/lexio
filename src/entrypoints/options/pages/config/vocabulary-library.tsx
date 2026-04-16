import { i18n } from "#imports"
import { IconDownload, IconTrash } from "@tabler/icons-react"
import { kebabCase } from "case-anything"
import { saveAs } from "file-saver"
import { useMemo, useState } from "react"
import { Button } from "@/components/ui/base-ui/button"
import { Input } from "@/components/ui/base-ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/base-ui/table"
import { useVocabularyItems } from "@/hooks/use-vocabulary-items"
import { APP_NAME } from "@/utils/constants/app"
import { clearVocabularyItems, removeVocabularyItem } from "@/utils/vocabulary/service"
import { ConfigCard } from "../../components/config-card"

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleString()
}

export function VocabularyLibraryCard() {
  const { query, invalidate } = useVocabularyItems()
  const [search, setSearch] = useState("")
  const items = useMemo(() => query.data ?? [], [query.data])

  const filteredItems = useMemo(() => {
    const normalizedQuery = search.trim().toLowerCase()
    if (!normalizedQuery) {
      return items
    }

    return items.filter(item =>
      item.sourceText.toLowerCase().includes(normalizedQuery)
      || item.translatedText.toLowerCase().includes(normalizedQuery),
    )
  }, [items, search])

  const exportItems = () => {
    const blob = new Blob([JSON.stringify(filteredItems, null, 2)], { type: "application/json;charset=utf-8" })
    saveAs(blob, `${kebabCase(APP_NAME)}-vocabulary.json`)
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
                void clearVocabularyItems().then(invalidate)
              }}
              disabled={items.length === 0}
            >
              <IconTrash className="size-4" />
              {i18n.t("options.vocabulary.library.clear")}
            </Button>
          </div>
        </div>

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
                    <TableHead>{i18n.t("options.vocabulary.library.columns.source")}</TableHead>
                    <TableHead>{i18n.t("options.vocabulary.library.columns.translation")}</TableHead>
                    <TableHead>{i18n.t("options.vocabulary.library.columns.type")}</TableHead>
                    <TableHead>{i18n.t("options.vocabulary.library.columns.hitCount")}</TableHead>
                    <TableHead>{i18n.t("options.vocabulary.library.columns.lastSeenAt")}</TableHead>
                    <TableHead className="w-24">{i18n.t("options.vocabulary.library.columns.actions")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredItems.map((item) => {
                    const deleteLabel = `${i18n.t("options.floatingButtonAndToolbar.selectionToolbar.customActions.form.delete")}: ${item.sourceText}`

                    return (
                      <TableRow key={item.id}>
                        <TableCell className="max-w-56 whitespace-normal break-words">{item.sourceText}</TableCell>
                        <TableCell className="max-w-56 whitespace-normal break-words">{item.translatedText}</TableCell>
                        <TableCell>{item.kind}</TableCell>
                        <TableCell>{item.hitCount}</TableCell>
                        <TableCell>{formatDate(item.lastSeenAt)}</TableCell>
                        <TableCell>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            aria-label={deleteLabel}
                            title={deleteLabel}
                            onClick={() => {
                              void removeVocabularyItem(item.id).then(invalidate)
                            }}
                          >
                            <IconTrash className="size-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            )}
      </div>
    </ConfigCard>
  )
}
