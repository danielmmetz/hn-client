package api

import (
	"database/sql"
	"errors"
	"net/http"
	"time"

	"github.com/danielmmetz/hn-client/server/store"
)

var errNotAuthenticated = errors.New("not authenticated")

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

// GetUserSub validates the session cookie and returns the user_sub.
// Returns ("", error) if not authenticated.
func GetUserSub(r *http.Request, db *sql.DB, q *store.Queries) (string, error) {
	cookie, err := r.Cookie(sessionCookieName)
	if err != nil {
		return "", err
	}

	sess, err := store.Nullable(q.GetSession(r.Context(), db, store.GetSessionParams{
		Token: cookie.Value, ExpiresAt: time.Now().Unix(),
	}))
	if err != nil {
		return "", err
	}
	if sess == nil {
		return "", errNotAuthenticated
	}
	return sess.UserSub, nil
}
