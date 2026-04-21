import { APP_ROUTES } from "../app/routes"

export function CheckoutSuccessPage() {
  return (
    <section className="success-page">
      <article className="success-card">
        <span className="section-kicker">Checkout Complete</span>
        <h1>Your plan was updated.</h1>
        <p>
          Lexio received the checkout result. If you installed the browser extension, open the
          authorization page once so the extension can refresh its access state.
        </p>

        <div className="success-actions">
          <a className="primary-link" href={APP_ROUTES.extensionSync}>Authorize Extension</a>
          <a className="ghost-button" href={APP_ROUTES.wordBank}>Go to Word Bank</a>
        </div>
      </article>
    </section>
  )
}
