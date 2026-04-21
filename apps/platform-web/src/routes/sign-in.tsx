import { SignIn } from "@clerk/clerk-react"
import { getExtensionIdFromLocation } from "../app/env"
import { APP_ROUTES } from "../app/routes"

export function SignInPage() {
  const extensionId = getExtensionIdFromLocation()
  const fallbackRedirectUrl = extensionId
    ? `${APP_ROUTES.extensionSync}?extensionId=${encodeURIComponent(extensionId)}`
    : APP_ROUTES.wordBank

  return (
    <section className="signin-page">
      <div className="signin-shell">
        <article className="signin-copy">
          <span className="section-kicker">Lexio Account</span>
          <h1>Sign in once. Return to your library, practice, and extension flow.</h1>
          <p>
            Your hosted Lexio account keeps vocabulary, reading progress, and AI access in one
            place. No provider setup. No API keys. No extra steps.
          </p>
          <ul className="signin-list">
            <li>Unified account for web and extension</li>
            <li>Synced word bank across sessions</li>
            <li>Managed access without manual setup</li>
          </ul>
        </article>

        <div className="signin-panel">
          <SignIn
            routing="path"
            path={APP_ROUTES.signIn}
            signUpUrl={APP_ROUTES.signIn}
            fallbackRedirectUrl={fallbackRedirectUrl}
          />
        </div>
      </div>
    </section>
  )
}
