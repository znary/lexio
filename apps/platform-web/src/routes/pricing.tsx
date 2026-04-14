import { SignedIn, SignedOut, SignInButton, useAuth } from "@clerk/clerk-react"
import { initializePaddle } from "@paddle/paddle-js"
import { useState } from "react"
import { PADDLE_CLIENT_TOKEN, PADDLE_ENV } from "../app/env"
import { APP_ROUTES } from "../app/routes"

async function openCheckout(priceId: string, clerkUserId: string | null) {
  const paddle = await initializePaddle({
    environment: PADDLE_ENV,
    token: PADDLE_CLIENT_TOKEN,
  })

  if (!paddle) {
    throw new Error("Paddle.js failed to initialize")
  }

  paddle.Checkout.open({
    items: [{ priceId, quantity: 1 }],
    settings: {
      displayMode: "overlay",
      successUrl: `${window.location.origin}${APP_ROUTES.checkoutSuccess}`,
    },
    customData: clerkUserId ? { clerkUserId } : {},
  })
}

function PlanCard(
  {
    featured,
    title,
    kicker,
    price,
    note,
    features,
    action,
  }: {
    featured?: boolean
    title: string
    kicker: string
    price: string
    note: string
    features: string[]
    action: React.ReactNode
  },
) {
  return (
    <article className={`pricing-card${featured ? " is-featured" : ""}`}>
      <span className="plan-kicker">{kicker}</span>
      <h2 className="plan-title">{title}</h2>
      <p className="card-copy">{note}</p>
      <div className="plan-price">
        <span>{price}</span>
        <small>/ month</small>
      </div>
      <div className="card-stack">
        {features.map(feature => (
          <div key={feature} className="plan-feature">
            <strong>{feature}</strong>
          </div>
        ))}
      </div>
      <div className="button-row">{action}</div>
    </article>
  )
}

export function PricingPage() {
  const { userId } = useAuth()
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const proPriceId = import.meta.env.VITE_PADDLE_PRO_PRICE_ID || ""

  const handleSubscribe = async () => {
    if (!proPriceId) {
      setErrorMessage("Missing VITE_PADDLE_PRO_PRICE_ID")
      return
    }

    try {
      setErrorMessage(null)
      setIsLoading(true)
      await openCheckout(proPriceId, userId ?? null)
    }
    catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Checkout failed")
    }
    finally {
      setIsLoading(false)
    }
  }

  return (
    <>
      <section className="hero-grid">
        <article className="hero-card">
          <span className="eyebrow">Hosted plans</span>
          <h1 className="hero-title">One plan controls AI, sync, and account access.</h1>
          <p className="hero-copy">
            Lexio pricing is intentionally simple: a free tier for lighter reading workflows,
            and one Pro plan for higher limits and stronger model routing.
          </p>
          {errorMessage && (
            <div className="status-pill is-error">{errorMessage}</div>
          )}
          <div className="hero-actions">
            <SignedIn>
              <button type="button" className="primary-button" onClick={handleSubscribe} disabled={isLoading}>
                {isLoading ? "Opening checkout..." : "Upgrade to Pro"}
              </button>
            </SignedIn>
            <SignedOut>
              <SignInButton mode="modal">
                <button type="button" className="primary-button">
                  Sign in to continue
                </button>
              </SignInButton>
            </SignedOut>
            <a className="ghost-button" href={APP_ROUTES.extensionSync}>Sync extension</a>
          </div>
        </article>
        <aside className="hero-aside">
          <div className="status-pill is-success">Paddle.js checkout is wired for this page</div>
          <div className="stat-list">
            <div className="stat-row">
              <strong>Free</strong>
              <span className="muted-copy">Light monthly allowance and synced vocabulary.</span>
            </div>
            <div className="stat-row">
              <strong>Pro</strong>
              <span className="muted-copy">Higher request budget and stronger model routing.</span>
            </div>
          </div>
        </aside>
      </section>

      <section>
        <header className="section-header">
          <h2 className="section-title">Plans</h2>
          <p className="section-copy">Users never touch provider settings. Their plan controls what the platform unlocks.</p>
        </header>
        <div className="pricing-grid">
          <PlanCard
            title="Free"
            kicker="Starter"
            price="$0"
            note="A clean on-ramp for synced reading and lighter AI usage."
            features={[
              "Hosted sign-in and extension sync",
              "Managed AI access with a monthly cap",
              "Vocabulary sync across devices",
            ]}
            action={<a className="ghost-button" href={APP_ROUTES.signIn}>Sign in</a>}
          />
          <PlanCard
            featured
            title="Pro"
            kicker="Best value"
            price="$12"
            note="Built for daily reading, heavier translation, and higher request volume."
            features={[
              "Higher monthly request allowance",
              "Stronger model routing",
              "Priority concurrency limits",
            ]}
            action={(
              <button type="button" className="primary-button" onClick={handleSubscribe} disabled={isLoading}>
                {isLoading ? "Opening..." : "Start Pro"}
              </button>
            )}
          />
        </div>
      </section>
    </>
  )
}
