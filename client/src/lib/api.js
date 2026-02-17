import * as db from './db';

const BASE = '/api';

async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`API error: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

/**
 * Network-first fetch for stories with IndexedDB fallback.
 * Returns { stories, fetched_at, offline }
 */
export async function getStories(page = 1) {
  try {
    const data = await fetchJSON(`${BASE}/stories?page=${page}`);
    // Save to IndexedDB in background
    const stories = data.stories || [];
    if (stories.length > 0) {
      db.putStories(stories).catch(() => {});
      db.setSyncMeta('last_stories_fetch', Math.floor(Date.now() / 1000)).catch(() => {});
    }
    return data;
  } catch (err) {
    // Network failed — try IndexedDB
    const cached = await db.getStoriesFromDB(page);
    if (cached && cached.length > 0) {
      const fetchedAt = await db.getSyncMeta('last_stories_fetch');
      return { stories: cached, fetched_at: fetchedAt, offline: true };
    }
    throw err; // No cache either
  }
}

export async function getTopStories(period = 'day', page = 1) {
  return fetchJSON(`${BASE}/stories/top?period=${period}&page=${page}`);
}

/**
 * Network-first fetch for a single story with IndexedDB fallback.
 */
export async function getStory(id) {
  try {
    const data = await fetchJSON(`${BASE}/stories/${id}`);
    // Cache in background
    db.putStories([data]).catch(() => {});
    return data;
  } catch (err) {
    const cached = await db.getStoryFromDB(id);
    if (cached) return cached;
    throw err;
  }
}

/**
 * Network-first fetch for article with IndexedDB fallback.
 */
export async function getArticle(id) {
  try {
    const data = await fetchJSON(`${BASE}/stories/${id}/article`);
    // Cache in background
    db.putArticle(id, data).catch(() => {});
    return data;
  } catch (err) {
    const cached = await db.getArticleFromDB(id);
    if (cached) return cached;
    throw err;
  }
}

/**
 * Network-first fetch for comments with IndexedDB fallback.
 */
export async function getComments(id) {
  try {
    const data = await fetchJSON(`${BASE}/stories/${id}/comments`);
    // Cache in background
    db.putComments(id, data).catch(() => {});
    return data;
  } catch (err) {
    const cached = await db.getCommentsFromDB(id);
    if (cached) return cached;
    throw err;
  }
}

export async function refreshStory(id, { article = false } = {}) {
  const url = `${BASE}/stories/${id}/refresh${article ? '?article=true' : ''}`;
  const res = await fetch(url, { method: 'POST' });
  if (!res.ok) {
    throw new Error(`Refresh error: ${res.status}`);
  }
  return res.json();
}

export function getHealth() {
  return fetchJSON(`${BASE}/health`);
}
