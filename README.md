# HN Client

**Subway-compatible Hacker News.** The idea is simple: you open the app before going underground, and it already has everything you need. The server proactively fetches top stories, their full comment trees, and reader-mode article extractions on a 5-minute cycle. The client prefetches this data into IndexedDB so that stories, articles, and comments are all available offline — no loading spinners, no "connect to read more." When you resurface, it syncs up quietly via SSE.

A mobile-first PWA with a Go+SQLite caching backend. The server proxies and caches HN data (stories, comments, reader-mode article extractions), provides alternative ranking APIs (top of day/week), and streams updates to clients over SSE. Authentication is handled via OIDC. The client uses Preact, IndexedDB for offline storage, and a Service Worker for app shell caching.

---

## Architecture

```
┌─────────────────────────────────────────────────┐
│  Client (PWA)                                   │
│                                                 │
│  Preact App                                     │
│  ├── Story List (paginated, pull-to-refresh)    │
│  ├── Story Detail (article + threaded comments) │
│  ├── Starred Posts                              │
│  └── Staleness Indicators                       │
│                                                 │
│  Service Worker                                 │
│  └── Cache app shell (HTML/JS/CSS) only         │
│                                                 │
│  IndexedDB (managed by app, not SW)             │
│  ├── stories (metadata)                         │
│  ├── articles (reader-mode content)             │
│  ├── comments (per story, nested)               │
│  ├── stars (bookmarked story IDs)               │
│  └── sync_meta (last fetch times, staleness)    │
└──────────────┬──────────────────────────────────┘
               │ HTTPS
               │ REST + SSE
┌──────────────▼──────────────────────────────────┐
│  Server (Go + SQLite)                           │
│                                                 │
│  HTTP API                                       │
│  ├── GET /api/auth/login              (OIDC)    │
│  ├── GET /api/auth/callback           (OIDC)    │
│  ├── GET /api/auth/me                 (session)  │
│  ├── POST /api/auth/logout            (session)  │
│  ├── GET /api/stories?page=N          (top 30)  │
│  ├── GET /api/stories/top?period=day|week|...   │
│  ├── GET /api/stories/:id             (detail)  │
│  ├── GET /api/stories/:id/article     (reader)  │
│  ├── GET /api/stories/:id/comments    (tree)    │
│  ├── POST /api/stories/:id/refresh    (trigger) │
│  ├── GET /api/events                  (SSE)     │
│  └── GET /                            (PWA)     │
│                                                 │
│  Background Workers                             │
│  ├── Poll HN top stories every 5 min            │
│  ├── Fetch comments for new stories             │
│  ├── Extract reader-mode articles               │
│  ├── Push updates to SSE subscribers            │
│  └── Daily cleanup of old data                  │
│                                                 │
│  SQLite                                         │
│  ├── stories                                    │
│  ├── comments                                   │
│  ├── articles (reader-mode content)             │
│  ├── rankings (precomputed popularity)          │
│  └── sessions (OIDC auth)                       │
└─────────────────────────────────────────────────┘
               │
               │ HTTPS (HN Firebase API + article URLs)
               ▼
       Hacker News API
       (hacker-news.firebaseio.com)
```

---

## Server

**Stack:** Go · SQLite (`modernc.org/sqlite`, pure Go, WAL mode) · `net/http` (Go 1.22+ routing) · `go-readability` · OIDC (`go-oidc`) · SSE via stdlib

### How It Works

A **polling worker** runs every 5 minutes, fetching up to 500 story IDs from the HN Firebase API with a concurrency limit of 10 requests. The top 60 stories are **eagerly fetched** (metadata + comments + articles); stories 61–500 get metadata only and are fetched on demand. Comments are fetched **incrementally** — only new comment IDs not already in the database are walked. Articles are extracted via `go-readability` with a 30s timeout and 1 MiB size cap; failures are flagged for optional client-initiated retry.

