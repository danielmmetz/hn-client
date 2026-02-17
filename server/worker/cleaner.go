package worker

import (
	"context"
	"database/sql"
	"log/slog"
	"time"

	"github.com/danielmmetz/hn-client/server/store"
)

type Cleaner struct {
	db *sql.DB
	q  *store.Queries
}

func NewCleaner(db *sql.DB, q *store.Queries) *Cleaner {
	return &Cleaner{db: db, q: q}
}

// Start begins the daily cleanup cycle. It runs until the context is cancelled.
func (c *Cleaner) Start(ctx context.Context) {
	go func() {
		select {
		case <-time.After(1 * time.Hour):
			c.cleanup(ctx)
		case <-ctx.Done():
			slog.Info("cleaner: shutting down before first run")
			return
		}

		ticker := time.NewTicker(24 * time.Hour)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				slog.Info("cleaner: shutting down")
				return
			case <-ticker.C:
				c.cleanup(ctx)
			}
		}
	}()
}

func (c *Cleaner) cleanup(ctx context.Context) {
	slog.Info("cleaner: starting daily cleanup")

	cutoff := time.Now().Add(-30 * 24 * time.Hour).Unix()
	ids, err := c.q.OldOffPageStoryIDs(ctx, c.db, cutoff)
	if err != nil {
		slog.Error("cleaner: error finding old stories", "error", err)
		return
	}

	deleted := 0
	for _, id := range ids {
		if ctx.Err() != nil {
			slog.Info("cleaner: cancelled during cleanup")
			break
		}
		if err := c.q.DeleteStory(ctx, c.db, id); err != nil {
			slog.Error("cleaner: error deleting story", "story_id", id, "error", err)
			continue
		}
		deleted++
	}

	if deleted > 0 {
		slog.Info("cleaner: deleted old stories", "count", deleted)
		if _, err := c.db.Exec(`VACUUM`); err != nil {
			slog.Error("cleaner: vacuum error", "error", err)
		}
	}

	slog.Info("cleaner: cleanup complete")
}
