import { SignedIn, SignedOut, SignInButton, useAuth } from "@clerk/clerk-react"
import { initializePaddle } from "@paddle/paddle-js"
import { useState } from "react"
import { PADDLE_CLIENT_TOKEN, PADDLE_ENV, PADDLE_PRO_PRICE_ID } from "../app/env"
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

export function PricingPage() {
  const { userId } = useAuth()
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  const handleSubscribe = async () => {
    if (!PADDLE_PRO_PRICE_ID) {
      setErrorMessage("Missing Paddle price id")
      return
    }

    try {
      setErrorMessage(null)
      setIsLoading(true)
      await openCheckout(PADDLE_PRO_PRICE_ID, userId ?? null)
    }
    catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Checkout failed")
    }
    finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="pricing-page">
      <section className="pricing-hero">
        <div>
          <span className="section-kicker">Hosted Plans</span>
          <h1>One plan keeps Lexio clear, focused, and ready across surfaces.</h1>
          <p>
            Choose a simple hosted plan for synced vocabulary, web practice, and managed AI access
            without provider setup.
          </p>
        </div>

        {errorMessage && <div className="feedback-callout feedback-callout--error">{errorMessage}</div>}
      </section>

      <div className="pricing-grid">
        <article className="pricing-card">
          <span className="pricing-badge">Starter</span>
          <h2>Free</h2>
          <div className="pricing-price">
            <strong>$0</strong>
            <span>/ month</span>
          </div>
          <p>A clean on-ramp for reading, capture, and light practice.</p>
          <ul className="pricing-features">
            <li>Hosted sign-in</li>
            <li>Word Bank access</li>
            <li>Light monthly usage</li>
          </ul>
          <a className="ghost-button" href={APP_ROUTES.signIn}>Sign In</a>
        </article>

        <article className="pricing-card pricing-card--featured">
          <span className="pricing-badge pricing-badge--featured">Best Value</span>
          <h2>Pro</h2>
          <div className="pricing-price">
            <strong>$12</strong>
            <span>/ month</span>
          </div>
          <p>Built for daily reading, heavier practice, and stronger model routing.</p>
          <ul className="pricing-features">
            <li>Higher request allowance</li>
            <li>Stronger model routing</li>
            <li>Priority sync and concurrency</li>
          </ul>

          <SignedIn>
            <button type="button" className="primary-button" onClick={handleSubscribe} disabled={isLoading}>
              {isLoading ? "Opening checkout..." : "Start Pro"}
            </button>
          </SignedIn>

          <SignedOut>
            <SignInButton mode="modal">
              <button type="button" className="primary-button">
                Sign in to continue
              </button>
            </SignInButton>
          </SignedOut>
        </article>
      </div>
    </div>
  )
}
