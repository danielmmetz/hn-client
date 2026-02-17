package store

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"time"
)

type Story struct {
	ID          int     `json:"id"`
	Title       string  `json:"title"`
	URL         *string `json:"url"`
	Text        *string `json:"text,omitempty"`
	Score       int     `json:"score"`
	By          string  `json:"by"`
	Time        int64   `json:"time"`
	Descendants int     `json:"descendants"`
	Type        string  `json:"type"`
	FetchedAt   int64   `json:"fetched_at"`
	Rank        *int    `json:"rank"`
	Dead        bool    `json:"dead"`
}

type StoryStore struct {
	db *sql.DB
}

func NewStoryStore(db *sql.DB) *StoryStore {
	return &StoryStore{db: db}
}

func (s *StoryStore) Upsert(ctx context.Context, st *Story) error {
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO stories (id, title, url, text, score, by, time, descendants, type, fetched_at, rank, dead)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET
			title=excluded.title, url=excluded.url, text=excluded.text,
			score=excluded.score, by=excluded.by, time=excluded.time,
			descendants=excluded.descendants, type=excluded.type,
			fetched_at=excluded.fetched_at,
			rank=COALESCE(excluded.rank, stories.rank),
			dead=excluded.dead`,
		st.ID, st.Title, st.URL, st.Text, st.Score, st.By, st.Time,
		st.Descendants, st.Type, st.FetchedAt, st.Rank, st.Dead)
	return err
}

func (s *StoryStore) GetByID(ctx context.Context, id int) (*Story, error) {
	st := &Story{}
	err := s.db.QueryRowContext(ctx, `SELECT id, title, url, text, score, by, time, descendants, type, fetched_at, rank, dead FROM stories WHERE id = ?`, id).
		Scan(&st.ID, &st.Title, &st.URL, &st.Text, &st.Score, &st.By, &st.Time, &st.Descendants, &st.Type, &st.FetchedAt, &st.Rank, &st.Dead)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	return st, err
}

// GetByIDs returns stories for the given IDs as a map.
// IDs not found in the DB are omitted from the result.
func (s *StoryStore) GetByIDs(ctx context.Context, ids []int) (map[int]*Story, error) {
	if len(ids) == 0 {
		return nil, nil
	}

	placeholders := make([]string, len(ids))
	args := make([]interface{}, len(ids))
	for i, id := range ids {
		placeholders[i] = "?"
		args[i] = id
	}

	query := fmt.Sprintf(`
		SELECT id, title, url, text, score, by, time, descendants, type, fetched_at, rank, dead
		FROM stories WHERE id IN (%s)`, strings.Join(placeholders, ","))

	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := make(map[int]*Story, len(ids))
	for rows.Next() {
		st := &Story{}
		if err := rows.Scan(&st.ID, &st.Title, &st.URL, &st.Text, &st.Score, &st.By, &st.Time, &st.Descendants, &st.Type, &st.FetchedAt, &st.Rank, &st.Dead); err != nil {
			return nil, err
		}
		result[st.ID] = st
	}
	return result, rows.Err()
}

// ListByRank returns paginated stories ordered by rank. page is 1-indexed.
func (s *StoryStore) ListByRank(ctx context.Context, page int) ([]Story, int, error) {
	pageSize := 30
	offset := (page - 1) * pageSize

	var total int
	if err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM stories WHERE rank IS NOT NULL`).Scan(&total); err != nil {
		return nil, 0, err
	}

	rows, err := s.db.QueryContext(ctx, `
		SELECT id, title, url, text, score, by, time, descendants, type, fetched_at, rank, dead
		FROM stories WHERE rank IS NOT NULL
		ORDER BY rank ASC
		LIMIT ? OFFSET ?`, pageSize, offset)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	var stories []Story
	for rows.Next() {
		var st Story
		if err := rows.Scan(&st.ID, &st.Title, &st.URL, &st.Text, &st.Score, &st.By, &st.Time, &st.Descendants, &st.Type, &st.FetchedAt, &st.Rank, &st.Dead); err != nil {
			return nil, 0, err
		}
		stories = append(stories, st)
	}
	return stories, total, rows.Err()
}

// ClearRanks sets all ranks to NULL.
func (s *StoryStore) ClearRanks(ctx context.Context) error {
	_, err := s.db.ExecContext(ctx, `UPDATE stories SET rank = NULL`)
	return err
}

