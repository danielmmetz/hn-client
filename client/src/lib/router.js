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
  const s = hash.replace(/^#\/?/, '');
  if (!s) return { page: 'home' };

  const parts = s.split('/');
  const page = parts[0] || 'home';
  const id = parts[1] || null;
  return { page, id };
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
