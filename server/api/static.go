package api

import (
	"io/fs"
	"mime"
	"net/http"
	"path"
	"strings"
)

// NewStaticHandler returns an http.HandlerFunc that serves static files from the given FS,
// with appropriate caching headers and SPA fallback to index.html.
func NewStaticHandler(staticFS fs.FS) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// Clean the path
		urlPath := strings.TrimPrefix(r.URL.Path, "/")
		if urlPath == "" {
			urlPath = "index.html"
		}

		// Try to serve the exact file
		if data, err := fs.ReadFile(staticFS, urlPath); err == nil {
			// Set content type based on extension
			ext := path.Ext(urlPath)
			ct := mime.TypeByExtension(ext)
			if ct == "" {
				ct = "application/octet-stream"
			}
			w.Header().Set("Content-Type", ct)

			// Cache hashed assets aggressively, others briefly
			if strings.HasPrefix(urlPath, "assets/") {
				w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
			} else if urlPath == "sw.js" {
				w.Header().Set("Cache-Control", "no-cache")
			} else {
				w.Header().Set("Cache-Control", "public, max-age=300")
			}

			w.Write(data)
			return
		}

		// Catch-all: serve index.html for client-side routing
		if data, err := fs.ReadFile(staticFS, "index.html"); err == nil {
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			w.Header().Set("Cache-Control", "no-cache")
			w.Write(data)
			return
		}

		// No static files — return a simple status page
		w.Header().Set("Content-Type", "text/html")
		w.Write([]byte(`<!DOCTYPE html><html><body><h1>HN Client</h1><p>Server is running. Client not built yet.</p></body></html>`))
	}
}
