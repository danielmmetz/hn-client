import { useEffect, useState, useRef, useCallback } from 'preact/hooks';
import { useHashRoute } from './lib/router';
import { useKeyboardShortcuts, ensureVisible } from './lib/keyboard';
import { StoryList } from './pages/StoryList';
import { StoryDetail } from './pages/StoryDetail';
import { ArticleReader } from './pages/ArticleReader';
import { Starred } from './pages/Starred';
import { ErrorBoundary } from './components/ErrorBoundary';
import { KeyboardShortcutsHelp } from './components/KeyboardShortcutsHelp';
import { connect, disconnect } from './lib/sse';
import { fetchUser, login, logout } from './lib/auth';


const WIDE_BREAKPOINT = 1100;

function useWideLayout() {
  const [wide, setWide] = useState(() => window.innerWidth >= WIDE_BREAKPOINT);
  useEffect(() => {
    const mq = window.matchMedia(`(min-width: ${WIDE_BREAKPOINT}px)`);
    const handler = (e) => setWide(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
  return wide;
}

/** Two-pane split layout used on wide screens. */
function SplitLayout({ route, storiesRef }) {
  const selectedId = (route.page === 'story' || route.page === 'article') ? Number(route.id) : null;
  const [readerMode, setReaderMode] = useState(false);

  // Enable reader mode when navigating to article route, reset otherwise
  useEffect(() => {
    setReaderMode(route.page === 'article');
  }, [selectedId, route.page]);

  // r/c view switching
  useKeyboardShortcuts({
    r: () => {
      if (selectedId) setReaderMode(true);
    },
    c: () => {
      if (selectedId) setReaderMode(false);
    },
  });

  // J/K story navigation
  useKeyboardShortcuts({
    J: (e) => {
      e.preventDefault();
      const stories = storiesRef.current;
      if (!stories || stories.length === 0) return;
      const idx = stories.findIndex((s) => s.id === selectedId);
      const nextIdx = idx < 0 ? 0 : Math.min(idx + 1, stories.length - 1);
      const targetId = stories[nextIdx].id;
      window.location.hash = `#/story/${targetId}`;
      const el = document.querySelector(`.split-sidebar [data-story-id="${targetId}"]`);
      if (el) ensureVisible(el);
    },
    K: (e) => {
      e.preventDefault();
      const stories = storiesRef.current;
      if (!stories || stories.length === 0) return;
      const idx = stories.findIndex((s) => s.id === selectedId);
      const targetIdx = idx <= 0 ? 0 : idx - 1;
      const targetId = stories[targetIdx].id;
      window.location.hash = `#/story/${targetId}`;
      const el = document.querySelector(`.split-sidebar [data-story-id="${targetId}"]`);
      if (el) ensureVisible(el);
    },
  });

  // Handle clicks on sidebar links that target the already-selected story.
  // When hash doesn't change, the route won't update, so we must reset readerMode manually.
  const handleSidebarClick = useCallback((e) => {
    if (!readerMode || !selectedId) return;
    const link = e.target.closest('a[href]');
    if (!link) return;
    const href = link.getAttribute('href');
    if (href === `#/story/${selectedId}`) {
      setReaderMode(false);
    }
  }, [readerMode, selectedId]);

  return (
    <div class="split-layout">
      <aside class="split-sidebar" onClick={handleSidebarClick}>
        <StoryList selectedId={selectedId} storiesRef={storiesRef} />
      </aside>
      <div class="split-detail">
        {selectedId ? (
          readerMode ? (
            <ArticleReader
              key={`article-${selectedId}`}
              id={selectedId}
              onShowComments={() => setReaderMode(false)}
            />
          ) : (
            <StoryDetail
              key={selectedId}
              id={selectedId}
              onReaderView={() => setReaderMode(true)}
            />
          )
        ) : (
          <div class="split-detail-empty">
            <div class="split-detail-empty-inner">
              <span class="split-detail-empty-icon">Y</span>
              <p>Select a story to read comments</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** Narrow (mobile) layout — one page at a time, driven by hash route. */
function NarrowLayout({ route, storiesRef }) {
  const activeId = (route.page === 'story' || route.page === 'article') ? Number(route.id) : null;

  // J/K story navigation in narrow mode
  useKeyboardShortcuts({
    J: (e) => {
      if (route.page !== 'home' && route.page !== 'story' && route.page !== 'article') return;
      e.preventDefault();
      const stories = storiesRef.current;
      if (!stories || stories.length === 0) return;
      if (route.page === 'home') {
        window.location.hash = `#/story/${stories[0].id}`;
      } else {
        const idx = stories.findIndex((s) => s.id === activeId);
        if (idx >= 0 && idx < stories.length - 1) {
          window.location.hash = `#/story/${stories[idx + 1].id}`;
        }
      }
    },
    K: (e) => {
      if (route.page !== 'story' && route.page !== 'article') return;
      e.preventDefault();
      const stories = storiesRef.current;
      if (!stories || stories.length === 0) return;
      const idx = stories.findIndex((s) => s.id === activeId);
      if (idx > 0) {
        window.location.hash = `#/story/${stories[idx - 1].id}`;
      }
    },
    r: () => {
      if (route.page === 'story') {
        window.location.hash = `#/article/${route.id}`;
      }
    },
    c: () => {
      if (route.page === 'article') {
        window.location.hash = `#/story/${route.id}`;
      }
    },
    h: () => {
      if (route.page === 'story' || route.page === 'article') {
        window.location.hash = '#/';
      }
    },
  });

  switch (route.page) {
    case 'story':
      return <StoryDetail key={route.id} id={route.id} storiesRef={storiesRef} />;
    case 'article':
      return <ArticleReader key={route.id} id={route.id} storiesRef={storiesRef} />;
    case 'starred':
      return <Starred />;
    default:
      return <StoryList storiesRef={storiesRef} />;
  }
}

export function App() {
  const [user, setUser] = useState(undefined); // undefined = loading
  const [showHelp, setShowHelp] = useState(false);
  const wide = useWideLayout();
  const route = useHashRoute();
  const storiesRef = useRef([]);

  // ? to toggle help modal
  useKeyboardShortcuts({
    '?': (e) => {
      e.preventDefault();
      setShowHelp((v) => !v);
    },
    Escape: () => {
      if (showHelp) setShowHelp(false);
    },
  });

  // Redirect legacy path-based URLs to hash equivalents
  useEffect(() => {
    const path = window.location.pathname;
    if (path !== '/' && path !== '/index.html') {
      const hash = '#' + path;
      window.history.replaceState(null, '', '/' + hash);
    }
  }, []);

  // Check auth on mount
  useEffect(() => {
    fetchUser().then(setUser);
  }, []);

  // Initialize SSE only when authenticated
  useEffect(() => {
    if (!user) return;

    connect().catch(() => {});

    function handleVisibility() {
      if (document.visibilityState === 'visible') {
        connect().catch(() => {});
      }
    }
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      disconnect();
    };
  }, [user]);

  // Loading state
  if (user === undefined) {
    return (
      <div class="app">
        <div class="login-gate">
          <div class="login-loading">Loading…</div>
        </div>
      </div>
    );
  }

  // Not authenticated — show login screen
  if (user === null) {
    return (
      <div class="app">
        <div class="login-gate">
          <div class="login-card">
            <span class="login-logo">Y</span>
            <h1 class="login-title">HN Reader</h1>
            <p class="login-subtitle">Sign in to continue</p>
            <button class="login-button" onClick={login}>
              Sign in with Pocket ID
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Authenticated
  return (
    <div class={`app${wide ? ' app-wide' : ''}`}>
      <header class="app-header">
        {!wide && (route.page === 'story' || route.page === 'article') ? (
          <a href="#/" class="back-btn" aria-label="Back to stories">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </a>
        ) : (
          <a href="#/" class="app-logo">
            <span class="logo-icon">Y</span>
            <span class="logo-text">HN Reader</span>
          </a>
        )}
        <nav class="app-nav">
          <a href="#/">Top</a>
          <a href="#/starred">Starred</a>
          <button class="signout-btn" onClick={logout} title="Sign out">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
          </button>
        </nav>
      </header>
      <main class="app-main">
        <ErrorBoundary>
          {wide ? (
            <SplitLayout route={route} storiesRef={storiesRef} />
          ) : (
            <NarrowLayout route={route} storiesRef={storiesRef} />
          )}
        </ErrorBoundary>
      </main>
      {showHelp && <KeyboardShortcutsHelp onClose={() => setShowHelp(false)} />}
    </div>
  );
}
