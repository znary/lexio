import type { VocabularyItem } from "@/types/vocabulary"
import { SelectionPopover } from "@/components/ui/selection-popover"
import { shadowWrapper } from ".."
import { SelectionTranslationVocabularyCard } from "../selection-toolbar/translate-button/selection-translation-vocabulary-card"

interface VocabularyDetailPopoverProps {
  anchor: { x: number, y: number } | null
  item: VocabularyItem | null
  onOpenChange?: (open: boolean) => void
}

export function VocabularyDetailPopover({
  anchor,
  item,
  onOpenChange,
}: VocabularyDetailPopoverProps) {
  const title = item?.sourceText ?? ""

  return (
    <SelectionPopover.Root
      open={Boolean(item)}
      onOpenChange={onOpenChange}
      anchor={anchor}
    >
      <SelectionPopover.Content
        className="selection-translation-popover"
        container={shadowWrapper ?? document.body}
        finalFocus={false}
        initialWidth={840}
        minWidth={760}
      >
        <SelectionPopover.Header className="selection-translation-popover__header border-b">
          <SelectionPopover.Title>{title}</SelectionPopover.Title>
          <div className="flex items-center gap-1">
            <SelectionPopover.Pin />
            <SelectionPopover.Close />
          </div>
        </SelectionPopover.Header>

        <SelectionPopover.Body className="selection-translation-popover__body">
          {item
            ? (
                <SelectionTranslationVocabularyCard
                  contextSentence={null}
                  detailedExplanation={null}
                  isTranslating={false}
                  selectionContent={null}
                  translatedText={undefined}
                  vocabularyItem={item}
                />
              )
            : null}
        </SelectionPopover.Body>
      </SelectionPopover.Content>
    </SelectionPopover.Root>
  )
}
