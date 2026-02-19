import { useState, useEffect, useRef } from 'preact/hooks';
import { getStory, getComments, refreshStory } from '../lib/api';
import { getStoryFromDB, getCommentsFromDB, isStarred, starStory, unstarStory } from '../lib/db';
import { isPrefetchAllowed } from '../lib/sync';
import { on } from '../lib/sse';
import { timeAgo } from '../lib/time';
import { CommentTree } from '../components/CommentTree';
import { StalenessLabel } from '../components/StalenessLabel';
import { PullToRefresh, RefreshButton, hasTouchSupport } from '../components/PullToRefresh';

export function StoryDetail({ id, onReaderView }) {
  const [story, setStory] = useState(null);
  const [comments, setComments] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [offline, setOffline] = useState(false);
  const [showLoadButton, setShowLoadButton] = useState(!isPrefetchAllowed());
  const [starred, setStarred] = useState(false);

  const sseCleanupRef = useRef(null);

  useEffect(() => {
    isStarred(id).then(setStarred).catch(() => {});
  }, [id]);

  async function handleToggleStar() {
    if (starred) {
      await unstarStory(id);
      setStarred(false);
    } else {
      await starStory(id);
      setStarred(true);
    }
  }

  useEffect(() => {
    let cancelled = false;

    // If cached data is less than 2 minutes old, skip the network request.
    const FRESH_THRESHOLD = 2 * 60; // seconds

    async function load() {
      setLoading(true);
      setError(null);
      setOffline(false);

      // Step 1: Show cached data immediately
      let hasFreshCache = false;
      try {
        const [cachedStory, cachedComments] = await Promise.all([
          getStoryFromDB(id),
          getCommentsFromDB(id),
        ]);
        if (cancelled) return;
        if (cachedStory) {
          setStory(cachedStory);
          setComments(cachedComments || { comments: [], fetched_at: null });
          setLoading(false);

          // Check if both story and comments were cached recently (client-side timestamp)
          const now = Math.floor(Date.now() / 1000);
          const storyAge = now - (cachedStory.cached_at || 0);
          const commentsAge = now - (cachedComments?.cached_at || 0);
          hasFreshCache = storyAge < FRESH_THRESHOLD && commentsAge < FRESH_THRESHOLD;
        }
      } catch {
        // IndexedDB read failed — continue to network
      }

      // Step 2: Fetch fresh data from network (skip if cache is fresh)
      if (!hasFreshCache) {
        try {
          const [storyData, commentsData] = await Promise.all([
            getStory(id),
            getComments(id).catch(() => ({ comments: [], fetched_at: null })),
          ]);
          if (cancelled) return;
          setStory(storyData);
          setComments(commentsData);
          setLoading(false);
        } catch (err) {
          if (cancelled) return;
          if (story) {
            setOffline(true);
            setLoading(false);
          } else {
            setError(err.message);
            setLoading(false);
          }
        }
      }
    }

    load();
    return () => { cancelled = true; };
  }, [id]);

  useEffect(() => {
    return () => {
      if (sseCleanupRef.current) {
        sseCleanupRef.current();
        sseCleanupRef.current = null;
      }
    };
  }, []);

  async function handleRefreshComments() {
    setRefreshing(true);

    if (sseCleanupRef.current) {
      sseCleanupRef.current();
      sseCleanupRef.current = null;
    }

    try {
      await refreshStory(id);

      await new Promise((resolve) => {
        const timeout = setTimeout(() => {
          unsub();
          resolve();
        }, 10000);

        const unsub = on(`comments_updated:${id}`, () => {
          clearTimeout(timeout);
          unsub();
          resolve();
        });

        sseCleanupRef.current = () => {
          clearTimeout(timeout);
          unsub();
        };
      });

      const newComments = await getComments(id).catch(() => ({ comments: [], fetched_at: null }));
      setComments(newComments);
    } catch {
      try {
        await new Promise((r) => setTimeout(r, 3000));
        const newComments = await getComments(id).catch(() => ({ comments: [], fetched_at: null }));
        setComments(newComments);
      } catch {
        // ignore
      }
    }
    sseCleanupRef.current = null;
    setRefreshing(false);
  }

  async function handleLoadComments() {
    setShowLoadButton(false);
    setRefreshing(true);
    try {
      const commentsData = await getComments(id).catch(() => ({ comments: [], fetched_at: null }));
      setComments(commentsData);
    } catch {
      // ignore
    }
    setRefreshing(false);
  }

  if (loading) {
    return <div class="page-loading">Loading story…</div>;
  }

  if (error) {
    return <div class="page-error">Error: {error}</div>;
  }

  if (!story) {
    return <div class="page-error">Story not found.</div>;
  }

  function getDomain(url) {
    if (!url) return null;
    try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return null; }
  }

  const domain = getDomain(story.url);

  return (
    <div class="story-detail-page">
      <header class="story-detail-header">
        <div class="story-detail-title-row">
          <div class="story-detail-title-group">
            <h1 class="story-detail-title">
              {story.url ? (
                <a href={story.url} target="_blank" rel="noopener noreferrer">
                  {story.title}
                </a>
              ) : (
                story.title
              )}
            </h1>
            {domain && <div class="story-detail-domain">{domain}</div>}
            <div class="story-detail-meta">
              <span>{story.score} points</span>
              <span class="story-separator">·</span>
              <span>{story.by}</span>
              <span class="story-separator">·</span>
              <span>{timeAgo(story.time)}</span>
            </div>
          </div>
          {offline && <span class="offline-badge">Offline</span>}
          {story.url && (
            onReaderView ? (
              <button
                class="reader-btn"
                onClick={onReaderView}
                aria-label="Open reader view"
              >
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/>
                  <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>
                </svg>
              </button>
            ) : (
              <a
                href={`#/article/${id}`}
                class="reader-btn"
                aria-label="Open reader view"
              >
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/>
                  <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>
                </svg>
              </a>
            )
          )}
          <button
            class={`star-btn ${starred ? 'star-btn-active' : ''}`}
            onClick={handleToggleStar}
            aria-label={starred ? 'Unstar story' : 'Star story'}
          >
            {starred ? '★' : '☆'}
          </button>
        </div>
      </header>

      {/* Text post body (Ask HN, etc.) */}
      {!story.url && story.text && (
        <div class="story-detail-text">
          <div class="story-detail-text-content" dangerouslySetInnerHTML={{ __html: story.text }} />
        </div>
      )}

      {showLoadButton ? (
        <div class="data-saver-prompt">
          <p>Data saver mode is active. Tap to load comments.</p>
          <button class="btn btn-primary" onClick={handleLoadComments} disabled={refreshing}>
            {refreshing ? 'Loading…' : 'Load comments'}
          </button>
        </div>
      ) : (
        <PullToRefresh onRefresh={handleRefreshComments} refreshing={refreshing}>
          <div class="story-detail-comments-header">
            <span class="story-detail-comments-count">
              {story.descendants ?? 0} comments
              {comments?.fetched_at && (
                <StalenessLabel fetchedAt={comments.fetched_at} />
              )}
            </span>
            {!hasTouchSupport() && (
              <RefreshButton onRefresh={handleRefreshComments} refreshing={refreshing} />
            )}
          </div>

          {comments && (
            <CommentTree
              comments={comments.comments || []}
            />
          )}
        </PullToRefresh>
      )}
    </div>
  );
}
