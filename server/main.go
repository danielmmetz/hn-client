package main

import (
	"context"
	"embed"
	"flag"
	"fmt"
	"io/fs"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"
	_ "time/tzdata"

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

	var (
		addr             string
		port             int
		staticDir        string
		dbPath           string
		requireAuthFlag  bool
		oidcIssuer       string
		oidcClientID     string
		oidcClientSecret string
		oidcRedirectURI  string
	)
	flagSet.StringVar(&addr, "addr", "localhost", "Address to listen on")
	flagSet.IntVar(&port, "port", 8080, "Port to listen on")
	flagSet.StringVar(&staticDir, "static-dir", "", "Path to static files directory (default: use embedded files)")
	flagSet.StringVar(&dbPath, "db-path", "hn.db", "Path to SQLite database file")
	flagSet.BoolVar(&requireAuthFlag, "require-auth", false, "Require OIDC authentication for API routes")
	flagSet.StringVar(&oidcIssuer, "oidc-issuer", "", "OIDC issuer URL")
	flagSet.StringVar(&oidcClientID, "oidc-client-id", "", "OIDC client ID")
	flagSet.StringVar(&oidcClientSecret, "oidc-client-secret", "", "OIDC client secret")
	flagSet.StringVar(&oidcRedirectURI, "oidc-redirect-uri", "", "OIDC redirect URI")

	if err := ff.Parse(flagSet, os.Args[1:], ff.WithEnvVars()); err != nil {
		slog.Error("failed to parse flags", "error", err)
		os.Exit(1)
	}

	// Database
	db, err := store.Open(dbPath)
	if err != nil {
		slog.Error("failed to open database", "error", err)
		os.Exit(1)
	}
	defer db.Close()

	q := store.New()

	// OIDC state — only populated when auth is required
	var authHandler *api.AuthHandler
	if requireAuthFlag {
		if oidcIssuer == "" || oidcClientID == "" || oidcClientSecret == "" || oidcRedirectURI == "" {
			slog.Error("oidc-issuer, oidc-client-id, oidc-client-secret, and oidc-redirect-uri must be set when -require-auth is enabled (via flags or env vars OIDC_ISSUER, OIDC_CLIENT_ID, OIDC_CLIENT_SECRET, OIDC_REDIRECT_URI)")
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

		authHandler = api.NewAuthHandler(oidcProvider, oidcConfig, db, q)
		slog.Info("OIDC configured", "issuer", oidcIssuer)
	} else {
		slog.Info("authentication disabled (use -require-auth to enable)")
	}

	// HN client
	hnClient := hn.NewClient()

	// SSE broker
	broker := sse.NewBroker(1000)

	// Shared TopList for pagination
	topList := store.NewTopList()

	// Fetcher
	fetcher := worker.NewFetcher(hnClient, db, q)

	// Background worker context
	workerCtx, workerCancel := context.WithCancel(context.Background())

	// Background poller
	poller := worker.NewPoller(hnClient, fetcher, db, q, broker, topList)
	poller.Start(workerCtx)

	// Daily cleanup
	cleaner := worker.NewCleaner(db, q)
	cleaner.Start(workerCtx)

	// API handlers
	storiesHandler := api.NewStoriesHandler(db, q, topList, fetcher)
	commentsHandler := api.NewCommentsHandler(db, q, fetcher, hnClient)
	articlesHandler := api.NewArticlesHandler(db, q, fetcher)
	refreshHandler := api.NewRefreshHandler(fetcher, hnClient, db, q, broker)
	healthHandler := api.NewHealthHandler(db, q)
	// Auth helper — wraps handlers in auth check when enabled, otherwise passes through
	var requireAuth func(http.HandlerFunc) http.Handler
	var requireAuthHandler func(http.Handler) http.Handler
	if requireAuthFlag {
		requireAuth = func(hf http.HandlerFunc) http.Handler {
			return api.RequireAuthFunc(db, q, hf)
		}
		requireAuthHandler = func(h http.Handler) http.Handler {
			return api.RequireAuth(db, q, h)
		}
	} else {
		requireAuth = func(hf http.HandlerFunc) http.Handler {
			return hf
		}
		requireAuthHandler = func(h http.Handler) http.Handler {
			return h
		}
	}

	// Routes
	mux := http.NewServeMux()

	// Auth routes (only registered when auth is required)
	if requireAuthFlag {
		mux.HandleFunc("GET /api/auth/login", authHandler.Login)
		mux.HandleFunc("GET /api/auth/callback", authHandler.Callback)
		mux.HandleFunc("GET /api/auth/me", authHandler.Me)
		mux.HandleFunc("POST /api/auth/logout", authHandler.Logout)
	} else {
		// When auth is disabled, /api/auth/me returns a dummy user so the frontend proceeds
		mux.HandleFunc("GET /api/auth/me", func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			w.Write([]byte(`{"sub":"anonymous","name":"Anonymous"}`))
		})
	}

	// API routes
	mux.Handle("GET /api/stories/top", requireAuth(storiesHandler.TopStories))
	mux.Handle("GET /api/stories/{id}/article", requireAuth(articlesHandler.GetArticle))
	mux.Handle("GET /api/stories/{id}/comments", requireAuth(commentsHandler.GetComments))
	mux.Handle("GET /api/stories/{id}/refresh", requireAuth(refreshHandler.Refresh))
	mux.Handle("POST /api/stories/{id}/refresh", requireAuth(refreshHandler.Refresh))
	mux.Handle("GET /api/stories/{id}", requireAuth(storiesHandler.GetStory))
	mux.Handle("GET /api/stories", requireAuth(storiesHandler.ListStories))
	mux.Handle("GET /api/health", requireAuthHandler(healthHandler))
	mux.Handle("GET /api/events", requireAuthHandler(broker))

	// Static file serving
	var staticFS fs.FS
	if staticDir != "" {
		slog.Info("serving static files from filesystem", "dir", staticDir)
		staticFS = os.DirFS(staticDir)
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
	listenAddr := fmt.Sprintf("%s:%d", addr, port)
	srv := &http.Server{
		Addr:    listenAddr,
		Handler: mux,
	}

	go func() {
		slog.Info("server starting", "addr", listenAddr)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			slog.Error("server error", "error", err)
			os.Exit(1)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	sig := <-quit
	slog.Info("received signal, shutting down", "signal", sig)

	workerCancel()

	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer shutdownCancel()

	if err := srv.Shutdown(shutdownCtx); err != nil {
		slog.Error("server shutdown error", "error", err)
	}

	slog.Info("server stopped")
}
