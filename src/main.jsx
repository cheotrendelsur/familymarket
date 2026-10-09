import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'

// Los console.* y debugger se eliminan en el build de producción (ver vite.config.js).
// El service worker lo registra vite-plugin-pwa automáticamente (registerSW.js).

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
