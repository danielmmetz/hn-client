package main

import (
	"context"
	"embed"
	"flag"
	"io/fs"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/peterbourgon/ff/v3"

	"github.com/danielmmetz/hn-client/server/api"
	"github.com/danielmmetz/hn-client/server/hn"
	"github.com/danielmmetz/hn-client/server/sse"
	"github.com/danielmmetz/hn-client/server/store"
	"github.com/danielmmetz/hn-client/server/worker"
)

//go:embed static/*
var staticFiles embed.FS

func main() {
	flagSet := flag.NewFlagSet("hn-client", flag.ExitOnError)

	staticDir := flagSet.String("static-dir", "", "Path to static files directory (default: use embedded files)")
	dbPath := flagSet.String("db-path", "hn.db", "Path to SQLite database file")
	oidcIssuer := flagSet.String("oidc-issuer", "", "OIDC issuer URL")
	oidcClientID := flagSet.String("oidc-client-id", "", "OIDC client ID")
	oidcClientSecret := flagSet.String("oidc-client-secret", "", "OIDC client secret")
	oidcRedirectURI := flagSet.String("oidc-redirect-uri", "", "OIDC redirect URI")

	if err := ff.Parse(flagSet, os.Args[1:], ff.WithEnvVars()); err != nil {
		slog.Error("failed to parse flags", "error", err)
		os.Exit(1)
	}

	// Database
	db, err := store.Open(*dbPath)
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
	if *oidcIssuer == "" || *oidcClientID == "" || *oidcClientSecret == "" || *oidcRedirectURI == "" {
		slog.Error("oidc-issuer, oidc-client-id, oidc-client-secret, and oidc-redirect-uri must be set (via flags or env vars OIDC_ISSUER, OIDC_CLIENT_ID, OIDC_CLIENT_SECRET, OIDC_REDIRECT_URI)")
		os.Exit(1)
	}

	oidcProvider, err := api.SetupOIDCProvider(context.Background(), *oidcIssuer)
	if err != nil {
		slog.Error("OIDC discovery failed", "error", err)
		os.Exit(1)
	}

	oidcConfig := &api.OIDCConfig{
		Issuer:       *oidcIssuer,
		ClientID:     *oidcClientID,
		ClientSecret: *oidcClientSecret,
		RedirectURI:  *oidcRedirectURI,
	}

	slog.Info("OIDC configured", "issuer", *oidcIssuer)

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

	// Static file serving: embedded FS by default, filesystem override with -static-dir flag
	var staticFS fs.FS
	if *staticDir != "" {
		slog.Info("serving static files from filesystem", "dir", *staticDir)
		staticFS = os.DirFS(*staticDir)
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
