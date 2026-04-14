import type { PlatformAuthSession } from "@/utils/platform/storage"
import { useEffect, useState } from "react"
import { Badge } from "@/components/ui/base-ui/badge"
import { Button } from "@/components/ui/base-ui/button"
import { openPlatformExtensionSyncTab, openPlatformPricingTab } from "@/utils/platform/navigation"
import { getPlatformAuthSession, watchPlatformAuthSession } from "@/utils/platform/storage"

export function PlatformQuickAccess({
  size = "default",
}: {
  size?: "default" | "sm"
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

  return (
    <section className="rounded-xl border bg-muted/30 p-3">
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
        <Button type="button" size={buttonSize} onClick={() => void openPlatformExtensionSyncTab()}>
          {isConnected ? "Reconnect" : "Sign in"}
        </Button>
        <Button type="button" size={buttonSize} variant="outline" onClick={() => void openPlatformPricingTab()}>
          Plans
        </Button>
      </div>
    </section>
  )
}
