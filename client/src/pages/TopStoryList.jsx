import { useState, useEffect, useCallback, useRef } from 'preact/hooks';
import { getTopStories } from '../lib/api';
import { getTopStoriesFromDB, getStarredStoryIds } from '../lib/db';
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

export function TopStoryList({ period, selectedId, storiesRef } = {}) {
  const [stories, setStories] = useState([]);
  const [page, setPage] = useState(getPageFromURL);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [offline, setOffline] = useState(false);
  const [fetchedAt, setFetchedAt] = useState(null);
  const [starredIds, setStarredIds] = useState(new Set());
  const [pullRefreshing, setPullRefreshing] = useState(false);
  const isTouch = typeof window !== 'undefined' ? hasTouchSupport() : true;

  const fetchStories = useCallback(async (pageNum) => {
    try {
      const data = await getTopStories(period, pageNum);
      const fresh = data.stories || [];
      setStories(fresh);
      setHasMore(pageNum * 30 < (data.total || 0));
      setOffline(!!data.offline);
      setFetchedAt(data.fetched_at || Math.floor(Date.now() / 1000));
      setLoading(false);
    } catch (err) {
      const cached = await getTopStoriesFromDB(period, pageNum);
      if (cached && cached.stories && cached.stories.length > 0) {
        setStories(cached.stories);
        setHasMore(cached.stories.length >= 30);
        setOffline(true);
        setFetchedAt(cached.fetched_at);
        setLoading(false);
      } else {
        setError(err.message);
        setLoading(false);
      }
    }
  }, [period]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      setOffline(false);

      // Show cached data immediately
      try {
        const cached = await getTopStoriesFromDB(period, page);
        if (!cancelled && cached && cached.stories && cached.stories.length > 0) {
          setStories(cached.stories);
          setHasMore(cached.stories.length >= 30);
          setLoading(false);
          setFetchedAt(cached.fetched_at);
        }
      } catch {
        // Continue to network
      }

      if (!cancelled) {
        await fetchStories(page);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [page, period, fetchStories]);

  // Expose stories to parent via ref
  useEffect(() => {
    if (storiesRef) storiesRef.current = stories;
  }, [stories, storiesRef]);

  // Load starred IDs
  useEffect(() => {
    getStarredStoryIds().then(setStarredIds).catch(() => {});
  }, []);

  // Reset page when period changes
  useEffect(() => {
    setPage(getPageFromURL());
  }, [period]);

  // Sync page from URL on hash change
  useEffect(() => {
    function onHashChange() {
      setPage(getPageFromURL());
    }
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const listRef = useRef(null);

  function handlePageChange(newPage) {
    window.location.hash = newPage > 1 ? `#/top/${period}?page=${newPage}` : `#/top/${period}`;
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
            <span class="top-stories-period-label">{PERIOD_LABELS[period] || 'Top Stories'}</span>
            <StalenessLabel fetchedAt={fetchedAt} />
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
              selected={selectedId === story.id}
            />
          ))}
        </div>
        {stories.length === 0 && !loading && (
          <div class="top-stories-empty">No stories found for this period.</div>
        )}
        <Pagination page={page} hasMore={hasMore} onPageChange={handlePageChange} />
      </div>
    </PullToRefresh>
  );
}
