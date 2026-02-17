export function ArticleView({ story, article, onRetry, retrying }) {
  // Text post (Ask HN, etc.) — show story body
  if (!story.url && story.text) {
    return (
      <div class="article-view">
        <div class="article-content" dangerouslySetInnerHTML={{ __html: story.text }} />
      </div>
    );
  }

  // No URL and no text
  if (!story.url) {
    return null;
  }

  // Article extraction failed
  if (!article || article.extraction_failed) {
    return (
      <div class="article-view article-failed">
        <p class="article-failed-msg">Could not extract article content.</p>
        <div class="article-failed-actions">
          <a href={story.url} target="_blank" rel="noopener noreferrer" class="btn btn-secondary">
            Open original ↗
          </a>
          <button class="btn btn-primary" onClick={onRetry} disabled={retrying}>
            {retrying ? 'Retrying…' : 'Retry extraction'}
          </button>
        </div>
      </div>
    );
  }

  // Successfully extracted article
  return (
    <div class="article-view">
      {article.title && <h1 class="article-title">{article.title}</h1>}
      {article.byline && <p class="article-byline">{article.byline}</p>}
      <div class="article-content" dangerouslySetInnerHTML={{ __html: article.content }} />
    </div>
  );
}
