package store

import (
	"context"
	"database/sql"
)

type Comment struct {
	ID        int        `json:"id"`
	StoryID   int        `json:"story_id,omitempty"`
	ParentID  *int       `json:"parent_id,omitempty"`
	By        *string    `json:"by"`
	Text      *string    `json:"text"`
	Time      int64      `json:"time"`
	Dead      bool       `json:"dead"`
	Deleted   bool       `json:"deleted"`
	FetchedAt int64      `json:"fetched_at,omitempty"`
	Children  []*Comment `json:"children"`
}

type CommentStore struct {
	db *sql.DB
}

func NewCommentStore(db *sql.DB) *CommentStore {
	return &CommentStore{db: db}
}

func (s *CommentStore) Upsert(ctx context.Context, c *Comment) error {
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO comments (id, story_id, parent_id, by, text, time, dead, deleted, fetched_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET
			story_id=excluded.story_id, parent_id=excluded.parent_id,
			by=excluded.by, text=excluded.text, time=excluded.time,
			dead=excluded.dead, deleted=excluded.deleted,
			fetched_at=excluded.fetched_at`,
		c.ID, c.StoryID, c.ParentID, c.By, c.Text, c.Time, c.Dead, c.Deleted, c.FetchedAt)
	return err
}

// Exists checks if a comment is already in the database.
func (s *CommentStore) Exists(ctx context.Context, id int) (bool, error) {
	var count int
	err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM comments WHERE id = ?`, id).Scan(&count)
	return count > 0, err
}

// GetByStory returns all comments for a story as a nested tree.
func (s *CommentStore) GetByStory(ctx context.Context, storyID int) ([]*Comment, int64, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, story_id, parent_id, by, text, time, dead, deleted, fetched_at
		FROM comments WHERE story_id = ?
		ORDER BY time ASC`, storyID)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	var all []*Comment
	byID := make(map[int]*Comment)
	var maxFetchedAt int64

	for rows.Next() {
		c := &Comment{Children: []*Comment{}}
		if err := rows.Scan(&c.ID, &c.StoryID, &c.ParentID, &c.By, &c.Text, &c.Time, &c.Dead, &c.Deleted, &c.FetchedAt); err != nil {
			return nil, 0, err
		}
		if c.FetchedAt > maxFetchedAt {
			maxFetchedAt = c.FetchedAt
		}
		byID[c.ID] = c
		all = append(all, c)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, err
	}

	// Build tree
	var roots []*Comment
	for _, c := range all {
		if c.ParentID != nil {
			if parent, ok := byID[*c.ParentID]; ok {
				parent.Children = append(parent.Children, c)
				continue
			}
		}
		roots = append(roots, c)
	}

	// Prune deleted comments with no children
	roots = pruneDeleted(roots)

	return roots, maxFetchedAt, nil
}

// pruneDeleted removes deleted comments that have no visible children.
func pruneDeleted(comments []*Comment) []*Comment {
	var result []*Comment
	for _, c := range comments {
		c.Children = pruneDeleted(c.Children)
		if c.Deleted && len(c.Children) == 0 {
			continue
		}
		result = append(result, c)
	}
	return result
}

// CommentIDs returns all comment IDs for a given story.
func (s *CommentStore) CommentIDs(ctx context.Context, storyID int) (map[int]bool, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id FROM comments WHERE story_id = ?`, storyID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	ids := make(map[int]bool)
	for rows.Next() {
		var id int
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids[id] = true
	}
	return ids, rows.Err()
}
