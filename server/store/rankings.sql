-- name: DeleteRankingsByPeriod :exec
DELETE FROM rankings WHERE period = ?;

-- name: InsertRanking :exec
INSERT INTO rankings (story_id, period, score, computed_at) VALUES (?, ?, ?, ?);

-- name: CountRankingsByPeriod :one
SELECT COUNT(*) FROM rankings WHERE period = ?;

-- name: GetStoriesByPeriod :many
SELECT s.id, s.title, s.url, s.text, s.score, s.by, s.time, s.descendants, s.type, s.fetched_at, s.rank, s.dead
FROM rankings r
JOIN stories s ON s.id = r.story_id
WHERE r.period = ?
ORDER BY r.score DESC
LIMIT ? OFFSET ?;

-- name: HasActiveRankings :one
SELECT COUNT(*) FROM rankings WHERE story_id = ?;
