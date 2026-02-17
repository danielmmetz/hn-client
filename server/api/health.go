package api

import (
	"net/http"

	"hn-client/server/store"
)

type HealthHandler struct {
	stories *store.StoryStore
}

func NewHealthHandler(stories *store.StoryStore) *HealthHandler {
	return &HealthHandler{stories: stories}
}

func (h *HealthHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	resp := map[string]interface{}{
		"status":        "ok",
		"stories_count": h.stories.Count(),
		"last_poll":     h.stories.LastPollTime(),
	}
	writeJSON(w, r, resp)
}
