import { SignIn } from "@clerk/clerk-react"
import { APP_ROUTES } from "../app/routes"

export function SignInPage() {
  return (
    <section className="clerk-shell">
      <div className="clerk-panel">
        <article className="media-panel">
          <span className="eyebrow">Lexio membership</span>
          <h1>Sign in once. Your extension becomes ready.</h1>
          <p>
            Lexio uses one hosted account for plans, synced vocabulary, and managed AI access.
            This page is the only place the user needs to sign in.
          </p>
          <ul>
            <li>No provider setup</li>
            <li>No API key input</li>
            <li>No separate sync setup</li>
          </ul>
        </article>
        <div className="auth-panel">
          <SignIn
            routing="path"
            path={APP_ROUTES.signIn}
            signUpUrl={APP_ROUTES.signIn}
            fallbackRedirectUrl={APP_ROUTES.extensionSync}
          />
        </div>
      </div>
    </section>
  )
}
