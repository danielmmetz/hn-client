package store

import (
	"database/sql"
	_ "embed"
	"fmt"
	"log/slog"

	_ "modernc.org/sqlite"
)

//go:embed schema.sql
var schema string

func Open(path string) (*sql.DB, error) {
	db, err := sql.Open("sqlite", path+"?_pragma=journal_mode(wal)&_pragma=busy_timeout(5000)&_pragma=synchronous(normal)&_pragma=foreign_keys(on)")
	if err != nil {
		return nil, fmt.Errorf("open db: %w", err)
	}

	db.SetMaxOpenConns(10)
	db.SetMaxIdleConns(5)

	if _, err := db.Exec(schema); err != nil {
		db.Close()
		return nil, fmt.Errorf("migrate: %w", err)
	}

	slog.Info("database ready", "path", path)
	return db, nil
}

// Nullable converts sql.ErrNoRows into (nil, nil).
func Nullable[T any](val *T, err error) (*T, error) {
	if err == sql.ErrNoRows {
		return nil, nil
	}
	return val, err
}
