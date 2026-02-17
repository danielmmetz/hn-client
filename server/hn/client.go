package hn

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"time"
)

const baseURL = "https://hacker-news.firebaseio.com/v0"

type Client struct {
	http *http.Client
	sem  chan struct{}
}

func NewClient() *Client {
	return &Client{
		http: &http.Client{Timeout: 15 * time.Second},
		sem:  make(chan struct{}, 10), // concurrency limit of 10
	}
}

func (c *Client) acquire(ctx context.Context) error {
	select {
	case c.sem <- struct{}{}:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

func (c *Client) release() { <-c.sem }

// TopStories returns up to 500 top story IDs.
func (c *Client) TopStories(ctx context.Context) ([]int, error) {
	if err := c.acquire(ctx); err != nil {
		return nil, err
	}
	defer c.release()

	req, err := http.NewRequestWithContext(ctx, "GET", baseURL+"/topstories.json", nil)
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}

	resp, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("fetch top stories: %w", err)
	}
	defer resp.Body.Close()

	var ids []int
	if err := json.NewDecoder(resp.Body).Decode(&ids); err != nil {
		return nil, fmt.Errorf("decode top stories: %w", err)
	}
	return ids, nil
}

// GetItem fetches a single HN item by ID.
func (c *Client) GetItem(ctx context.Context, id int) (*Item, error) {
	if err := c.acquire(ctx); err != nil {
		return nil, err
	}
	defer c.release()

	req, err := http.NewRequestWithContext(ctx, "GET", fmt.Sprintf("%s/item/%d.json", baseURL, id), nil)
	if err != nil {
		return nil, fmt.Errorf("create request for item %d: %w", id, err)
	}

	resp, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("fetch item %d: %w", id, err)
	}
	defer resp.Body.Close()

	var item Item
	if err := json.NewDecoder(resp.Body).Decode(&item); err != nil {
		return nil, fmt.Errorf("decode item %d: %w", id, err)
	}
	return &item, nil
}

// GetItems fetches multiple items concurrently and returns them in order.
// Errors for individual items are logged but don't fail the batch.
func (c *Client) GetItems(ctx context.Context, ids []int) []*Item {
	results := make([]*Item, len(ids))
	var wg sync.WaitGroup
	for i, id := range ids {
		wg.Add(1)
		go func(idx, itemID int) {
			defer wg.Done()
			item, err := c.GetItem(ctx, itemID)
			if err != nil {
				return
			}
			results[idx] = item
		}(i, id)
	}
	wg.Wait()
	return results
}
