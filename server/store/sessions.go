package store

import (
	"context"
	"database/sql"
	"time"
)

type Session struct {
	Token     string
	UserSub   string
	UserInfo  string // JSON blob
	ExpiresAt int64
}

type SessionStore struct {
	db *sql.DB
}

func NewSessionStore(db *sql.DB) *SessionStore {
	return &SessionStore{db: db}
}

func (s *SessionStore) Create(ctx context.Context, session *Session) error {
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO sessions (token, user_sub, user_info, expires_at) VALUES (?, ?, ?, ?)`,
		session.Token, session.UserSub, session.UserInfo, session.ExpiresAt,
	)
	return err
}

func (s *SessionStore) Get(ctx context.Context, token string) (*Session, error) {
	row := s.db.QueryRowContext(ctx,
		`SELECT token, user_sub, user_info, expires_at FROM sessions WHERE token = ? AND expires_at > ?`,
		token, time.Now().Unix(),
	)
	var sess Session
	if err := row.Scan(&sess.Token, &sess.UserSub, &sess.UserInfo, &sess.ExpiresAt); err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}
	return &sess, nil
}

func (s *SessionStore) Delete(ctx context.Context, token string) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM sessions WHERE token = ?`, token)
	return err
}

func (s *SessionStore) CleanExpired(ctx context.Context) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM sessions WHERE expires_at <= ?`, time.Now().Unix())
	return err
}
