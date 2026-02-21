import { timeAgo } from '../lib/time';
import { CommentBubble } from './CommentBubble';

function getDomain(url) {
  if (!url) return null;
  try {
    const h = new URL(url).hostname;
    return h.replace(/^www\./, '');
  } catch {
    return null;
  }
}

export function StoryItem({ story, rank, starred, prefetched, selected }) {
  const domain = getDomain(story.url);
  // Title links to the actual source for link posts, comments page for text posts
  const titleHref = story.url ? story.url : `#/story/${story.id}`;

  // Link posts always open in a new tab; text posts navigate via the router
  const titleIsExternal = !!story.url;
  const titleTarget = titleIsExternal ? { target: '_blank', rel: 'noopener noreferrer' } : {};

  return (
    <article class={`story-item${selected ? ' story-item-selected' : ''}`} data-story-id={story.id}>
      <a
        href={titleHref}
        class="story-item-title-link"
        {...titleTarget}
      >
        <div class="story-item-title-inner">
          <div class="story-content">
            <h2 class="story-title">
              {story.title}
              {starred && <span class="story-star-indicator" aria-label="Starred">★</span>}
            </h2>
            {domain && <div class="story-domain-line">({domain})</div>}
            <div class="story-meta">
              <span class="story-score">{story.score} points</span>
              <span class="story-separator">·</span>
              <span class="story-author">{story.by}</span>
              <span class="story-separator">·</span>
              <span class="story-time">{timeAgo(story.time)}</span>
              {prefetched && <>
                <span class="story-separator">·</span>
                <span class="story-prefetch-indicator" aria-label="Cached for offline" title="Available offline"><svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242"/><path d="M12 12v9"/><path d="m8 17 4 4 4-4"/></svg></span>
              </>}
            </div>
          </div>
        </div>
      </a>
      <div class="story-item-actions">
        {story.url ? (
          <a href={`#/article/${story.id}`} class="story-item-action-icon story-item-action-icon--reader" aria-label="Reader view">
            <svg viewBox="0 0 24 24" width="23" height="20" preserveAspectRatio="none" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>
          </a>
        ) : (
          <span class="story-item-action-icon story-item-action-placeholder" aria-hidden="true" />
        )}
        <a
          href={`#/story/${story.id}`}
          class="story-item-action-icon"
          aria-label={`${story.descendants ?? 0} comments`}
        >
          <CommentBubble count={story.descendants ?? 0} scale={0.85} />
        </a>
      </div>
    </article>
  );
}
