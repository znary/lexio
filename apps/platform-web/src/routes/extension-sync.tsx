import { useAuth, useUser } from "@clerk/clerk-react"
import { useState } from "react"
import { toast } from "sonner"
import { getExtensionIdFromLocation } from "../app/env"
import {
  BookIcon,
  ExtensionDocumentIcon,
  LockIcon,
  ProfileCircleIcon,
  SyncCycleIcon,
} from "../app/icons"
import { syncPlatformAuthToExtension } from "../app/platform-auth"
import { APP_ROUTES } from "../app/routes"

type SyncStatus = "idle" | "syncing" | "success" | "error"

function getAuthorizeButtonLabel(status: SyncStatus, isSignedIn: boolean): string {
  if (!isSignedIn) {
    return "Sign In to Continue"
  }

  if (status === "syncing") {
    return "Authorizing..."
  }

  if (status === "success") {
    return "Authorized"
  }

  return "Authorize Access"
}

export function ExtensionSyncPage() {
  const { getToken, isSignedIn } = useAuth()
  const { user } = useUser()
  const hasSignedInSession = Boolean(isSignedIn)
  const extensionId = getExtensionIdFromLocation()
  const signInHref = extensionId
    ? `${APP_ROUTES.signIn}?extensionId=${encodeURIComponent(extensionId)}`
    : APP_ROUTES.signIn
  const [status, setStatus] = useState<SyncStatus>("idle")
  const [message, setMessage] = useState("")

  async function syncExtension() {
    if (!hasSignedInSession) {
      setStatus("idle")
      setMessage("")
      return
    }

    try {
      setStatus("syncing")
      setMessage("Sending your current Lexio session to the extension.")
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
      setMessage("Extension connected.")
      toast.success("Extension connected.")
    }
    catch (error) {
      setStatus("error")
      const nextMessage = error instanceof Error ? error.message : "Extension sync failed"
      setMessage(nextMessage)
      toast.error(nextMessage)
    }
  }

  function closePage() {
    window.close()
  }

  if (status === "success") {
    return (
      <section className="extension-auth-page">
        <div className="extension-auth-card extension-auth-card--success">
          <div className="extension-auth-topbar" />

          <div className="extension-auth-body extension-auth-body--success">
            <div className="extension-auth-success-icon" aria-hidden="true">
              <SyncCycleIcon className="extension-auth-success-icon__glyph" />
            </div>

            <div className="extension-auth-copy extension-auth-copy--success">
              <h1>Extension Connected</h1>
              <p>
                Lexio has sent your current sign-in session to the extension. You can return to
                the extension now.
              </p>
            </div>

            <div className="extension-auth-actions">
              <button
                type="button"
                className="primary-button primary-button--full"
                onClick={closePage}
              >
                Close This Page
              </button>
            </div>

            <p className="extension-auth-success-note">
              If this tab stays open, close it manually and continue in the extension popup.
            </p>
          </div>
        </div>
      </section>
    )
  }

  return (
    <section className="extension-auth-page">
      <div className="extension-auth-card">
        <div className="extension-auth-topbar" />

        <div className="extension-auth-body">
          <div className="extension-auth-logos" aria-hidden="true">
            <div className="extension-auth-icon">
              <ExtensionDocumentIcon className="extension-auth-icon__glyph" />
            </div>
            <div className="extension-auth-connector" />
            <div className="extension-auth-brand">FS</div>
          </div>

          <div className="extension-auth-copy">
            <h1>Authorize Extension</h1>
            <p>
              Allow the Lexio browser extension to use your current sign-in session and sync words
              into your Lexio account.
            </p>
          </div>

          <section className="permission-card">
            <h2>Requested Access</h2>

            <div className="permission-list">
              <div className="permission-item">
                <div className="permission-icon" aria-hidden="true">
                  <BookIcon className="permission-icon__glyph" />
                </div>
                <div>
                  <strong>Save words to your Word Bank</strong>
                  <p>The extension can add saved words and definitions to the same Lexio account you are using here.</p>
                </div>
              </div>

              <div className="permission-item">
                <div className="permission-icon" aria-hidden="true">
                  <ProfileCircleIcon className="permission-icon__glyph" />
                </div>
                <div>
                  <strong>Basic account profile</strong>
                  <p>The extension receives your display name, email address, and avatar for account identification.</p>
                </div>
              </div>

              <div className="permission-item">
                <div className="permission-icon permission-icon--success" aria-hidden="true">
                  <SyncCycleIcon className="permission-icon__glyph" />
                </div>
                <div>
                  <strong>Current sign-in session</strong>
                  <p>The extension receives a fresh Lexio session token so it can act on your behalf after you approve.</p>
                </div>
              </div>
            </div>
          </section>

          <div className="extension-auth-actions">
            {hasSignedInSession
              ? (
                  <button
                    type="button"
                    className="primary-button primary-button--full"
                    onClick={() => {
                      void syncExtension()
                    }}
                    disabled={status === "syncing"}
                  >
                    {getAuthorizeButtonLabel(status, hasSignedInSession)}
                  </button>
                )
              : (
                  <a className="primary-link primary-link--full" href={signInHref}>
                    {getAuthorizeButtonLabel(status, hasSignedInSession)}
                  </a>
                )}

            <a className="secondary-link secondary-link--centered" href={APP_ROUTES.home}>
              Cancel
            </a>
          </div>

          {status !== "idle"
            ? (
                <p className={`extension-auth-feedback is-${status}`}>
                  {message}
                </p>
              )
            : null}

          <p className="extension-auth-note">
            <LockIcon className="extension-auth-note__icon" />
            <span>Secure authorization via The Focused Scholar</span>
          </p>
        </div>
      </div>
    </section>
  )
}
