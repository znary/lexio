import { SignedIn, SignedOut, SignInButton, useAuth, useUser } from "@clerk/clerk-react"
import { useEffect, useMemo, useState } from "react"
import { getExtensionIdFromLocation } from "../app/env"

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
  const className = status === "success"
    ? "status-pill is-success"
    : status === "error"
      ? "status-pill is-error"
      : status === "syncing"
        ? "status-pill is-warning"
        : "status-pill"

  const label = status === "success"
    ? "Extension synced"
    : status === "error"
      ? "Sync failed"
      : status === "syncing"
        ? "Syncing..."
        : "Waiting for sign-in"

  return <div className={className}>{label}</div>
}

export function ExtensionSyncPage() {
  const { getToken, isSignedIn } = useAuth()
  const { user } = useUser()
  const [status, setStatus] = useState<SyncStatus>("idle")
  const [message, setMessage] = useState("Sign in and keep the extension installed in this browser.")
  const extensionId = useMemo(() => getExtensionIdFromLocation(), [])

  useEffect(() => {
    async function syncExtension() {
      if (!isSignedIn || !extensionId) {
        return
      }

      if (!window.chrome?.runtime?.sendMessage) {
        setStatus("error")
        setMessage("This page must run in a browser that can message the extension.")
        return
      }

      try {
        setStatus("syncing")
        const token = await getToken()
        if (!token) {
          throw new Error("Clerk did not return a session token. Sign in again and retry.")
        }

        const payload = {
          type: "lexio-platform-auth-sync",
          token,
          user: {
            id: user?.id,
            email: user?.primaryEmailAddress?.emailAddress ?? null,
            name: user?.fullName ?? user?.username ?? user?.primaryEmailAddress?.emailAddress ?? "Lexio user",
            imageUrl: user?.imageUrl ?? null,
          },
        }

        await new Promise<void>((resolve, reject) => {
          window.chrome?.runtime?.sendMessage?.(extensionId, payload, (response) => {
            const runtimeError = window.chrome?.runtime?.lastError
            if (runtimeError) {
              reject(new Error(runtimeError.message || "The extension rejected the platform token."))
              return
            }

            const result = response as { ok?: boolean, error?: string } | undefined
            if (!result?.ok) {
              reject(new Error(result?.error || "The extension did not accept the sync payload."))
              return
            }

            resolve()
          })
        })

        setStatus("success")
        setMessage("Token sent to the extension. You can go back and use Lexio now.")
      }
      catch (error) {
        setStatus("error")
        setMessage(error instanceof Error ? error.message : "Extension sync failed")
      }
    }

    void syncExtension()
  }, [extensionId, getToken, isSignedIn, user])

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
        {!extensionId && (
          <div className="empty-panel">
            Open this page from the extension so the `extensionId` query parameter is filled automatically.
          </div>
        )}
      </article>
      <aside className="sync-card">
        <SignedOut>
          <div className="card-stack">
            <h2 className="plan-title">Sign in first</h2>
            <p className="card-copy">The extension can only accept a signed Clerk token.</p>
            <SignInButton mode="modal">
              <button type="button" className="primary-button">Sign in</button>
            </SignInButton>
          </div>
        </SignedOut>
        <SignedIn>
          <div className="card-stack">
            <h2 className="plan-title">Current browser session</h2>
            <div className="feature-list">
              <div className="feature-row">
                <strong>User</strong>
                <span className="muted-copy">{user?.primaryEmailAddress?.emailAddress ?? "Signed in"}</span>
              </div>
              <div className="feature-row">
                <strong>Extension ID</strong>
                <span className="muted-copy">{extensionId || "Missing"}</span>
              </div>
            </div>
          </div>
        </SignedIn>
      </aside>
    </section>
  )
}
