package api

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/coreos/go-oidc/v3/oidc"
	"golang.org/x/oauth2"

	"hn-client/server/store"
)

const (
	sessionCookieName = "hn_session"
	stateCookieName   = "hn_oauth_state"
	pkceVerifierLen   = 64
	sessionMaxAge     = 30 * 24 * 60 * 60 // 30 days
)

type OIDCConfig struct {
	Issuer       string
	ClientID     string
	ClientSecret string
	RedirectURI  string
}

type AuthHandler struct {
	provider     *oidc.Provider
	verifier     *oidc.IDTokenVerifier
	oauth2Config oauth2.Config
	sessionStore *store.SessionStore
}

// NewAuthHandler creates an AuthHandler using go-oidc for discovery and token verification.
func NewAuthHandler(provider *oidc.Provider, cfg *OIDCConfig, sessionStore *store.SessionStore) *AuthHandler {
	verifier := provider.Verifier(&oidc.Config{ClientID: cfg.ClientID})

	oauth2Config := oauth2.Config{
		ClientID:     cfg.ClientID,
		ClientSecret: cfg.ClientSecret,
		RedirectURL:  cfg.RedirectURI,
		Endpoint:     provider.Endpoint(),
		Scopes:       []string{oidc.ScopeOpenID, "profile", "email"},
	}

	return &AuthHandler{
		provider:     provider,
		verifier:     verifier,
		oauth2Config: oauth2Config,
		sessionStore: sessionStore,
	}
}

// SetupOIDCProvider performs OIDC discovery and returns the provider.
func SetupOIDCProvider(ctx context.Context, issuer string) (*oidc.Provider, error) {
	return oidc.NewProvider(ctx, issuer)
}

// Login redirects to the OIDC authorization endpoint.
func (h *AuthHandler) Login(w http.ResponseWriter, r *http.Request) {
	state := randomString(32)
	verifier := randomString(pkceVerifierLen)

	// Store state + verifier in a cookie
	stateData := state + "|" + verifier
	http.SetCookie(w, &http.Cookie{
		Name:     stateCookieName,
		Value:    stateData,
		Path:     "/api/auth",
		MaxAge:   600, // 10 minutes
		HttpOnly: true,
		Secure:   true,
		SameSite: http.SameSiteLaxMode,
	})

	// PKCE challenge
	challenge := oauth2.S256ChallengeOption(verifier)

	url := h.oauth2Config.AuthCodeURL(state, challenge)
	http.Redirect(w, r, url, http.StatusFound)
}

