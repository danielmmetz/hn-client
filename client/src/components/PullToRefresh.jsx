import { useState, useRef, useCallback, useEffect } from 'preact/hooks';

const THRESHOLD = 60; // px to pull before triggering refresh
const MAX_PULL = 100; // max pull distance

export function hasTouchSupport() {
  if (typeof window === 'undefined') return false;
  return 'ontouchstart' in window || navigator.maxTouchPoints > 0;
}

/**
 * Refresh button for non-touch devices.
 */
export function RefreshButton({ onRefresh, refreshing, class: className }) {
  return (
    <button
      class={`ptr-btn ${className || ''}`}
      onClick={onRefresh}
      disabled={refreshing}
    >
      {refreshing ? '↻ Refreshing…' : '↻ Refresh'}
    </button>
  );
}

/**
 * Pull-to-refresh wrapper component.
 * On touch devices: adds touch gesture support for pulling down to refresh.
 * On non-touch devices: just renders children (use RefreshButton separately).
 */
export function PullToRefresh({ onRefresh, refreshing: externalRefreshing, children }) {
  const [pulling, setPulling] = useState(false);
  const [pullDistance, setPullDistance] = useState(0);
  const [internalRefreshing, setInternalRefreshing] = useState(false);
  const [isTouch, setIsTouch] = useState(true); // default true to avoid flash
  const startY = useRef(0);
  const currentY = useRef(0);
  const isPulling = useRef(false);

  const refreshing = externalRefreshing || internalRefreshing;

  useEffect(() => {
    setIsTouch(hasTouchSupport());
  }, []);

  const handleTouchStart = useCallback((e) => {
    if (window.scrollY > 0) return;
    startY.current = e.touches[0].clientY;
    isPulling.current = false;
  }, []);

  const handleTouchMove = useCallback((e) => {
    if (refreshing) return;
    if (window.scrollY > 0) return;

    currentY.current = e.touches[0].clientY;
    const diff = currentY.current - startY.current;

    if (diff > 10) {
      if (!isPulling.current) {
        isPulling.current = true;
        setPulling(true);
      }

      const distance = Math.min(MAX_PULL, diff * 0.5);
      setPullDistance(distance);

      if (diff > 0 && window.scrollY === 0) {
        e.preventDefault();
      }
    }
  }, [refreshing]);

  const handleTouchEnd = useCallback(async () => {
    if (!isPulling.current) return;

    isPulling.current = false;

    if (pullDistance >= THRESHOLD && onRefresh) {
      setInternalRefreshing(true);
      setPullDistance(THRESHOLD * 0.6);
      try {
        await onRefresh();
      } catch {
        // ignore
      }
      setInternalRefreshing(false);
    }

    setPulling(false);
    setPullDistance(0);
  }, [pullDistance, onRefresh]);

  const triggered = pullDistance >= THRESHOLD;

  if (!isTouch) {
    // Non-touch: just render children, button placed by parent
    return (
      <div class="pull-to-refresh">
        {children}
      </div>
    );
  }

  return (
    <div
      class="pull-to-refresh"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      <div
        class={`ptr-indicator ${pulling || refreshing ? 'ptr-active' : ''} ${triggered ? 'ptr-triggered' : ''} ${refreshing ? 'ptr-refreshing' : ''}`}
        style={{ height: `${pulling || refreshing ? Math.max(pullDistance, refreshing ? 36 : 0) : 0}px` }}
      >
        <div class="ptr-spinner">
          {refreshing ? '↻' : triggered ? '↓' : '↓'}
        </div>
        <span class="ptr-text">
          {refreshing ? 'Refreshing…' : triggered ? 'Release to refresh' : 'Pull to refresh'}
        </span>
      </div>
      {children}
    </div>
  );
}
