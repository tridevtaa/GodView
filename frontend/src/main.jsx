// Montserrat, served from godview.in (no extra connection to Google).
import "@fontsource/montserrat/latin-400.css";
import "@fontsource/montserrat/latin-500.css";
import "@fontsource/montserrat/latin-600.css";
import "@fontsource/montserrat/latin-700.css";
import React, { Suspense, lazy } from 'react'
import ReactDOM from 'react-dom/client'
// The staff app loads only after sign-in (visitors get just the landing page).
const App = lazy(() => import('./App.jsx'))
import AuthGate from './components/AuthGate.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import './App.css'
import './pwa/install.js'
import './pwa/scrollLock.js'
import './pwa/viewport.js'
import './pwa/compactBars.js'
import { reloadForNewRelease } from './pwa/release.js'

// A screen's code from the previous release is gone: load the new release.
window.addEventListener('vite:preloadError', (e) => {
  if (reloadForNewRelease()) e.preventDefault()
})

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <AuthGate>
        <Suspense fallback={<main className="auth-screen" aria-busy="true" />}>
          <App />
        </Suspense>
      </AuthGate>
    </ErrorBoundary>
  </React.StrictMode>
)

// Installed app: cache the app shell (production only; dev reloads freely).
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
}
