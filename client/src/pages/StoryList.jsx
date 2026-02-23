import { useState, useEffect, useRef, useCallback } from 'preact/hooks';
import { getStories, getTopStories } from '../lib/api';
import { getStoriesFromDB, getTopStoriesFromDB, getSyncMeta, getStarredStoryIds } from '../lib/db';
import { prefetchStoriesData, isPrefetchAllowed } from '../lib/sync';
import { on } from '../lib/sse';
import { StoryItem } from '../components/StoryItem';
import { Pagination } from '../components/Pagination';
import { StalenessLabel } from '../components/StalenessLabel';
import { PullToRefresh, RefreshButton, hasTouchSupport } from '../components/PullToRefresh';

const PERIOD_LABELS = {
  day: "Today's Top Stories",
  yesterday: "Yesterday's Top Stories",
  week: "This Week's Top Stories",
};

function getPageFromURL() {
  const hash = window.location.hash;
  const hashQuery = hash.indexOf('?') >= 0 ? hash.slice(hash.indexOf('?')) : '';
  const params = new URLSearchParams(hashQuery || window.location.search);
  const p = parseInt(params.get('page'), 10);
  return p > 0 ? p : 1;
}

/**
 * Unified story list component.
 *
 * Props:
 *   - period: null for frontpage, or 'day'|'yesterday'|'week' for top stories
 *   - selectedId: highlighted story id (split layout)
 *   - storiesRef: ref to expose stories array to parent
 */
export function StoryList({ period, selectedId, storiesRef } = {}) {
  const isFrontpage = !period;

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
  const listRef = useRef(null);
  const isTouch = typeof window !== 'undefined' ? hasTouchSupport() : true;

  const fetchStories = useCallback(async (pageNum) => {
    try {
      const data = isFrontpage
        ? await getStories(pageNum)
        : await getTopStories(period, pageNum);
      const fresh = data.stories || [];
      setStories(fresh);
      setHasMore(pageNum * 30 < (data.total || 0));
      setOffline(!!data.offline);
      setFetchedAt(data.fetched_at || Math.floor(Date.now() / 1000));
      setLoading(false);
      setRefreshReady(false);

      // Prefetch comments/articles for frontpage page 1 (once per session)
      if (isFrontpage && pageNum === 1 && !prefetchedRef.current && fresh.length > 0) {
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
      // Try IndexedDB fallback
      let cached, cachedFetchedAt;
      if (isFrontpage) {
        cached = await getStoriesFromDB(pageNum);
        cachedFetchedAt = cached?.length > 0 ? await getSyncMeta('last_stories_fetch') : null;
      } else {
        const entry = await getTopStoriesFromDB(period, pageNum);
        cached = entry?.stories;
        cachedFetchedAt = entry?.fetched_at;
      }
      if (cached && cached.length > 0) {
        setStories(cached);
        setHasMore(cached.length >= 30);
        setOffline(true);
        setFetchedAt(cachedFetchedAt);
        setLoading(false);
      } else {
        setError(err.message);
        setLoading(false);
      }
    }
  }, [isFrontpage, period]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      setOffline(false);

      // Step 1: Show cached data immediately
      try {
        let cached, cachedFetchedAt;
        if (isFrontpage) {
          cached = await getStoriesFromDB(page);
          cachedFetchedAt = cached?.length > 0 ? await getSyncMeta('last_stories_fetch') : null;
        } else {
          const entry = await getTopStoriesFromDB(period, page);
          cached = entry?.stories;
          cachedFetchedAt = entry?.fetched_at;
        }
        if (!cancelled && cached && cached.length > 0) {
          setStories(cached);
          setHasMore(cached.length >= 30);
          setLoading(false);
          setFetchedAt(cachedFetchedAt);
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
  }, [page, period, fetchStories]);

  // Expose stories to parent via ref for keyboard navigation
  useEffect(() => {
    if (storiesRef) storiesRef.current = stories;
  }, [stories, storiesRef]);

  // Load starred story IDs
  useEffect(() => {
    getStarredStoryIds().then(setStarredIds).catch(() => {});
  }, []);

  // Listen for SSE events (frontpage only)
  useEffect(() => {
    if (!isFrontpage) return;
    const unsub = on('stories_updated', () => setRefreshReady(true));
    return unsub;
  }, [isFrontpage]);

  useEffect(() => {
    if (!isFrontpage) return;
    const unsub = on('sync_required', () => fetchStories(page));
    return unsub;
  }, [isFrontpage, page, fetchStories]);

  // Reset page when period changes
  useEffect(() => {
    setPage(getPageFromURL());
  }, [period]);

  // Sync page from URL on hash change (browser back/forward)
  useEffect(() => {
    function onHashChange() { setPage(getPageFromURL()); }
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  function handlePageChange(newPage) {
    const base = isFrontpage
      ? (newPage > 1 ? `#/?page=${newPage}` : '#/')
      : (newPage > 1 ? `#/top/${period}?page=${newPage}` : `#/top/${period}`);
    window.location.hash = base;
    setPage(newPage);
    const scroller = listRef.current?.closest('.narrow-scroll-container, .split-sidebar');
    if (scroller) scroller.scrollTop = 0;
    else window.scrollTo(0, 0);
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
      <div class="story-list-page" ref={listRef}>
        <div class="story-list-status">
          <div class="story-list-status-left">
            {offline && <span class="offline-badge">Offline</span>}
            {!isFrontpage && (
              <span class="top-stories-period-label">
                {PERIOD_LABELS[period] || 'Top Stories'}
              </span>
            )}
            <StalenessLabel fetchedAt={fetchedAt} refreshReady={isFrontpage && refreshReady} />
          </div>
          {!isTouch && (
            <RefreshButton onRefresh={handlePullRefresh} refreshing={pullRefreshing} />
          )}
        </div>
        <div class="story-list">
          {stories.map((story, i) => (
            <StoryItem
              key={story.id}
              story={story}
              rank={(page - 1) * 30 + i + 1}
              starred={starredIds.has(story.id)}
              prefetched={isFrontpage && prefetchedIds.has(story.id)}
              selected={selectedId === story.id}
            />
          ))}
        </div>
        {!isFrontpage && stories.length === 0 && !loading && (
          <div class="top-stories-empty">No stories found for this period.</div>
        )}
        <Pagination page={page} hasMore={hasMore} onPageChange={handlePageChange} />
      </div>
    </PullToRefresh>
  );
}
