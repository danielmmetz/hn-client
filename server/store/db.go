package store

import (
	"database/sql"
	"fmt"
	"log/slog"

	_ "modernc.org/sqlite"
)

func Open(path string) (*sql.DB, error) {
	db, err := sql.Open("sqlite", path+"?_pragma=journal_mode(wal)&_pragma=busy_timeout(5000)&_pragma=synchronous(normal)&_pragma=foreign_keys(on)")
	if err != nil {
		return nil, fmt.Errorf("open db: %w", err)
	}

	// WAL mode allows concurrent readers with a single writer.
	// Allow multiple connections for parallel reads; SQLite serializes writes via busy_timeout.
	db.SetMaxOpenConns(10)
	db.SetMaxIdleConns(5)

	if err := migrate(db); err != nil {
		db.Close()
		return nil, fmt.Errorf("migrate: %w", err)
	}

	slog.Info("database ready", "path", path)
	return db, nil
}

func migrate(db *sql.DB) error {
	_, err := db.Exec(`
		CREATE TABLE IF NOT EXISTS stories (
			id          INTEGER PRIMARY KEY,
			title       TEXT NOT NULL,
			url         TEXT,
			text        TEXT,
			score       INTEGER NOT NULL DEFAULT 0,
			by          TEXT NOT NULL,
			time        INTEGER NOT NULL,
			descendants INTEGER NOT NULL DEFAULT 0,
			type        TEXT NOT NULL DEFAULT 'story',
			fetched_at  INTEGER NOT NULL,
			rank        INTEGER,
			dead        BOOLEAN NOT NULL DEFAULT FALSE
		);

		CREATE TABLE IF NOT EXISTS comments (
			id          INTEGER PRIMARY KEY,
			story_id    INTEGER NOT NULL REFERENCES stories(id),
			parent_id   INTEGER,
			by          TEXT,
			text        TEXT,
			time        INTEGER NOT NULL,
			dead        BOOLEAN NOT NULL DEFAULT FALSE,
			deleted     BOOLEAN NOT NULL DEFAULT FALSE,
			fetched_at  INTEGER NOT NULL
		);
		CREATE INDEX IF NOT EXISTS idx_comments_story ON comments(story_id);

		CREATE TABLE IF NOT EXISTS articles (
			story_id         INTEGER PRIMARY KEY REFERENCES stories(id),
			content          TEXT,
			title            TEXT,
			excerpt          TEXT,
			byline           TEXT,
			extraction_failed BOOLEAN NOT NULL DEFAULT FALSE,
			fetched_at       INTEGER NOT NULL
		);

		CREATE TABLE IF NOT EXISTS rankings (
			story_id    INTEGER NOT NULL REFERENCES stories(id),
			period      TEXT NOT NULL,
			score       REAL NOT NULL,
			computed_at INTEGER NOT NULL,
			PRIMARY KEY (story_id, period)
		);
		CREATE INDEX IF NOT EXISTS idx_rankings_period_score ON rankings(period, score DESC);

		CREATE TABLE IF NOT EXISTS sessions (
			token      TEXT PRIMARY KEY,
			user_sub   TEXT NOT NULL,
			user_info  TEXT NOT NULL,
			expires_at INTEGER NOT NULL
		);
		CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
	`)
	return err
}