**Rankings** are recomputed each poll cycle using an HN-adapted decay formula: `(score - 1) / (age_hours + 2)^1.5`. Period rankings (today, yesterday, this week) filter by story creation time.

A **daily cleanup** job removes stories that haven't been on the front page for 30+ days and aren't in any active ranking period.

All mutations push events to **SSE subscribers** with monotonic IDs. A ring buffer (last 1000 events) supports `Last-Event-ID` reconnection; clients that fall too far behind receive a `sync_required` event.

### Authentication

All API endpoints (except auth routes and static assets) require authentication. The server uses OIDC (via `go-oidc`) with PKCE. Sessions are stored server-side in SQLite with a 30-day max age.

| Endpoint | Description |
|---|---|
| `GET /api/auth/login` | Initiates OIDC login flow (redirects to provider) |
| `GET /api/auth/callback` | OIDC callback, creates session, sets `hn_session` cookie |
| `GET /api/auth/me` | Returns current user info from session |
| `POST /api/auth/logout` | Destroys session |

### API

| Endpoint | Description |
|---|---|
| `GET /api/stories?page=N` | Top stories, 30/page, ordered by HN rank. |
| `GET /api/stories/top?period=day\|yesterday\|week&page=N` | Period-based popular stories |
| `GET /api/stories/:id` | Story metadata |
| `GET /api/stories/:id/article` | Reader-mode content. 404 if no URL; includes `extraction_failed` flag. |
| `GET /api/stories/:id/comments` | Pre-nested comment tree (see format below) |
| `POST /api/stories/:id/refresh?article=true` | Re-fetch story + comments (also accepts GET). Rate-limited 1/story/30s. Returns 202; results via SSE. |
| `GET /api/events` | SSE stream. Events: `stories_updated`, `story_refreshed:{id}`, `comments_updated:{id}`, `sync_required` |
| `GET /api/health` | `{"status": "ok", "stories_count": N, "last_poll": timestamp}` |

Story and comment responses include `fetched_at` timestamps. All JSON responses include `ETag` headers (304 support).

### Comment Tree Format

Comments are returned pre-nested in HN's native ordering. Deleted comments with visible children are preserved as `[deleted]` placeholders; childless deleted comments are omitted.

```json
{
  "story_id": 123,
  "fetched_at": 1700000000,
  "comments": [
    {
      "id": 456, "by": "user1", "text": "<p>Comment</p>",
      "time": 1700000000, "dead": false, "deleted": false,
      "children": [
        {
          "id": 789, "by": "user2", "text": "<p>Reply</p>",
          "time": 1700000100, "dead": false, "deleted": false,
          "children": []
        }
      ]
    }
  ]
}
```

Note: `children` may be `null` (not just empty array) when a comment has no replies.

### Database Schema

Five tables: `stories`, `comments`, `articles`, `rankings`, `sessions`. The schema is defined in `store/sqlc/schema.sql` and applied via migrations in `store/db.go`. Key points:

- **stories** — keyed by HN item ID, includes `rank` (front-page position, NULL when off front page) and `fetched_at`
- **comments** — keyed by HN item ID, indexed on `story_id`, tracks `parent_id` for tree structure
- **articles** — keyed by `story_id`, stores reader-mode HTML + metadata, `extraction_failed` flag
- **rankings** — composite key `(story_id, period)`, indexed on `(period, score DESC)` for efficient period queries
- **sessions** — OIDC session storage, keyed by token, with user info and expiry

### SQL Queries (sqlc)

