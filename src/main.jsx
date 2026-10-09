import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import { initPWA } from './lib/pwa'
import './index.css'

// Los console.* y debugger se eliminan en el build de producción (ver vite.config.js).
// La PWA avisa cuando hay versión nueva y la aplica solo si el jugador lo pide (ver lib/pwa.js).
initPWA()

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
