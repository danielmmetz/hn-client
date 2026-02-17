package store

import "sync"

// TopList is a thread-safe ordered list of HN top story IDs.
// Set by the poller after each TopStories() call, read by the API handler for pagination.
type TopList struct {
	mu  sync.RWMutex
	ids []int
}

func NewTopList() *TopList {
	return &TopList{}
}

// Set replaces the entire list of top story IDs.
func (t *TopList) Set(ids []int) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.ids = make([]int, len(ids))
	copy(t.ids, ids)
}

// Page returns a slice of IDs for the given page (1-indexed) and page size,
// along with the total number of IDs.
func (t *TopList) Page(page, pageSize int) ([]int, int) {
	t.mu.RLock()
	defer t.mu.RUnlock()

	total := len(t.ids)
	if total == 0 {
		return nil, 0
	}

	offset := (page - 1) * pageSize
	if offset >= total {
		return nil, total
	}

	end := offset + pageSize
	if end > total {
		end = total
	}

	result := make([]int, end-offset)
	copy(result, t.ids[offset:end])
	return result, total
}

// Len returns the number of IDs in the list.
func (t *TopList) Len() int {
	t.mu.RLock()
	defer t.mu.RUnlock()
	return len(t.ids)
}
