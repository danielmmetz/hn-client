package api

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"strconv"
	"sync"
	"time"

	"hn-client/server/hn"
	"hn-client/server/readability"
	"hn-client/server/sse"
	"hn-client/server/store"
	"hn-client/server/worker"
)

const (
	rateLimitWindow   = 30 * time.Second
	rateLimitCapacity = 10000 // max entries before forced sweep
	rateLimitSweepAge = 60 * time.Second
)

type RefreshHandler struct {
	fetcher  *worker.Fetcher
	hnClient *hn.Client
	stories  *store.StoryStore
	articles *store.ArticleStore
	broker   *sse.Broker

	mu        sync.Mutex
	lastFetch map[int]time.Time // rate limit tracking (bounded with TTL eviction)
}

func NewRefreshHandler(fetcher *worker.Fetcher, hnClient *hn.Client, stories *store.StoryStore, articles *store.ArticleStore, broker *sse.Broker) *RefreshHandler {
	return &RefreshHandler{
		fetcher:   fetcher,
		hnClient:  hnClient,
		stories:   stories,
		articles:  articles,
		broker:    broker,
		lastFetch: make(map[int]time.Time),
	}
}

// Refresh handles POST /api/stories/{id}/refresh
func (h *RefreshHandler) Refresh(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.Atoi(r.PathValue("id"))
	if err != nil {
		http.Error(w, "invalid id", http.StatusBadRequest)
		return
	}

	// Rate limit: 1 request per story per 30 seconds (with periodic eviction)
	h.mu.Lock()
	now := time.Now()

	// Evict stale entries when map gets large
	if len(h.lastFetch) > rateLimitCapacity {
		h.sweepLocked(now)
	}

	if last, ok := h.lastFetch[id]; ok && now.Sub(last) < rateLimitWindow {
		h.mu.Unlock()
		http.Error(w, "rate limited — retry after 30s", http.StatusTooManyRequests)
		return
	}
	h.lastFetch[id] = now
	h.mu.Unlock()

	reExtract := r.URL.Query().Get("article") == "true"

	// Return 202 immediately, do work in background
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusAccepted)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status":   "accepted",
		"story_id": id,
	})

	// Background work uses a detached context (not tied to the request)
	go h.doRefresh(context.Background(), id, reExtract)
}

// sweepLocked removes entries older than rateLimitSweepAge. Must be called with h.mu held.
func (h *RefreshHandler) sweepLocked(now time.Time) {
	for id, t := range h.lastFetch {
		if now.Sub(t) > rateLimitSweepAge {
			delete(h.lastFetch, id)
		}
	}
}

func (h *RefreshHandler) doRefresh(ctx context.Context, id int, reExtract bool) {
	// Fetch story + comments (handles unknown stories on-demand)
	if err := h.fetcher.FetchStoryWithComments(ctx, id, nil); err != nil {
		slog.Error("refresh: error fetching story", "story_id", id, "error", err)
		return
	}

	// Re-extract article if requested
	if reExtract {
		story, err := h.stories.GetByID(ctx, id)
		if err != nil || story == nil {
			slog.Warn("refresh: cannot find story for article extraction", "story_id", id)
		} else if story.URL != nil {
			h.extractArticle(ctx, id, *story.URL)
		}
	}

	// Publish SSE events
	now := time.Now().Unix()
	data, _ := json.Marshal(map[string]interface{}{
		"story_id":  id,
		"timestamp": now,
	})
	h.broker.Publish("story_refreshed", string(data))

	commentsData, _ := json.Marshal(map[string]interface{}{
		"story_id":  id,
		"timestamp": now,
	})
	h.broker.Publish("comments_updated", string(commentsData))
}

func (h *RefreshHandler) extractArticle(ctx context.Context, storyID int, url string) {
	now := store.NowUnix()
	article, err := readability.Extract(ctx, url)
	if err != nil {
		slog.Error("refresh: article extraction failed", "story_id", storyID, "error", err)
		h.articles.Upsert(ctx, &store.Article{
			StoryID:          storyID,
			ExtractionFailed: true,
			FetchedAt:        now,
		})
		return
	}

	h.articles.Upsert(ctx, &store.Article{
		StoryID:          storyID,
		Content:          &article.Content,
		Title:            &article.Title,
		Excerpt:          &article.Excerpt,
		Byline:           &article.Byline,
		ExtractionFailed: false,
		FetchedAt:        now,
	})
}
