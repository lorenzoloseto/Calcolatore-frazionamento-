# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # Dev server at http://localhost:5173
npm run build        # Production build → dist/
npm run cap:build    # build + npx cap sync ios
npm run cap:open     # Open Xcode
npm run cap:sync     # Sync web assets to iOS
npm run cap:run      # Run on iOS device/simulator
```

iOS build pipeline (when ios/ doesn't exist): `npx cap add ios` → `npm run build` → `npx cap sync ios` → `npx cap open ios`.

## Architecture

### Monolithic single-file app

All application code lives in `src/App.jsx` (~3200 lines). There are no separate route files, component files, or stores. The file is organized in sections:

1. **Imports & Supabase init** — Capacitor setup, constants, `isNative` flag
2. **`DB` object** — All Supabase calls (auth, projects, shares, tracking)
3. **Reusable components & hooks** — Modals, animations, SVG icons, landing page sections
4. **Format helpers & constants** — `fmt()`, `fmtEur()`, color constants (`C`), `DEFAULT_DATA`, `DEFAULT_SCENARI`, `RIST_INIT` (30 renovation line items)
5. **`AdminDashboard` component** — Admin-only panel (users, projects, shares, analytics)
6. **`App` component** — All state, auth flow, calculations, auto-save, rendering

### Screen routing

No router library. Screens are conditionally rendered based on state flags:

```
showLanding         → Landing page
authScreen          → "login" | "register" | "forgot" | "reset-password" | "projects" | "admin"
__sharedId          → NDA gate (shared project link, public access)
!showDash & step    → Wizard (8-step onboarding)
showDash            → Main dashboard (4 tabs)
```

`__sharedId` comes from `?s=UUID` URL param and bypasses auth entirely.

### Financial calculation engine

A single `calc = useMemo(...)` computes all KPIs from `data` and `scenari`:
- Base case: investment, revenue, margin, ROI, annualized ROI
- Three scenarios (pessimistic / realistic / optimistic) using `varPrezzoDown/Up`, `varCostiUp/Down`, `mesiExtra/Meno`
- Comparables: average €/mq across entered market data

### State

All state is in the `App` component via `useState`/`useMemo`. No external store. Key state:
- `data` — all project inputs (30+ fields, typed against `DEFAULT_DATA`)
- `scenari` — scenario deltas
- `ristItems` — renovation line items (array)
- `comparabili` — market comparables (array)
- `user`, `projectsList`, `authScreen`, `step`, `showDash`

Auto-save: 1.2s debounce on `data`/`scenari`/`ristItems`/`comparabili` changes when a project is loaded.

### Supabase schema (key tables)

- `projects` — `{ id, owner_id, name, data (jsonb), scenari, comparabili, ristItems }`
- `project_shares` — access control (view/edit permissions)
- `shared_snapshots` — immutable snapshots for shared links
- `snapshot_visitors` — NDA acceptance records (name, email, codice fiscale, consents)
- `analytics_events` — event tracking

Admin RPCs (`supabase-admin-rpc.sql`): `admin_get_stats`, `admin_get_users`, `admin_get_all_projects`, `admin_get_all_shares`, `admin_get_all_visitors` — all security-restricted to admin email (`lorenzoloseto@hotmail.it`).

### Capacitor / iOS specifics

- `contentInset: 'never'` in `capacitor.config.ts` — required so `env(safe-area-inset-top)` returns the real status bar height. All navbars use `paddingTop: 'env(safe-area-inset-top, 0px)'`.
- OAuth on native: `skipBrowserRedirect: true` + `Browser.open(url)` + deep link `com.lorenzoloseto.frazio://auth/callback` handled via `App.addListener('appUrlOpen')`.
- `isNative = Capacitor.isNativePlatform()` controls branching for auth, links, and status bar.
- iOS entitlements: `ios/App/App/App.entitlements` must include `com.apple.developer.applesignin`.

### NDA sharing flow

Shared links (`?s=UUID`) load a snapshot and show a gate: visitor must enter full personal data including Italian codice fiscale (validated with the checksum algorithm inline in App.jsx) and accept NDA + privacy. All data persisted to `snapshot_visitors`.

### UI conventions

- No CSS framework, no component library — all inline styles
- Color constants in `C` object: `C.navy` (`#0D2240`), `C.gold` (`#C4841D`), `C.green`, `C.red`
- Font: Georgia serif for financial display, `-apple-system` for UI controls
- Italian locale throughout (`it-IT` number/date formatting)

## LEAD MAGNET MODE (giugno 2026)

Il calcolatore è ora pubblicato come **lead magnet di Lorenzo Loseto** su
`https://lorenzoloseto.com/calcolatore-frazionamento` (oltre che app SaaS completa).

### Deploy / routing
- Stesso progetto Vercel `calcolatore-frazionamento.vercel.app`.
- Sul sito Astro `Lorenzo Loseto/vercel.json` c'è un **rewrite** `/calcolatore-frazionamento/:path*` → `https://calcolatore-frazionamento.vercel.app/calcolatore-frazionamento/:path*`.
- `vite.config.js`: `base = '/calcolatore-frazionamento/'` solo in `build` (in dev resta `/`).
- `vercel.json` del calcolatore: rewrite interni `/calcolatore-frazionamento/*` → SPA (`/`), con passthrough `/assets/*`.
- `go.lorenzoloseto.com` NON è più il calcolatore (ora serve il workshop "Spacca il Mattone" su WordPress/SupportHost). `WEB_ORIGIN` aggiornato al nuovo path.

