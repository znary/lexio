import type { PlatformAuthSession } from "@/utils/platform/storage"
import { Icon } from "@iconify/react"
import { useEffect, useState } from "react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/base-ui/badge"
import { Button } from "@/components/ui/base-ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/base-ui/dropdown-menu"
import { openPlatformExtensionSyncTab, openPlatformPricingTab } from "@/utils/platform/navigation"
import { clearPlatformAuthSession, getPlatformAuthSession, watchPlatformAuthSession } from "@/utils/platform/storage"
import { cn } from "@/utils/styles/utils"

export function PlatformQuickAccess({
  variant = "card",
  size = "default",
  className,
}: {
  variant?: "card" | "menu"
  size?: "default" | "sm"
  className?: string
}) {
  const [session, setSession] = useState<PlatformAuthSession | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    let isDisposed = false

    async function loadSession() {
      const session = await getPlatformAuthSession()
      if (isDisposed) {
        return
      }

      setSession(session)
      setIsLoading(false)
    }

    void loadSession()

    const unwatch = watchPlatformAuthSession((session) => {
      if (isDisposed) {
        return
      }

      setSession(session)
      setIsLoading(false)
    })

    return () => {
      isDisposed = true
      unwatch?.()
    }
  }, [])

  const isConnected = Boolean(session)
  const accountLabel = session?.user?.email ?? "Sign in once to sync settings, vocabulary, and your managed plan."
  const buttonSize = size === "sm" ? "sm" : "default"

  const handleSignIn = () => {
    void openPlatformExtensionSyncTab()
  }

  const handleOpenPlans = () => {
    void openPlatformPricingTab()
  }

  const handleSignOut = async () => {
    await clearPlatformAuthSession()
    toast.success("Logged out.")
  }

  if (variant === "menu") {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger
          render={(
            <Button
              type="button"
              variant="ghost"
              size={size === "sm" ? "icon-sm" : "icon"}
              aria-label="Open account menu"
              className={className}
            />
          )}
        >
          <Icon icon={isConnected ? "tabler:user-circle" : "tabler:user-plus"} className="size-4" strokeWidth={1.8} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" side="bottom" className="w-52">
          <div className="px-2 py-1">
            <div className="text-sm font-semibold">Lexio Cloud</div>
            <div className="text-xs text-muted-foreground">
              {isLoading ? "Loading" : isConnected ? accountLabel : "Not signed in"}
            </div>
          </div>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={handleSignIn} className="cursor-pointer">
            <Icon icon="tabler:login-2" className="size-4" strokeWidth={1.6} />
            {isConnected ? "Reconnect" : "Sign in"}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleOpenPlans} className="cursor-pointer">
            <Icon icon="tabler:ticket" className="size-4" strokeWidth={1.6} />
            Plans
          </DropdownMenuItem>
          {isConnected && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleSignOut} className="cursor-pointer" variant="destructive">
                <Icon icon="tabler:logout" className="size-4" strokeWidth={1.6} />
                Log out
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    )
  }

  return (
    <section className={cn("rounded-xl border bg-muted/30 p-3", className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="text-sm font-semibold">Lexio Cloud</div>
          <div className="text-xs text-muted-foreground">
            {accountLabel}
          </div>
        </div>
        <Badge variant={isConnected ? "secondary" : "outline"}>
          {isLoading ? "Loading" : isConnected ? "Signed in" : "Not signed in"}
        </Badge>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <Button type="button" size={buttonSize} onClick={handleSignIn}>
          {isConnected ? "Reconnect" : "Sign in"}
        </Button>
        <Button type="button" size={buttonSize} variant="outline" onClick={handleOpenPlans}>
          Plans
        </Button>
        {isConnected && (
          <Button type="button" size={buttonSize} variant="outline" onClick={() => void handleSignOut()}>
            Log out
          </Button>
        )}
      </div>
    </section>
  )
}
