import type { ReactNode } from "react"
import { SignedIn, SignedOut, UserButton } from "@clerk/clerk-react"
import { CheckoutSuccessPage } from "../routes/checkout-success"
import { ExtensionSyncPage } from "../routes/extension-sync"
import { HomePage } from "../routes/home"
import { PracticePage } from "../routes/practice"
import { PricingPage } from "../routes/pricing"
import { SignInPage } from "../routes/sign-in"
import { WordBankPage } from "../routes/word-bank"
import { AccountOutlineIcon } from "./icons"
import { PlatformAuthBridge } from "./platform-auth-bridge"
import { APP_ROUTES, normalizePathname } from "./routes"

const SITE_NAV_LINKS = [
  { href: APP_ROUTES.wordBank, label: "Word Bank" },
  { href: APP_ROUTES.practice, label: "Practice" },
] as const

interface ResolvedPage {
  content: ReactNode
  layout: "site" | "standalone"
  headerVariant: "hero" | "library"
}

function resolvePage(pathname: string): ResolvedPage {
  switch (normalizePathname(pathname)) {
    case APP_ROUTES.wordBank:
      return { layout: "site", headerVariant: "library", content: <WordBankPage /> }
    case APP_ROUTES.practice:
      return { layout: "site", headerVariant: "library", content: <PracticePage /> }
    case APP_ROUTES.pricing:
      return { layout: "site", headerVariant: "library", content: <PricingPage /> }
    case APP_ROUTES.signIn:
      return { layout: "standalone", headerVariant: "hero", content: <SignInPage /> }
    case APP_ROUTES.checkoutSuccess:
      return { layout: "standalone", headerVariant: "hero", content: <CheckoutSuccessPage /> }
    case APP_ROUTES.extensionSync:
      return { layout: "standalone", headerVariant: "hero", content: <ExtensionSyncPage /> }
    case APP_ROUTES.home:
    default:
      return { layout: "site", headerVariant: "hero", content: <HomePage /> }
  }
}

function SiteHeader({ pathname, variant }: { pathname: string, variant: "hero" | "library" }) {
  const signedOutActions = variant === "library"
    ? (
        <>
          <a className="account-icon" href={APP_ROUTES.signIn} aria-label="Open sign in">
            <AccountOutlineIcon className="account-glyph" />
          </a>
          <a className="primary-link primary-link--compact" href={APP_ROUTES.signIn}>Sign In</a>
        </>
      )
    : (
        <>
          <a className="account-link" href={APP_ROUTES.signIn}>Sign In</a>
          <a className="account-icon" href={APP_ROUTES.signIn} aria-label="Open sign in">
            <AccountOutlineIcon className="account-glyph" />
          </a>
        </>
      )

  return (
    <header className="site-header">
      <div className="site-header__inner">
        <a className="brand-link" href={APP_ROUTES.home}>
          <span className="brand-wordmark">Lexio</span>
        </a>

        <nav className="site-nav" aria-label="Primary">
          {SITE_NAV_LINKS.map(link => (
            <a
              key={link.href}
              href={link.href}
              className={pathname === link.href ? "is-active" : undefined}
            >
              {link.label}
            </a>
          ))}
        </nav>

        <div className="site-actions">
          <SignedOut>{signedOutActions}</SignedOut>
          <SignedIn>
            <div className="account-user">
              <UserButton />
            </div>
          </SignedIn>
        </div>
      </div>
    </header>
  )
}

function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="site-footer__inner">
        <p>© 2024 LEXIO. THE INTELLECTUAL SANCTUARY FOR FOCUSED LEARNING.</p>
        <div className="site-footer__links">
          <a href={APP_ROUTES.home}>Privacy</a>
          <a href={APP_ROUTES.home}>Terms</a>
          <a href={APP_ROUTES.home}>Methodology</a>
          <a href={APP_ROUTES.home}>Support</a>
        </div>
      </div>
    </footer>
  )
}

export default function App() {
  const pathname = normalizePathname(window.location.pathname)
  const page = resolvePage(pathname)
  const isPracticePage = pathname === APP_ROUTES.practice

  if (page.layout === "standalone") {
    return (
      <div className="app-shell app-shell--standalone">
        <PlatformAuthBridge />
        <main className="standalone-main">{page.content}</main>
      </div>
    )
  }

  return (
    <div className="app-shell">
      <PlatformAuthBridge />
      <SiteHeader pathname={pathname} variant={page.headerVariant} />
      <main className={isPracticePage ? "site-main site-main--practice" : "site-main"}>
        {page.content}
      </main>
      {isPracticePage ? null : <SiteFooter />}
    </div>
  )
}
