package worker

import (
	"context"
	"encoding/json"
	"log/slog"
	"time"

	"hn-client/server/hn"
	"hn-client/server/sse"
	"hn-client/server/store"
)

type Poller struct {
	client   *hn.Client
	stories  *store.StoryStore
	comments *store.CommentStore
	articles *store.ArticleStore
	rankings *store.RankingStore
	fetcher  *Fetcher
	ranker   *Ranker
	broker   *sse.Broker
	topList  *store.TopList
	interval time.Duration
}

// NewPoller creates a Poller with an externally-provided Fetcher (dependency injection).
func NewPoller(client *hn.Client, fetcher *Fetcher, stories *store.StoryStore, comments *store.CommentStore, articles *store.ArticleStore, rankings *store.RankingStore, broker *sse.Broker, topList *store.TopList) *Poller {
	ranker := NewRanker(stories, rankings)
	return &Poller{
		client:   client,
		stories:  stories,
		comments: comments,
		articles: articles,
		rankings: rankings,
		fetcher:  fetcher,
		ranker:   ranker,
		broker:   broker,
		topList:  topList,
		interval: 5 * time.Minute,
	}
}

// Start begins the polling loop. It runs until the context is cancelled.
func (p *Poller) Start(ctx context.Context) {
	go func() {
		p.poll(ctx)
		ticker := time.NewTicker(p.interval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				slog.Info("poller: shutting down")
				return
			case <-ticker.C:
				p.poll(ctx)
			}
		}
	}()
}

func (p *Poller) poll(ctx context.Context) {
	slog.Info("polling HN top stories")
	start := time.Now()

	topIDs, err := p.client.TopStories(ctx)
	if err != nil {
		slog.Error("error fetching top stories", "error", err)
		return
	}

	// Update the shared TopList immediately so the API can use it for pagination
	p.topList.Set(topIDs)
	slog.Info("TopList updated", "count", len(topIDs))

	// Phase 1: Fetch all story data WITHOUT setting ranks.
	// Accumulate (storyID, rank) pairs in memory for atomic swap later.
	var rankPairs []store.RankPair
	var updatedIDs []int

	// Eager fetch: top 60 (stories + comments)
	eagerCount := 60
	if len(topIDs) < eagerCount {
		eagerCount = len(topIDs)
	}

	for i := 0; i < eagerCount; i++ {
		// Check for cancellation between stories
		if ctx.Err() != nil {
			slog.Info("poller: cancelled during eager fetch")
			return
		}
		id := topIDs[i]
		if err := p.fetcher.FetchStoryWithComments(ctx, id, nil); err != nil {
			slog.Error("error fetching story", "story_id", id, "error", err)
			continue
		}
		rankPairs = append(rankPairs, store.RankPair{ID: id, Rank: i + 1})
		updatedIDs = append(updatedIDs, id)
	}

	// Lazy fetch: stories 61-500 (metadata only)
	for i := eagerCount; i < len(topIDs); i++ {
		if ctx.Err() != nil {
			slog.Info("poller: cancelled during lazy fetch")
			break
		}
		id := topIDs[i]
		if err := p.fetcher.FetchStory(ctx, id, nil); err != nil {
			slog.Error("error fetching story metadata", "story_id", id, "error", err)
			continue
		}
		rankPairs = append(rankPairs, store.RankPair{ID: id, Rank: i + 1})
		updatedIDs = append(updatedIDs, id)
	}

	// Phase 2: Atomic rank swap — only if we fetched enough stories.
	// Require at least 10 stories to avoid wiping ranks on a mostly-failed poll.
	if len(rankPairs) >= 10 {
		if err := p.stories.SwapRanks(ctx, rankPairs); err != nil {
			slog.Error("error swapping ranks", "error", err)
		}
	} else {
		slog.Warn("skipping rank swap: insufficient stories fetched", "fetched", len(rankPairs), "minimum", 10)
	}

	// Recompute rankings
	p.ranker.ComputeAll(ctx)

	elapsed := time.Since(start)
	slog.Info("poll complete", "stories_updated", len(updatedIDs), "elapsed", elapsed)

	// Publish SSE event
	if len(updatedIDs) > 0 {
		data, _ := json.Marshal(map[string]interface{}{
			"story_ids": updatedIDs,
			"timestamp": time.Now().Unix(),
		})
		p.broker.Publish("stories_updated", string(data))
	}
}
