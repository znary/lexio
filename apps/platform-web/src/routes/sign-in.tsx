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
      <div className="signin-panel signin-panel--centered">
        <SignIn
          routing="path"
          path={APP_ROUTES.signIn}
          signUpUrl={APP_ROUTES.signIn}
          fallbackRedirectUrl={fallbackRedirectUrl}
        />
      </div>
    </section>
  )
}
