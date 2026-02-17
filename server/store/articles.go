package store

import (
	"context"
	"database/sql"
)

type Article struct {
	StoryID          int     `json:"story_id"`
	Content          *string `json:"content"`
	Title            *string `json:"title"`
	Excerpt          *string `json:"excerpt"`
	Byline           *string `json:"byline"`
	ExtractionFailed bool    `json:"extraction_failed"`
	FetchedAt        int64   `json:"fetched_at"`
}

type ArticleStore struct {
	db *sql.DB
}

func NewArticleStore(db *sql.DB) *ArticleStore {
	return &ArticleStore{db: db}
}

func (s *ArticleStore) Upsert(ctx context.Context, a *Article) error {
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO articles (story_id, content, title, excerpt, byline, extraction_failed, fetched_at)
		VALUES (?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(story_id) DO UPDATE SET
			content=excluded.content, title=excluded.title, excerpt=excluded.excerpt,
			byline=excluded.byline, extraction_failed=excluded.extraction_failed,
			fetched_at=excluded.fetched_at`,
		a.StoryID, a.Content, a.Title, a.Excerpt, a.Byline, a.ExtractionFailed, a.FetchedAt)
	return err
}

func (s *ArticleStore) GetByStoryID(ctx context.Context, storyID int) (*Article, error) {
	a := &Article{}
	err := s.db.QueryRowContext(ctx, `
		SELECT story_id, content, title, excerpt, byline, extraction_failed, fetched_at
		FROM articles WHERE story_id = ?`, storyID).
		Scan(&a.StoryID, &a.Content, &a.Title, &a.Excerpt, &a.Byline, &a.ExtractionFailed, &a.FetchedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	return a, err
}

// Delete removes an article by story ID.
func (s *ArticleStore) Delete(ctx context.Context, storyID int) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM articles WHERE story_id = ?`, storyID)
	return err
}
