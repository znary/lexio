import { SignedIn, SignedOut, UserButton } from "@clerk/clerk-react"
import { CheckoutSuccessPage } from "../routes/checkout-success"
import { ExtensionSyncPage } from "../routes/extension-sync"
import { PricingPage } from "../routes/pricing"
import { SignInPage } from "../routes/sign-in"
import { PlatformAuthBridge } from "./platform-auth-bridge"
import { APP_ROUTES, normalizePathname } from "./routes"

const NAV_LINKS = [
  { href: APP_ROUTES.signIn, label: "Sign in" },
  { href: APP_ROUTES.pricing, label: "Pricing" },
  { href: APP_ROUTES.extensionSync, label: "Sync extension" },
] as const

function resolvePage() {
  switch (normalizePathname(window.location.pathname)) {
    case APP_ROUTES.pricing:
      return <PricingPage />
    case APP_ROUTES.checkoutSuccess:
      return <CheckoutSuccessPage />
    case APP_ROUTES.extensionSync:
      return <ExtensionSyncPage />
    case APP_ROUTES.signIn:
    default:
      return <SignInPage />
  }
}

function Header() {
  return (
    <header className="site-header">
      <a className="brand-lockup" href={APP_ROUTES.signIn}>
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
          <a className="ghost-button" href={APP_ROUTES.signIn}>
            Sign in
          </a>
        </SignedOut>
        <SignedIn>
          <UserButton />
        </SignedIn>
      </div>
    </header>
  )
}

export default function App() {
  return (
    <div className="page-shell">
      <PlatformAuthBridge />
      <Header />
      <main className="page-content">
        {resolvePage()}
      </main>
    </div>
  )
}
