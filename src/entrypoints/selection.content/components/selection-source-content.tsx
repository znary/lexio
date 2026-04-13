import { ScrollArea } from "@/components/ui/base-ui/scroll-area"
import { Separator } from "@/components/ui/base-ui/separator"
import { cn } from "@/utils/styles/utils"
import { CopyButton } from "./copy-button"
import { SpeakButton } from "./speak-button"

interface SelectionSourceContentProps {
  text: string | null | undefined
  emptyPlaceholder?: string
  separatorClassName?: string
}

export function SelectionSourceContent({
  text,
  emptyPlaceholder,
  separatorClassName,
}: SelectionSourceContentProps) {
  const displayText = text || emptyPlaceholder || ""

  return (
    <>
      <div className="space-y-2">
        <div className="flex items-start justify-between gap-3">
          <ScrollArea className="min-w-0 flex-1">
            <p className="text-sm whitespace-pre-wrap break-words [overflow-wrap:anywhere] text-zinc-600 dark:text-zinc-400 line-clamp-3">
              {displayText}
            </p>
          </ScrollArea>
          <div className="flex items-center gap-1">
            <CopyButton text={text ?? undefined} />
            <SpeakButton text={text ?? undefined} />
          </div>
        </div>
      </div>
      <Separator className={cn("mt-3 opacity-60", separatorClassName)} />
    </>
  )
}
