-- name: CreateSession :exec
INSERT INTO sessions (token, user_sub, user_info, expires_at) VALUES (?, ?, ?, ?);

-- name: GetSession :one
SELECT token, user_sub, user_info, expires_at
FROM sessions WHERE token = ? AND expires_at > ?;

-- name: DeleteSession :exec
DELETE FROM sessions WHERE token = ?;

-- name: CleanExpiredSessions :exec
DELETE FROM sessions WHERE expires_at <= ?;
