-- name: UpsertStar :exec
INSERT INTO stars (user_sub, story_id, starred_at) VALUES (?, ?, ?)
ON CONFLICT(user_sub, story_id) DO UPDATE SET starred_at = excluded.starred_at;

-- name: DeleteStar :exec
DELETE FROM stars WHERE user_sub = ? AND story_id = ?;

-- name: GetStar :one
SELECT user_sub, story_id, starred_at FROM stars WHERE user_sub = ? AND story_id = ?;

-- name: ListStarsByUser :many
SELECT user_sub, story_id, starred_at FROM stars WHERE user_sub = ?;

-- name: ListStarredStoryIDs :many
SELECT DISTINCT story_id FROM stars;
