import { useEffect, useRef } from 'preact/hooks';

/**
 * Ensure an element is visible within its nearest scrollable ancestor,
 * accounting for sticky headers. Falls back to viewport if no scroll parent.
 */
export function ensureVisible(el, { margin = 8 } = {}) {
  const scrollParent = getScrollParent(el);
  const headerHeight = getHeaderHeight();

  if (!scrollParent || scrollParent === document.documentElement || scrollParent === document.body) {
    // Scrolling the window — account for sticky header
    const rect = el.getBoundingClientRect();
    const top = headerHeight + margin;
    const bottom = window.innerHeight - margin;

    // Scroll to show the full element; prioritize top if element is taller than viewport
    if (rect.top < top) {
      window.scrollBy(0, rect.top - top);
    }
    if (rect.bottom > bottom) {
      window.scrollBy(0, rect.bottom - bottom);
    }
  } else {
    // Scrolling within a container
    const containerRect = scrollParent.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    const visibleTop = Math.max(containerRect.top, headerHeight) + margin;
    const visibleBottom = containerRect.bottom - margin;

    // Scroll to show the full element; prioritize top if element is taller than visible area
    if (elRect.bottom > visibleBottom) {
      scrollParent.scrollTop += (elRect.bottom - visibleBottom);
    }
    if (elRect.top < visibleTop) {
      scrollParent.scrollTop -= (visibleTop - elRect.top);
    }
  }
}

function getScrollParent(el) {
  let node = el.parentElement;
  while (node) {
    const overflow = getComputedStyle(node).overflowY;
    if (overflow === 'auto' || overflow === 'scroll') return node;
    node = node.parentElement;
  }
  return null;
}

function getHeaderHeight() {
  const header = document.querySelector('.app-header');
  return header ? header.getBoundingClientRect().height : 0;
}

/**
 * Hook that registers keyboard shortcuts.
 *
 * @param {Object} shortcuts — map of key to handler.
 *   Keys are event.key values, e.g. 'j', 'J', 'x', '?'.
 *   Handlers receive the KeyboardEvent.
 * @param {Array} deps — extra dependencies to re-bind when changed.
 */
export function useKeyboardShortcuts(shortcuts, deps = []) {
  const ref = useRef(shortcuts);
  ref.current = shortcuts;

  useEffect(() => {
    function handler(e) {
      // Ignore when typing in form fields
      const tag = e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.target.isContentEditable) return;

      // Ignore when modifier keys are held (except Shift, which we use for J/K)
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      const fn = ref.current[e.key];
      if (fn) {
        fn(e);
      }
    }

    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, deps);
}
