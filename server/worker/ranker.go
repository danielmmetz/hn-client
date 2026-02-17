package worker

import (
	"context"
	"log/slog"
	"math"
	"time"

	"hn-client/server/store"
)

type Ranker struct {
	stories  *store.StoryStore
	rankings *store.RankingStore
}

func NewRanker(stories *store.StoryStore, rankings *store.RankingStore) *Ranker {
	return &Ranker{stories: stories, rankings: rankings}
}

// ComputeAll computes rankings for day, yesterday, and week periods.
func (r *Ranker) ComputeAll(ctx context.Context) {
	now := time.Now()
	nowUnix := now.Unix()

	// Today: stories from last 24h, sorted by rank_score
	dayAgo := now.Add(-24 * time.Hour).Unix()
	r.computePeriod(ctx, "day", dayAgo, nowUnix, nowUnix, false)

	// Yesterday: stories from 24-48h ago, sorted by raw score
	twoDaysAgo := now.Add(-48 * time.Hour).Unix()
	r.computePeriod(ctx, "yesterday", twoDaysAgo, dayAgo, nowUnix, true)

	// Week: stories from last 7 days, sorted by rank_score
	weekAgo := now.Add(-7 * 24 * time.Hour).Unix()
	r.computePeriod(ctx, "week", weekAgo, nowUnix, nowUnix, false)
}

func (r *Ranker) computePeriod(ctx context.Context, period string, fromTime, toTime, now int64, useRawScore bool) {
	stories, err := r.stories.ListByTimeRange(ctx, fromTime, toTime)
	if err != nil {
		slog.Error("ranker: error listing stories", "period", period, "error", err)
		return
	}

	var rankings []store.Ranking
	for _, s := range stories {
		var score float64
		if useRawScore {
			score = float64(s.Score)
		} else {
			ageHours := float64(now-s.Time) / 3600.0
			score = float64(s.Score-1) / math.Pow(ageHours+2, 1.5)
		}

		rankings = append(rankings, store.Ranking{
			StoryID:    s.ID,
			Period:     period,
			Score:      score,
			ComputedAt: now,
		})
	}

	if err := r.rankings.UpsertBatch(ctx, period, rankings); err != nil {
		slog.Error("ranker: error upserting rankings", "period", period, "error", err)
		return
	}

	slog.Info("ranker: computed rankings", "period", period, "count", len(rankings))
}
