import { useState, useEffect, useRef } from 'preact/hooks';
import { getStory, getArticle, refreshStory } from '../lib/api';
import { getStoryFromDB, getArticleFromDB, isStarred, starStory, unstarStory } from '../lib/db';
import { on } from '../lib/sse';
import { timeAgo } from '../lib/time';
import { ArticleView } from '../components/ArticleView';

export function ArticleReader({ id }) {
  const [story, setStory] = useState(null);
  const [article, setArticle] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [retrying, setRetrying] = useState(false);
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

    async function load() {
      setLoading(true);
      setError(null);

      try {
        const [cachedStory, cachedArticle] = await Promise.all([
          getStoryFromDB(id),
          getArticleFromDB(id),
        ]);
        if (cancelled) return;
        if (cachedStory) {
          setStory(cachedStory);
          setArticle(cachedArticle || null);
          setLoading(false);
        }
      } catch {}

      try {
        const [storyData, articleData] = await Promise.all([
          getStory(id),
          getArticle(id).catch(() => null),
        ]);
        if (cancelled) return;
        setStory(storyData);
        setArticle(articleData);
        setLoading(false);
      } catch (err) {
        if (cancelled) return;
        if (!story) {
          setError(err.message);
        }
        setLoading(false);
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

  async function handleRetryExtraction() {
    setRetrying(true);

    if (sseCleanupRef.current) {
      sseCleanupRef.current();
      sseCleanupRef.current = null;
    }

    try {
      await refreshStory(id, { article: true });

      await new Promise((resolve) => {
        const timeout = setTimeout(() => {
          unsub();
          resolve();
        }, 10000);

        const unsub = on(`story_refreshed:${id}`, () => {
          clearTimeout(timeout);
          unsub();
          resolve();
        });

        sseCleanupRef.current = () => {
          clearTimeout(timeout);
          unsub();
        };
      });

      const newArticle = await getArticle(id).catch(() => null);
      setArticle(newArticle);
    } catch {
      try {
        await new Promise((r) => setTimeout(r, 3000));
        const newArticle = await getArticle(id).catch(() => null);
        setArticle(newArticle);
      } catch {}
    }
    sseCleanupRef.current = null;
    setRetrying(false);
  }

  if (loading) {
    return <div class="page-loading">Loading article…</div>;
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
            <div class="story-detail-meta">
              {domain && <span class="story-detail-domain">({domain})</span>}
              <span>{story.score} points</span>
              <span class="story-separator">·</span>
              <span>{story.by}</span>
              <span class="story-separator">·</span>
              <span>{timeAgo(story.time)}</span>
            </div>
          </div>
          <a
            href={`/story/${story.id}`}
            class="comments-btn"
            aria-label={`${story.descendants ?? 0} comments`}
          >
            <svg class="comments-icon" viewBox="0 0 512 512" width="16" height="16" fill="currentColor"><path d="M256 32C114.6 32 0 125.1 0 240c0 49.6 21.4 95 57 130.7C44.5 421.1 2.7 466 2.2 466.5c-2.2 2.3-2.8 5.7-1.5 8.7S4.8 480 8 480c66.3 0 116-31.8 140.6-51.4 32.7 12.3 69 19.4 107.4 19.4 141.4 0 256-93.1 256-208S397.4 32 256 32zm-64 232c-13.3 0-24-10.7-24-24s10.7-24 24-24 24 10.7 24 24-10.7 24-24 24zm64 0c-13.3 0-24-10.7-24-24s10.7-24 24-24 24 10.7 24 24-10.7 24-24 24zm64 0c-13.3 0-24-10.7-24-24s10.7-24 24-24 24 10.7 24 24-10.7 24-24 24z"/></svg>
            <span>{story.descendants ?? 0}</span>
          </a>
          <button
            class={`star-btn ${starred ? 'star-btn-active' : ''}`}
            onClick={handleToggleStar}
            aria-label={starred ? 'Unstar story' : 'Star story'}
          >
            {starred ? '★' : '☆'}
          </button>
        </div>
      </header>

      <ArticleView
        story={story}
        article={article}
        onRetry={handleRetryExtraction}
        retrying={retrying}
      />
    </div>
  );
}
