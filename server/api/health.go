package api

import (
	"database/sql"
	"net/http"

	"github.com/danielmmetz/hn-client/server/store"
)

type HealthHandler struct {
	db *sql.DB
	q  *store.Queries
}

func NewHealthHandler(db *sql.DB, q *store.Queries) *HealthHandler {
	return &HealthHandler{db: db, q: q}
}

func (h *HealthHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	count, _ := h.q.CountStories(r.Context(), h.db)
	maxFetched, _ := h.q.MaxFetchedAt(r.Context(), h.db)

	resp := map[string]interface{}{
		"status":        "ok",
		"stories_count": count,
		"last_poll":     maxFetched,
	}
	writeJSON(w, r, resp)
}
