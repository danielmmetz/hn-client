import * as api from './api';
import * as db from './db';

/**
 * Check if we should skip prefetch due to data-saver or slow connection.
 * Returns true if prefetch should be skipped.
 */
export function shouldSkipPrefetch() {
  const conn = navigator.connection;
  if (!conn) return false;

  // Respect Save-Data header
  if (conn.saveData) return true;

  // Skip on slow connections (2g, slow-2g)
  const slow = ['slow-2g', '2g'];
  if (slow.includes(conn.effectiveType)) return true;

  return false;
}

/**
 * Get the user's data-saver override preference from localStorage.
 */
export function getDataSaverOverride() {
  try {
    return localStorage.getItem('hn-data-saver-override') === 'true';
  } catch {
    return false;
  }
}

export function setDataSaverOverride(value) {
  try {
    localStorage.setItem('hn-data-saver-override', value ? 'true' : 'false');
  } catch {
    // ignore
  }
}

/**
 * Whether prefetch is allowed (considering override).
 */
export function isPrefetchAllowed() {
  if (getDataSaverOverride()) return true;
  return !shouldSkipPrefetch();
}

/**
 * Prefetch comments and articles for given stories (staggered).
 * Respects data-saver unless overridden.
 */
export async function prefetchStoriesData(stories, options = {}) {
  const { maxStories = 30, onStoryPrefetched } = options;

  if (!isPrefetchAllowed() && !options.force) return;

  const storiesToPrefetch = stories.slice(0, maxStories);

  await Promise.all(storiesToPrefetch.map(async (story) => {
    try {
      // Skip if comments already cached
      const existing = await db.getCommentsFromDB(story.id);
      if (existing) {
        if (onStoryPrefetched) onStoryPrefetched(story.id);
        return;
      }

      // Prefetch comments
      const commentsData = await api.getComments(story.id);
      await db.putComments(story.id, commentsData);

      // Prefetch article if story has a URL
      if (story.url) {
        try {
          const articleData = await api.getArticle(story.id);
          await db.putArticle(story.id, articleData);
        } catch {
          // Article fetch may 404 or fail — that's fine
        }
      }

      // Notify caller this story is now cached
      if (onStoryPrefetched) {
        onStoryPrefetched(story.id);
      }
    } catch {
      // Network error for this story — continue with others
    }
  }));
}

/**
 * Full sync: fetch stories, save to IndexedDB, then prefetch comments/articles.
 * Returns the fresh stories data.
 */
export async function syncStories(page = 1) {
  const data = await api.getStories(page);
  const stories = data.stories || [];

  // Save stories to IndexedDB
  if (stories.length > 0) {
    await db.putStories(stories);
  }

  // Update sync timestamp
  await db.setSyncMeta('last_stories_fetch', Math.floor(Date.now() / 1000));

  return data;
}

/**
 * Run on app open: eviction + sync.
 */
export async function onAppOpen() {
  try {
    await db.runEviction();
  } catch {
    // Eviction failure shouldn't block the app
  }
}
