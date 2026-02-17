-- name: UpsertComment :exec
INSERT INTO comments (id, story_id, parent_id, by, text, time, dead, deleted, fetched_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(id) DO UPDATE SET
    story_id=excluded.story_id, parent_id=excluded.parent_id,
    by=excluded.by, text=excluded.text, time=excluded.time,
    dead=excluded.dead, deleted=excluded.deleted,
    fetched_at=excluded.fetched_at;

-- name: CommentExists :one
SELECT COUNT(*) FROM comments WHERE id = ?;

-- name: GetCommentsByStory :many
SELECT id, story_id, parent_id, by, text, time, dead, deleted, fetched_at
FROM comments WHERE story_id = ?
ORDER BY time ASC;

-- name: GetCommentIDsByStory :many
SELECT id FROM comments WHERE story_id = ?;
