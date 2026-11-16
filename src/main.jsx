import React from 'react'
import ReactDOM from 'react-dom/client'
import App, { ContoEconomicoPage, SpaccaTema } from './App.jsx'

// Rotta leggera: /conto-economicofacile (prima /conto-economico-immobiliare) (in produzione sotto /calcolatore-economicoprofessional/).
// Pagina libera, senza login né salvataggio: non passa dall'app completa.
const isContoEconomico = /\/(conto-economicofacile|conto-economico-immobiliare)\/?$/.test(window.location.pathname)

// Un solo indirizzo (16 nov 2026): chi apre calcolatore-frazionamento.vercel.app viene
// portato su lorenzoloseto.com. Solo l'indirizzo di produzione: le anteprime Vercel
// (altri nomi *.vercel.app) restano apribili per le prove. Chi arriva da qui usava
// l'app completa, quindi ?app; i link condivisi (?s=) passano così come sono.
const daVercel = window.location.hostname === 'calcolatore-frazionamento.vercel.app'
if (daVercel) {
  const q = new URLSearchParams(window.location.search)
  if (!isContoEconomico && !q.has('s') && !q.has('lead')) q.set('app', '1')
  const coda = (q.toString() ? '?' + q.toString() : '') + window.location.hash
  window.location.replace(isContoEconomico
    ? 'https://www.lorenzoloseto.com/conto-economicofacile' + coda
    : 'https://www.lorenzoloseto.com/calcolatore-economicoprofessional/' + coda)
} else {
  ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      <SpaccaTema />
      {isContoEconomico ? <ContoEconomicoPage /> : <App />}
    </React.StrictMode>,
  )
}
