import { useState, useEffect } from 'preact/hooks';

/**
 * Toast notification component.
 * Shows a message that can be tapped to trigger an action.
 * Auto-dismisses after a timeout.
 */
export function Toast({ message, onAction, actionLabel, visible, onDismiss }) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (visible) {
      // Small delay for enter animation
      requestAnimationFrame(() => setShow(true));
      const timer = setTimeout(() => {
        setShow(false);
        setTimeout(() => onDismiss && onDismiss(), 300);
      }, 8000);
      return () => clearTimeout(timer);
    } else {
      setShow(false);
    }
  }, [visible]);

  if (!visible) return null;

  function handleAction() {
    setShow(false);
    setTimeout(() => {
      onAction && onAction();
      onDismiss && onDismiss();
    }, 150);
  }

  function handleDismissClick(e) {
    e.stopPropagation();
    setShow(false);
    setTimeout(() => onDismiss && onDismiss(), 300);
  }

  return (
    <div class={`toast ${show ? 'toast-visible' : ''}`} onClick={handleAction}>
      <span class="toast-message">{message}</span>
      {actionLabel && <span class="toast-action">{actionLabel}</span>}
      <button class="toast-close" onClick={handleDismissClick} aria-label="Dismiss">×</button>
    </div>
  );
}
