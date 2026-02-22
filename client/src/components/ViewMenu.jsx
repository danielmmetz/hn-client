import { useEffect, useRef } from 'preact/hooks';

const VIEWS = [
  { label: 'Frontpage', hash: '#/' },
  { label: 'Top - Today', hash: '#/top/day' },
  { label: 'Top - Yesterday', hash: '#/top/yesterday' },
  { label: 'Top - This Week', hash: '#/top/week' },
  { type: 'divider' },
  { label: 'Starred', hash: '#/starred' },
];

export function getViewLabel(route) {
  if (!route) return 'Frontpage';
  if (route.page === 'top') {
    switch (route.id) {
      case 'day': return 'Top - Today';
      case 'yesterday': return 'Top - Yesterday';
      case 'week': return 'Top - This Week';
      default: return 'Top';
    }
  }
  if (route.page === 'starred') return 'Starred';
  return 'Frontpage';
}

/** Returns the base route page for determining which view is active */
function isActive(viewHash, route) {
  if (viewHash === '#/') {
    return route.page === 'home';
  }
  if (viewHash === '#/starred') {
    return route.page === 'starred';
  }
  // #/top/day, #/top/yesterday, #/top/week
  const parts = viewHash.replace('#/', '').split('/');
  return route.page === parts[0] && route.id === parts[1];
}

export function ViewMenu({ route, onClose }) {
  const menuRef = useRef(null);

  useEffect(() => {
    function handleClick(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        onClose();
      }
    }
    function handleKey(e) {
      if (e.key === 'Escape') onClose();
    }
    // Delay adding click listener to avoid closing on the same click that opened the menu
    const timer = setTimeout(() => {
      document.addEventListener('click', handleClick, true);
    }, 0);
    document.addEventListener('keydown', handleKey);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('click', handleClick, true);
      document.removeEventListener('keydown', handleKey);
    };
  }, [onClose]);

  function handleItemClick(hash) {
    window.location.hash = hash;
    onClose();
  }

  return (
    <div class="view-menu" ref={menuRef}>
      {VIEWS.map((item, i) =>
        item.type === 'divider' ? (
          <div key={i} class="view-menu-divider" />
        ) : (
          <button
            key={item.hash}
            class={`view-menu-item${isActive(item.hash, route) ? ' view-menu-item-active' : ''}`}
            onClick={() => handleItemClick(item.hash)}
          >
            <span class="view-menu-item-check">
              {isActive(item.hash, route) ? '✓' : ''}
            </span>
            {item.label}
          </button>
        )
      )}
    </div>
  );
}
