export type FoundationStatusTone = "positive" | "informational" | "negative";

export interface FoundationStatusCardProps {
  label: string;
  status: string;
  tone?: FoundationStatusTone;
}

export function FoundationStatusCard({
  label,
  status,
  tone = "positive",
}: FoundationStatusCardProps) {
  return (
    <article className="foundation-status-card" data-status-tone={tone}>
      <span className="foundation-status-card__indicator" aria-hidden="true" />
      <div>
        <h3 className="foundation-status-card__label">{label}</h3>
        <p className="foundation-status-card__value">
          <span className="visually-hidden">Status: </span>
          {status}
        </p>
      </div>
    </article>
  );
}
