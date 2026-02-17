import { useState, useEffect } from 'preact/hooks';
import { staleness } from '../lib/time';

export function StalenessLabel({ fetchedAt }) {
  const [, setTick] = useState(0);

  // Re-render every 30 seconds to keep staleness text fresh
  useEffect(() => {
    if (!fetchedAt) return;
    const interval = setInterval(() => setTick((t) => t + 1), 30000);
    return () => clearInterval(interval);
  }, [fetchedAt]);

  if (!fetchedAt) return null;
  return <span class="staleness-label">{staleness(fetchedAt)}</span>;
}
