import { i18n } from "#imports"
import { IconBulb } from "@tabler/icons-react"
import { SelectionToolbarTooltip } from "../../components/selection-tooltip"
import { useSelectionExplainPopover } from "./provider"

export function ExplainButton() {
  const { openToolbarExplain } = useSelectionExplainPopover()
  const triggerLabel = i18n.t("action.explain")

  return (
    <SelectionToolbarTooltip
      content={triggerLabel}
      render={(
        <button
          type="button"
          aria-label={triggerLabel}
          className="px-2 h-7 shrink-0 flex items-center justify-center hover:bg-accent cursor-pointer"
          onClick={(event) => {
            event.currentTarget.blur()
            openToolbarExplain(event.currentTarget)
          }}
        />
      )}
    >
      <IconBulb className="size-4.5" />
    </SelectionToolbarTooltip>
  )
}
