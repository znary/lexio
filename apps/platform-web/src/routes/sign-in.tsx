import { SignIn } from "@clerk/clerk-react"

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
            path="/sign-in"
            signUpUrl="/sign-in"
            fallbackRedirectUrl="/extension-sync"
          />
        </div>
      </div>
    </section>
  )
}