All SQL queries are managed with [sqlc](https://sqlc.dev/). Query definitions (`*.sql`), the schema (`schema.sql`), and the generated Go code all live together in `store/`. The generated types and query methods are used directly by API handlers and workers — `db` and `tx` handles are passed at each call site via `emit_methods_with_db_argument`. Hand-written Go is limited to `SwapRanks` (atomic rank transaction), `GetCommentTree` (nested tree building), and the `Nullable` helper for `sql.ErrNoRows` → nil conversion. Cascade deletes are handled by SQLite `ON DELETE CASCADE` foreign keys. The schema is embedded via `//go:embed` and used directly for migrations — no duplicate DDL.

To regenerate after changing queries or schema:

```
cd server && go tool sqlc generate
```

### Routing

API routes are prefixed with `/api/`. Static assets are embedded via `//go:embed static/*`. Any request that doesn't match an API route or static file is served `index.html` (catch-all for client-side routing with clean URLs).

---

## Client

**Stack:** Preact (~3KB) · Vite · IndexedDB (via `idb`) · Workbox Service Worker · Plain CSS

### Pages

| Route | Page | Description |
|---|---|---|
| `/` | StoryList | Paginated top stories (30/page). Pull-to-refresh. Staleness indicator. |
| `/story/:id` | StoryDetail | Reader-mode article (or text body for Ask HN), threaded comments with collapse/expand, star toggle, refresh controls. |
| `/article/:id` | ArticleReader | Standalone reader-mode article view. |
| `/starred` | Starred | Bookmarked stories, available offline. Client-side only (IndexedDB). |

### Offline Strategy

The Service Worker caches only the app shell (HTML/JS/CSS) — it does **not** intercept API requests. This avoids race conditions between the SW and main thread over IndexedDB.

Data flows through the Preact app's fetch layer: network-first with IndexedDB fallback. On app open, stories are rendered from IndexedDB immediately, then refreshed from the server. On fast/unmetered connections, comments and articles for the top 30 stories are prefetched in the background. On metered/slow connections (detected via `navigator.connection`), prefetch is skipped and a manual load button is shown. A user toggle overrides this.

Cache eviction runs on app open: non-starred content older than 24 hours is purged, then a 200MB size cap is enforced. Starred content is never evicted.

### Real-time Updates

The client maintains an SSE connection to `/api/events` with `Last-Event-ID` tracking. When `stories_updated` fires, a non-intrusive toast offers to refresh the list. On `sync_required` (after long offline), a full re-fetch is triggered. Comment and article refreshes are driven by `comments_updated:{id}` and `story_refreshed:{id}` events following user-initiated refresh requests.

### UI

Light mode only. Mobile-first with 44px touch targets, system font stack, and HN orange (`#ff6600`) accent. Threaded comments use colored nesting lines with tap-to-collapse and hidden reply counts.

---

## Project Structure

```
hn-client/
├── server/
│   ├── main.go                 # Entry, HTTP server, embeds static/
│   ├── api/
│   │   ├── stories.go          # Story endpoints + shared writeJSON/ETag helper
│   │   ├── comments.go         # Comment endpoints
│   │   ├── articles.go         # Article endpoints
│   │   ├── refresh.go          # Refresh trigger endpoint
│   │   ├── health.go           # Health check
│   │   ├── auth.go             # OIDC login/callback/logout handlers
│   │   ├── middleware.go        # Auth middleware (requireAuth)
│   │   └── static.go           # Static file serving with SPA fallback
│   ├── hn/
│   │   ├── client.go           # HN Firebase API client (concurrency-limited)
│   │   └── types.go            # HN API response types
│   ├── worker/
│   │   ├── poller.go           # 5-min HN polling loop
│   │   ├── fetcher.go          # Story/comment/article fetch logic
│   │   ├── ranker.go           # Ranking computation
│   │   └── cleaner.go          # Daily cleanup
│   ├── readability/
│   │   └── extract.go          # go-readability wrapper
│   ├── store/
│   │   ├── schema.sql          # DDL schema (embedded for migrations + sqlc)
│   │   ├── db.go               # SQLite setup (embeds schema.sql), Nullable helper
│   │   ├── stories.go/.sql     # SQL queries + SwapRanks transaction
│   │   ├── comments.go/.sql    # SQL queries + comment tree building (CommentNode)
│   │   ├── articles.sql        # SQL queries (no hand-written Go needed)
│   │   ├── rankings.sql        # SQL queries (no hand-written Go needed)
│   │   ├── sessions.sql        # SQL queries (no hand-written Go needed)
│   │   ├── toplist.go          # Thread-safe ordered top story ID list
│   │   ├── models.go           # Generated types (sqlc, do not edit)
│   │   ├── sqlc.go             # Generated DBTX/Queries (sqlc, do not edit)
│   │   └── *.sql.go            # Generated query methods (sqlc, do not edit)
│   ├── sse/
│   │   └── broker.go           # SSE manager, ring buffer, Last-Event-ID replay
│   └── static/                 # Vite build output (embedded into binary)
├── client/
│   ├── index.html
│   ├── manifest.json           # PWA manifest
│   ├── vite.config.js
│   ├── src/
│   │   ├── app.jsx             # Root component + router
│   │   ├── index.jsx           # Entry point
│   │   ├── pages/
│   │   │   ├── StoryList.jsx
│   │   │   ├── StoryDetail.jsx
│   │   │   ├── ArticleReader.jsx
│   │   │   └── Starred.jsx
│   │   ├── components/
│   │   │   ├── StoryItem.jsx
│   │   │   ├── CommentTree.jsx
│   │   │   ├── Comment.jsx
│   │   │   ├── ArticleView.jsx
│   │   │   ├── ErrorBoundary.jsx
│   │   │   ├── Pagination.jsx
│   │   │   ├── PullToRefresh.jsx
│   │   │   ├── StalenessLabel.jsx
│   │   │   └── Toast.jsx
│   │   ├── lib/
│   │   │   ├── api.js          # Server API client
│   │   │   ├── auth.js         # Client-side auth (login redirect, session check)
│   │   │   ├── db.js           # IndexedDB wrapper (idb)
│   │   │   ├── sse.js          # SSE with Last-Event-ID tracking
│   │   │   ├── sync.js         # Prefetch, eviction, data-saver logic
│   │   │   └── time.js         # Relative time formatting
│   │   ├── sw.js               # Service Worker (Workbox, app shell only)
│   │   └── styles/
│   │       ├── global.css
│   │       └── components.css
│   └── package.json
└── README.md
```

---

## Key Design Decisions

- **Pure-Go SQLite (`modernc.org/sqlite`)** — No CGo dependency simplifies builds and deployment. WAL mode gives concurrent read/write performance.
- **Eager/lazy fetch split** — Top 60 stories get full data on every poll; the rest are metadata-only until requested. Balances freshness with API courtesy.
- **Incremental comment fetching** — Only new comment branches are walked on refresh, avoiding full tree re-walks for popular stories with 1000+ comments.
- **Pre-nested comment trees from server** — The server builds the tree so the client doesn't have to reconstruct it from flat data.
- **Service Worker doesn't touch API data** — All API caching is in the app layer via IndexedDB. This avoids SW/main-thread race conditions over IndexedDB.
- **Client-side only stars** — Stars live in IndexedDB, not on the server. Clearing browser data loses them.
- **Single binary deployment** — Client build is embedded via `//go:embed static/*`. One binary, no file dependencies.
- **sqlc for type-safe SQL** — Queries are plain SQL; `go tool sqlc generate` produces type-safe Go. Column type overrides map SQLite integers to `int` and nullable columns to Go pointers. The generated types are used directly — no wrapper structs or conversion code. Schema is defined once in `schema.sql`, embedded for both sqlc codegen and runtime migrations.
- **ETags on all JSON responses** — Shared `writeJSON` helper (in `stories.go`) hashes response bodies for conditional request support (304 Not Modified). Used by all API handlers.
- **SSE with ring buffer** — Last 1000 events buffered for `Last-Event-ID` reconnection. Clients too far behind get `sync_required` to trigger a full re-fetch.
