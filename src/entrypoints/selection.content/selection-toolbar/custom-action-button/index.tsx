import { useAtomValue } from "jotai"
import { configFieldsAtomMap } from "@/utils/atoms/config"
import { isSelectionToolbarInternalAction } from "@/utils/constants/custom-action"
import { SelectionToolbarCustomActionTrigger } from "./custom-action-trigger"

export function SelectionToolbarCustomActionButtons() {
  const selectionToolbarConfig = useAtomValue(configFieldsAtomMap.selectionToolbar)
  const customActions = selectionToolbarConfig.customActions?.filter(action =>
    action.enabled !== false && !isSelectionToolbarInternalAction(action),
  ) ?? []

  return customActions.map(action => (
    <SelectionToolbarCustomActionTrigger key={action.id} action={action} />
  ))
}
