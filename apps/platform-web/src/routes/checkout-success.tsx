import { APP_ROUTES } from "../app/routes"

export function CheckoutSuccessPage() {
  return (
    <section className="sync-grid">
      <article className="success-card">
        <span className="eyebrow">Checkout complete</span>
        <h1 className="section-title">Your plan was updated.</h1>
        <p className="section-copy">
          Paddle returned to Lexio successfully. The next step is to reopen the extension sync page
          so the extension can refresh the latest plan state.
        </p>
        <div className="button-row">
          <a className="primary-button" href={APP_ROUTES.extensionSync}>Sync extension now</a>
          <a className="ghost-button" href={APP_ROUTES.pricing}>Back to pricing</a>
        </div>
      </article>
      <aside className="sync-card">
        <div className="status-pill is-success">Ready for refresh</div>
        <div className="feature-list">
          <div className="feature-row">
            <strong>Step 1</strong>
            <span className="muted-copy">Keep the same browser profile where the extension is installed.</span>
          </div>
          <div className="feature-row">
            <strong>Step 2</strong>
            <span className="muted-copy">Open the extension sync page so the website can hand the token back.</span>
          </div>
        </div>
      </aside>
    </section>
  )
}
