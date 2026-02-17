package readability

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"time"

	goreadability "github.com/go-shiori/go-readability"
)

const (
	fetchTimeout = 30 * time.Second
	maxBodySize  = 1 << 20 // 1 MiB
	userAgent    = "HNReader/1.0"
)

// httpClient is a dedicated client for article fetching with transport-level controls.
var httpClient = &http.Client{
	Timeout: fetchTimeout,
	Transport: &http.Transport{
		DialContext: (&net.Dialer{
			Timeout:   10 * time.Second,
			KeepAlive: 30 * time.Second,
		}).DialContext,
		TLSHandshakeTimeout:   10 * time.Second,
		ResponseHeaderTimeout: 15 * time.Second,
		MaxIdleConns:          20,
		MaxIdleConnsPerHost:   5,
		IdleConnTimeout:       90 * time.Second,
	},
}

// Article holds extracted reader-mode content.
type Article struct {
	Title   string
	Byline  string
	Content string // cleaned HTML
	Excerpt string
}

// Extract fetches a URL and extracts reader-mode content.
// The provided context is used as a parent; a 30-second timeout is applied on top.
func Extract(ctx context.Context, rawURL string) (*Article, error) {
	ctx, cancel := context.WithTimeout(ctx, fetchTimeout)
	defer cancel()

	parsedURL, err := url.Parse(rawURL)
	if err != nil {
		return nil, fmt.Errorf("parse url: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, "GET", rawURL, nil)
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("User-Agent", userAgent)

	resp, err := httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("fetch: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("fetch returned status %d", resp.StatusCode)
	}

	// Limit response body
	body, err := io.ReadAll(io.LimitReader(resp.Body, maxBodySize+1))
	if err != nil {
		return nil, fmt.Errorf("read body: %w", err)
	}
	if len(body) > maxBodySize {
		return nil, fmt.Errorf("response exceeds %d bytes", maxBodySize)
	}

	article, err := goreadability.FromReader(bytes.NewReader(body), parsedURL)
	if err != nil {
		return nil, fmt.Errorf("readability extract: %w", err)
	}

	if article.Content == "" {
		return nil, fmt.Errorf("no content extracted")
	}

	return &Article{
		Title:   article.Title,
		Byline:  article.Byline,
		Content: article.Content,
		Excerpt: article.Excerpt,
	}, nil
}
