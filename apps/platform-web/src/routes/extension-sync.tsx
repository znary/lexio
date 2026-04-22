import { useAuth, useUser } from "@clerk/clerk-react"
import { useEffect, useState } from "react"
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
import { useSitePreferences } from "../app/site-preferences"

type SyncStatus = "idle" | "syncing" | "success" | "error"

function getAuthorizeButtonLabel(
  status: SyncStatus,
  isSignedIn: boolean,
  copy: {
    authorizeButtonSignedOut: string
    authorizeButtonIdle: string
    authorizeButtonSyncing: string
    authorizeButtonSuccess: string
  },
): string {
  if (!isSignedIn) {
    return copy.authorizeButtonSignedOut
  }

  if (status === "syncing") {
    return copy.authorizeButtonSyncing
  }

  if (status === "success") {
    return copy.authorizeButtonSuccess
  }

  return copy.authorizeButtonIdle
}

export function ExtensionSyncPage() {
  const { getToken, isLoaded, isSignedIn } = useAuth()
  const { user } = useUser()
  const { copy } = useSitePreferences()
  const commonCopy = copy.common
  const extensionSyncCopy = copy.extensionSync
  const hasSignedInSession = Boolean(isSignedIn)
  const extensionId = getExtensionIdFromLocation()
  const signInHref = extensionId
    ? `${APP_ROUTES.signIn}?extensionId=${encodeURIComponent(extensionId)}`
    : APP_ROUTES.signIn
  const [status, setStatus] = useState<SyncStatus>("idle")
  const [message, setMessage] = useState("")

  useEffect(() => {
    if (!isLoaded || hasSignedInSession) {
      return
    }

    window.location.replace(signInHref)
  }, [hasSignedInSession, isLoaded, signInHref])

  async function syncExtension() {
    if (!hasSignedInSession) {
      setStatus("idle")
      setMessage("")
      return
    }

    try {
      setStatus("syncing")
      setMessage(extensionSyncCopy.sendingSession)
      const token = await getToken()
      if (!token) {
        throw new Error(extensionSyncCopy.tokenMissing)
      }

      await syncPlatformAuthToExtension(token, {
        id: user?.id,
        email: user?.primaryEmailAddress?.emailAddress ?? null,
        name: user?.fullName ?? user?.username ?? user?.primaryEmailAddress?.emailAddress ?? "Lexio user",
        imageUrl: user?.imageUrl ?? null,
      })

      setStatus("success")
      setMessage(extensionSyncCopy.connected)
      toast.success(extensionSyncCopy.connectedToast)
    }
    catch (error) {
      setStatus("error")
      const nextMessage = error instanceof Error ? error.message : extensionSyncCopy.syncFailed
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
              <h1>{extensionSyncCopy.successTitle}</h1>
              <p>{extensionSyncCopy.successDescription}</p>
            </div>

            <div className="extension-auth-actions">
              <button
                type="button"
                className="primary-button primary-button--full"
                onClick={closePage}
              >
                {commonCopy.actions.closeThisPage}
              </button>
            </div>

            <p className="extension-auth-success-note">
              {extensionSyncCopy.successNote}
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
            <div className="extension-auth-brand">LX</div>
          </div>

          <div className="extension-auth-copy">
            <h1>{extensionSyncCopy.authorizeTitle}</h1>
            <p>{extensionSyncCopy.authorizeDescription}</p>
          </div>

          <section className="permission-card">
            <h2>{extensionSyncCopy.requestedAccess}</h2>

            <div className="permission-list">
              <div className="permission-item">
                <div className="permission-icon" aria-hidden="true">
                  <BookIcon className="permission-icon__glyph" />
                </div>
                <div>
                  <strong>{extensionSyncCopy.permissions.wordBankTitle}</strong>
                </div>
              </div>

              <div className="permission-item">
                <div className="permission-icon" aria-hidden="true">
                  <ProfileCircleIcon className="permission-icon__glyph" />
                </div>
                <div>
                  <strong>{extensionSyncCopy.permissions.profileTitle}</strong>
                </div>
              </div>

              <div className="permission-item">
                <div className="permission-icon permission-icon--success" aria-hidden="true">
                  <SyncCycleIcon className="permission-icon__glyph" />
                </div>
                <div>
                  <strong>{extensionSyncCopy.permissions.sessionTitle}</strong>
                </div>
              </div>
            </div>
          </section>

          <div className="extension-auth-actions">
            <button
              type="button"
              className="primary-button primary-button--full"
              onClick={() => {
                void syncExtension()
              }}
              disabled={status === "syncing" || !hasSignedInSession}
            >
              {getAuthorizeButtonLabel(status, hasSignedInSession, extensionSyncCopy)}
            </button>

            <a className="secondary-link secondary-link--centered" href={APP_ROUTES.home}>
              {commonCopy.actions.cancel}
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
            <span>{extensionSyncCopy.secureNote}</span>
          </p>
        </div>
      </div>
    </section>
  )
}
