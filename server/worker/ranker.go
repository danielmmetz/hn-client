package worker

import (
	"context"
	"database/sql"
	"log/slog"
	"math"
	"time"

	"github.com/danielmmetz/hn-client/server/store"
)

type Ranker struct {
	db *sql.DB
	q  *store.Queries
}

func NewRanker(db *sql.DB, q *store.Queries) *Ranker {
	return &Ranker{db: db, q: q}
}

// ComputeAll computes rankings for day, yesterday, and week periods.
func (r *Ranker) ComputeAll(ctx context.Context) {
	now := time.Now()
	nowUnix := now.Unix()

	dayAgo := now.Add(-24 * time.Hour).Unix()
	r.computePeriod(ctx, "day", dayAgo, nowUnix, nowUnix, false)

	twoDaysAgo := now.Add(-48 * time.Hour).Unix()
	r.computePeriod(ctx, "yesterday", twoDaysAgo, dayAgo, nowUnix, true)

	weekAgo := now.Add(-7 * 24 * time.Hour).Unix()
	r.computePeriod(ctx, "week", weekAgo, nowUnix, nowUnix, false)
}

func (r *Ranker) computePeriod(ctx context.Context, period string, fromTime, toTime, now int64, useRawScore bool) {
	stories, err := r.q.ListStoriesByTimeRange(ctx, r.db, store.ListStoriesByTimeRangeParams{
		Time: fromTime, Time_2: toTime,
	})
	if err != nil {
		slog.Error("ranker: error listing stories", "period", period, "error", err)
		return
	}

	// Upsert rankings in a transaction: delete old, insert new
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		slog.Error("ranker: error starting transaction", "period", period, "error", err)
		return
	}
	defer tx.Rollback()

	if err := r.q.DeleteRankingsByPeriod(ctx, tx, period); err != nil {
		slog.Error("ranker: error deleting old rankings", "period", period, "error", err)
		return
	}

	for _, s := range stories {
		var score float64
		if useRawScore {
			score = float64(s.Score)
		} else {
			ageHours := float64(now-s.Time) / 3600.0
			score = float64(s.Score-1) / math.Pow(ageHours+2, 1.5)
		}

		if err := r.q.InsertRanking(ctx, tx, store.InsertRankingParams{
			StoryID: s.ID, Period: period,
			Score: score, ComputedAt: now,
		}); err != nil {
			slog.Error("ranker: error inserting ranking", "period", period, "story_id", s.ID, "error", err)
			return
		}
	}

	if err := tx.Commit(); err != nil {
		slog.Error("ranker: error committing rankings", "period", period, "error", err)
		return
	}

	slog.Info("ranker: computed rankings", "period", period, "count", len(stories))
}