// Callback handles the OIDC authorization code callback.
func (h *AuthHandler) Callback(w http.ResponseWriter, r *http.Request) {
	// Check for error from provider
	if errParam := r.URL.Query().Get("error"); errParam != "" {
		desc := r.URL.Query().Get("error_description")
		http.Error(w, "OAuth error: "+errParam+" — "+desc, http.StatusBadRequest)
		return
	}

	code := r.URL.Query().Get("code")
	state := r.URL.Query().Get("state")
	if code == "" || state == "" {
		http.Error(w, "missing code or state", http.StatusBadRequest)
		return
	}

	// Retrieve and validate state cookie
	cookie, err := r.Cookie(stateCookieName)
	if err != nil {
		http.Error(w, "missing state cookie", http.StatusBadRequest)
		return
	}
	parts := strings.SplitN(cookie.Value, "|", 2)
	if len(parts) != 2 || parts[0] != state {
		http.Error(w, "state mismatch", http.StatusBadRequest)
		return
	}
	verifier := parts[1]

	// Clear state cookie
	http.SetCookie(w, &http.Cookie{
		Name:     stateCookieName,
		Value:    "",
		Path:     "/api/auth",
		MaxAge:   -1,
		HttpOnly: true,
		Secure:   true,
		SameSite: http.SameSiteLaxMode,
	})

	// Exchange code for tokens (with PKCE verifier)
	oauth2Token, err := h.oauth2Config.Exchange(r.Context(), code, oauth2.VerifierOption(verifier))
	if err != nil {
		slog.Error("token exchange failed", "error", err)
		http.Error(w, "token exchange failed", http.StatusInternalServerError)
		return
	}

	// Extract and verify ID token
	rawIDToken, ok := oauth2Token.Extra("id_token").(string)
	if !ok {
		http.Error(w, "no id_token in response", http.StatusInternalServerError)
		return
	}

	idToken, err := h.verifier.Verify(r.Context(), rawIDToken)
	if err != nil {
		slog.Error("ID token verification failed", "error", err)
		http.Error(w, "ID token verification failed", http.StatusInternalServerError)
		return
	}

	// Extract claims
	var claims struct {
		Sub               string `json:"sub"`
		Name              string `json:"name"`
		Email             string `json:"email"`
		Picture           string `json:"picture,omitempty"`
		PreferredUsername string `json:"preferred_username,omitempty"`
	}
	if err := idToken.Claims(&claims); err != nil {
		slog.Error("failed to parse ID token claims", "error", err)
		http.Error(w, "failed to parse claims", http.StatusInternalServerError)
		return
	}

	if claims.Sub == "" {
		http.Error(w, "missing sub claim", http.StatusInternalServerError)
		return
	}

	// Build user info JSON
	userInfo := map[string]interface{}{
		"sub":   claims.Sub,
		"name":  claims.Name,
		"email": claims.Email,
	}
	if claims.Picture != "" {
		userInfo["picture"] = claims.Picture
	}
	if claims.PreferredUsername != "" {
		userInfo["preferred_username"] = claims.PreferredUsername
	}
	userInfoJSON, _ := json.Marshal(userInfo)

	// Create session
	sessionToken := randomString(48)
	expiresAt := time.Now().Unix() + sessionMaxAge

	if err := h.sessionStore.Create(r.Context(), &store.Session{
		Token:     sessionToken,
		UserSub:   claims.Sub,
		UserInfo:  string(userInfoJSON),
		ExpiresAt: expiresAt,
	}); err != nil {
		slog.Error("failed to create session", "error", err)
		http.Error(w, "session creation failed", http.StatusInternalServerError)
		return
	}

	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookieName,
		Value:    sessionToken,
		Path:     "/",
		MaxAge:   sessionMaxAge,
		HttpOnly: true,
		Secure:   true,
		SameSite: http.SameSiteLaxMode,
	})

	http.Redirect(w, r, "/", http.StatusFound)
}

// Me returns the current user's info or 401.
func (h *AuthHandler) Me(w http.ResponseWriter, r *http.Request) {
	cookie, err := r.Cookie(sessionCookieName)
	if err != nil {
		http.Error(w, "not authenticated", http.StatusUnauthorized)
		return
	}

	sess, err := h.sessionStore.Get(r.Context(), cookie.Value)
	if err != nil || sess == nil {
		http.Error(w, "not authenticated", http.StatusUnauthorized)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.Write([]byte(sess.UserInfo))
}

// Logout clears the session.
func (h *AuthHandler) Logout(w http.ResponseWriter, r *http.Request) {
	cookie, err := r.Cookie(sessionCookieName)
	if err == nil {
		h.sessionStore.Delete(r.Context(), cookie.Value)
	}

	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookieName,
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		HttpOnly: true,
		Secure:   true,
		SameSite: http.SameSiteLaxMode,
	})

	w.Header().Set("Content-Type", "application/json")
	w.Write([]byte(`{"ok":true}`))
}

// --- PKCE Helpers ---

func s256Challenge(verifier string) string {
	h := sha256.Sum256([]byte(verifier))
	return base64.RawURLEncoding.EncodeToString(h[:])
}

func randomString(length int) string {
	b := make([]byte, length)
	rand.Read(b)
	return base64.RawURLEncoding.EncodeToString(b)[:length]
}
