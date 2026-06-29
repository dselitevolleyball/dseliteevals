import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'

// Catch any render error so one bad view shows a readable message instead of a
// fully blank (black) screen. Also logs the error + stack to the console.
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }
  static getDerivedStateFromError(error) {
    return { error }
  }
  componentDidCatch(error, info) {
    console.error('App crashed:', error, info && info.componentStack)
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ minHeight: '100vh', background: '#0a0a0a', color: '#e5e5e5', fontFamily: 'system-ui, sans-serif', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div style={{ maxWidth: 640, background: '#161616', border: '1px solid #333', borderRadius: 12, padding: 24 }}>
            <h2 style={{ margin: '0 0 8px', color: '#e91e8c' }}>Something went wrong</h2>
            <p style={{ margin: '0 0 12px', color: '#9a9a9a', fontSize: 14 }}>
              The app hit an error while rendering. Try reloading. If it keeps happening, share the message below.
            </p>
            <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', background: '#0a0a0a', border: '1px solid #333', borderRadius: 8, padding: 12, fontSize: 12, color: '#f87171', maxHeight: 240, overflow: 'auto' }}>
              {String((this.state.error && (this.state.error.stack || this.state.error.message)) || this.state.error)}
            </pre>
            <button onClick={() => window.location.reload()} style={{ marginTop: 14, padding: '10px 18px', borderRadius: 8, border: 'none', background: '#e91e8c', color: '#000', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
              Reload
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
)

// Register the PWA service worker so the app is installable on phones
// ("Add to Home Screen"). Network-first, so deploys are picked up immediately.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {})
  })
}
