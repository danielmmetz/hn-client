package worker

import (
	"context"
	"log/slog"
	"time"

	"hn-client/server/store"
)

type Cleaner struct {
	stories *store.StoryStore
}

func NewCleaner(stories *store.StoryStore) *Cleaner {
	return &Cleaner{stories: stories}
}

// Start begins the daily cleanup cycle. It runs until the context is cancelled.
func (c *Cleaner) Start(ctx context.Context) {
	go func() {
		// Run first cleanup after 1 hour (let data accumulate on startup)
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

	ids, err := c.stories.OldOffPageStories(ctx)
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
		if err := c.stories.DeleteStory(ctx, id); err != nil {
			slog.Error("cleaner: error deleting story", "story_id", id, "error", err)
			continue
		}
		deleted++
	}

	if deleted > 0 {
		slog.Info("cleaner: deleted old stories", "count", deleted)
		if err := c.stories.Vacuum(); err != nil {
			slog.Error("cleaner: vacuum error", "error", err)
		}
	}

	slog.Info("cleaner: cleanup complete")
}