### LEAD_MODE (flag runtime in App.jsx, ~riga 20)
`LEAD_MODE = !isNative && (hostname === lorenzoloseto.com || ?lead in query)`.
Attivo SOLO su lorenzoloseto.com (o `?lead=1` per test locale). Su `vercel.app` e iOS = false → app FRAZIO completa invariata (auth, NDA, salvataggi, admin).

Quando LEAD_MODE è true:
- **Branding**: tutto "LORENZO LOSETO" (FRAZIO rimosso da UI; resta solo in commenti + filename Excel). Icona edificio rimossa dalla navbar landing.
- **Landing**: copy lead-magnet (hero "Quanto rende davvero il tuo frazionamento?", features/steps/trust/stats riscritti, niente bottoni Accedi/account). Nessun riferimento ai "minuti".
- **Wizard anonimo**: parte senza registrazione, stato persistito in `localStorage` (`ll_calc_state`).
- **Gate email** (`LeadGateModal`) a fine wizard: nome + email + privacy. Submit = triplo POST come `/video-gratuito`:
  - Kajabi form `2149582625` (`lorenzo-loseto.mykajabi.com/forms/2149582625/form_submissions`)
  - Zapier `hooks.zapier.com/hooks/catch/22684503/4o0o06b/` (con dati calcolo: margine, ROI, investimento, città + UTM, per pre-qualifica Regina)
  - Web3Forms backup
- **Thank-you page** `/grazie`: dopo il gate, `history.replaceState` → URL diventa `/calcolatore-frazionamento/grazie` (per custom conversion Meta URL-based di Francesco) + banner verde conferma (`justCaptured`) + risultati subito (opzione B).
- **CTA video MFIB**: banner pulsante (`ll-ctaPulse`) + popup dopo 15s (`ll_video_popup_shown` in sessionStorage, chiusura solo con "No grazie") → `https://lorenzoloseto.com/video-mfib/?from=calcolatore[-popup]`.
- **Pixel**: Meta `850911246223558` + TikTok `CK4NBF3C77U7PQISJ0E0` iniettati a runtime solo in LEAD_MODE. Eventi: PageView → InitiateCheckout (apertura gate) → Lead + CompleteRegistration (submit) + PageView su /grazie.
- Eventi analytics interni: `lead_capture`, `video_popup_view/dismiss`, `video_cta_click`.

### Consegna tracking a Francesco
- Pixel Meta `850911246223558`; custom conversion URL-based su `/calcolatore-frazionamento/grazie`, oppure evento standard `Lead`.
- TikTok pixel `CK4NBF3C77U7PQISJ0E0`, evento `CompleteRegistration`.

### TODO aperti
- Test reale gate da iPhone (l'email entra nella sequenza Kajabi `2148828853`).
- Eventuale sequenza Kajabi dedicata "calcolatore" (oggi condivide quella VSL).

## CONTO ECONOMICO IMMOBILIARE (pagina light, settembre 2026)

Rotta `/conto-economico-immobiliare`. URL pubblico **`https://lorenzoloseto.com/conto-economico-immobiliare`** (primo livello): rewrite nel `vercel.json` del sito Astro → `calcolatore-frazionamento.vercel.app/calcolatore-frazionamento/conto-economico-immobiliare`. Gli asset restano sotto `/calcolatore-frazionamento/assets/`, già proxati.
- Instradata in `src/main.jsx` sul pathname: renderizza `ContoEconomicoPage` (in `App.jsx`, subito prima di `App`) invece dell'app completa.
- Pagina **libera**: nessun login, nessun gate email, **nessun salvataggio** (stato solo in memoria, sparisce chiudendo la pagina). Nessun `localStorage` tranne il consenso cookie.
- Voci: prezzo acquisto, superficie, tipo acquisto (1ª casa / 2ª casa / società; sempre acquisto da privato, imposta di registro), rendita catastale opzionale (prezzo-valore), ristrutturazione €/mq (valore suggerito 1000, "media italiana"), prezzo vendita €/mq OBBLIGATORIO (il risultato compare solo con acquisto + mq + vendita). Fisse: provvigione 3%, notaio 2.000 €, spese tecniche 5.000 € (`CE_FISSI`).
- Imposte: funzione pura `calcImposteAcquisto()` condivisa con il calcolatore completo (`confrontoAcquisto` la usa). Non duplicare la logica.
- Disclaimer "a solo titolo di studio, non dati certi" in evidenza (box sotto l'hero + footer + navbar).
- Azione principale: form **"Invia il conto economico a Lorenzo"** (nome, email, telefono e note facoltativi, privacy) per parlarne al workshop. Invio SOLO via Web3Forms (key del sito, reply-to = email del mittente, corpo = riepilogo testuale) + evento Supabase `conto_economico_invio`. Niente Kajabi, niente Zapier, niente pixel Lead (da decidere con Francesco).
- Link discreto nel footer al calcolatore completo (`?utm_source=conto-economico`). Eventi: `page_view` (page: conto-economico), `conto_economico_calc`, `conto_economico_cta_click`.
- I componenti `CeField`/`CeRow` stanno fuori dal componente pagina: se li sposti dentro, l'input perde il focus a ogni tasto.
