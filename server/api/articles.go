package api

import (
	"database/sql"
	"log/slog"
	"net/http"
	"strconv"

	"github.com/danielmmetz/hn-client/server/store"
	"github.com/danielmmetz/hn-client/server/worker"
)

type ArticlesHandler struct {
	db      *sql.DB
	q       *store.Queries
	fetcher *worker.Fetcher
}

func NewArticlesHandler(db *sql.DB, q *store.Queries, fetcher *worker.Fetcher) *ArticlesHandler {
	return &ArticlesHandler{db: db, q: q, fetcher: fetcher}
}

// GetArticle handles GET /api/stories/{id}/article
func (h *ArticlesHandler) GetArticle(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	id, err := strconv.Atoi(r.PathValue("id"))
	if err != nil {
		http.Error(w, "invalid id", http.StatusBadRequest)
		return
	}

	// Check if story exists (fetch on-demand if needed)
	story, err := store.Nullable(h.q.GetStoryByID(ctx, h.db, id))
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	if story == nil {
		if fetchErr := h.fetcher.FetchStorySingleflight(ctx, id); fetchErr != nil {
			slog.Error("on-demand story fetch for article failed", "story_id", id, "error", fetchErr)
			http.Error(w, "story not found", http.StatusNotFound)
			return
		}
		story, err = store.Nullable(h.q.GetStoryByID(ctx, h.db, id))
		if err != nil {
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}
		if story == nil {
			http.Error(w, "story not found", http.StatusNotFound)
			return
		}
	}

	if story.URL == nil {
		http.Error(w, "story has no URL", http.StatusNotFound)
		return
	}

	article, err := store.Nullable(h.q.GetArticleByStoryID(ctx, h.db, id))
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}

	// On-demand article extraction if not in DB
	if article == nil {
		slog.Info("on-demand article extraction", "story_id", id)
		h.fetcher.ExtractArticleSingleflight(ctx, id, *story.URL)

		article, err = store.Nullable(h.q.GetArticleByStoryID(ctx, h.db, id))
		if err != nil {
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}
		if article == nil {
			http.Error(w, "article not found", http.StatusNotFound)
			return
		}
	}

	writeJSON(w, r, article)
}
