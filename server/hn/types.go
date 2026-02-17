package hn

// Item represents a Hacker News item (story, comment, etc.)
type Item struct {
	ID          int    `json:"id"`
	Type        string `json:"type"`
	By          string `json:"by"`
	Time        int64  `json:"time"`
	Text        string `json:"text"`
	URL         string `json:"url"`
	Title       string `json:"title"`
	Score       int    `json:"score"`
	Descendants int    `json:"descendants"`
	Kids        []int  `json:"kids"`
	Parent      int    `json:"parent"`
	Dead        bool   `json:"dead"`
	Deleted     bool   `json:"deleted"`
}
