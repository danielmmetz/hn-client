import { timeAgo } from '../lib/time';

function countReplies(comment) {
  if (!comment.children) return 0;
  let count = comment.children.length;
  for (const child of comment.children) {
    count += countReplies(child);
  }
  return count;
}

export function Comment({ comment, depth = 0, collapsedIds, toggleCollapse, focusedCommentId }) {
  const collapsed = collapsedIds.has(comment.id);
  const replyCount = countReplies(comment);
  const isDeleted = comment.deleted;
  const maxDepth = 8;
  const effectiveDepth = Math.min(depth, maxDepth);
  const isFocused = focusedCommentId === comment.id;

  return (
    <div
      class={`comment${isFocused ? ' comment-focused' : ''}`}
      style={{ '--depth': effectiveDepth }}
      data-comment-id={comment.id}
    >
      <div class="comment-indent">
        {Array.from({ length: effectiveDepth }, (_, i) => (
          <span class="comment-indent-line" key={i} />
        ))}
      </div>
      <div class="comment-body">
        <div class="comment-header" onClick={() => toggleCollapse(comment.id)}>
          {isDeleted ? (
            <span class="comment-deleted">[deleted]</span>
          ) : (
            <>
              <span class="comment-author">{comment.by}</span>
              <span class="comment-time">{timeAgo(comment.time)}</span>
            </>
          )}
          {collapsed && replyCount > 0 && (
            <span class="comment-collapsed-indicator">[+{replyCount} {replyCount === 1 ? 'reply' : 'replies'}]</span>
          )}
        </div>
        {!collapsed && (
          <>
            {!isDeleted && comment.text && (
              <div class="comment-text" dangerouslySetInnerHTML={{ __html: comment.text }} />
            )}
            {comment.children && comment.children.length > 0 && (
              <div class="comment-children">
                {comment.children.map((child) => (
                  <Comment
                    key={child.id}
                    comment={child}
                    depth={depth + 1}
                    collapsedIds={collapsedIds}
                    toggleCollapse={toggleCollapse}
                    focusedCommentId={focusedCommentId}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
