import { openDB } from 'idb';

const DB_NAME = 'hn-reader';
const DB_VERSION = 1;

let dbPromise;

function getDB() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        // Stories store
        const stories = db.createObjectStore('stories', { keyPath: 'id' });
        stories.createIndex('fetched_at', 'fetched_at');

        // Articles store
        db.createObjectStore('articles', { keyPath: 'story_id' });

        // Comments store
        const comments = db.createObjectStore('comments', { keyPath: 'story_id' });
        // We store the entire comment tree per story (keyed by story_id)

        // Stars store
        db.createObjectStore('stars', { keyPath: 'story_id' });

        // Sync metadata store
        db.createObjectStore('sync_meta', { keyPath: 'name' });
      },
    });
  }
  return dbPromise;
}

// --- Stories ---

export async function putStories(stories) {
  const db = await getDB();
  const tx = db.transaction('stories', 'readwrite');
  const now = Math.floor(Date.now() / 1000);
  for (const story of stories) {
    await tx.store.put({ ...story, fetched_at: story.fetched_at || now });
  }
  await tx.done;
}

export async function getStoriesFromDB(page = 1) {
  const db = await getDB();
  const all = await db.getAll('stories');
  // Sort by rank (ascending), then by score (descending) for unranked
  all.sort((a, b) => {
    if (a.rank != null && b.rank != null) return a.rank - b.rank;
    if (a.rank != null) return -1;
    if (b.rank != null) return 1;
    return (b.score || 0) - (a.score || 0);
  });
  const start = (page - 1) * 30;
  return all.slice(start, start + 30);
}

export async function getStoryFromDB(id) {
  const db = await getDB();
  return db.get('stories', Number(id));
}

// --- Articles ---

export async function putArticle(storyId, article) {
  const db = await getDB();
  const now = Math.floor(Date.now() / 1000);
  await db.put('articles', { ...article, story_id: Number(storyId), fetched_at: article.fetched_at || now });
}

export async function getArticleFromDB(storyId) {
  const db = await getDB();
  return db.get('articles', Number(storyId));
}

// --- Comments (stored as full tree per story) ---

export async function putComments(storyId, commentsData) {
  const db = await getDB();
  const now = Math.floor(Date.now() / 1000);
  await db.put('comments', {
    story_id: Number(storyId),
    comments: commentsData.comments || [],
    fetched_at: commentsData.fetched_at || now,
  });
}

export async function getCommentsFromDB(storyId) {
  const db = await getDB();
  return db.get('comments', Number(storyId));
}

// --- Stars ---

export async function starStory(storyId) {
  const db = await getDB();
  await db.put('stars', { story_id: Number(storyId), starred_at: Math.floor(Date.now() / 1000) });
}

export async function unstarStory(storyId) {
  const db = await getDB();
  await db.delete('stars', Number(storyId));
}

export async function isStarred(storyId) {
  const db = await getDB();
  const star = await db.get('stars', Number(storyId));
  return !!star;
}

export async function getAllStars() {
  const db = await getDB();
  return db.getAll('stars');
}

export async function getStarredStoryIds() {
  const db = await getDB();
  const stars = await db.getAll('stars');
  return new Set(stars.map((s) => s.story_id));
}

export async function getCachedStoryIds(storyIds) {
  const db = await getDB();
  const cached = new Set();
  for (const id of storyIds) {
    const entry = await db.get('comments', Number(id));
    if (entry) cached.add(Number(id));
  }
  return cached;
}

// --- Sync Meta ---

export async function setSyncMeta(name, timestamp) {
  const db = await getDB();
  await db.put('sync_meta', { name, timestamp });
}

export async function getSyncMeta(name) {
  const db = await getDB();
  const meta = await db.get('sync_meta', name);
  return meta ? meta.timestamp : null;
}

// --- Cache Eviction ---

export async function runEviction() {
  const db = await getDB();
  const now = Math.floor(Date.now() / 1000);
  const maxAge = 24 * 60 * 60; // 24 hours
  const cutoff = now - maxAge;

  // Get starred story IDs (exempt from eviction)
  const starredIds = await getStarredStoryIds();

  // Get all stories
  const allStories = await db.getAll('stories');

  // Find stories to evict: non-starred AND older than 24h
  const toEvict = allStories
    .filter((s) => !starredIds.has(s.id) && s.fetched_at < cutoff)
    .map((s) => s.id);

  if (toEvict.length > 0) {
    const tx = db.transaction(['stories', 'articles', 'comments'], 'readwrite');
    for (const id of toEvict) {
      tx.objectStore('stories').delete(id);
      tx.objectStore('articles').delete(id);
      tx.objectStore('comments').delete(id);
    }
    await tx.done;
  }

  // Size-based eviction: if still over 200MB, delete oldest non-starred
  if (navigator.storage && navigator.storage.estimate) {
    const estimate = await navigator.storage.estimate();
    const usedMB = (estimate.usage || 0) / (1024 * 1024);
    if (usedMB > 200) {
      const remaining = await db.getAll('stories');
      const nonStarred = remaining
        .filter((s) => !starredIds.has(s.id))
        .sort((a, b) => a.fetched_at - b.fetched_at); // oldest first

      const tx2 = db.transaction(['stories', 'articles', 'comments'], 'readwrite');
      for (const story of nonStarred) {
        // Re-check if under budget
        const est = await navigator.storage.estimate();
        if ((est.usage || 0) / (1024 * 1024) <= 200) break;
        tx2.objectStore('stories').delete(story.id);
        tx2.objectStore('articles').delete(story.id);
        tx2.objectStore('comments').delete(story.id);
      }
      await tx2.done;
    }
  }
}
