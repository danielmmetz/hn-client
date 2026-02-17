package store

import (
	"context"
	"database/sql"
)

type Ranking struct {
	StoryID    int     `json:"story_id"`
	Period     string  `json:"period"`
	Score      float64 `json:"score"`
	ComputedAt int64   `json:"computed_at"`
}

type RankingStore struct {
	db *sql.DB
}

func NewRankingStore(db *sql.DB) *RankingStore {
	return &RankingStore{db: db}
}

// UpsertBatch replaces all rankings for a given period.
func (s *RankingStore) UpsertBatch(ctx context.Context, period string, rankings []Ranking) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	// Clear old rankings for this period
	if _, err := tx.ExecContext(ctx, `DELETE FROM rankings WHERE period = ?`, period); err != nil {
		return err
	}

	stmt, err := tx.PrepareContext(ctx, `INSERT INTO rankings (story_id, period, score, computed_at) VALUES (?, ?, ?, ?)`)
	if err != nil {
		return err
	}
	defer stmt.Close()

	for _, r := range rankings {
		if _, err := stmt.ExecContext(ctx, r.StoryID, r.Period, r.Score, r.ComputedAt); err != nil {
			return err
		}
	}

	return tx.Commit()
}

// GetByPeriod returns stories ranked by period, paginated. Returns stories with ranking info.
func (s *RankingStore) GetByPeriod(ctx context.Context, period string, page int) ([]Story, int, error) {
	pageSize := 30
	offset := (page - 1) * pageSize

	var total int
	if err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM rankings WHERE period = ?`, period).Scan(&total); err != nil {
		return nil, 0, err
	}

	rows, err := s.db.QueryContext(ctx, `
		SELECT s.id, s.title, s.url, s.text, s.score, s.by, s.time, s.descendants, s.type, s.fetched_at, s.rank, s.dead
		FROM rankings r
		JOIN stories s ON s.id = r.story_id
		WHERE r.period = ?
		ORDER BY r.score DESC
		LIMIT ? OFFSET ?`, period, pageSize, offset)
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

// HasActiveRankings checks if a story is in any active ranking period.
func (s *RankingStore) HasActiveRankings(ctx context.Context, storyID int) (bool, error) {
	var count int
	err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM rankings WHERE story_id = ?`, storyID).Scan(&count)
	return count > 0, err
}
