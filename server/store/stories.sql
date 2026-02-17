-- name: UpsertStory :exec
INSERT INTO stories (id, title, url, text, score, by, time, descendants, type, fetched_at, rank, dead)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(id) DO UPDATE SET
    title=excluded.title, url=excluded.url, text=excluded.text,
    score=excluded.score, by=excluded.by, time=excluded.time,
    descendants=excluded.descendants, type=excluded.type,
    fetched_at=excluded.fetched_at,
    rank=COALESCE(excluded.rank, stories.rank),
    dead=excluded.dead;

-- name: GetStoryByID :one
SELECT id, title, url, text, score, by, time, descendants, type, fetched_at, rank, dead
FROM stories WHERE id = ?;

-- name: GetStoriesByIDs :many
SELECT id, title, url, text, score, by, time, descendants, type, fetched_at, rank, dead
FROM stories WHERE id IN (sqlc.slice('ids'));

-- name: CountRankedStories :one
SELECT COUNT(*) FROM stories WHERE rank IS NOT NULL;

-- name: ListStoriesByRank :many
SELECT id, title, url, text, score, by, time, descendants, type, fetched_at, rank, dead
FROM stories WHERE rank IS NOT NULL
ORDER BY rank ASC
LIMIT ? OFFSET ?;

-- name: ClearRanks :exec
UPDATE stories SET rank = NULL;

-- name: SetRank :exec
UPDATE stories SET rank = ? WHERE id = ?;

-- name: StoryExists :one
SELECT COUNT(*) FROM stories WHERE id = ?;

-- name: MaxFetchedAt :one
SELECT fetched_at FROM stories ORDER BY fetched_at DESC LIMIT 1;

-- name: CountStories :one
SELECT COUNT(*) FROM stories;

-- name: CountCommentsForStory :one
SELECT COUNT(*) FROM comments WHERE story_id = ?;

-- name: GetStoryFetchedAt :one
SELECT fetched_at FROM stories WHERE id = ?;

-- name: ListStoriesByTimeRange :many
SELECT id, title, url, text, score, by, time, descendants, type, fetched_at, rank, dead
FROM stories WHERE time >= ? AND time < ?
ORDER BY time DESC;

-- name: OldOffPageStoryIDs :many
SELECT s.id FROM stories s
WHERE s.rank IS NULL
AND s.fetched_at < ?
AND NOT EXISTS (SELECT 1 FROM rankings r WHERE r.story_id = s.id);

-- name: DeleteStory :exec
DELETE FROM stories WHERE id = ?;
