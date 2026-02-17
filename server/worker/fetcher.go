package worker

import (
	"context"
	"fmt"
	"log/slog"

	"golang.org/x/sync/singleflight"

	"hn-client/server/hn"
	"hn-client/server/readability"
	"hn-client/server/store"
)

type Fetcher struct {
	client     *hn.Client
	stories    *store.StoryStore
	comments   *store.CommentStore
	articles   *store.ArticleStore
	sfStory    singleflight.Group
	sfComments singleflight.Group
	sfArticle  singleflight.Group
}

func NewFetcher(client *hn.Client, stories *store.StoryStore, comments *store.CommentStore, articles *store.ArticleStore) *Fetcher {
	return &Fetcher{client: client, stories: stories, comments: comments, articles: articles}
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

	now := store.NowUnix()
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
	return f.stories.Upsert(ctx, st)
}

// FetchComments fetches all comments for a story recursively.
// Re-fetches existing comments to discover new replies and pick up edits/deletions.
func (f *Fetcher) FetchComments(ctx context.Context, storyID int, kids []int) error {
	if len(kids) == 0 {
		return nil
	}

	return f.fetchCommentsRecursive(ctx, storyID, kids)
}

func (f *Fetcher) fetchCommentsRecursive(ctx context.Context, storyID int, kids []int) error {
	items := f.client.GetItems(ctx, kids)
	now := store.NowUnix()

	for _, item := range items {
		if item == nil {
			continue
		}

		// Check for cancellation between items
		if err := ctx.Err(); err != nil {
			return err
		}

		parentID := &item.Parent
		// If parent is the story itself, set parent_id to NULL (top-level)
		if *parentID == storyID {
			parentID = nil
		}

		c := &store.Comment{
			ID:        item.ID,
			StoryID:   storyID,
			ParentID:  parentID,
			Time:      item.Time,
			Dead:      item.Dead,
			Deleted:   item.Deleted,
			FetchedAt: now,
		}
		if item.By != "" {
			c.By = &item.By
		}
		if item.Text != "" {
			c.Text = &item.Text
		}

		if err := f.comments.Upsert(ctx, c); err != nil {
			slog.Error("error upserting comment", "comment_id", item.ID, "error", err)
			continue
		}

		// Recurse into children
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

	now := store.NowUnix()
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

	// Check if story is new (for article extraction decision)
	isNew := false
	if existing, _ := f.stories.GetByID(ctx, item.ID); existing == nil {
		isNew = true
	}

	if err := f.stories.Upsert(ctx, st); err != nil {
		return err
	}

	// Fetch comments incrementally
	if len(item.Kids) > 0 {
		if err := f.FetchComments(ctx, item.ID, item.Kids); err != nil {
			slog.Error("error fetching comments for story", "story_id", item.ID, "error", err)
		}
	}

	// Extract article for new stories with URLs (skip Ask HN / text posts)
	if isNew && f.articles != nil && item.URL != "" {
		f.ExtractArticle(ctx, item.ID, item.URL)
	}

	return nil
}

// ExtractArticle fetches and extracts reader-mode content for a story URL.
func (f *Fetcher) ExtractArticle(ctx context.Context, storyID int, url string) {
	now := store.NowUnix()
	article, err := readability.Extract(ctx, url)
	if err != nil {
		slog.Error("article extraction failed", "story_id", storyID, "error", err)
		f.articles.Upsert(ctx, &store.Article{
			StoryID:          storyID,
			ExtractionFailed: true,
			FetchedAt:        now,
		})
		return
	}

	if err := f.articles.Upsert(ctx, &store.Article{
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
