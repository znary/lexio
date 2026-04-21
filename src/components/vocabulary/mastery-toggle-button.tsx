import type * as React from "react"
import { IconCircleCheck, IconCircleCheckFilled } from "@tabler/icons-react"
import { Button } from "@/components/ui/base-ui/button"
import { Spinner } from "@/components/ui/base-ui/spinner"
import { cn } from "@/utils/styles/utils"

export function VocabularyMasteryToggleButton({
  className,
  disabled,
  label,
  mastered,
  onClick,
  pending = false,
}: {
  className?: string
  disabled?: boolean
  label: string
  mastered: boolean
  onClick: () => void
  pending?: boolean
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      className={cn(
        "shrink-0 transition-colors",
        mastered
          ? "bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/15 hover:text-emerald-700"
          : "text-muted-foreground hover:bg-emerald-500/8 hover:text-emerald-600",
        className,
      )}
      aria-label={label}
      aria-pressed={mastered}
      data-mastery-state={mastered ? "mastered" : "learning"}
      onClick={onClick}
      disabled={disabled || pending}
    >
      {pending
        ? <Spinner className="size-4" />
        : mastered
          ? <IconCircleCheckFilled className="size-4" data-slot="vocabulary-mastery-icon" />
          : <IconCircleCheck className="size-4" data-slot="vocabulary-mastery-icon" />}
    </Button>
  )
}
