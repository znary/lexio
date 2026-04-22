import { BookmarkPlusIcon, KeyboardIcon } from "../app/icons"
import { APP_ROUTES } from "../app/routes"
import { useSitePreferences } from "../app/site-preferences"

export function HomePage() {
  const { copy } = useSitePreferences()

  return (
    <div className="home-page">
      <section className="hero-section">
        <h1 className="hero-title">
          {copy.home.heroTitleLine1}
          <br />
          {copy.home.heroTitleLine2}
        </h1>
        <p className="hero-copy">
          {copy.home.heroBodyLine1}
          <br />
          {copy.home.heroBodyLine2}
        </p>
        <div className="hero-actions">
          <a className="primary-link" href={APP_ROUTES.practice}>
            {copy.home.startPractice}
            {" "}
            <span aria-hidden="true">→</span>
          </a>
        </div>
      </section>

      <section className="feature-stage">
        <header className="feature-stage__header">
          <h2>{copy.home.featureTitle}</h2>
          <p>{copy.home.featureBody}</p>
        </header>

        <div className="feature-grid">
          <article className="feature-card feature-card--wide">
            <div>
              <div className="feature-icon feature-icon--cool" aria-hidden="true">
                <BookmarkPlusIcon />
              </div>
              <h3>{copy.home.wordBankTitle}</h3>
              <p>{copy.home.wordBankBody}</p>
            </div>

            <div className="quote-panel">
              <div className="quote-mark" aria-hidden="true">❞</div>
              <div>
                <strong>Esoteric</strong>
                <p>&quot;The author&apos;s esoteric references alienated the mainstream audience.&quot;</p>
              </div>
              <div className="saved-pill">{copy.home.savedBadge}</div>
            </div>
          </article>

          <article className="feature-card">
            <div>
              <div className="feature-icon feature-icon--warm" aria-hidden="true">
                <KeyboardIcon />
              </div>
              <h3>{copy.home.tactileTitle}</h3>
              <p>{copy.home.tactileBody}</p>
            </div>

            <div className="typing-panel">
              <p>
                {copy.home.define}
                {" "}
                <strong>Ephemeral</strong>
              </p>
              <div className="typing-line">
                <span className="typing-line__active">Lasting for a very sh</span>
                <span className="typing-line__rest">ort time.</span>
              </div>
            </div>
          </article>
        </div>
      </section>
    </div>
  )
}
