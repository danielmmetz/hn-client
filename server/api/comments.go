package api

import (
	"database/sql"
	"log/slog"
	"net/http"
	"strconv"

	"github.com/danielmmetz/hn-client/server/hn"
	"github.com/danielmmetz/hn-client/server/store"
	"github.com/danielmmetz/hn-client/server/worker"
)

type CommentsHandler struct {
	db       *sql.DB
	q        *store.Queries
	fetcher  *worker.Fetcher
	hnClient *hn.Client
}

func NewCommentsHandler(db *sql.DB, q *store.Queries, fetcher *worker.Fetcher, hnClient *hn.Client) *CommentsHandler {
	return &CommentsHandler{db: db, q: q, fetcher: fetcher, hnClient: hnClient}
}

// GetComments handles GET /api/stories/{id}/comments
func (h *CommentsHandler) GetComments(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	id, err := strconv.Atoi(r.PathValue("id"))
	if err != nil {
		http.Error(w, "invalid id", http.StatusBadRequest)
		return
	}

	comments, fetchedAt, err := store.GetCommentTree(ctx, h.db, h.q, id)
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}

	// On-demand fetch if no comments and story has descendants > 0
	if len(comments) == 0 {
		story, storyErr := store.Nullable(h.q.GetStoryByID(ctx, h.db, id))
		if storyErr == nil && story != nil && story.Descendants > 0 {
			item, itemErr := h.hnClient.GetItem(ctx, id)
			if itemErr == nil && item != nil && len(item.Kids) > 0 {
				if fetchErr := h.fetcher.FetchCommentsSingleflight(ctx, id, item.Kids); fetchErr != nil {
					slog.Error("on-demand comment fetch failed", "story_id", id, "error", fetchErr)
				} else {
					comments, fetchedAt, err = store.GetCommentTree(ctx, h.db, h.q, id)
					if err != nil {
						http.Error(w, "internal error", http.StatusInternalServerError)
						return
					}
				}
			}
		}
	}

	if comments == nil {
		comments = []*store.CommentNode{}
	}

	resp := map[string]interface{}{
		"story_id":   id,
		"fetched_at": fetchedAt,
		"comments":   comments,
	}

	writeJSON(w, r, resp)
}
