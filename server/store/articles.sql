-- name: UpsertArticle :exec
INSERT INTO articles (story_id, content, title, excerpt, byline, extraction_failed, fetched_at)
VALUES (?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(story_id) DO UPDATE SET
    content=excluded.content, title=excluded.title, excerpt=excluded.excerpt,
    byline=excluded.byline, extraction_failed=excluded.extraction_failed,
    fetched_at=excluded.fetched_at;

-- name: GetArticleByStoryID :one
SELECT story_id, content, title, excerpt, byline, extraction_failed, fetched_at
FROM articles WHERE story_id = ?;

-- name: DeleteArticle :exec
DELETE FROM articles WHERE story_id = ?;
