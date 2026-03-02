import { useEffect, useState, useRef, useCallback } from 'preact/hooks';
import { useHashRoute } from './lib/router';
import { useKeyboardShortcuts } from './lib/keyboard';
import { useSplitShortcuts, useNarrowShortcuts } from './lib/storyNav';
import { StoryList } from './pages/StoryList';
import { StoryDetail } from './pages/StoryDetail';
import { ArticleReader } from './pages/ArticleReader';
import { Starred } from './pages/Starred';
import { ErrorBoundary } from './components/ErrorBoundary';
import { KeyboardShortcutsHelp } from './components/KeyboardShortcutsHelp';
import { ViewMenu, getViewLabel } from './components/ViewMenu';
import { connect, disconnect } from './lib/sse';
import { fetchAuthConfig, fetchUser, login, logout } from './lib/auth';


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

const LIST_VIEW_KEY = 'hn-active-list-view';

/** Determine if the current route is a list view (not a story/article detail) */
function getListView(route) {
  if (route.page === 'top') return { type: 'top', period: route.id };
  if (route.page === 'starred') return { type: 'starred' };
  if (route.page === 'home') return { type: 'frontpage' };
  return null; // story/article — not a list view
}

function saveListView(view) {
  try { sessionStorage.setItem(LIST_VIEW_KEY, JSON.stringify(view)); } catch {}
}

function loadListView() {
  try {
    const stored = sessionStorage.getItem(LIST_VIEW_KEY);
    if (stored) return JSON.parse(stored);
  } catch {}
  return { type: 'frontpage' };
}

function listViewToHash(view) {
  if (view.type === 'top') return `#/top/${view.period || 'day'}`;
  if (view.type === 'starred') return '#/starred';
  return '#/';
}

