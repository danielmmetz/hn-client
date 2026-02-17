import { Comment } from './Comment';

export function CommentTree({ comments }) {
  return (
    <section class="comment-tree">
      {comments.length === 0 ? (
        <p class="comment-tree-empty">No comments yet.</p>
      ) : (
        <div class="comment-tree-list">
          {comments.map((comment) => (
            <Comment key={comment.id} comment={comment} depth={0} />
          ))}
        </div>
      )}
    </section>
  );
}
