import type { ReactNode } from "react"
import { SignInButton, useAuth, useUser } from "@clerk/clerk-react"
import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { syncPlatformAuthToExtension } from "../app/platform-auth"

declare global {
  interface Window {
    chrome?: {
      runtime?: {
        lastError?: {
          message?: string
        }
        sendMessage?: (
          extensionId: string,
          message: unknown,
          callback?: (response?: unknown) => void,
        ) => void
      }
    }
  }
}

type SyncStatus = "idle" | "syncing" | "success" | "error"

function StatusPill({ status }: { status: SyncStatus }) {
  let className = "status-pill"
  let label = "Waiting for sign-in"

  if (status === "success") {
    className = "status-pill is-success"
    label = "Extension synced"
  }
  else if (status === "error") {
    className = "status-pill is-error"
    label = "Sync failed"
  }
  else if (status === "syncing") {
    className = "status-pill is-warning"
    label = "Syncing..."
  }

  return <div className={className}>{label}</div>
}

export function ExtensionSyncPage() {
  const { getToken, isSignedIn } = useAuth()
  const { user } = useUser()
  const [status, setStatus] = useState<SyncStatus>("idle")
  const [message, setMessage] = useState("Sign in to send the token back to the extension.")
  const syncKey = isSignedIn
    ? [
        user?.id ?? "",
        user?.primaryEmailAddress?.emailAddress ?? "",
        user?.fullName ?? "",
        user?.username ?? "",
        user?.imageUrl ?? "",
      ].join("|")
    : "signed-out"
  const lastSyncKeyRef = useRef("")
  let sessionPanel: ReactNode

  useEffect(() => {
    async function syncExtension() {
      if (!isSignedIn) {
        lastSyncKeyRef.current = ""
        setStatus("idle")
        setMessage("Sign in to send the token back to the extension.")
        return
      }

      if (lastSyncKeyRef.current === syncKey) {
        return
      }

      lastSyncKeyRef.current = syncKey

      try {
        setStatus("syncing")
        const token = await getToken()
        if (!token) {
          throw new Error("Clerk did not return a session token.")
        }

        await syncPlatformAuthToExtension(token, {
          id: user?.id,
          email: user?.primaryEmailAddress?.emailAddress ?? null,
          name: user?.fullName ?? user?.username ?? user?.primaryEmailAddress?.emailAddress ?? "Lexio user",
          imageUrl: user?.imageUrl ?? null,
        })

        setStatus("success")
        setMessage("Lexio account connected. You can go back to the extension now.")
        toast.success("Lexio account connected.")
      }
      catch (error) {
        setStatus("error")
        const nextMessage = error instanceof Error ? error.message : "Extension sync failed"
        setMessage(nextMessage)
        toast.error(nextMessage)
      }
    }

    void syncExtension()
  }, [
    getToken,
    isSignedIn,
    syncKey,
    user?.fullName,
    user?.id,
    user?.imageUrl,
    user?.primaryEmailAddress?.emailAddress,
    user?.username,
  ])

  if (!isSignedIn) {
    sessionPanel = (
      <div className="card-stack">
        <h2 className="plan-title">Sign in first</h2>
        <p className="card-copy">The extension can only accept a signed Clerk token.</p>
        <SignInButton mode="modal">
          <button type="button" className="primary-button">Sign in</button>
        </SignInButton>
      </div>
    )
  }
  else {
    sessionPanel = (
      <div className="card-stack">
        <h2 className="plan-title">Current browser session</h2>
        <div className="feature-list">
          <div className="feature-row">
            <strong>User</strong>
            <span className="muted-copy">{user?.primaryEmailAddress?.emailAddress ?? "Signed in"}</span>
          </div>
        </div>
      </div>
    )
  }

  return (
    <section className="sync-grid">
      <article className="sync-card">
        <span className="eyebrow">Extension handoff</span>
        <h1 className="section-title">Send your Lexio account token back to the extension.</h1>
        <p className="section-copy">
          This page is the bridge between the signed-in website and the browser extension. Once the
          sync succeeds, the extension can call the hosted Lexio platform without asking for provider settings.
        </p>
        <StatusPill status={status} />
        <p className="sync-code">{message}</p>
      </article>
      <aside className="sync-card">{sessionPanel}</aside>
    </section>
  )
}
