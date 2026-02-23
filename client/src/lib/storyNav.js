import { useKeyboardShortcuts, ensureVisible } from './keyboard';

/**
 * Find the next/previous story index relative to the current one.
 * Returns the target story id, or null if no move is possible.
 */
function stepStory(stories, currentId, direction) {
  if (!stories || stories.length === 0) return null;
  const idx = stories.findIndex((s) => s.id === currentId);
  if (direction > 0) {
    const next = idx < 0 ? 0 : Math.min(idx + 1, stories.length - 1);
    return stories[next].id;
  } else {
    const prev = idx <= 0 ? 0 : idx - 1;
    return stories[prev].id;
  }
}

/**
 * Open the URL of the given story in a new tab.
 */
function openStoryLink(stories, storyId) {
  if (!storyId) return;
  const story = stories && stories.find((s) => s.id === storyId);
  if (story && story.url) {
    window.open(story.url, '_blank', 'noopener,noreferrer');
  }
}

/**
 * Keyboard shortcuts for wide (split) layout:
 *   J/K — step through stories in sidebar
 *   r/c — switch reader/comments mode
 *   v   — open story link in new tab
 */
export function useSplitShortcuts({ selectedId, storiesRef, setReaderMode }) {
  useKeyboardShortcuts({
    r: () => { if (selectedId) setReaderMode(true); },
    c: () => { if (selectedId) setReaderMode(false); },
    v: () => openStoryLink(storiesRef.current, selectedId),
    J: (e) => {
      e.preventDefault();
      const targetId = stepStory(storiesRef.current, selectedId, 1);
      if (targetId != null) {
        window.location.hash = `#/story/${targetId}`;
        const el = document.querySelector(`.split-sidebar [data-story-id="${targetId}"]`);
        if (el) ensureVisible(el);
      }
    },
    K: (e) => {
      e.preventDefault();
      const targetId = stepStory(storiesRef.current, selectedId, -1);
      if (targetId != null) {
        window.location.hash = `#/story/${targetId}`;
        const el = document.querySelector(`.split-sidebar [data-story-id="${targetId}"]`);
        if (el) ensureVisible(el);
      }
    },
  });
}

/**
 * Keyboard shortcuts for narrow (mobile) layout:
 *   J/K — step through stories (navigates to story detail)
 *   r/c — switch between reader and comments views
 *   h   — go back to list view
 *   v   — open story link in new tab
 */
export function useNarrowShortcuts({ route, storiesRef, listBackHash }) {
  const activeId = (route.page === 'story' || route.page === 'article') ? Number(route.id) : null;

  useKeyboardShortcuts({
    J: (e) => {
      if (route.page !== 'home' && route.page !== 'top' && route.page !== 'story' && route.page !== 'article') return;
      e.preventDefault();
      const stories = storiesRef.current;
      if (!stories || stories.length === 0) return;
      if (!activeId) {
        window.location.hash = `#/story/${stories[0].id}`;
      } else {
        const targetId = stepStory(stories, activeId, 1);
        if (targetId != null && targetId !== activeId) {
          window.location.hash = `#/story/${targetId}`;
        }
      }
    },
    K: (e) => {
      if (route.page !== 'story' && route.page !== 'article') return;
      e.preventDefault();
      const targetId = stepStory(storiesRef.current, activeId, -1);
      if (targetId != null && targetId !== activeId) {
        window.location.hash = `#/story/${targetId}`;
      }
    },
    r: () => {
      if (route.page === 'story') {
        window.location.hash = `#/article/${route.id}`;
      }
    },
    c: () => {
      if (route.page === 'article') {
        window.location.hash = `#/story/${route.id}`;
      }
    },
    h: () => {
      if (route.page === 'story' || route.page === 'article') {
        window.location.hash = listBackHash;
      }
    },
    v: () => openStoryLink(storiesRef.current, activeId),
  });
}
