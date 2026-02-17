package api

import (
	"crypto/md5"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"

	"github.com/danielmmetz/hn-client/server/store"
	"github.com/danielmmetz/hn-client/server/worker"
)

type StoriesHandler struct {
	stories  *store.StoryStore
	rankings *store.RankingStore
	topList  *store.TopList
	fetcher  *worker.Fetcher
}

func NewStoriesHandler(stories *store.StoryStore, rankings *store.RankingStore, topList *store.TopList, fetcher *worker.Fetcher) *StoriesHandler {
	return &StoriesHandler{stories: stories, rankings: rankings, topList: topList, fetcher: fetcher}
}

// ListStories handles GET /api/stories?page=N
func (h *StoriesHandler) ListStories(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	page := 1
	if p := r.URL.Query().Get("page"); p != "" {
		if n, err := strconv.Atoi(p); err == nil && n > 0 {
			page = n
		}
	}

	pageSize := 30

	// Try TopList first
	pageIDs, total := h.topList.Page(page, pageSize)
	if total > 0 {
		h.serveFromTopList(w, r, page, pageIDs, total)
		return
	}

	// Fallback: TopList not yet populated, use rank-based query
	stories, total, err := h.stories.ListByRank(ctx, page)
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}

	if stories == nil {
		stories = []store.Story{}
	}

	resp := map[string]interface{}{
		"stories":  stories,
		"page":     page,
		"total":    total,
		"complete": true,
	}

	writeJSON(w, r, resp)
}

// serveFromTopList loads stories for the given page IDs from DB, fetching missing ones on-demand.
func (h *StoriesHandler) serveFromTopList(w http.ResponseWriter, r *http.Request, page int, pageIDs []int, total int) {
	ctx := r.Context()

	// Batch-load from DB
	storyMap, err := h.stories.GetByIDs(ctx, pageIDs)
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}

	// Find missing IDs and fetch on-demand (metadata only)
	for _, id := range pageIDs {
		if _, ok := storyMap[id]; !ok {
			if fetchErr := h.fetcher.FetchStorySingleflight(ctx, id); fetchErr != nil {
				slog.Error("on-demand fetch failed", "story_id", id, "error", fetchErr)
				continue
			}
			// Reload from DB
			if st, getErr := h.stories.GetByID(ctx, id); getErr == nil && st != nil {
				storyMap[st.ID] = st
			}
		}
	}

	// Build ordered result
	pageSize := 30
	stories := make([]store.Story, 0, len(pageIDs))
	for i, id := range pageIDs {
		if st, ok := storyMap[id]; ok {
			// Set rank for client-side display
			rank := (page-1)*pageSize + i + 1
			st.Rank = &rank
			stories = append(stories, *st)
		}
	}

	resp := map[string]interface{}{
		"stories":  stories,
		"page":     page,
		"total":    total,
		"complete": true,
	}

	writeJSON(w, r, resp)
}

// GetStory handles GET /api/stories/{id}
func (h *StoriesHandler) GetStory(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	id, err := strconv.Atoi(r.PathValue("id"))
	if err != nil {
		http.Error(w, "invalid id", http.StatusBadRequest)
		return
	}

	story, err := h.stories.GetByID(ctx, id)
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}

	// On-demand fetch if not in DB
	if story == nil {
		if fetchErr := h.fetcher.FetchStorySingleflight(ctx, id); fetchErr != nil {
			slog.Error("on-demand fetch failed", "story_id", id, "error", fetchErr)
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
		story, err = h.stories.GetByID(ctx, id)
		if err != nil {
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}
		if story == nil {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
	}

	writeJSON(w, r, story)
}

// TopStories handles GET /api/stories/top?period=day|yesterday|week&page=1
func (h *StoriesHandler) TopStories(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	period := r.URL.Query().Get("period")
	switch period {
	case "day", "yesterday", "week":
	default:
		http.Error(w, "invalid period: must be day, yesterday, or week", http.StatusBadRequest)
		return
	}

	page := 1
	if p := r.URL.Query().Get("page"); p != "" {
		if n, err := strconv.Atoi(p); err == nil && n > 0 {
			page = n
		}
	}

	stories, total, err := h.rankings.GetByPeriod(ctx, period, page)
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}

	if stories == nil {
		stories = []store.Story{}
	}

	resp := map[string]interface{}{
		"stories": stories,
		"page":    page,
		"total":   total,
		"period":  period,
	}

	writeJSON(w, r, resp)
}

func writeJSON(w http.ResponseWriter, r *http.Request, data interface{}) {
	body, err := json.Marshal(data)
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}

	etag := fmt.Sprintf(`"%x"`, md5.Sum(body))

	if match := r.Header.Get("If-None-Match"); match == etag {
		w.WriteHeader(http.StatusNotModified)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("ETag", etag)
	w.Write(body)
}
