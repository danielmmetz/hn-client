import { useEffect, useState } from 'preact/hooks';
import Router from 'preact-router';
import { StoryList } from './pages/StoryList';
import { StoryDetail } from './pages/StoryDetail';
import { ArticleReader } from './pages/ArticleReader';
import { Starred } from './pages/Starred';
import { ErrorBoundary } from './components/ErrorBoundary';
import { connect, disconnect } from './lib/sse';
import { fetchUser, login, logout } from './lib/auth';

export function App() {
  const [user, setUser] = useState(undefined); // undefined = loading

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
    <div class="app">
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
          <Router>
            <StoryList path="/" />
            <StoryDetail path="/story/:id" />
            <ArticleReader path="/article/:id" />
            <Starred path="/starred" />
          </Router>
        </ErrorBoundary>
      </main>
    </div>
  );
}
