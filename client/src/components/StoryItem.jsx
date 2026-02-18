import { timeAgo } from '../lib/time';

function getDomain(url) {
  if (!url) return null;
  try {
    const h = new URL(url).hostname;
    return h.replace(/^www\./, '');
  } catch {
    return null;
  }
}

export function StoryItem({ story, rank, starred, prefetched, selected, onSelectStory }) {
  const domain = getDomain(story.url);
  // Title links to the actual source for link posts, comments page for text posts
  const titleHref = story.url ? story.url : `/story/${story.id}`;

  // In split-layout mode, clicking the comments button selects the story.
  function handleCommentsClick(e) {
    if (onSelectStory) {
      e.preventDefault();
      onSelectStory(story.id);
    }
    // else default link navigation
  }

  // In split-layout mode with a URL, title opens the article in a new tab.
  // For text posts (no URL) in split mode, title click selects the story.
  const titleIsExternal = !!story.url; // always open link posts in new tab
  const titleTarget = titleIsExternal ? { target: '_blank', rel: 'noopener noreferrer' } : {};

  // For text posts in split mode, clicking title selects story instead of navigating
  function handleTitleClick(e) {
    if (onSelectStory && !story.url) {
      e.preventDefault();
      onSelectStory(story.id);
    }
    // link posts: let the browser open the new tab normally
  }

  return (
    <article class={`story-item${selected ? ' story-item-selected' : ''}`}>
      <a
        href={titleHref}
        class="story-item-title-link"
        onClick={handleTitleClick}
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
      {!onSelectStory && (story.url ? (
        <a href={`/article/${story.id}`} class="story-item-action-link" aria-label="Reader view">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>
        </a>
      ) : (
        <span class="story-item-action-link story-item-action-placeholder" aria-hidden="true" />
      ))}
      <a
        href={`/story/${story.id}`}
        class="story-item-action-link"
        aria-label={`${story.descendants} comments`}
        onClick={handleCommentsClick}
      >
        <svg class="comments-icon" viewBox="0 0 512 512" width="16" height="16" fill="currentColor"><path d="M256 32C114.6 32 0 125.1 0 240c0 49.6 21.4 95 57 130.7C44.5 421.1 2.7 466 2.2 466.5c-2.2 2.3-2.8 5.7-1.5 8.7S4.8 480 8 480c66.3 0 116-31.8 140.6-51.4 32.7 12.3 69 19.4 107.4 19.4 141.4 0 256-93.1 256-208S397.4 32 256 32zm-64 232c-13.3 0-24-10.7-24-24s10.7-24 24-24 24 10.7 24 24-10.7 24-24 24zm64 0c-13.3 0-24-10.7-24-24s10.7-24 24-24 24 10.7 24 24-10.7 24-24 24zm64 0c-13.3 0-24-10.7-24-24s10.7-24 24-24 24 10.7 24 24-10.7 24-24 24z"/></svg>
        <span class="comments-count">{story.descendants ?? 0}</span>
      </a>
    </article>
  );
}
