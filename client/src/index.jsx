import { render } from 'preact';
import { App } from './app';
import { onAppOpen } from './lib/sync';
import './styles/global.css';
import './styles/components.css';

render(<App />, document.getElementById('app'));

// Register service worker
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // SW registration failed — app still works without it
    });
  });
}

// Run app-open tasks (eviction, etc.)
onAppOpen().catch(() => {});
