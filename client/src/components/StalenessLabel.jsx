import { useState, useEffect } from 'preact/hooks';
import { staleness } from '../lib/time';

export function StalenessLabel({ fetchedAt, refreshReady }) {
  const [, setTick] = useState(0);

  // Re-render every 30 seconds to keep staleness text fresh
  useEffect(() => {
    if (!fetchedAt) return;
    const interval = setInterval(() => setTick((t) => t + 1), 30000);
    return () => clearInterval(interval);
  }, [fetchedAt]);

  if (!fetchedAt) return null;

  if (refreshReady) {
    return (
      <span class="staleness-label staleness-label-ready">
        <span class="staleness-dot" aria-hidden="true" />
        Refresh ready
      </span>
    );
  }

  return <span class="staleness-label">{staleness(fetchedAt)}</span>;
}
