import { useState, useEffect, useRef } from 'preact/hooks';
import { getStory, getArticle, refreshStory } from '../lib/api';
import { getStoryFromDB, getArticleFromDB, isStarred, starStory, unstarStory } from '../lib/db';
import { on } from '../lib/sse';
import { timeAgo } from '../lib/time';
import { ArticleView } from '../components/ArticleView';

export function ArticleReader({ id, onShowComments }) {
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
            {domain && <div class="story-detail-domain">{domain}</div>}
            <div class="story-detail-meta">
              <span>{story.score} points</span>
              <span class="story-separator">·</span>
              <span>{story.by}</span>
              <span class="story-separator">·</span>
              <span>{timeAgo(story.time)}</span>
            </div>
          </div>
          {onShowComments ? (
            <button
              class="comments-btn"
              onClick={onShowComments}
              aria-label={`${story.descendants ?? 0} comments`}
            >
              <svg viewBox="0 0 18 16" width="18" height="16" aria-hidden="true">
                <path d="M3,0 H15 Q18,0 18,3 V9 Q18,12 15,12 H9 L1,16 L5,12 H3 Q0,12 0,9 V3 Q0,0 3,0 Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" />
              </svg>
            </button>
          ) : (
            <a
              href={`#/story/${story.id}`}
              class="comments-btn"
              aria-label={`${story.descendants ?? 0} comments`}
            >
              <svg viewBox="0 0 18 16" width="18" height="16" aria-hidden="true">
                <path d="M3,0 H15 Q18,0 18,3 V9 Q18,12 15,12 H9 L1,16 L5,12 H3 Q0,12 0,9 V3 Q0,0 3,0 Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" />
              </svg>
            </a>
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

      <ArticleView
        story={story}
        article={article}
        onRetry={handleRetryExtraction}
        retrying={retrying}
      />
    </div>
  );
}
