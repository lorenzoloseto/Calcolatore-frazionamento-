import React from 'react'
import ReactDOM from 'react-dom/client'
import App, { ContoEconomicoPage } from './App.jsx'

// Rotta leggera: /conto-economico-immobiliare (in produzione sotto /calcolatore-frazionamento/).
// Pagina libera, senza login né salvataggio: non passa dall'app completa.
const isContoEconomico = /\/conto-economico-immobiliare\/?$/.test(window.location.pathname)

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {isContoEconomico ? <ContoEconomicoPage /> : <App />}
  </React.StrictMode>,
)
