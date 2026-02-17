import { getSyncMeta, setSyncMeta } from './db';

/**
 * SSE client that connects to /api/events with Last-Event-ID support.
 * Encapsulated in a class for testability and clean lifecycle management.
 */
class SSEClient {
  constructor() {
    this.eventSource = null;
    this.lastEventId = null;
    this.listeners = new Map(); // eventType -> Set<callback>
  }

  /**
   * Register a listener for an SSE event type.
   * Supports exact match (e.g., "stories_updated") and
   * parameterized types (e.g., "comments_updated:12345").
   * Returns an unsubscribe function.
   */
  on(eventType, callback) {
    if (!this.listeners.has(eventType)) {
      this.listeners.set(eventType, new Set());
    }
    this.listeners.get(eventType).add(callback);
    return () => {
      const set = this.listeners.get(eventType);
      if (set) {
        set.delete(callback);
        if (set.size === 0) this.listeners.delete(eventType);
      }
    };
  }

  _emit(eventType, data) {
    const set = this.listeners.get(eventType);
    if (set) {
      for (const cb of set) {
        try { cb(data); } catch (e) { console.error('SSE listener error:', e); }
      }
    }
  }

  _emitParameterized(eventType, data) {
    this._emit(eventType, data);
    if (data && data.story_id) {
      this._emit(`${eventType}:${data.story_id}`, data);
    }
  }

  _handleEvent = (event) => {
    if (event.lastEventId) {
      this.lastEventId = event.lastEventId;
      setSyncMeta('last_event_id', this.lastEventId).catch(() => {});
    }

    let data;
    try {
      data = JSON.parse(event.data);
    } catch {
      data = event.data;
    }

    this._emitParameterized(event.type, data);
  };

  /**
   * Connect to the SSE endpoint. Safe to call multiple times (reconnects).
   */
  async connect() {
    // Load last event ID from IndexedDB
    if (this.lastEventId === null) {
      try {
        const stored = await getSyncMeta('last_event_id');
        if (stored) this.lastEventId = String(stored);
      } catch {
        // ignore
      }
    }

    this.disconnect();

    const url = '/api/events';
    this.eventSource = new EventSource(url);

    if (this.lastEventId) {
      this.eventSource.close();
      this.eventSource = new EventSource(`${url}?lastEventId=${this.lastEventId}`);
    }

    this.eventSource.addEventListener('stories_updated', this._handleEvent);
    this.eventSource.addEventListener('sync_required', this._handleEvent);
    this.eventSource.addEventListener('comments_updated', this._handleEvent);
    this.eventSource.addEventListener('story_refreshed', this._handleEvent);

    this.eventSource.onerror = () => {
      // EventSource automatically reconnects. The browser handles this.
    };
  }

  /**
   * Disconnect from the SSE endpoint.
   */
  disconnect() {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
  }

  /**
   * Check if the SSE connection is currently open.
   */
  isConnected() {
    return this.eventSource && this.eventSource.readyState !== EventSource.CLOSED;
  }

  /**
   * Reset all state — useful for testing.
   */
  reset() {
    this.disconnect();
    this.lastEventId = null;
    this.listeners.clear();
  }
}

// Default singleton instance for app use
const defaultClient = new SSEClient();

// Named exports preserve the existing API
export const on = (eventType, callback) => defaultClient.on(eventType, callback);
export const connect = () => defaultClient.connect();
export const disconnect = () => defaultClient.disconnect();
export const isConnected = () => defaultClient.isConnected();

// Also export the class and instance for testing / advanced use
export { SSEClient };
export default defaultClient;
