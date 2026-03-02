import { getPendingStarChanges, clearPendingStarChanges, replaceAllStars } from './db';

let syncing = false;

export async function syncStars() {
  if (syncing) return;
  syncing = true;
  try {
    const pending = await getPendingStarChanges();
    const resp = await fetch('/api/stars/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ changes: pending }),
    });
    if (!resp.ok) return;
    const data = await resp.json();
    await clearPendingStarChanges();
    await replaceAllStars(data.stars || []);
  } catch {
    // Retry on next trigger
  } finally {
    syncing = false;
  }
}
