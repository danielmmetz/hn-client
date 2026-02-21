import { useState, useEffect, useCallback } from 'preact/hooks';

/**
 * Parse the current hash into a route object.
 * Examples:
 *   #/story/123     → { page: 'story', id: '123' }
 *   #/article/456   → { page: 'article', id: '456' }
 *   #/starred       → { page: 'starred' }
 *   (empty or #/)   → { page: 'home' }
 */
function parseHash(hash) {
  const raw = hash.replace(/^#\/?/, '');
  if (!raw) return { page: 'home', params: {} };

  // Split path from query params (e.g. "story/123?comment=456")
  const [path, queryString] = raw.split('?');
  const parts = path.split('/');
  const page = parts[0] || 'home';
  const id = parts[1] || null;

  const params = {};
  if (queryString) {
    for (const pair of queryString.split('&')) {
      const [key, value] = pair.split('=');
      if (key) params[decodeURIComponent(key)] = decodeURIComponent(value || '');
    }
  }

  return { page, id, params };
}

/** React hook that tracks the current hash route. */
export function useHashRoute() {
  const [route, setRoute] = useState(() => parseHash(window.location.hash));

  useEffect(() => {
    function onHashChange() {
      setRoute(parseHash(window.location.hash));
    }
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  return route;
}

/**
 * Navigate programmatically.
 * navigate('#/story/123') or navigate('#/')
 */
export function navigate(hash) {
  window.location.hash = hash;
}