// SetRank sets the rank for a story.
func (s *StoryStore) SetRank(ctx context.Context, id, rank int) error {
	_, err := s.db.ExecContext(ctx, `UPDATE stories SET rank = ? WHERE id = ?`, rank, id)
	return err
}

// RankPair represents a story ID and its rank for batch rank updates.
type RankPair struct {
	ID   int
	Rank int
}

// SwapRanks atomically clears all ranks, then sets new ranks from the given pairs
// in a single transaction. Old ranks persist if this method is never called.
func (s *StoryStore) SwapRanks(ctx context.Context, pairs []RankPair) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if _, err := tx.ExecContext(ctx, `UPDATE stories SET rank = NULL`); err != nil {
		return err
	}

	stmt, err := tx.PrepareContext(ctx, `UPDATE stories SET rank = ? WHERE id = ?`)
	if err != nil {
		return err
	}
	defer stmt.Close()

	for _, p := range pairs {
		if _, err := stmt.ExecContext(ctx, p.Rank, p.ID); err != nil {
			return err
		}
	}

	return tx.Commit()
}

// Exists checks if a story exists in the database.
func (s *StoryStore) Exists(ctx context.Context, id int) (bool, error) {
	var count int
	err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM stories WHERE id = ?`, id).Scan(&count)
	return count > 0, err
}

// LastPollTime returns the most recent fetched_at from any story.
func (s *StoryStore) LastPollTime() int64 {
	var t sql.NullInt64
	s.db.QueryRow(`SELECT MAX(fetched_at) FROM stories`).Scan(&t)
	if t.Valid {
		return t.Int64
	}
	return 0
}

// Count returns total number of stories.
func (s *StoryStore) Count() int {
	var n int
	s.db.QueryRow(`SELECT COUNT(*) FROM stories`).Scan(&n)
	return n
}

// StoryHasComments checks if any comments exist for a story.
func (s *StoryStore) StoryHasComments(ctx context.Context, storyID int) (bool, error) {
	var count int
	err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM comments WHERE story_id = ?`, storyID).Scan(&count)
	return count > 0, err
}

// GetFetchedAt returns the fetched_at time for a story, or 0 if not found.
func (s *StoryStore) GetFetchedAt(id int) int64 {
	var t int64
	s.db.QueryRow(`SELECT fetched_at FROM stories WHERE id = ?`, id).Scan(&t)
	return t
}

// ListByTimeRange returns stories created within [from, to) unix timestamps.
func (s *StoryStore) ListByTimeRange(ctx context.Context, from, to int64) ([]Story, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, title, url, text, score, by, time, descendants, type, fetched_at, rank, dead
		FROM stories WHERE time >= ? AND time < ?
		ORDER BY time DESC`, from, to)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var stories []Story
	for rows.Next() {
		var st Story
		if err := rows.Scan(&st.ID, &st.Title, &st.URL, &st.Text, &st.Score, &st.By, &st.Time, &st.Descendants, &st.Type, &st.FetchedAt, &st.Rank, &st.Dead); err != nil {
			return nil, err
		}
		stories = append(stories, st)
	}
	return stories, rows.Err()
}

// OldOffPageStories returns story IDs that have had rank=NULL for 30+ days
// and are not referenced by any active ranking.
func (s *StoryStore) OldOffPageStories(ctx context.Context) ([]int, error) {
	cutoff := time.Now().Add(-30 * 24 * time.Hour).Unix()
	rows, err := s.db.QueryContext(ctx, `
		SELECT s.id FROM stories s
		WHERE s.rank IS NULL
		AND s.fetched_at < ?
		AND NOT EXISTS (SELECT 1 FROM rankings r WHERE r.story_id = s.id)`, cutoff)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var ids []int
	for rows.Next() {
		var id int
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

// DeleteStory removes a story and its associated comments and articles.
func (s *StoryStore) DeleteStory(ctx context.Context, id int) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	tx.ExecContext(ctx, `DELETE FROM comments WHERE story_id = ?`, id)
	tx.ExecContext(ctx, `DELETE FROM articles WHERE story_id = ?`, id)
	tx.ExecContext(ctx, `DELETE FROM rankings WHERE story_id = ?`, id)
	tx.ExecContext(ctx, `DELETE FROM stories WHERE id = ?`, id)

	return tx.Commit()
}

// Vacuum runs VACUUM on the database.
func (s *StoryStore) Vacuum() error {
	_, err := s.db.Exec(`VACUUM`)
	return err
}

// NowUnix returns current unix timestamp.
func NowUnix() int64 {
	return time.Now().Unix()
}
