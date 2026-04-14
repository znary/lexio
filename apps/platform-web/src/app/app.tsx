import { SignedIn, SignedOut, useAuth, UserButton, useUser } from "@clerk/clerk-react"
import { CheckoutSuccessPage } from "../routes/checkout-success"
import { ExtensionSyncPage } from "../routes/extension-sync"
import { PricingPage } from "../routes/pricing"
import { SignInPage } from "../routes/sign-in"

const NAV_LINKS = [
  { href: "/sign-in", label: "Sign in" },
  { href: "/pricing", label: "Pricing" },
  { href: "/extension-sync", label: "Sync extension" },
] as const

function resolvePage() {
  switch (window.location.pathname) {
    case "/pricing":
      return <PricingPage />
    case "/checkout-success":
      return <CheckoutSuccessPage />
    case "/extension-sync":
      return <ExtensionSyncPage />
    case "/sign-in":
    default:
      return <SignInPage />
  }
}

function Header() {
  const { isSignedIn } = useAuth()
  const { user } = useUser()

  return (
    <header className="site-header">
      <a className="brand-lockup" href="/sign-in">
        <span className="brand-badge">L</span>
        <span className="brand-copy">
          <strong>Lexio</strong>
          <span>Account & plans</span>
        </span>
      </a>
      <nav className="site-nav" aria-label="Primary">
        {NAV_LINKS.map(link => (
          <a key={link.href} href={link.href}>
            {link.label}
          </a>
        ))}
      </nav>
      <div className="header-account">
        <SignedOut>
          <a className="ghost-button" href="/sign-in">
            Sign in
          </a>
        </SignedOut>
        <SignedIn>
          <span className="account-label">{user?.firstName || user?.username || user?.primaryEmailAddress?.emailAddress}</span>
          <UserButton />
        </SignedIn>
        {!isSignedIn && <a className="primary-button" href="/pricing">See plans</a>}
      </div>
    </header>
  )
}

export default function App() {
  return (
    <div className="page-shell">
      <Header />
      <main className="page-content">
        {resolvePage()}
      </main>
    </div>
  )
}
