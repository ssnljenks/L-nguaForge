import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import {ErrorBoundary} from './components/ErrorBoundary.tsx';
import './index.css';

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

createRoot(document.getElementById('root')!).render(
  <ErrorBoundary scopeLabel="LinguaForge ILR">
    <App />
  </ErrorBoundary>
);
