export function timeAgo(unixSeconds) {
  const now = Date.now() / 1000;
  const diff = Math.max(0, now - unixSeconds);

  if (diff < 60) return 'just now';
  if (diff < 3600) {
    const m = Math.floor(diff / 60);
    return `${m}m ago`;
  }
  if (diff < 86400) {
    const h = Math.floor(diff / 3600);
    return `${h}h ago`;
  }
  const d = Math.floor(diff / 86400);
  if (d === 1) return '1 day ago';
  if (d < 30) return `${d} days ago`;
  const mo = Math.floor(d / 30);
  if (mo === 1) return '1 month ago';
  return `${mo} months ago`;
}

export function staleness(unixSeconds) {
  if (!unixSeconds) return 'never';
  return `Updated ${timeAgo(unixSeconds)}`;
}
