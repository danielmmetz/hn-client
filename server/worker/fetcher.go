package worker

import (
	"context"
	"database/sql"
	"fmt"
	"log/slog"
	"time"

	"golang.org/x/sync/singleflight"

	"github.com/danielmmetz/hn-client/server/hn"
	"github.com/danielmmetz/hn-client/server/readability"
	"github.com/danielmmetz/hn-client/server/store"
)

type Fetcher struct {
	client     *hn.Client
	db         *sql.DB
	q          *store.Queries
	sfStory    singleflight.Group
	sfComments singleflight.Group
	sfArticle  singleflight.Group
}

func NewFetcher(client *hn.Client, db *sql.DB, q *store.Queries) *Fetcher {
	return &Fetcher{client: client, db: db, q: q}
}

// FetchStorySingleflight fetches a story via singleflight (concurrent callers share one request).
func (f *Fetcher) FetchStorySingleflight(ctx context.Context, id int) error {
	_, err, _ := f.sfStory.Do(fmt.Sprintf("story-%d", id), func() (interface{}, error) {
		return nil, f.FetchStory(ctx, id, nil)
	})
	return err
}

// FetchStoryWithCommentsSingleflight fetches story+comments via singleflight.
func (f *Fetcher) FetchStoryWithCommentsSingleflight(ctx context.Context, id int) error {
	_, err, _ := f.sfStory.Do(fmt.Sprintf("story-comments-%d", id), func() (interface{}, error) {
		return nil, f.FetchStoryWithComments(ctx, id, nil)
	})
	return err
}

// ExtractArticleSingleflight extracts an article via singleflight.
func (f *Fetcher) ExtractArticleSingleflight(ctx context.Context, storyID int, url string) {
	f.sfArticle.Do(fmt.Sprintf("article-%d", storyID), func() (interface{}, error) {
		f.ExtractArticle(ctx, storyID, url)
		return nil, nil
	})
}

// FetchCommentsSingleflight fetches comments via singleflight.
func (f *Fetcher) FetchCommentsSingleflight(ctx context.Context, storyID int, kids []int) error {
	_, err, _ := f.sfComments.Do(fmt.Sprintf("comments-%d", storyID), func() (interface{}, error) {
		return nil, f.FetchComments(ctx, storyID, kids)
	})
	return err
}

// FetchStory fetches and upserts a single story from HN.
func (f *Fetcher) FetchStory(ctx context.Context, id int, rank *int) error {
	item, err := f.client.GetItem(ctx, id)
	if err != nil {
		return err
	}
	if item == nil || item.ID == 0 {
		return nil
	}

	now := time.Now().Unix()
	st := storyFromItem(item, now, rank)
	return f.q.UpsertStory(ctx, f.db, store.UpsertStoryParams{
		ID: st.ID, Title: st.Title, URL: st.URL, Text: st.Text,
		Score: st.Score, By: st.By, Time: st.Time,
		Descendants: st.Descendants, Type: st.Type,
		FetchedAt: st.FetchedAt, Rank: st.Rank, Dead: st.Dead,
	})
}

// FetchComments fetches all comments for a story recursively.
func (f *Fetcher) FetchComments(ctx context.Context, storyID int, kids []int) error {
	if len(kids) == 0 {
		return nil
	}
	return f.fetchCommentsRecursive(ctx, storyID, kids)
}

func (f *Fetcher) fetchCommentsRecursive(ctx context.Context, storyID int, kids []int) error {
	items := f.client.GetItems(ctx, kids)
	now := time.Now().Unix()

	for _, item := range items {
		if item == nil {
			continue
		}

		if err := ctx.Err(); err != nil {
			return err
		}

		var parentID *int
		if item.Parent != storyID {
			parentID = &item.Parent
		}

		var by *string
		if item.By != "" {
			by = &item.By
		}
		var text *string
		if item.Text != "" {
			text = &item.Text
		}

		if err := f.q.UpsertComment(ctx, f.db, store.UpsertCommentParams{
			ID: item.ID, StoryID: storyID, ParentID: parentID,
			By: by, Text: text, Time: item.Time,
			Dead: item.Dead, Deleted: item.Deleted, FetchedAt: now,
		}); err != nil {
			slog.Error("error upserting comment", "comment_id", item.ID, "error", err)
			continue
		}

		if len(item.Kids) > 0 {
			if err := f.fetchCommentsRecursive(ctx, storyID, item.Kids); err != nil {
				slog.Error("error fetching children of comment", "comment_id", item.ID, "error", err)
			}
		}
	}
	return nil
}

// FetchStoryWithComments fetches story details and its comments from HN.
func (f *Fetcher) FetchStoryWithComments(ctx context.Context, id int, rank *int) error {
	item, err := f.client.GetItem(ctx, id)
	if err != nil {
		return err
	}
	if item == nil || item.ID == 0 {
		return nil
	}

	now := time.Now().Unix()
	st := storyFromItem(item, now, rank)

	// Check if story is new (for article extraction decision)
	isNew := false
	if existing, _ := store.Nullable(f.q.GetStoryByID(ctx, f.db, item.ID)); existing == nil {
		isNew = true
	}

	if err := f.q.UpsertStory(ctx, f.db, store.UpsertStoryParams{
		ID: st.ID, Title: st.Title, URL: st.URL, Text: st.Text,
		Score: st.Score, By: st.By, Time: st.Time,
		Descendants: st.Descendants, Type: st.Type,
		FetchedAt: st.FetchedAt, Rank: st.Rank, Dead: st.Dead,
	}); err != nil {
		return err
	}

	if len(item.Kids) > 0 {
		if err := f.FetchComments(ctx, item.ID, item.Kids); err != nil {
			slog.Error("error fetching comments for story", "story_id", item.ID, "error", err)
		}
	}

	// Extract article for new stories with URLs
	if isNew && item.URL != "" {
		f.ExtractArticle(ctx, item.ID, item.URL)
	}

	return nil
}

// ExtractArticle fetches and extracts reader-mode content for a story URL.
func (f *Fetcher) ExtractArticle(ctx context.Context, storyID int, url string) {
	now := time.Now().Unix()
	article, err := readability.Extract(ctx, url)
	if err != nil {
		slog.Error("article extraction failed", "story_id", storyID, "error", err)
		f.q.UpsertArticle(ctx, f.db, store.UpsertArticleParams{
			StoryID:          storyID,
			ExtractionFailed: true,
			FetchedAt:        now,
		})
		return
	}

	if err := f.q.UpsertArticle(ctx, f.db, store.UpsertArticleParams{
		StoryID:          storyID,
		Content:          &article.Content,
		Title:            &article.Title,
		Excerpt:          &article.Excerpt,
		Byline:           &article.Byline,
		ExtractionFailed: false,
		FetchedAt:        now,
	}); err != nil {
		slog.Error("error storing article", "story_id", storyID, "error", err)
	}
}

func storyFromItem(item *hn.Item, now int64, rank *int) *store.Story {
	st := &store.Story{
		ID:          item.ID,
		Title:       item.Title,
		Score:       item.Score,
		By:          item.By,
		Time:        item.Time,
		Descendants: item.Descendants,
		Type:        item.Type,
		FetchedAt:   now,
		Rank:        rank,
		Dead:        item.Dead,
	}
	if item.URL != "" {
		st.URL = &item.URL
	}
	if item.Text != "" {
		st.Text = &item.Text
	}
	if st.Type == "" {
		st.Type = "story"
	}
	if st.By == "" {
		st.By = "[unknown]"
	}
	return st
}
