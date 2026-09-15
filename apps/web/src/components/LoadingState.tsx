type LoadingStateProps = {
  label?: string;
  compact?: boolean;
};

export function LoadingState({ label = 'Loading…', compact = false }: LoadingStateProps) {
  return (
    <div className={`loading-state${compact ? ' compact' : ''}`} role="status" aria-live="polite">
      <span className="loader-ring" aria-hidden>
        <span className="loader-ring-core" />
      </span>
      <div className="loading-copy">
        <span>{label}</span>
        <span className="loading-dots" aria-hidden>
          <i />
          <i />
          <i />
        </span>
      </div>
    </div>
  );
}

export function BusyOverlay({ label = 'Working…' }: { label?: string }) {
  return (
    <div className="busy-overlay" role="status" aria-live="assertive" aria-busy="true">
      <div className="busy-card">
        <span className="loader-ring lg" aria-hidden>
          <span className="loader-ring-core" />
        </span>
        <div className="loading-copy">
          <span>{label}</span>
          <span className="loading-dots" aria-hidden>
            <i />
            <i />
            <i />
          </span>
        </div>
      </div>
    </div>
  );
}

export function SavePulse({ label = 'Saved to database' }: { label?: string }) {
  return (
    <div className="save-pulse" role="status" aria-live="polite">
      <span className="save-pulse-dot" aria-hidden />
      <span>{label}</span>
    </div>
  );
}
