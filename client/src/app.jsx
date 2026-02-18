import { useEffect, useState, useCallback } from 'preact/hooks';
import Router from 'preact-router';
import { StoryList } from './pages/StoryList';
import { StoryDetail } from './pages/StoryDetail';
import { ArticleReader } from './pages/ArticleReader';
import { Starred } from './pages/Starred';
import { ErrorBoundary } from './components/ErrorBoundary';
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

/** Two-pane split layout used on wide screens for the story list + detail. */
function SplitLayout() {
  const [selectedId, setSelectedId] = useState(() => {
    // If we're already on a /story/:id URL, pre-select that story
    const m = window.location.pathname.match(/^\/story\/(\d+)$/);
    return m ? m[1] : null;
  });

  const handleSelectStory = useCallback((id) => {
    setSelectedId(id);
    // Keep the URL in sync so back/share still works
    history.pushState(null, '', `/story/${id}`);
  }, []);

  // Also sync from browser back/forward
  useEffect(() => {
    function onPopState() {
      const m = window.location.pathname.match(/^\/story\/(\d+)$/);
      setSelectedId(m ? m[1] : null);
    }
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  return (
    <div class="split-layout">
      <aside class="split-sidebar">
        <StoryList onSelectStory={handleSelectStory} selectedId={selectedId} />
      </aside>
      <div class="split-detail">
        {selectedId ? (
          <StoryDetail key={selectedId} id={selectedId} />
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

export function App() {
  const [user, setUser] = useState(undefined); // undefined = loading
  const wide = useWideLayout();

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
        <a href="/" class="app-logo">
          <span class="logo-icon">Y</span>
          <span class="logo-text">HN Reader</span>
        </a>
        <nav class="app-nav">
          <a href="/">Top</a>
          <a href="/starred">Starred</a>
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
            // Wide layout: always show split view; other pages (starred, article) still route normally
            <Router>
              <SplitLayout path="/" />
              <SplitLayout path="/story/:id" />
              <ArticleReader path="/article/:id" />
              <Starred path="/starred" />
            </Router>
          ) : (
            <Router>
              <StoryList path="/" />
              <StoryDetail path="/story/:id" />
              <ArticleReader path="/article/:id" />
              <Starred path="/starred" />
            </Router>
          )}
        </ErrorBoundary>
      </main>
    </div>
  );
}
