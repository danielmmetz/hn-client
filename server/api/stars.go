package api

import (
	"database/sql"
	"encoding/json"
	"log/slog"
	"net/http"

	"github.com/danielmmetz/hn-client/server/store"
)

type StarsHandler struct {
	db *sql.DB
	q  *store.Queries
}

func NewStarsHandler(db *sql.DB, q *store.Queries) *StarsHandler {
	return &StarsHandler{db: db, q: q}
}

type starChange struct {
	StoryID   int    `json:"story_id"`
	Action    string `json:"action"`
	Timestamp int64  `json:"timestamp"`
}

type syncRequest struct {
	Changes []starChange `json:"changes"`
}

type starEntry struct {
	StoryID   int   `json:"story_id"`
	StarredAt int64 `json:"starred_at"`
}

type syncResponse struct {
	Stars []starEntry `json:"stars"`
}

func (h *StarsHandler) Sync(w http.ResponseWriter, r *http.Request) {
	userSub, err := GetUserSub(r, h.db, h.q)
	if err != nil {
		http.Error(w, `{"error":"not authenticated"}`, http.StatusUnauthorized)
		return
	}

	var req syncRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"error":"invalid request body"}`, http.StatusBadRequest)
		return
	}

	tx, err := h.db.Begin()
	if err != nil {
		slog.Error("stars sync: begin tx", "error", err)
		http.Error(w, `{"error":"internal error"}`, http.StatusInternalServerError)
		return
	}
	defer tx.Rollback()

	for _, c := range req.Changes {
		existing, err := store.Nullable(h.q.GetStar(r.Context(), tx, store.GetStarParams{
			UserSub: userSub,
			StoryID: c.StoryID,
		}))
		if err != nil {
			slog.Error("stars sync: get star", "error", err)
			http.Error(w, `{"error":"internal error"}`, http.StatusInternalServerError)
			return
		}

		switch c.Action {
		case "star":
			if existing == nil {
				// No row → insert
				if err := h.q.UpsertStar(r.Context(), tx, store.UpsertStarParams{
					UserSub: userSub, StoryID: c.StoryID, StarredAt: c.Timestamp,
				}); err != nil {
					slog.Error("stars sync: insert star", "error", err)
					http.Error(w, `{"error":"internal error"}`, http.StatusInternalServerError)
					return
				}
			} else if c.Timestamp > existing.StarredAt {
				// Newer → update
				if err := h.q.UpsertStar(r.Context(), tx, store.UpsertStarParams{
					UserSub: userSub, StoryID: c.StoryID, StarredAt: c.Timestamp,
				}); err != nil {
					slog.Error("stars sync: update star", "error", err)
					http.Error(w, `{"error":"internal error"}`, http.StatusInternalServerError)
					return
				}
			}
			// else no-op
		case "unstar":
			if existing != nil && c.Timestamp > existing.StarredAt {
				if err := h.q.DeleteStar(r.Context(), tx, store.DeleteStarParams{
					UserSub: userSub, StoryID: c.StoryID,
				}); err != nil {
					slog.Error("stars sync: delete star", "error", err)
					http.Error(w, `{"error":"internal error"}`, http.StatusInternalServerError)
					return
				}
			}
			// else no-op
		}
	}

	// Fetch all stars for user
	allStars, err := h.q.ListStarsByUser(r.Context(), tx, userSub)
	if err != nil {
		slog.Error("stars sync: list stars", "error", err)
		http.Error(w, `{"error":"internal error"}`, http.StatusInternalServerError)
		return
	}

	if err := tx.Commit(); err != nil {
		slog.Error("stars sync: commit", "error", err)
		http.Error(w, `{"error":"internal error"}`, http.StatusInternalServerError)
		return
	}

	resp := syncResponse{Stars: make([]starEntry, len(allStars))}
	for i, s := range allStars {
		resp.Stars[i] = starEntry{StoryID: s.StoryID, StarredAt: s.StarredAt}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}
