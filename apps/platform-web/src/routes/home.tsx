import { BookmarkPlusIcon, KeyboardIcon } from "../app/icons"
import { APP_ROUTES } from "../app/routes"

export function HomePage() {
  return (
    <div className="home-page">
      <section className="hero-section">
        <h1 className="hero-title">
          Master the Art of
          <br />
          Language with Precision
        </h1>
        <p className="hero-copy">
          Elevate your vocabulary through contextual immersion.
          <br />
          A focused sanctuary designed for scholars, writers, and curious minds.
        </p>
        <div className="hero-actions">
          <a className="primary-link" href={APP_ROUTES.practice}>
            Start Practice
            {" "}
            <span aria-hidden="true">→</span>
          </a>
        </div>
      </section>

      <section className="feature-stage">
        <header className="feature-stage__header">
          <h2>A System for True Mastery</h2>
          <p>
            Move beyond flashcards. Cultivate deep understanding through curated tools designed
            for focus and retention.
          </p>
        </header>

        <div className="feature-grid">
          <article className="feature-card feature-card--wide">
            <div>
              <div className="feature-icon feature-icon--cool" aria-hidden="true">
                <BookmarkPlusIcon />
              </div>
              <h3>Word Bank</h3>
              <p>
                Capture elusive words from your daily reading. Seamlessly integrate with our
                browser extension to save vocabulary directly from any article or paper.
              </p>
            </div>

            <div className="quote-panel">
              <div className="quote-mark" aria-hidden="true">❞</div>
              <div>
                <strong>Esoteric</strong>
                <p>&quot;The author&apos;s esoteric references alienated the mainstream audience.&quot;</p>
              </div>
              <div className="saved-pill">✓ Saved to Bank</div>
            </div>
          </article>

          <article className="feature-card">
            <div>
              <div className="feature-icon feature-icon--warm" aria-hidden="true">
                <KeyboardIcon />
              </div>
              <h3>Tactile Practice</h3>
              <p>
                Engage muscle memory. Type definitions and contextual sentences in a
                distraction-free, fluid interface.
              </p>
            </div>

            <div className="typing-panel">
              <p>
                Define:
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
