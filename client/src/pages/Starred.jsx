import { useState, useEffect } from 'preact/hooks';
import { getAllStars, getStoryFromDB } from '../lib/db';
import { StoryItem } from '../components/StoryItem';

export function Starred() {
  const [stories, setStories] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const stars = await getAllStars();
        // Sort by starred_at descending (most recent first)
        stars.sort((a, b) => b.starred_at - a.starred_at);

        const storyPromises = stars.map((s) => getStoryFromDB(s.story_id));
        const storyData = await Promise.all(storyPromises);
        if (cancelled) return;

        // Filter out any stories that were evicted but somehow still starred
        setStories(storyData.filter(Boolean));
      } catch {
        // ignore
      }
      setLoading(false);
    }

    load();
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return <div class="page-loading">Loading starred stories…</div>;
  }

  if (stories.length === 0) {
    return (
      <div class="starred-page">
        <h2>Starred Stories</h2>
        <p class="starred-empty">No starred stories yet. Star stories from their detail pages.</p>
      </div>
    );
  }

  return (
    <div class="starred-page">
      <h2 class="starred-title">Starred Stories</h2>
      <div class="story-list">
        {stories.map((story, i) => (
          <StoryItem key={story.id} story={story} rank={i + 1} starred={true} />
        ))}
      </div>
    </div>
  );
}