/** Two-pane split layout used on wide screens. */
function SplitLayout({ route, storiesRef }) {
  const selectedId = (route.page === 'story' || route.page === 'article') ? Number(route.id) : null;
  const [readerMode, setReaderMode] = useState(route.page === 'article');
  // Track which list view was active when a story was selected, so the sidebar
  // keeps showing the correct list (frontpage vs top/period vs starred).
  // Persisted to sessionStorage so it survives page refresh.
  const [sidebarView, setSidebarView] = useState(() => {
    const fromRoute = getListView(route);
    return fromRoute || loadListView();
  });

  // Update sidebar view when navigating to a list page
  useEffect(() => {
    const view = getListView(route);
    if (view) {
      setSidebarView(view);
      saveListView(view);
    }
  }, [route.page, route.id]);

  // Enable reader mode when navigating to article route, reset otherwise
  useEffect(() => {
    setReaderMode(route.page === 'article');
  }, [selectedId, route.page]);

  // Keep URL hash in sync with readerMode so that switching to narrow layout
  // (which reads the hash route) preserves the current view mode.
  // Only react to readerMode changes (keyboard toggle), not selectedId changes,
  // to avoid overwriting the URL when navigating to a different story.
  useEffect(() => {
    if (!selectedId) return;
    const expectedPage = readerMode ? 'article' : 'story';
    if (route.page !== expectedPage) {
      window.location.replace(`#/${expectedPage}/${selectedId}`);
    }
  }, [readerMode]);

  // J/K story navigation, r/c view switching, v open link
  useSplitShortcuts({ selectedId, storiesRef, setReaderMode });

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

  const renderSidebar = () => {
    if (sidebarView.type === 'top') {
      return <StoryList period={sidebarView.period} selectedId={selectedId} storiesRef={storiesRef} />;
    }
    if (sidebarView.type === 'starred') {
      return <Starred selectedId={selectedId} />;
    }
    return <StoryList selectedId={selectedId} storiesRef={storiesRef} />;
  };

  return (
    <div class="split-layout">
      <aside class="split-sidebar" onClick={handleSidebarClick}>
        {renderSidebar()}
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
  // Track which list view was last visited so the back button returns there
  useEffect(() => {
    const view = getListView(route);
    if (view) saveListView(view);
  }, [route.page, route.id]);

  // Scroll the detail container to top when entering a new detail page
  const detailRef = useRef(null);
  const prevRouteId = useRef(null);
  useEffect(() => {
    const isDetail = route.page === 'story' || route.page === 'article';
    if (isDetail && route.id !== prevRouteId.current && detailRef.current) {
      detailRef.current.scrollTop = 0;
    }
    prevRouteId.current = isDetail ? route.id : null;
  }, [route.page, route.id]);

  // J/K story navigation, r/c view switching, h back to list, v open link
  useNarrowShortcuts({ route, storiesRef, listBackHash: listViewToHash(loadListView()) });

  const isDetail = route.page === 'story' || route.page === 'article';
  const listView = getListView(route) || loadListView();

  return (
    <>
      {/* Each view gets its own scroll container so scroll position is
          naturally preserved when toggling between list and detail. */}
      <div class="narrow-scroll-container" style={{ display: isDetail ? 'none' : undefined }}>
        {listView.type === 'starred' && <Starred />}
        {listView.type === 'top' && <StoryList key={listView.period} period={listView.period} storiesRef={storiesRef} />}
        {listView.type === 'frontpage' && <StoryList storiesRef={storiesRef} />}
      </div>
      {isDetail && (
        <div class="narrow-scroll-container" ref={detailRef}>
          {route.page === 'story' && <StoryDetail key={route.id} id={route.id} storiesRef={storiesRef} />}
          {route.page === 'article' && <ArticleReader key={route.id} id={route.id} storiesRef={storiesRef} />}
        </div>
      )}
    </>
  );
}

export function App() {
  const [user, setUser] = useState(undefined); // undefined = loading, null = not logged in, object = user
  const [authConfig, setAuthConfig] = useState(undefined); // undefined = loading
  const [showHelp, setShowHelp] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
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

  // Close menu when route changes
  useEffect(() => {
    setShowMenu(false);
  }, [route.page, route.id]);

  // Redirect legacy path-based URLs to hash equivalents
  useEffect(() => {
    const path = window.location.pathname;
    if (path !== '/' && path !== '/index.html') {
      const hash = '#' + path;
      window.history.replaceState(null, '', '/' + hash);
    }
  }, []);

  // Check auth config and user on mount
  useEffect(() => {
    fetchAuthConfig().then((config) => {
      setAuthConfig(config);
      if (config.enabled) {
        fetchUser().then(setUser);
      } else {
        // No auth available — treat as anonymous (no user)
        setUser(null);
      }
    });
  }, []);

  // Initialize SSE when ready (authenticated, or auth not required)
  useEffect(() => {
    if (authConfig === undefined || user === undefined) return;
    if (authConfig.required && !user) return;

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
  }, [authConfig, user]);

  // Loading state
  if (authConfig === undefined || user === undefined) {
    return (
      <div class="app">
        <div class="login-gate">
          <div class="login-loading">Loading…</div>
        </div>
      </div>
    );
  }

  // Auth required but not authenticated — show login gate
  if (authConfig.required && !user) {
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

  // App is accessible — user may or may not be logged in
  return (
    <div class={`app${wide ? ' app-wide' : ''}`}>
      <header class="app-header">
        {!wide && (route.page === 'story' || route.page === 'article') ? (
          <a href={listViewToHash(loadListView())} class="back-btn" aria-label="Back to stories">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </a>
        ) : (
          <div class="app-logo-group">
            <a href="#/" class="logo-icon-link" onClick={() => setShowMenu(false)}>
              <span class="logo-icon">Y</span>
            </a>
            <button
              class="logo-menu-trigger"
              onClick={() => setShowMenu((v) => !v)}
              aria-expanded={showMenu}
              aria-haspopup="true"
            >
              <span class="logo-text">HN Reader</span>
              <span class="logo-separator">·</span>
              <span class="logo-view-label">{getViewLabel(route)}</span>
              <svg class="logo-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
            {showMenu && <ViewMenu route={route} onClose={() => setShowMenu(false)} />}
          </div>
        )}
        {user ? (
          <button class="signout-btn" onClick={logout} title="Sign out">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
          </button>
        ) : authConfig.enabled ? (
          <button class="signin-btn" onClick={login} title="Sign in">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
              <circle cx="12" cy="7" r="4" />
            </svg>
          </button>
        ) : null}
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
