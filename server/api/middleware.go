package api

import (
	"database/sql"
	"net/http"
	"time"

	"github.com/danielmmetz/hn-client/server/store"
)

// RequireAuth wraps an http.Handler and returns 401 if no valid session cookie is present.
func RequireAuth(db *sql.DB, q *store.Queries, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		cookie, err := r.Cookie(sessionCookieName)
		if err != nil {
			http.Error(w, `{"error":"not authenticated"}`, http.StatusUnauthorized)
			return
		}

		sess, err := store.Nullable(q.GetSession(r.Context(), db, store.GetSessionParams{
			Token: cookie.Value, ExpiresAt: time.Now().Unix(),
		}))
		if err != nil || sess == nil {
			http.Error(w, `{"error":"not authenticated"}`, http.StatusUnauthorized)
			return
		}

		next.ServeHTTP(w, r)
	})
}

// RequireAuthFunc wraps an http.HandlerFunc.
func RequireAuthFunc(db *sql.DB, q *store.Queries, next http.HandlerFunc) http.Handler {
	return RequireAuth(db, q, http.HandlerFunc(next))
}
