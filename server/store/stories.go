package store

import (
	"context"
	"database/sql"
)

// RankPair represents a story ID and its rank for batch rank updates.
type RankPair struct {
	ID   int
	Rank int
}

// SwapRanks atomically clears all ranks, then sets new ranks in a single transaction.
func SwapRanks(ctx context.Context, db *sql.DB, q *Queries, pairs []RankPair) error {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if err := q.ClearRanks(ctx, tx); err != nil {
		return err
	}

	for _, p := range pairs {
		rank := p.Rank
		if err := q.SetRank(ctx, tx, SetRankParams{Rank: &rank, ID: p.ID}); err != nil {
			return err
		}
	}

	return tx.Commit()
}
