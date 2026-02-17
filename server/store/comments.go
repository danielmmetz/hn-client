package store

import (
	"context"
)

// CommentNode wraps a Comment with its nested children for tree responses.
type CommentNode struct {
	*Comment
	Children []*CommentNode `json:"children"`
}

// GetCommentTree returns all comments for a story as a nested tree.
func GetCommentTree(ctx context.Context, db DBTX, q *Queries, storyID int) ([]*CommentNode, int64, error) {
	rows, err := q.GetCommentsByStory(ctx, db, storyID)
	if err != nil {
		return nil, 0, err
	}

	var all []*CommentNode
	byID := make(map[int]*CommentNode)
	var maxFetchedAt int64

	for _, row := range rows {
		node := &CommentNode{Comment: row, Children: []*CommentNode{}}
		if node.FetchedAt > maxFetchedAt {
			maxFetchedAt = node.FetchedAt
		}
		byID[node.ID] = node
		all = append(all, node)
	}

	// Build tree
	var roots []*CommentNode
	for _, node := range all {
		if node.ParentID != nil {
			if parent, ok := byID[*node.ParentID]; ok {
				parent.Children = append(parent.Children, node)
				continue
			}
		}
		roots = append(roots, node)
	}

	return pruneDeleted(roots), maxFetchedAt, nil
}

// pruneDeleted removes deleted comments that have no visible children.
func pruneDeleted(comments []*CommentNode) []*CommentNode {
	var result []*CommentNode
	for _, c := range comments {
		c.Children = pruneDeleted(c.Children)
		if c.Deleted && len(c.Children) == 0 {
			continue
		}
		result = append(result, c)
	}
	return result
}
