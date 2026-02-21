# HN Client

**Subway-compatible Hacker News.** The idea is simple: you open the app before going underground, and it already has everything you need. The server proactively fetches top stories, their full comment trees, and reader-mode article extractions on a 1-minute cycle. The client prefetches this data into IndexedDB so that stories, articles, and comments are all available offline — no loading spinners, no "connect to read more." When you resurface, it syncs up quietly via SSE.

A mobile-first PWA with a Go+SQLite caching backend. The server proxies and caches HN data (stories, comments, reader-mode article extractions), provides alternative ranking APIs (top of day/week), and streams updates to clients over SSE. Authentication via OIDC is available but optional — controlled by the `-require-auth` flag. The client uses Preact, IndexedDB for offline storage, and a Service Worker for app shell caching.

---

## Architecture

```
┌──────────────────────────────┐
│  Client (Preact PWA)         │
│  IndexedDB · Service Worker  │
└──────────────┬───────────────┘
               │ REST + SSE
┌──────────────▼───────────────┐
│  Server (Go)                 │
│  SQLite · Background Poller  │
└──────────────┬───────────────┘
               │
       HN Firebase API
```

---

## Server

**Stack:** Go · SQLite (`modernc.org/sqlite`, pure Go, WAL mode) · `net/http` (Go 1.22+ routing) · `go-readability` · OIDC (`go-oidc`) · SSE via stdlib

A **polling worker** runs every minute, fetching up to 500 story IDs from the HN Firebase API with a concurrency limit of 10 requests. The top 60 stories are **eagerly fetched** (metadata + comments + articles); stories 61–500 get metadata only and are fetched on demand. Comments are fetched **incrementally** — only new comment IDs not already in the database are walked. Articles are extracted via `go-readability` with a 30s timeout and 1 MiB size cap; failures are flagged for optional client-initiated retry.

**Rankings** are recomputed each poll cycle using an HN-adapted decay formula: `(score - 1) / (age_hours + 2)^1.5`. Period rankings (today, yesterday, this week) filter by story creation time.

A **daily cleanup** job removes stories that haven't been on the front page for 30+ days and aren't in any active ranking period.

All mutations push events to **SSE subscribers** with monotonic IDs. A ring buffer (last 1000 events) supports `Last-Event-ID` reconnection; clients that fall too far behind receive a `sync_required` event.

All SQL queries are managed with [sqlc](https://sqlc.dev/) — plain SQL in, type-safe Go out. To regenerate after changing queries or schema: `cd server && go tool sqlc generate`.

### Configuration

Authentication is **optional**, controlled by the `-require-auth` flag. When disabled (the default), API routes are open and `/api/auth/me` returns a dummy anonymous user. When enabled, all API endpoints require a valid OIDC session (PKCE, 30-day max age, stored in SQLite).

| Flag | Env Var | Description |
|---|---|---|
| `-addr` | `ADDR` | Listen address (default: `:8080`) |
| `-db-path` | `DB_PATH` | Path to SQLite database (default: `hn.db`) |
| `-require-auth` | `REQUIRE_AUTH` | Enable OIDC authentication (default: `false`) |
| `-oidc-issuer` | `OIDC_ISSUER` | OIDC issuer URL |
| `-oidc-client-id` | `OIDC_CLIENT_ID` | OIDC client ID |
| `-oidc-client-secret` | `OIDC_CLIENT_SECRET` | OIDC client secret |
| `-oidc-redirect-uri` | `OIDC_REDIRECT_URI` | OIDC redirect URI |

---

## Client

**Stack:** Preact (~3KB) · Vite · Hash-based routing (no router library) · IndexedDB (via `idb`) · Workbox Service Worker · Plain CSS

The Service Worker caches only the app shell (HTML/JS/CSS) — it does **not** intercept API requests. Data flows through the Preact app's fetch layer: network-first with IndexedDB fallback. On fast/unmetered connections, comments and articles for the top 30 stories are prefetched in the background. On metered/slow connections (detected via `navigator.connection`), prefetch is skipped and a manual load button is shown.

The client maintains an SSE connection for real-time updates. Story list updates show a non-intrusive toast; comment and article updates are applied after user-initiated refreshes.

### Keyboard Shortcuts

Vim-style keyboard navigation. Press `?` to toggle a help modal.

| Key | Action | Context |
|---|---|---|
| `J` / `K` | Next / previous story | Story list / split sidebar |
| `j` / `k` | Next / previous comment | Comments view |
| `x` | Collapse/expand comment subtree | Focused comment |
| `r` | Reader view | Story selected |
| `c` | Comments view | Reader view |
| `?` | Toggle shortcut help | Global |

---

## Key Design Decisions

- **Pure-Go SQLite (`modernc.org/sqlite`)** — No CGo dependency simplifies builds and deployment. WAL mode gives concurrent read/write performance.
- **Eager/lazy fetch split** — Top 60 stories get full data on every poll; the rest are metadata-only until requested. Balances freshness with API courtesy.
- **Incremental comment fetching** — Only new comment branches are walked on refresh, avoiding full tree re-walks for popular stories with 1000+ comments.
- **Pre-nested comment trees from server** — The server builds the tree so the client doesn't have to reconstruct it from flat data.
- **Service Worker doesn't touch API data** — All API caching is in the app layer via IndexedDB. This avoids SW/main-thread race conditions over IndexedDB.
- **Hash-based routing** — The split layout stays mounted across story selections, so the story list never refetches. Links are plain `<a href="#/...">` with no click interception, so cmd+click and middle-click work naturally.
- **Single binary deployment** — Client build is embedded via `//go:embed static/*`. One binary, no file dependencies.
- **Keyboard navigation via DOM queries** — Comment focus uses DOM-order queries on `data-comment-id` attributes rather than threading focus state through the recursive component tree. Collapse state is lifted to `CommentTree` as a `Set<id>` for keyboard toggle support.
