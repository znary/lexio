import type { PlatformMeResponse } from "@/utils/platform/api"
import type { PlatformAuthSession } from "@/utils/platform/storage"
import { browser } from "#imports"
import { useEffect, useState } from "react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/base-ui/badge"
import { Button } from "@/components/ui/base-ui/button"
import { getPlatformMe } from "@/utils/platform/api"
import { openPlatformExtensionSyncTab, openPlatformPricingTab } from "@/utils/platform/navigation"
import { getPlatformAuthSession, watchPlatformAuthSession } from "@/utils/platform/storage"
import { syncPlatformNow } from "@/utils/platform/sync"
import { ConfigCard } from "../../../components/config-card"

function formatDateTime(value: string | null | undefined): string {
  if (!value) {
    return "Never"
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return "Never"
  }

  return date.toLocaleString()
}

function formatPlan(plan: PlatformMeResponse["subscription"]["plan"] | undefined): string {
  return plan === "pro" ? "Pro" : "Free"
}

function describeSync(account: PlatformMeResponse | null): string {
  if (!account) {
    return "Waiting for account connection"
  }

  return `Last push: ${formatDateTime(account.sync.lastPushAt)}. Last pull: ${formatDateTime(account.sync.lastPullAt)}.`
}

function StatusBadge({
  isConnected,
  isLoading,
}: {
  isConnected: boolean
  isLoading: boolean
}) {
  if (isLoading) {
    return <Badge variant="secondary">Loading</Badge>
  }

  return (
    <Badge variant={isConnected ? "secondary" : "outline"}>
      {isConnected ? "Signed in" : "Not signed in"}
    </Badge>
  )
}

export function PlatformAccountCard() {
  const [session, setSession] = useState<PlatformAuthSession | null>(null)
  const [account, setAccount] = useState<PlatformMeResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isSyncing, setIsSyncing] = useState(false)

  useEffect(() => {
    let isDisposed = false

    async function loadAccount(nextSession?: PlatformAuthSession | null) {
      const resolvedSession = nextSession ?? await getPlatformAuthSession()

      if (isDisposed) {
        return
      }

      setSession(resolvedSession)

      if (!resolvedSession) {
        setAccount(null)
        setError(null)
        setIsLoading(false)
        return
      }

      setIsLoading(true)
      try {
        const nextAccount = await getPlatformMe()
        if (isDisposed) {
          return
        }

        setAccount(nextAccount)
        setError(null)
      }
      catch (loadError) {
        if (isDisposed) {
          return
        }

        setAccount(null)
        setError(loadError instanceof Error ? loadError.message : "Failed to load account")
      }
      finally {
        if (!isDisposed) {
          setIsLoading(false)
        }
      }
    }

    void loadAccount()

    const unwatch = watchPlatformAuthSession((nextSession) => {
      void loadAccount(nextSession)
    })

    return () => {
      isDisposed = true
      unwatch()
    }
  }, [])

  const handleSyncNow = async () => {
    if (!session) {
      toast.error("Sign in first, then sync again.")
      return
    }

    try {
      setIsSyncing(true)
      const result = await syncPlatformNow()
      const nextAccount = await getPlatformMe()
      setAccount(nextAccount)
      setError(null)

      const message = result.action === "downloaded"
        ? "Cloud data was pulled into this extension."
        : result.action === "merged"
          ? "Local and cloud data were merged."
          : "Local data was pushed to the cloud."

      toast.success(message)
    }
    catch (syncError) {
      const message = syncError instanceof Error ? syncError.message : "Cloud sync failed"
      setError(message)
      toast.error(message)
    }
    finally {
      setIsSyncing(false)
    }
  }

  const accountLabel = session?.user?.email
    ?? account?.user.email
    ?? "Not connected"

  return (
    <ConfigCard
      id="platform-account"
      title="Account & Plan"
      description="Sign in once, use Lexio Cloud everywhere, and sync your settings and vocabulary without local provider setup."
    >
      <div className="space-y-4 rounded-xl border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <div className="text-sm font-medium">{accountLabel}</div>
            <div className="text-xs text-muted-foreground">
              {describeSync(account)}
            </div>
          </div>
          <StatusBadge isConnected={Boolean(session)} isLoading={isLoading} />
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded-lg border bg-muted/30 p-3">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Plan</div>
            <div className="mt-1 text-base font-semibold">{formatPlan(account?.subscription.plan)}</div>
          </div>
          <div className="rounded-lg border bg-muted/30 p-3">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Sync status</div>
            <div className="mt-1 text-base font-semibold">
              {account?.sync.lastStatus || "idle"}
            </div>
          </div>
          <div className="rounded-lg border bg-muted/30 p-3">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Updated</div>
            <div className="mt-1 text-base font-semibold">
              {formatDateTime(account?.sync.updatedAt)}
            </div>
          </div>
        </div>

        {error && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={() => void openPlatformExtensionSyncTab(browser.runtime.id)}>
            {session ? "Reconnect account" : "Sign in"}
          </Button>
          <Button type="button" variant="outline" onClick={() => void openPlatformPricingTab()} disabled={!session}>
            Manage subscription
          </Button>
          <Button type="button" variant="outline" onClick={() => void handleSyncNow()} disabled={!session || isSyncing}>
            {isSyncing ? "Syncing..." : "Sync now"}
          </Button>
        </div>
      </div>
    </ConfigCard>
  )
}
