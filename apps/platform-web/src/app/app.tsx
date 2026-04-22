import type { ReactNode } from "react"
import type { SiteLocale, ThemeMode } from "./site-preferences"
import { SignedIn, SignedOut, UserButton } from "@clerk/clerk-react"
import { CheckoutSuccessPage } from "../routes/checkout-success"
import { ExtensionSyncPage } from "../routes/extension-sync"
import { HomePage } from "../routes/home"
import { PracticePage } from "../routes/practice"
import { PricingPage } from "../routes/pricing"
import { SignInPage } from "../routes/sign-in"
import { WordBankPage } from "../routes/word-bank"
import { AccountOutlineIcon, GlobeIcon, MoonIcon } from "./icons"
import { PlatformAuthBridge } from "./platform-auth-bridge"
import { APP_ROUTES, normalizePathname } from "./routes"
import { useSitePreferences } from "./site-preferences"

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
  const {
    copy,
    locale,
    localeOptions,
    setLocale,
    setThemeMode,
    themeMode,
    themeModeOptions,
  } = useSitePreferences()
  const siteNavLinks = [
    { href: APP_ROUTES.wordBank, label: copy.common.navigation.wordBank },
    { href: APP_ROUTES.practice, label: copy.common.navigation.practice },
  ] as const
  const signedOutActions = variant === "library"
    ? (
        <>
          <a className="account-icon" href={APP_ROUTES.signIn} aria-label={copy.common.actions.signIn}>
            <AccountOutlineIcon className="account-glyph" />
          </a>
          <a className="primary-link primary-link--compact" href={APP_ROUTES.signIn}>
            {copy.common.actions.signIn}
          </a>
        </>
      )
    : (
        <>
          <a className="account-link" href={APP_ROUTES.signIn}>{copy.common.actions.signIn}</a>
          <a className="account-icon" href={APP_ROUTES.signIn} aria-label={copy.common.actions.signIn}>
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

        <nav className="site-nav" aria-label={copy.common.navigation.practice}>
          {siteNavLinks.map(link => (
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
          <SitePreferenceControls
            locale={locale}
            onLocaleChange={setLocale}
            themeMode={themeMode}
            onThemeModeChange={setThemeMode}
            localeOptions={localeOptions}
            themeModeOptions={themeModeOptions}
          />
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

function SitePreferenceControls({
  locale,
  localeOptions,
  onLocaleChange,
  onThemeModeChange,
  themeMode,
  themeModeOptions,
}: {
  locale: SiteLocale
  localeOptions: ReadonlyArray<{ value: SiteLocale, label: string }>
  onLocaleChange: (locale: SiteLocale) => void
  onThemeModeChange: (mode: ThemeMode) => void
  themeMode: ThemeMode
  themeModeOptions: Array<{ value: ThemeMode, label: string }>
}) {
  const { copy } = useSitePreferences()

  return (
    <div className="site-preferences">
      <label className="site-preference-chip">
        <GlobeIcon className="site-preference-chip__icon" />
        <select
          aria-label={copy.common.labels.languageMenu}
          value={locale}
          onChange={event => onLocaleChange(event.target.value as SiteLocale)}
        >
          {localeOptions.map(option => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      <label className="site-preference-chip">
        <MoonIcon className="site-preference-chip__icon" />
        <select
          aria-label={copy.common.labels.themeMenu}
          value={themeMode}
          onChange={event => onThemeModeChange(event.target.value as ThemeMode)}
        >
          {themeModeOptions.map(option => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  )
}

function SiteFooter() {
  const { copy } = useSitePreferences()

  return (
    <footer className="site-footer">
      <div className="site-footer__inner">
        <p>{copy.common.footer.note}</p>
        <div className="site-footer__links">
          <a href={APP_ROUTES.home}>{copy.common.footer.privacy}</a>
          <a href={APP_ROUTES.home}>{copy.common.footer.terms}</a>
          <a href={APP_ROUTES.home}>{copy.common.footer.methodology}</a>
          <a href={APP_ROUTES.home}>{copy.common.footer.support}</a>
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
