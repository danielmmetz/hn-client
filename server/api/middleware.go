package api

import (
	"net/http"

	"hn-client/server/store"
)

// RequireAuth wraps an http.Handler and returns 401 if no valid session cookie is present.
func RequireAuth(sessionStore *store.SessionStore, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		cookie, err := r.Cookie(sessionCookieName)
		if err != nil {
			http.Error(w, `{"error":"not authenticated"}`, http.StatusUnauthorized)
			return
		}

		sess, err := sessionStore.Get(r.Context(), cookie.Value)
		if err != nil || sess == nil {
			http.Error(w, `{"error":"not authenticated"}`, http.StatusUnauthorized)
			return
		}

		next.ServeHTTP(w, r)
	})
}

// RequireAuthFunc wraps an http.HandlerFunc.
func RequireAuthFunc(sessionStore *store.SessionStore, next http.HandlerFunc) http.Handler {
	return RequireAuth(sessionStore, http.HandlerFunc(next))
}
