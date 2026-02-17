package sse

import (
	"fmt"
	"net/http"
	"strconv"
	"sync"
	"time"
)

type Event struct {
	ID    uint64
	Type  string
	Data  string
}

func (e *Event) Format() string {
	return fmt.Sprintf("id: %d\nevent: %s\ndata: %s\n\n", e.ID, e.Type, e.Data)
}

type Broker struct {
	mu          sync.RWMutex
	subscribers map[chan *Event]struct{}
	ring        []*Event
	ringSize    int
	nextID      uint64
}

func NewBroker(ringSize int) *Broker {
	return &Broker{
		subscribers: make(map[chan *Event]struct{}),
		ring:        make([]*Event, 0, ringSize),
		ringSize:    ringSize,
		nextID:      1,
	}
}

// Publish broadcasts an event to all subscribers and stores in ring buffer.
func (b *Broker) Publish(eventType, data string) {
	b.mu.Lock()
	evt := &Event{
		ID:   b.nextID,
		Type: eventType,
		Data: data,
	}
	b.nextID++

	// Add to ring buffer
	if len(b.ring) >= b.ringSize {
		b.ring = b.ring[1:]
	}
	b.ring = append(b.ring, evt)

	// Copy subscribers to avoid holding lock during send
	subs := make([]chan *Event, 0, len(b.subscribers))
	for ch := range b.subscribers {
		subs = append(subs, ch)
	}
	b.mu.Unlock()

	for _, ch := range subs {
		select {
		case ch <- evt:
		default:
			// slow consumer, skip
		}
	}
}

func (b *Broker) subscribe() chan *Event {
	ch := make(chan *Event, 64)
	b.mu.Lock()
	b.subscribers[ch] = struct{}{}
	b.mu.Unlock()
	return ch
}

func (b *Broker) unsubscribe(ch chan *Event) {
	b.mu.Lock()
	delete(b.subscribers, ch)
	b.mu.Unlock()
	close(ch)
}

// eventsAfter returns all events in the ring buffer after the given ID.
// If the ID is too old (not in buffer), returns nil to indicate sync_required.
func (b *Broker) eventsAfter(lastID uint64) ([]*Event, bool) {
	b.mu.RLock()
	defer b.mu.RUnlock()

	if len(b.ring) == 0 {
		return nil, true
	}

	// Check if lastID is within our buffer range
	oldest := b.ring[0].ID
	if lastID < oldest-1 {
		return nil, false // too old
	}

	var events []*Event
	for _, e := range b.ring {
		if e.ID > lastID {
			events = append(events, e)
		}
	}
	return events, true
}

func (b *Broker) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming not supported", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	// Handle Last-Event-ID (header for browser reconnects, query param for initial connect)
	lastEventID := r.Header.Get("Last-Event-ID")
	if lastEventID == "" {
		lastEventID = r.URL.Query().Get("lastEventId")
	}
	if lastEventID != "" {
		if id, err := strconv.ParseUint(lastEventID, 10, 64); err == nil {
			events, ok := b.eventsAfter(id)
			if !ok {
				// Too old, send sync_required
				fmt.Fprintf(w, "id: %d\nevent: sync_required\ndata: {}\n\n", b.nextID-1)
				flusher.Flush()
			} else {
				for _, e := range events {
					fmt.Fprint(w, e.Format())
				}
				flusher.Flush()
			}
		}
	}

	ch := b.subscribe()
	defer b.unsubscribe(ch)

	// Send a keepalive comment immediately
	fmt.Fprintf(w, ": connected\n\n")
	flusher.Flush()

	keepalive := time.NewTicker(30 * time.Second)
	defer keepalive.Stop()

	for {
		select {
		case <-r.Context().Done():
			return
		case evt := <-ch:
			fmt.Fprint(w, evt.Format())
			flusher.Flush()
		case <-keepalive.C:
			fmt.Fprintf(w, ": keepalive\n\n")
			flusher.Flush()
		}
	}
}

func (b *Broker) SubscriberCount() int {
	b.mu.RLock()
	defer b.mu.RUnlock()
	return len(b.subscribers)
}


