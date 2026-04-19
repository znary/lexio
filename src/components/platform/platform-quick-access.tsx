import type { PlatformAuthSession } from "@/utils/platform/storage"
import { browser, i18n } from "#imports"
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
  includeSettingsEntry = false,
}: {
  variant?: "card" | "menu"
  size?: "default" | "sm"
  className?: string
  includeSettingsEntry?: boolean
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
  const accountLabel = session?.user?.email ?? i18n.t("platform.quickAccess.accountHint")
  const buttonSize = size === "sm" ? "sm" : "default"

  const handleSignIn = () => {
    void openPlatformExtensionSyncTab()
  }

  const handleOpenPlans = () => {
    void openPlatformPricingTab()
  }

  const handleOpenFullSettings = () => {
    void browser.runtime.openOptionsPage()
  }

  const handleSignOut = async () => {
    await clearPlatformAuthSession()
    toast.success(i18n.t("platform.quickAccess.toast.loggedOut"))
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
              aria-label={i18n.t("platform.quickAccess.menuLabel")}
              className={className}
            />
          )}
        >
          <Icon icon={isConnected ? "tabler:user-circle" : "tabler:user-plus"} className="size-4" strokeWidth={1.8} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" side="bottom" className="w-52">
          <div className="px-2 py-1">
            <div className="text-sm font-semibold">{i18n.t("platform.quickAccess.title")}</div>
            <div className="text-xs text-muted-foreground">
              {isLoading
                ? i18n.t("platform.quickAccess.status.loading")
                : isConnected
                  ? accountLabel
                  : i18n.t("platform.quickAccess.status.signedOut")}
            </div>
          </div>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={handleSignIn} className="cursor-pointer">
            <Icon icon="tabler:login-2" className="size-4" strokeWidth={1.6} />
            {isConnected ? i18n.t("platform.quickAccess.actions.reconnect") : i18n.t("platform.quickAccess.actions.signIn")}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleOpenPlans} className="cursor-pointer">
            <Icon icon="tabler:ticket" className="size-4" strokeWidth={1.6} />
            {i18n.t("platform.quickAccess.actions.plans")}
          </DropdownMenuItem>
          {includeSettingsEntry && (
            <DropdownMenuItem onClick={handleOpenFullSettings} className="cursor-pointer">
              <Icon icon="tabler:settings" className="size-4" strokeWidth={1.6} />
              {i18n.t("platform.quickAccess.actions.openSettings")}
            </DropdownMenuItem>
          )}
          {isConnected && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleSignOut} className="cursor-pointer" variant="destructive">
                <Icon icon="tabler:logout" className="size-4" strokeWidth={1.6} />
                {i18n.t("platform.quickAccess.actions.logOut")}
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
          <div className="text-sm font-semibold">{i18n.t("platform.quickAccess.title")}</div>
          <div className="text-xs text-muted-foreground">
            {accountLabel}
          </div>
        </div>
        <Badge variant={isConnected ? "secondary" : "outline"}>
          {isLoading
            ? i18n.t("platform.quickAccess.status.loading")
            : isConnected
              ? i18n.t("platform.quickAccess.status.signedIn")
              : i18n.t("platform.quickAccess.status.signedOut")}
        </Badge>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <Button type="button" size={buttonSize} onClick={handleSignIn}>
          {isConnected ? i18n.t("platform.quickAccess.actions.reconnect") : i18n.t("platform.quickAccess.actions.signIn")}
        </Button>
        <Button type="button" size={buttonSize} variant="outline" onClick={handleOpenPlans}>
          {i18n.t("platform.quickAccess.actions.plans")}
        </Button>
        {isConnected && (
          <Button type="button" size={buttonSize} variant="outline" onClick={() => void handleSignOut()}>
            {i18n.t("platform.quickAccess.actions.logOut")}
          </Button>
        )}
      </div>
    </section>
  )
}
