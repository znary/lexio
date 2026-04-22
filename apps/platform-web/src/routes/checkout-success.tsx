import { APP_ROUTES } from "../app/routes"
import { useSitePreferences } from "../app/site-preferences"

export function CheckoutSuccessPage() {
  const { copy } = useSitePreferences()
  const checkoutSuccessCopy = copy.checkoutSuccess

  return (
    <section className="success-page">
      <article className="success-card">
        <span className="section-kicker">{checkoutSuccessCopy.badge}</span>
        <h1>{checkoutSuccessCopy.title}</h1>
        <p>{checkoutSuccessCopy.description}</p>

        <div className="success-actions">
          <a className="primary-link" href={APP_ROUTES.extensionSync}>{checkoutSuccessCopy.authorizeExtension}</a>
          <a className="ghost-button" href={APP_ROUTES.wordBank}>{checkoutSuccessCopy.goToWordBank}</a>
        </div>
      </article>
    </section>
  )
}
