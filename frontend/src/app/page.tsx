import { FoundationStatus } from "@/components/foundation-status";

export default function Home() {
  return (
    <main className="foundation-shell">
      <section className="foundation-panel" aria-labelledby="foundation-title">
        <header className="foundation-header">
          <p className="foundation-eyebrow">Bright Steps</p>
          <h1 id="foundation-title" className="foundation-title">
            Centre Success
          </h1>
          <p className="foundation-summary">
            Foundation environment status.
          </p>
        </header>

        <section
          className="foundation-status"
          aria-labelledby="foundation-status-title"
        >
          <h2 id="foundation-status-title" className="visually-hidden">
            Foundation status
          </h2>
          <FoundationStatus />
        </section>
      </section>
    </main>
  );
}
