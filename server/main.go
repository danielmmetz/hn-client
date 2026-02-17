package main

import (
	"context"
	"embed"
	"io/fs"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"hn-client/server/api"
	"hn-client/server/hn"
	"hn-client/server/sse"
	"hn-client/server/store"
	"hn-client/server/worker"
)

//go:embed static/*
var staticFiles embed.FS

func main() {
	// Database
	dbPath := "hn.db"
	if p := os.Getenv("DB_PATH"); p != "" {
		dbPath = p
	}

	db, err := store.Open(dbPath)
	if err != nil {
		slog.Error("failed to open database", "error", err)
		os.Exit(1)
	}
	defer db.Close()

	// Stores
	storyStore := store.NewStoryStore(db)
	commentStore := store.NewCommentStore(db)
	articleStore := store.NewArticleStore(db)
	rankingStore := store.NewRankingStore(db)
	sessionStore := store.NewSessionStore(db)

	// OIDC configuration
	oidcIssuer := os.Getenv("OIDC_ISSUER")
	oidcClientID := os.Getenv("OIDC_CLIENT_ID")
	oidcClientSecret := os.Getenv("OIDC_CLIENT_SECRET")
	oidcRedirectURI := os.Getenv("OIDC_REDIRECT_URI")

	if oidcIssuer == "" || oidcClientID == "" || oidcClientSecret == "" || oidcRedirectURI == "" {
		slog.Error("OIDC_ISSUER, OIDC_CLIENT_ID, OIDC_CLIENT_SECRET, and OIDC_REDIRECT_URI must be set")
		os.Exit(1)
	}

	oidcProvider, err := api.SetupOIDCProvider(context.Background(), oidcIssuer)
	if err != nil {
		slog.Error("OIDC discovery failed", "error", err)
		os.Exit(1)
	}

	oidcConfig := &api.OIDCConfig{
		Issuer:       oidcIssuer,
		ClientID:     oidcClientID,
		ClientSecret: oidcClientSecret,
		RedirectURI:  oidcRedirectURI,
	}

	slog.Info("OIDC configured", "issuer", oidcIssuer)

	// HN client
	hnClient := hn.NewClient()

	// SSE broker
	broker := sse.NewBroker(1000)

	// Shared TopList for pagination
	topList := store.NewTopList()

	// Fetcher: created externally and injected into both Poller and API handlers
	fetcher := worker.NewFetcher(hnClient, storyStore, commentStore, articleStore)

	// Background worker context — cancelled on shutdown to stop all goroutines
	workerCtx, workerCancel := context.WithCancel(context.Background())

	// Background poller (with article extraction and ranking computation)
	poller := worker.NewPoller(hnClient, fetcher, storyStore, commentStore, articleStore, rankingStore, broker, topList)
	poller.Start(workerCtx)

	// Daily cleanup
	cleaner := worker.NewCleaner(storyStore)
	cleaner.Start(workerCtx)

	// API handlers
	storiesHandler := api.NewStoriesHandler(storyStore, rankingStore, topList, fetcher)
	commentsHandler := api.NewCommentsHandler(commentStore, storyStore, fetcher, hnClient)
	articlesHandler := api.NewArticlesHandler(articleStore, storyStore, fetcher)
	refreshHandler := api.NewRefreshHandler(fetcher, hnClient, storyStore, articleStore, broker)
	healthHandler := api.NewHealthHandler(storyStore)
	authHandler := api.NewAuthHandler(oidcProvider, oidcConfig, sessionStore)

	// Auth helper
	requireAuth := func(hf http.HandlerFunc) http.Handler {
		return api.RequireAuthFunc(sessionStore, hf)
	}

	// Routes
	mux := http.NewServeMux()

	// Auth routes (unauthenticated)
	mux.HandleFunc("GET /api/auth/login", authHandler.Login)
	mux.HandleFunc("GET /api/auth/callback", authHandler.Callback)
	mux.HandleFunc("GET /api/auth/me", authHandler.Me)
	mux.HandleFunc("POST /api/auth/logout", authHandler.Logout)

	// API routes (authenticated)
	mux.Handle("GET /api/stories/top", requireAuth(storiesHandler.TopStories))
	mux.Handle("GET /api/stories/{id}/article", requireAuth(articlesHandler.GetArticle))
	mux.Handle("GET /api/stories/{id}/comments", requireAuth(commentsHandler.GetComments))
	mux.Handle("GET /api/stories/{id}/refresh", requireAuth(refreshHandler.Refresh))
	mux.Handle("POST /api/stories/{id}/refresh", requireAuth(refreshHandler.Refresh))
	mux.Handle("GET /api/stories/{id}", requireAuth(storiesHandler.GetStory))
	mux.Handle("GET /api/stories", requireAuth(storiesHandler.ListStories))
	mux.Handle("GET /api/health", api.RequireAuth(sessionStore, healthHandler))
	mux.Handle("GET /api/events", api.RequireAuth(sessionStore, broker))

	// Static file serving: embedded FS by default, filesystem override with STATIC_DIR
	var staticFS fs.FS
	if d := os.Getenv("STATIC_DIR"); d != "" {
		slog.Info("serving static files from filesystem", "dir", d)
		staticFS = os.DirFS(d)
	} else {
		sub, err := fs.Sub(staticFiles, "static")
		if err != nil {
			slog.Error("failed to create sub FS", "error", err)
			os.Exit(1)
		}
		slog.Info("serving static files from embedded FS")
		staticFS = sub
	}

	mux.HandleFunc("/", api.NewStaticHandler(staticFS))

	// HTTP server with graceful shutdown
	addr := ":8080"
	srv := &http.Server{
		Addr:    addr,
		Handler: mux,
	}

	// Start server in a goroutine
	go func() {
		slog.Info("server starting", "addr", addr)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			slog.Error("server error", "error", err)
			os.Exit(1)
		}
	}()

	// Wait for interrupt signal
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	sig := <-quit
	slog.Info("received signal, shutting down", "signal", sig)

	// Cancel background workers first
	workerCancel()

	// Gracefully shut down HTTP server (waits for in-flight requests, including SSE)
	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer shutdownCancel()

	if err := srv.Shutdown(shutdownCtx); err != nil {
		slog.Error("server shutdown error", "error", err)
	}

	slog.Info("server stopped")
}
