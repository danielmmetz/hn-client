export function KeyboardShortcutsHelp({ onClose }) {
  const shortcuts = [
    { key: 'J', desc: 'Next story' },
    { key: 'K', desc: 'Previous story' },
    { key: 'j', desc: 'Next comment' },
    { key: 'k', desc: 'Previous comment' },
    { key: 'x', desc: 'Collapse / expand comment' },
    { key: 'r', desc: 'Reader view' },
    { key: 'c', desc: 'Comments view' },
    { key: '?', desc: 'Toggle this help' },
  ];

  return (
    <div class="kbd-help-overlay" onClick={onClose}>
      <div class="kbd-help-modal" onClick={(e) => e.stopPropagation()}>
        <div class="kbd-help-header">
          <h2>Keyboard Shortcuts</h2>
          <button class="kbd-help-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        <table class="kbd-help-table">
          <tbody>
            {shortcuts.map(({ key, desc }) => (
              <tr key={key}>
                <td><kbd>{key}</kbd></td>
                <td>{desc}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
