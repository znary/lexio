import { SignedIn, SignedOut, SignInButton, useAuth } from "@clerk/clerk-react"
import { initializePaddle } from "@paddle/paddle-js"
import { useState } from "react"
import { PADDLE_CLIENT_TOKEN, PADDLE_ENV, PADDLE_PRO_PRICE_ID } from "../app/env"
import { APP_ROUTES } from "../app/routes"
import { useSitePreferences } from "../app/site-preferences"

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

export function PricingPage() {
  const { userId } = useAuth()
  const { copy } = useSitePreferences()
  const pricingCopy = copy.pricing
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  const handleSubscribe = async () => {
    if (!PADDLE_PRO_PRICE_ID) {
      setErrorMessage(pricingCopy.missingPriceId)
      return
    }

    try {
      setErrorMessage(null)
      setIsLoading(true)
      await openCheckout(PADDLE_PRO_PRICE_ID, userId ?? null)
    }
    catch (error) {
      setErrorMessage(error instanceof Error ? error.message : pricingCopy.checkoutFailed)
    }
    finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="pricing-page">
      <section className="pricing-hero">
        <div>
          <span className="section-kicker">{pricingCopy.badge}</span>
          <h1>{pricingCopy.title}</h1>
          <p>{pricingCopy.description}</p>
        </div>

        {errorMessage && <div className="feedback-callout feedback-callout--error">{errorMessage}</div>}
      </section>

      <div className="pricing-grid">
        <article className="pricing-card">
          <span className="pricing-badge">{pricingCopy.starterBadge}</span>
          <h2>{pricingCopy.freeLabel}</h2>
          <div className="pricing-price">
            <strong>$0</strong>
            <span>{pricingCopy.perMonth}</span>
          </div>
          <p>{pricingCopy.starterBody}</p>
          <ul className="pricing-features">
            {pricingCopy.starterFeatures.map(feature => (
              <li key={feature}>{feature}</li>
            ))}
          </ul>
          <a className="ghost-button" href={APP_ROUTES.signIn}>{pricingCopy.signIn}</a>
        </article>

        <article className="pricing-card pricing-card--featured">
          <span className="pricing-badge pricing-badge--featured">{pricingCopy.proBadge}</span>
          <h2>{pricingCopy.proLabel}</h2>
          <div className="pricing-price">
            <strong>$12</strong>
            <span>{pricingCopy.perMonth}</span>
          </div>
          <p>{pricingCopy.proBody}</p>
          <ul className="pricing-features">
            {pricingCopy.proFeatures.map(feature => (
              <li key={feature}>{feature}</li>
            ))}
          </ul>

          <SignedIn>
            <button type="button" className="primary-button" onClick={handleSubscribe} disabled={isLoading}>
              {isLoading ? pricingCopy.openingCheckout : pricingCopy.startPro}
            </button>
          </SignedIn>

          <SignedOut>
            <SignInButton mode="modal">
              <button type="button" className="primary-button">
                {pricingCopy.signInToContinue}
              </button>
            </SignInButton>
          </SignedOut>
        </article>
      </div>
    </div>
  )
}
