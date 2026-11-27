import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import {ErrorBoundary} from './components/ErrorBoundary.tsx';
import './index.css';
import {installGlobalErrorReporting} from './services/errorReporter.ts';
import {prepareVocabFsrsMigration} from './utils/vocabFsrsLoader.ts';

installGlobalErrorReporting();

if (import.meta.env.DEV && typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
  navigator.serviceWorker
    .getRegistrations()
    .then((regs) => {
      for (const reg of regs) {
        const urls = [reg.active?.scriptURL ?? '', reg.waiting?.scriptURL ?? '', reg.installing?.scriptURL ?? ''];
        if (urls.some((u) => u.includes('dev-sw.js'))) {
          reg.unregister().catch(() => {});
        }
      }
    })
    .catch(() => {});
}

// After a deploy, an open tab may request code-split chunks that no longer exist. Reload once to
// pick up the new build instead of showing an error (guarded so a real outage can't loop).
window.addEventListener('vite:preloadError', (event) => {
  const RELOAD_KEY = 'linguaforge_chunk_reload_at';
  const last = Number(sessionStorage.getItem(RELOAD_KEY) ?? 0);
  if (Date.now() - last > 60_000) {
    event.preventDefault();
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
    window.location.reload();
  }
});

function render() {
  createRoot(document.getElementById('root')!).render(
    <ErrorBoundary scopeLabel="LinguaForge ILR">
      <App />
    </ErrorBoundary>
  );
}

// Pre-FSRS vocab (and the seed deck on first run) needs ts-fsrs to migrate; it is loaded only then.
prepareVocabFsrsMigration(window.localStorage).then(render, render);
