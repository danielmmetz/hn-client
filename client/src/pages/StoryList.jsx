import { useState, useEffect, useRef, useCallback } from 'preact/hooks';
import { getStories } from '../lib/api';
import { getStoriesFromDB, getSyncMeta, getStarredStoryIds } from '../lib/db';
import { prefetchStoriesData } from '../lib/sync';
import { on } from '../lib/sse';
import { StoryItem } from '../components/StoryItem';
import { Pagination } from '../components/Pagination';
import { StalenessLabel } from '../components/StalenessLabel';
import { PullToRefresh, RefreshButton, hasTouchSupport } from '../components/PullToRefresh';

function getPageFromURL() {
  // Support both hash query params (#/?page=2) and legacy path query params (?page=2)
  const hash = window.location.hash;
  const hashQuery = hash.indexOf('?') >= 0 ? hash.slice(hash.indexOf('?')) : '';
  const params = new URLSearchParams(hashQuery || window.location.search);
  const p = parseInt(params.get('page'), 10);
  return p > 0 ? p : 1;
}

export function StoryList({ selectedId } = {}) {
  const [stories, setStories] = useState([]);
  const [page, setPage] = useState(getPageFromURL);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [offline, setOffline] = useState(false);
  const [fetchedAt, setFetchedAt] = useState(null);
  const [refreshReady, setRefreshReady] = useState(false);
  const [starredIds, setStarredIds] = useState(new Set());
  const [pullRefreshing, setPullRefreshing] = useState(false);
  const [prefetchedIds, setPrefetchedIds] = useState(new Set());
  const prefetchedRef = useRef(false);
  const isTouch = typeof window !== 'undefined' ? hasTouchSupport() : true;

  const fetchStories = useCallback(async (pageNum) => {
    try {
      const data = await getStories(pageNum);
      const fresh = data.stories || [];
      setStories(fresh);
      setHasMore(pageNum * 30 < (data.total || 0));
      setOffline(!!data.offline);
      setFetchedAt(data.fetched_at || Math.floor(Date.now() / 1000));
      setLoading(false);
      setRefreshReady(false);

      // Prefetch comments/articles for page 1 stories (once per app session)
      if (pageNum === 1 && !prefetchedRef.current && fresh.length > 0) {
        prefetchedRef.current = true;

        prefetchStoriesData(fresh, {
          onStoryPrefetched: (id) => {
            setPrefetchedIds((prev) => {
              const next = new Set(prev);
              next.add(id);
              return next;
            });
          },
        }).catch(() => {});
      }
    } catch (err) {
      // If we already have cached data, just show offline indicator
      const cached = await getStoriesFromDB(pageNum);
      if (cached && cached.length > 0) {
        setStories(cached);
        setHasMore(cached.length >= 30);
        setOffline(true);
        setLoading(false);
      } else {
        setError(err.message);
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      setOffline(false);

      // Step 1: Show cached data immediately
      try {
        const cached = await getStoriesFromDB(page);
        if (!cancelled && cached && cached.length > 0) {
          setStories(cached);
          setHasMore(cached.length >= 30);
          setLoading(false);
          const ts = await getSyncMeta('last_stories_fetch');
          setFetchedAt(ts);
        }
      } catch {
        // IndexedDB read failed — continue to network
      }

      // Step 2: Fetch fresh data from network
      if (!cancelled) {
        await fetchStories(page);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [page, fetchStories]);

  // Load starred story IDs
  useEffect(() => {
    getStarredStoryIds().then(setStarredIds).catch(() => {});
  }, []);

  // Listen for SSE stories_updated events
  useEffect(() => {
    const unsub = on('stories_updated', () => {
      // Show toast instead of force-refreshing
      setRefreshReady(true);
    });
    return unsub;
  }, []);

  // Listen for SSE sync_required events
  useEffect(() => {
    const unsub = on('sync_required', () => {
      // Full re-fetch on sync_required
      fetchStories(page);
    });
    return unsub;
  }, [page, fetchStories]);

  // Sync state from URL on hash change (browser back/forward)
  useEffect(() => {
    function onHashChange() {
      setPage(getPageFromURL());
    }
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  function handlePageChange(newPage) {
    window.location.hash = newPage > 1 ? `#/?page=${newPage}` : '#/';
    setPage(newPage);
    window.scrollTo(0, 0);
  }

  function handleRefreshReady() {
    fetchStories(page);
  }

  async function handlePullRefresh() {
    setPullRefreshing(true);
    try {
      await fetchStories(page);
    } finally {
      setPullRefreshing(false);
    }
  }

  if (loading && stories.length === 0) {
    return <div class="page-loading">Loading stories…</div>;
  }

  if (error && stories.length === 0) {
    return (
      <div class="page-error">
        <p>Error: {error}</p>
        <p class="offline-hint">You appear to be offline with no cached data.</p>
      </div>
    );
  }

  return (
    <PullToRefresh onRefresh={handlePullRefresh}>
      <div class="story-list-page">
        {(offline || fetchedAt) && (
          <div class="story-list-status">
            <div class="story-list-status-left">
              {offline && <span class="offline-badge">Offline</span>}
              <StalenessLabel fetchedAt={fetchedAt} refreshReady={refreshReady} />
            </div>
            {!isTouch && (
              <RefreshButton onRefresh={handlePullRefresh} refreshing={pullRefreshing} />
            )}
          </div>
        )}
        <div class="story-list">
          {stories.map((story, i) => (
            <StoryItem
              key={story.id}
              story={story}
              rank={(page - 1) * 30 + i + 1}
              starred={starredIds.has(story.id)}
              prefetched={prefetchedIds.has(story.id)}
              selected={selectedId === story.id}
            />
          ))}
        </div>
        <Pagination page={page} hasMore={hasMore} onPageChange={handlePageChange} />


      </div>
    </PullToRefresh>
  );
}
