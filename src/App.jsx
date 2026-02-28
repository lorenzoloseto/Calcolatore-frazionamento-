import { useState, useMemo, useCallback, useEffect, useRef } from "react";
// ============================================================
// CALCOLATORE FRAZIONAMENTO IMMOBILIARE — V2 con Auth & Salvataggio
// Aesthetic: Il Sole 24 Ore / Bloomberg — professional finance
// Lorenzo Loseto — 4 Sere di Frazionamento Immobiliare
// ============================================================

// ============================================================
// SUPABASE SERVICE — Collegamento reale al database
// ============================================================
const SB_URL = "https://hyfktrxffwdnawbvfajr.supabase.co";
const SB_KEY = "sb_publishable_uJdFDJ4lGsrGdrqmu-NmdQ_7Dy2WVfb";

const DB = {
  _token: null, _user: null,
  _init() {
    try { this._token = localStorage.getItem("sb_token") || null; this._user = JSON.parse(localStorage.getItem("sb_user") || "null"); } catch { this._token = null; this._user = null; }
  },
  _setSession(token, user) {
    this._token = token; this._user = user;
    if (token) localStorage.setItem("sb_token", token); else localStorage.removeItem("sb_token");
    if (user) localStorage.setItem("sb_user", JSON.stringify(user)); else localStorage.removeItem("sb_user");
  },
  _h(auth = true) {
    const h = { "apikey": SB_KEY, "Content-Type": "application/json" };
    if (auth && this._token) h["Authorization"] = `Bearer ${this._token}`;
    return h;
  },
  async register(name, email, password) {
    try {
      const res = await fetch(`${SB_URL}/auth/v1/signup`, { method: "POST", headers: this._h(false), body: JSON.stringify({ email, password, data: { name } }) });
      const d = await res.json();
      if (d.error || d.msg) return { ok: false, error: d.error?.message || d.msg || "Errore registrazione" };
      if (d.access_token) { const u = { id: d.user.id, name, email }; this._setSession(d.access_token, u); return { ok: true, user: u }; }
      if (d.id) return { ok: true, user: null, confirmEmail: true };
      return { ok: false, error: "Errore sconosciuto" };
    } catch { return { ok: false, error: "Errore di rete" }; }
  },
  async login(email, password) {
    try {
      const res = await fetch(`${SB_URL}/auth/v1/token?grant_type=password`, { method: "POST", headers: this._h(false), body: JSON.stringify({ email, password }) });
      const d = await res.json();
      if (!res.ok || d.error) return { ok: false, error: d.error_description || d.error?.message || "Credenziali non valide" };
      const u = { id: d.user.id, name: d.user.user_metadata?.name || email.split("@")[0], email };
      this._setSession(d.access_token, u);
      return { ok: true, user: u };
    } catch { return { ok: false, error: "Errore di rete" }; }
  },
  loginWithGoogle() {
    const redirectTo = window.location.origin + window.location.pathname;
    window.location.href = `${SB_URL}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(redirectTo)}`;
  },
  handleOAuthCallback() {
    // Supabase mette i token nel hash fragment dopo il redirect da Google
    const hash = window.location.hash;
    if (!hash || !hash.includes("access_token")) return false;
    const params = new URLSearchParams(hash.substring(1));
    const token = params.get("access_token");
    if (!token) return false;
    this._token = token;
    localStorage.setItem("sb_token", token);
    // Pulisci l'URL
    window.history.replaceState(null, "", window.location.pathname);
    return true;
  },
  async fetchUserFromToken() {
    if (!this._token) return null;
    try {
      const res = await fetch(`${SB_URL}/auth/v1/user`, { headers: this._h() });
      if (!res.ok) { this._setSession(null, null); return null; }
      const d = await res.json();
      const u = { id: d.id, name: d.user_metadata?.name || d.user_metadata?.full_name || d.email?.split("@")[0] || "Utente", email: d.email };
      this._setSession(this._token, u);
      return u;
    } catch { this._setSession(null, null); return null; }
  },
  logout() {
    if (this._token) fetch(`${SB_URL}/auth/v1/logout`, { method: "POST", headers: this._h() }).catch(() => {});
    this._setSession(null, null);
  },
  getUser() { this._init(); return this._user; },
  async saveProject(pd) {
    if (!this._user) return { ok: false, error: "Non autenticato" };
    const body = { name: pd.name, data: pd.data, scenari: pd.scenari, comparabili: pd.comparabili, rist_items: pd.ristItems };
    try {
      if (pd.id) {
        const res = await fetch(`${SB_URL}/rest/v1/projects?id=eq.${pd.id}`, { method: "PATCH", headers: { ...this._h(), "Prefer": "return=representation" }, body: JSON.stringify(body) });
        const arr = await res.json(); if (!res.ok) return { ok: false, error: "Errore salvataggio" }; return { ok: true, project: arr[0] };
      } else {
        body.owner_id = this._user.id; body.owner_name = this._user.name;
        const res = await fetch(`${SB_URL}/rest/v1/projects`, { method: "POST", headers: { ...this._h(), "Prefer": "return=representation" }, body: JSON.stringify(body) });
        const arr = await res.json(); if (!res.ok) return { ok: false, error: "Errore creazione" }; return { ok: true, project: arr[0] };
      }
    } catch { return { ok: false, error: "Errore di rete" }; }
  },
  async getProjects() {
    if (!this._user) return [];
    try {
      const [ownRes, sharesRes] = await Promise.all([
        fetch(`${SB_URL}/rest/v1/projects?owner_id=eq.${this._user.id}&order=updated_at.desc`, { headers: this._h() }),
        fetch(`${SB_URL}/rest/v1/project_shares?shared_with_email=eq.${encodeURIComponent(this._user.email)}&select=project_id,permission`, { headers: this._h() }),
      ]);
      const own = await ownRes.json() || [];
      const shares = await sharesRes.json() || [];
      let shared = [];
      if (shares.length > 0) {
        const ids = shares.map((s) => s.project_id);
        const shRes = await fetch(`${SB_URL}/rest/v1/projects?id=in.(${ids.join(",")})&order=updated_at.desc`, { headers: this._h() });
        const shProjects = await shRes.json() || [];
        shared = shProjects.map((p) => { const sh = shares.find((s) => s.project_id === p.id); return { ...p, _shared: true, _permission: sh?.permission || "view" }; });
      }
      return [...own, ...shared];
    } catch { return []; }
  },
  async deleteProject(pid) {
    try { const res = await fetch(`${SB_URL}/rest/v1/projects?id=eq.${pid}`, { method: "DELETE", headers: this._h() }); return { ok: res.ok }; } catch { return { ok: false }; }
  },
  async shareProject(pid, email, permission) {
    if (!this._user) return { ok: false, error: "Non autenticato" };
    if (email === this._user.email) return { ok: false, error: "Non puoi condividere con te stesso" };
    try {
      const res = await fetch(`${SB_URL}/rest/v1/project_shares`, { method: "POST", headers: { ...this._h(), "Prefer": "return=representation" }, body: JSON.stringify({ project_id: pid, shared_with_email: email, permission, shared_by: this._user.id }) });
      if (!res.ok) { const err = await res.json().catch(() => null); return { ok: false, error: err?.message?.includes("duplicate") ? "Già condiviso con questa email" : "Errore nella condivisione" }; }
      return { ok: true };
    } catch { return { ok: false, error: "Errore di rete" }; }
  },
  async removeShare(pid, email) {
    try { const res = await fetch(`${SB_URL}/rest/v1/project_shares?project_id=eq.${pid}&shared_with_email=eq.${encodeURIComponent(email)}`, { method: "DELETE", headers: this._h() }); return { ok: res.ok }; } catch { return { ok: false }; }
  },
  async getShares(pid) {
    try { const res = await fetch(`${SB_URL}/rest/v1/project_shares?project_id=eq.${pid}&select=*`, { headers: this._h() }); return await res.json() || []; } catch { return []; }
  },
};

// ============================================================
// FORMAT HELPERS & COLORS
// ============================================================
const fmt = (n) => new Intl.NumberFormat("it-IT", { maximumFractionDigits: 0 }).format(n);
const fmtEur = (n) => fmt(Math.round(n)) + " €";
const fmtPct = (n) => (n * 100).toFixed(1) + "%";
const fmtMq = (n) => fmt(Math.round(n)) + " mq";
const fmtMesi = (n) => Math.round(n) + (Math.round(n) === 1 ? " mese" : " mesi");
const C = {
  bg: "#F8F7F4", card: "#FFFFFF", dark: "#1B2A4A", navy: "#0D2240",
  accent: "#C4841D", accentLight: "#F5E6CC", green: "#1A7F37", greenBg: "#E6F4EA",
  red: "#C82333", redBg: "#FDE8E8", border: "#E5E1D8", borderDark: "#D0CCC3",
  text: "#1B2A4A", textMid: "#5A6578", textLight: "#8E95A2", goldBar: "#C4841D",
  inputBg: "#FAFAF8", inputBorder: "#D0CCC3", inputFocus: "#C4841D", highlight: "#FFF8ED",
};

const DEFAULT_DATA = {
  via: "", civico: "", citta: "", prezzoAcquisto: 200000, metratura: 120, numUnita: 3,
  prezzoVenditaMq: 3200, costoRistMq: 500, durataOp: 8,
  oneriComunali: 5000, costiProfessionisti: 15000, provvigioniPct: 0.03, bufferPct: 0.15, tasseAcquistoPct: 0.09,
  allacciamentiUtenze: 0, bolletteGasLuce: 0, consulenzeTecniche: 0, rendering: 0,
  speseBancarieSomma: 0, speseBancariePct: 0, interessiSomma: 0, interessiPct: 0,
};
const DEFAULT_SCENARI = { varPrezzoDown: -0.10, varCostiUp: 0.20, mesiExtra: 4, varPrezzoUp: 0.10, varCostiDown: -0.10, mesiMeno: 2 };
const RIST_INIT = [
  { nome: "Pavimento gres e posa", qty: 0, unita: "Mq", prezzo: 35 },
  { nome: "Pavimento parquet", qty: 0, unita: "Mq", prezzo: 90 },
  { nome: "Battiscopa", qty: 0, unita: "Mq", prezzo: 17 },
  { nome: "Impianto elettrico", qty: 0, unita: "Corpo", prezzo: 3250 },
  { nome: "Massetto alleggerito", qty: 0, unita: "Mq", prezzo: 30 },
  { nome: "Intonaco", qty: 0, unita: "Mq", prezzo: 10 },
  { nome: "Cappotto", qty: 0, unita: "Mq", prezzo: 50 },
  { nome: "Guaina terrazzo", qty: 0, unita: "Mq", prezzo: 35 },
  { nome: "Tinteggiatura interna", qty: 0, unita: "Mq", prezzo: 10 },
  { nome: "Controsoffitto", qty: 0, unita: "Mq", prezzo: 30 },
  { nome: "Pompa di calore", qty: 0, unita: "Corpo", prezzo: 800 },
  { nome: "Split", qty: 0, unita: "Corpo", prezzo: 400 },
  { nome: "Canalizzato", qty: 0, unita: "Corpo", prezzo: 3500 },
  { nome: "Termoarredo elettrico", qty: 0, unita: "Corpo", prezzo: 180 },
  { nome: "Scaldabagno elettrico", qty: 0, unita: "Corpo", prezzo: 350 },
  { nome: "Mobile bagno", qty: 0, unita: "Corpo", prezzo: 250 },
  { nome: "Impianto termico", qty: 0, unita: "Corpo", prezzo: 2500 },
  { nome: "Elementi radianti", qty: 0, unita: "Corpo", prezzo: 250 },
  { nome: "Termo arredo", qty: 0, unita: "Corpo", prezzo: 150 },
  { nome: "Idrico/fognante", qty: 0, unita: "Corpo", prezzo: 150 },
  { nome: "Posa in opera sanitari", qty: 0, unita: "Corpo", prezzo: 30 },
  { nome: "Piatto doccia", qty: 0, unita: "Corpo", prezzo: 230 },
  { nome: "Wc/Bidet", qty: 0, unita: "Corpo", prezzo: 150 },
  { nome: "Lavabo", qty: 0, unita: "Corpo", prezzo: 100 },
  { nome: "Rubinetteria", qty: 0, unita: "Corpo", prezzo: 50 },
  { nome: "Infissi completi con tap", qty: 0, unita: "Mq", prezzo: 550 },
  { nome: "Smontaggio e smaltimento infissi", qty: 0, unita: "Corpo", prezzo: 50 },
  { nome: "Porte battente", qty: 0, unita: "Corpo", prezzo: 350 },
  { nome: "Porta scrigno", qty: 0, unita: "Corpo", prezzo: 380 },
  { nome: "Porta filo muro", qty: 0, unita: "Corpo", prezzo: 350 },
  { nome: "Posa porta", qty: 0, unita: "Corpo", prezzo: 60 },
  { nome: "Porta blindata", qty: 0, unita: "Corpo", prezzo: 1000 },
  { nome: "Posa porta blindata", qty: 0, unita: "Corpo", prezzo: 100 },
  { nome: "Demolizione murature", qty: 0, unita: "Mq", prezzo: 15 },
  { nome: "Ricostruzione murature", qty: 0, unita: "Mq", prezzo: 70 },
  { nome: "Assistenza muraria", qty: 0, unita: "Corpo", prezzo: 2000 },
  { nome: "Rivestimenti bagno e posa", qty: 0, unita: "Corpo", prezzo: 45 },
  { nome: "Pavimento balconi e posa", qty: 0, unita: "Mq", prezzo: 35 },
  { nome: "Battiscopa balconi", qty: 0, unita: "Mq", prezzo: 7 },
  { nome: "Soglie balconi", qty: 0, unita: "Mq", prezzo: 10 },
  { nome: "Sistemazione balconi", qty: 0, unita: "Corpo", prezzo: 400 },
  { nome: "Pitturazioni esterne", qty: 0, unita: "Mq", prezzo: 15 },
];

// ============================================================
// REUSABLE COMPONENTS
// ============================================================
function WizardNumberInput({ value, onChange, suffix, step = 1, min = 0, max, autoFocus = true }) {
  const ref = useRef(null);
  useEffect(() => { if (autoFocus && ref.current) ref.current.focus(); }, [autoFocus]);
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", background: C.card, borderRadius: 8, border: `2px solid ${C.accent}`, maxWidth: 320, margin: "0 auto", boxShadow: "0 2px 12px rgba(0,0,0,0.06)" }}>
      <input ref={ref} type="number" value={value} onChange={(e) => onChange(Number(e.target.value) || 0)} step={step} min={min} max={max}
        style={{ flex: 1, background: "transparent", border: "none", outline: "none", color: C.dark, fontSize: 34, fontWeight: 700, textAlign: "center", padding: "14px 16px", fontFamily: "'Georgia', 'Times New Roman', serif", width: "100%", minWidth: 0 }} />
      {suffix && <span style={{ padding: "0 16px 0 0", color: C.textMid, fontSize: 16, fontWeight: 600 }}>{suffix}</span>}
    </div>
  );
}
function WizardSlider({ value, onChange, min, max, step = 1, labels, unit }) {
  return (
    <div style={{ maxWidth: 360, margin: "0 auto" }}>
      <div style={{ textAlign: "center", marginBottom: 14 }}>
        <span style={{ color: C.dark, fontSize: 52, fontWeight: 700, fontFamily: "'Georgia', serif" }}>{value}</span>
        {unit && <span style={{ color: C.textMid, fontSize: 20, marginLeft: 6 }}>{unit}</span>}
      </div>
      <input type="range" value={value} onChange={(e) => onChange(Number(e.target.value))} min={min} max={max} step={step}
        style={{ width: "100%", accentColor: C.accent, height: 6, cursor: "pointer" }} />
      {labels && (
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6 }}>
          {labels.map((l, i) => <span key={i} style={{ color: C.textLight, fontSize: 12 }}>{l}</span>)}
        </div>
      )}
    </div>
  );
}
function DashInput({ label, value, onChange, suffix, step = 1, min = 0, max, note, disabled }) {
  const [focused, setFocused] = useState(false);
  return (
    <div style={{ marginBottom: 10 }}>
      <label style={{ color: C.textMid, fontSize: 11, fontWeight: 600, letterSpacing: 0.3, display: "block", marginBottom: 3, textTransform: "uppercase" }}>{label}</label>
      <div style={{ display: "flex", alignItems: "center", background: disabled ? "#f0f0f0" : C.inputBg, borderRadius: 4, border: `1px solid ${focused ? C.inputFocus : C.inputBorder}`, transition: "border-color 0.15s" }}>
        <input type="number" value={value} onChange={(e) => !disabled && onChange(Number(e.target.value) || 0)}
          onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} step={step} min={min} max={max} disabled={disabled}
          style={{ flex: 1, background: "transparent", border: "none", outline: "none", color: disabled ? C.textLight : C.dark, fontSize: 14, fontWeight: 600, padding: "7px 8px", fontFamily: "inherit", width: "100%", minWidth: 0 }} />
        {suffix && <span style={{ padding: "0 8px 0 0", color: C.textLight, fontSize: 12, fontWeight: 600, whiteSpace: "nowrap" }}>{suffix}</span>}
      </div>
      {note && <p style={{ color: C.textLight, fontSize: 10, margin: "2px 0 0" }}>{note}</p>}
    </div>
  );
}
function DashPctInput({ label, value, onChange, note, disabled }) {
  return <DashInput label={label} value={Math.round(value * 1000) / 10} onChange={(v) => onChange(v / 100)} suffix="%" step={0.5} min={-100} max={100} note={note} disabled={disabled} />;
}
function DataRow({ label, value, highlight, bold, border = true }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: border ? `1px solid ${C.border}` : "none", background: highlight ? C.highlight : "transparent", marginLeft: highlight ? -8 : 0, marginRight: highlight ? -8 : 0, paddingLeft: highlight ? 8 : 0, paddingRight: highlight ? 8 : 0 }}>
      <span style={{ color: bold ? C.dark : C.textMid, fontSize: 13, fontWeight: bold ? 700 : 400 }}>{label}</span>
      <span style={{ color: C.dark, fontSize: 13, fontWeight: bold ? 700 : 600, fontFamily: "'Georgia', serif" }}>{value}</span>
    </div>
  );
}
function KpiCard({ label, value, subvalue, positive, negative, accent }) {
  const color = positive ? C.green : negative ? C.red : accent ? C.accent : C.dark;
  return (
    <div style={{ background: C.card, borderRadius: 6, padding: "12px 14px", border: `1px solid ${C.border}`, boxShadow: "0 1px 4px rgba(0,0,0,0.04)", overflow: "hidden" }}>
      <div style={{ color: C.textMid, fontSize: 10, fontWeight: 700, letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 4 }}>{label}</div>
      <div style={{ color, fontSize: 20, fontWeight: 700, fontFamily: "'Georgia', serif", lineHeight: 1.1, wordBreak: "break-word" }}>{value}</div>
      {subvalue && <div style={{ color: C.textLight, fontSize: 11, marginTop: 2 }}>{subvalue}</div>}
    </div>
  );
}
function ScenarioBlock({ title, subtitle, margine, roi, roiAnn, durata, investimento, color, borderColor }) {
  const isPos = margine >= 0;
  return (
    <div style={{ flex: 1, background: C.card, borderRadius: 6, border: `1px solid ${borderColor || C.border}`, borderTop: `3px solid ${color}`, padding: 16, minWidth: 180, boxShadow: "0 1px 4px rgba(0,0,0,0.04)" }}>
      <div style={{ marginBottom: 12 }}>
        <div style={{ color, fontWeight: 700, fontSize: 12, letterSpacing: 0.8, textTransform: "uppercase" }}>{title}</div>
        {subtitle && <div style={{ color: C.textLight, fontSize: 11 }}>{subtitle}</div>}
      </div>
      <div style={{ background: isPos ? C.greenBg : C.redBg, borderRadius: 4, padding: "10px 12px", textAlign: "center", marginBottom: 10 }}>
        <div style={{ color: C.textLight, fontSize: 9, fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase" }}>Margine netto</div>
        <div style={{ color: isPos ? C.green : C.red, fontSize: 22, fontWeight: 700, fontFamily: "'Georgia', serif" }}>{fmtEur(margine)}</div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
        {[["ROI", fmtPct(roi)], ["ROI annuo", fmtPct(roiAnn)], ["Investim.", fmtEur(investimento)], ["Durata", fmtMesi(durata)]].map(([l, v]) => (
          <div key={l} style={{ background: "#F5F3EE", borderRadius: 4, padding: "6px 8px", textAlign: "center" }}>
            <div style={{ color: C.textLight, fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.3 }}>{l}</div>
            <div style={{ color: C.dark, fontSize: 13, fontWeight: 600, fontFamily: "'Georgia', serif" }}>{v}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================================
// AUTH INPUT COMPONENT
// ============================================================
function AuthInput({ label, type = "text", value, onChange, placeholder, autoFocus }) {
  const ref = useRef(null);
  useEffect(() => { if (autoFocus && ref.current) ref.current.focus(); }, [autoFocus]);
  return (
    <div style={{ marginBottom: 16 }}>
      <label style={{ display: "block", color: C.textMid, fontSize: 12, fontWeight: 600, marginBottom: 4, fontFamily: "-apple-system, sans-serif" }}>{label}</label>
      <input ref={ref} type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        style={{ width: "100%", boxSizing: "border-box", padding: "10px 14px", border: `1px solid ${C.borderDark}`, borderRadius: 6, fontSize: 15, color: C.dark, outline: "none", fontFamily: "-apple-system, sans-serif", background: C.card }} />
    </div>
  );
}

// ============================================================
// WIZARD STEPS
// ============================================================
const STEPS = [
  { id: "welcome", title: "Analisi operazione\ndi frazionamento", subtitle: "Inserisci i dati dell'immobile per calcolare margine, ROI e scenari in pochi secondi.", isWelcome: true },
  { id: "indirizzo", title: "Indirizzo dell'immobile", subtitle: "Inserisci l'indirizzo per identificare questa operazione.", type: "address" },
  { id: "metratura", title: "Superficie totale", subtitle: "La metratura commerciale dell'immobile.", field: "metratura", type: "number", suffix: "mq", step: 5 },
  { id: "prezzo", title: "Prezzo di acquisto", subtitle: "Il prezzo richiesto o negoziato per l'immobile.", field: "prezzoAcquisto", type: "number", suffix: "€", step: 5000 },
  { id: "unita", title: "Numero di unità", subtitle: "In quante unità indipendenti vuoi dividere l'immobile.", field: "numUnita", type: "slider", min: 2, max: 6, labels: ["2", "3", "4", "5", "6"] },
  { id: "vendita", title: "Prezzo di vendita al mq", subtitle: "Prezzo medio al metro quadro delle unità piccole nella zona.", field: "prezzoVenditaMq", type: "number", suffix: "€/mq", step: 100 },
  { id: "rist", title: "Costo ristrutturazione", subtitle: "Costo al mq comprensivo di ristrutturazione e impiantistica.", field: "costoRistMq", type: "number", suffix: "€/mq", step: 50 },
  { id: "durata", title: "Durata dell'operazione", subtitle: "Tempistica prevista dalla firma all'ultima vendita.", field: "durataOp", type: "slider", min: 3, max: 24, labels: ["3 mesi", "12", "24 mesi"], unit: "mesi" },
];

// ============================================================
// MAIN APP
// ============================================================
export default function App() {
  // AUTH STATE
  const [user, setUser] = useState(() => DB.getUser());
  const [projectsList, setProjectsList] = useState([]);
  const [sharesForModal, setSharesForModal] = useState([]);
  const [authScreen, setAuthScreen] = useState(null); // null | "login" | "register" | "projects"
  const [authForm, setAuthForm] = useState({ name: "", email: "", password: "" });
  const [authLoading, setAuthLoading] = useState(false);

  // Gestisci il callback OAuth (ritorno da Google login)
  useEffect(() => {
    const handled = DB.handleOAuthCallback();
    if (handled) {
      setAuthLoading(true);
      DB.fetchUserFromToken().then((u) => {
        if (u) setUser(u);
        setAuthLoading(false);
      });
    }
  }, []);
  const [authError, setAuthError] = useState("");
  const [shareModal, setShareModal] = useState(null); // projectId to share
  const [shareEmail, setShareEmail] = useState("");
  const [sharePermission, setSharePermission] = useState("view");
  const [shareError, setShareError] = useState("");
  const [projectName, setProjectName] = useState("");
  const [editingProjectId, setEditingProjectId] = useState(null);

  // APP STATE
  const [step, setStep] = useState(0);
  const [showDash, setShowDash] = useState(false);
  const [dashTab, setDashTab] = useState("risultati");
  const [fadeIn, setFadeIn] = useState(true);
  const [showPopup, setShowPopup] = useState(false);
  const [viewOnly, setViewOnly] = useState(false);
  const [data, setData] = useState({ ...DEFAULT_DATA });
  const [scenari, setScenari] = useState({ ...DEFAULT_SCENARI });
  const [comparabili, setComparabili] = useState([{ indirizzo: "", mq: 0, prezzo: 0, prezzoMq: 0, note: "" }]);
  const [ristItems, setRistItems] = useState([...RIST_INIT]);

  // DERIVED
  const ristTotale = useMemo(() => ristItems.reduce((s, it) => s + it.qty * it.prezzo, 0), [ristItems]);
  const addComparabile = () => setComparabili((prev) => [...prev, { indirizzo: "", mq: 0, prezzo: 0, prezzoMq: 0, note: "" }]);
  const removeComparabile = (idx) => setComparabili((prev) => prev.filter((_, i) => i !== idx));
  const updComparabile = (idx, field, value) => setComparabili((prev) => prev.map((c, i) => {
    if (i !== idx) return c;
    const updated = { ...c, [field]: value };
    if (field === "prezzo" || field === "mq") updated.prezzoMq = updated.mq > 0 ? Math.round(updated.prezzo / updated.mq) : 0;
    return updated;
  }));
  const mediaComparabili = useMemo(() => {
    const valid = comparabili.filter((c) => c.prezzoMq > 0);
    if (valid.length === 0) return { mediaMq: 0, mediaPrezzo: 0, mediaPrezzoMq: 0, count: 0 };
    const tot = valid.reduce((acc, c) => ({ mq: acc.mq + c.mq, prezzo: acc.prezzo + c.prezzo, prezzoMq: acc.prezzoMq + c.prezzoMq }), { mq: 0, prezzo: 0, prezzoMq: 0 });
    return { mediaMq: Math.round(tot.mq / valid.length), mediaPrezzo: Math.round(tot.prezzo / valid.length), mediaPrezzoMq: Math.round(tot.prezzoMq / valid.length), count: valid.length };
  }, [comparabili]);

  const updRist = useCallback((idx, field, val) => {
    setRistItems((prev) => prev.map((it, i) => i === idx ? { ...it, [field]: val } : it));
  }, []);
  const upd = useCallback((f, v) => setData((p) => ({ ...p, [f]: v })), []);
  const animTo = useCallback((fn) => { setFadeIn(false); setTimeout(() => { fn(); setFadeIn(true); }, 180); }, []);
  const goNext = () => {
    if (step < STEPS.length - 1) animTo(() => setStep((s) => s + 1));
    else animTo(() => {
      setShowDash(true);
      // Auto-crea progetto al primo accesso alla dashboard se loggato
      if (user && !editingProjectId) {
        setTimeout(async () => {
          const res = await handleSaveProject();
          if (res.ok) setEditingProjectId(res.project.id);
        }, 300);
      }
    });
  };
  const goBack = () => { if (step > 0) animTo(() => setStep((s) => s - 1)); };

  // ============================================================
  // AUTOSAVE — salva automaticamente ogni volta che i dati cambiano
  // ============================================================
  const autoSaveTimer = useRef(null);
  const [saveStatus, setSaveStatus] = useState(""); // "" | "saving" | "saved"
  useEffect(() => {
    if (!user || !editingProjectId || viewOnly) return;
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    setSaveStatus("saving");
    autoSaveTimer.current = setTimeout(async () => {
      await handleSaveProject();
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus(""), 2000);
    }, 1200);
    return () => { if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current); };
  }, [data, scenari, comparabili, ristItems, user, editingProjectId, viewOnly]);

  // ============================================================
  // AUTH HANDLERS
  // ============================================================
  const handleLogin = async () => {
    setAuthError("");
    const res = await DB.login(authForm.email, authForm.password);
    if (res.ok) { setUser(res.user); setAuthScreen(null); setAuthForm({ name: "", email: "", password: "" }); }
    else setAuthError(res.error);
  };
  const handleRegister = async () => {
    setAuthError("");
    if (!authForm.name.trim()) { setAuthError("Inserisci il tuo nome"); return; }
    if (!authForm.email.trim()) { setAuthError("Inserisci la tua email"); return; }
    if (authForm.password.length < 4) { setAuthError("Password minimo 4 caratteri"); return; }
    const res = await DB.register(authForm.name, authForm.email, authForm.password);
    if (res.ok && res.user) { setUser(res.user); setAuthScreen(null); setAuthForm({ name: "", email: "", password: "" }); }
    else if (res.ok && res.confirmEmail) { setAuthError("Controlla la tua email per confermare la registrazione, poi accedi."); }
    else setAuthError(res.error);
  };
  const handleLogout = () => { DB.logout(); setUser(null); setAuthScreen(null); };
  const handleSaveProject = async () => {
    const indirizzo = [data.via, data.civico].filter(Boolean).join(" ");
    const nome = projectName || [indirizzo, data.citta].filter(Boolean).join(", ") || "Nuova operazione";
    const res = await DB.saveProject({
      id: editingProjectId,
      name: nome,
      data: { ...data },
      scenari: { ...scenari },
      comparabili: [...comparabili],
      ristItems: [...ristItems],
    });
    if (res.ok) { setEditingProjectId(res.project.id); setProjectName(nome); }
    return res;
  };
  const handleLoadProject = (project) => {
    setData({ ...DEFAULT_DATA, ...project.data });
    setScenari({ ...DEFAULT_SCENARI, ...project.scenari });
    setComparabili(project.comparabili || [{ indirizzo: "", mq: 0, prezzo: 0, prezzoMq: 0, note: "" }]);
    setRistItems(project.rist_items || [...RIST_INIT]);
    setEditingProjectId(project.id);
    setProjectName(project.name);
    setViewOnly(project._shared && project._permission === "view");
    setShowDash(true);
    setAuthScreen(null);
  };
  const handleNewProject = () => {
    setData({ ...DEFAULT_DATA });
    setScenari({ ...DEFAULT_SCENARI });
    setComparabili([{ indirizzo: "", mq: 0, prezzo: 0, prezzoMq: 0, note: "" }]);
    setRistItems([...RIST_INIT]);
    setEditingProjectId(null);
    setProjectName("");
    setViewOnly(false);
    setShowDash(false);
    setStep(0);
    setAuthScreen(null);
  };
  const handleShare = async () => {
    setShareError("");
    if (!shareEmail.trim()) { setShareError("Inserisci un'email"); return; }
    const res = await DB.shareProject(shareModal, shareEmail, sharePermission);
    if (res.ok) { setShareEmail(""); setShareError(""); const sh = await DB.getShares(shareModal); setSharesForModal(sh); }
    else setShareError(res.error);
  };
  // Load projects when opening projects screen
  useEffect(() => {
    if (authScreen === "projects" && user) { DB.getProjects().then(setProjectsList); }
  }, [authScreen, user]);
  // Load shares when opening share modal
  useEffect(() => {
    if (shareModal && user) { DB.getShares(shareModal).then(setSharesForModal); }
    else setSharesForModal([]);
  }, [shareModal, user]);

  // ============================================================
  // CALCULATIONS
  // ============================================================
  const calc = useMemo(() => {
    const d = data;
    const costoRistTot = d.metratura * d.costoRistMq;
    const buffer = costoRistTot * d.bufferPct;
    const tasseAcquisto = d.prezzoAcquisto * d.tasseAcquistoPct;
    const speseBancarie = d.speseBancarieSomma * d.speseBancariePct;
    const interessi = d.interessiSomma * d.interessiPct;
    const altriCosti = d.allacciamentiUtenze + d.bolletteGasLuce + d.consulenzeTecniche + d.rendering + speseBancarie + interessi;
    const costiFraz = costoRistTot + d.oneriComunali + d.costiProfessionisti + buffer + tasseAcquisto + altriCosti;
    const inv = d.prezzoAcquisto + costiFraz;
    const mqU = d.numUnita > 0 ? d.metratura / d.numUnita : 0;
    const pMqAcq = d.metratura > 0 ? d.prezzoAcquisto / d.metratura : 0;
    const ricU = mqU * d.prezzoVenditaMq;
    const ricTot = ricU * d.numUnita;
    const prov = ricTot * d.provvigioniPct;
    const ricNet = ricTot - prov;
    const margine = ricNet - inv;
    const roi = inv > 0 ? margine / inv : 0;
    const roiAnn = inv > 0 && d.durataOp > 0 ? roi * (12 / d.durataOp) : 0;
    const incMq = pMqAcq > 0 ? (d.prezzoVenditaMq - pMqAcq) / pMqAcq : 0;
    function sc(vP, vC, mD) {
      const pV = d.prezzoVenditaMq * (1 + vP), cF = costiFraz * (1 + vC), i = d.prezzoAcquisto + cF;
      const r = d.metratura * pV, pr = r * d.provvigioniPct, m = r - pr - i;
      const ms = Math.max(1, d.durataOp + mD), ro = i > 0 ? m / i : 0;
      return { margine: m, roi: ro, roiAnn: i > 0 && ms > 0 ? ro * (12 / ms) : 0, durata: ms, investimento: i };
    }
    return { costoRistTot, buffer, tasseAcquisto, speseBancarie, interessi, altriCosti, costiFraz, inv, mqU, pMqAcq, ricU, ricTot, prov, ricNet, margine, roi, roiAnn, incMq, pess: sc(scenari.varPrezzoDown, scenari.varCostiUp, scenari.mesiExtra), real: sc(0, 0, 0), ott: sc(scenari.varPrezzoUp, scenari.varCostiDown, -scenari.mesiMeno) };
  }, [data, scenari]);
  const verdict = calc.pess.margine > 0;

  // ============================================================
  // EXPORT EXCEL (same as v1)
  // ============================================================
  const exportExcel = useCallback(() => {
    const indirizzo = (() => { const s = [data.via, data.civico].filter(Boolean).join(" "); return [s, data.citta].filter(Boolean).join(", ") || "Nuova operazione"; })();
    const r = Math.round;
    const esc = (v) => String(v).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
    const cell = (v, opts = {}) => {
      const { bold, bg, color, head, pct, eur } = opts;
      let type = "String", val = esc(v);
      if (typeof v === "number" && !pct) { type = "Number"; val = v; }
      const sid = [];
      if (bold) sid.push("font-weight:700;");
      if (color) sid.push(`color:${color};`);
      if (bg) sid.push(`mso-pattern:${bg} none;`);
      if (head) sid.push("font-weight:700;color:#FFFFFF;mso-pattern:#0D2240 none;");
      if (eur && typeof v === "number") { sid.push('mso-number-format:"#,##0 €";'); type = "Number"; val = v; }
      if (pct) { sid.push('mso-number-format:"0.0%";'); type = "Number"; val = v; }
      const s = sid.length ? ` style="${sid.join("")}"` : "";
      return `<td${s}>${type === "Number" ? `<Data ss:Type="Number">${val}</Data>` : val}</td>`;
    };
    const row = (...cells) => `<tr>${cells.join("")}</tr>`;
    const blank = () => row(cell(""));
    const section = (title) => row(cell(title, { bold: true, bg: "#F5E6CC", color: "#0D2240" }));
    const dataRow = (label, value, unit, opts = {}) => {
      if (opts.eur) return row(cell(label), cell(value, { eur: true }), cell(unit || "€"));
      if (opts.pct) return row(cell(label), cell(value, { pct: true }), cell(""));
      return row(cell(label), cell(value), cell(unit || ""));
    };
    let sh1 = "";
    sh1 += row(cell("ANALISI FRAZIONAMENTO IMMOBILIARE", { bold: true, bg: "#0D2240", color: "#FFFFFF" }));
    sh1 += row(cell(indirizzo, { bold: true, color: "#C4841D" }));
    sh1 += blank();
    sh1 += section("DATI IMMOBILE");
    sh1 += dataRow("Prezzo acquisto", r(data.prezzoAcquisto), "€", { eur: true });
    sh1 += dataRow("Superficie totale", r(data.metratura), "mq");
    sh1 += dataRow("Prezzo/mq acquisto", r(calc.pMqAcq), "€/mq", { eur: true });
    sh1 += dataRow("Numero unità", data.numUnita, "");
    sh1 += dataRow("Superficie per unità", r(calc.mqU), "mq");
    sh1 += dataRow("Prezzo vendita/mq", r(data.prezzoVenditaMq), "€/mq", { eur: true });
    sh1 += dataRow("Incremento valore/mq", calc.incMq, "", { pct: true });
    sh1 += dataRow("Ricavo per unità", r(calc.ricU), "€", { eur: true });
    sh1 += dataRow("Durata operazione", data.durataOp, "mesi");
    sh1 += blank();
    sh1 += section("STRUTTURA COSTI");
    sh1 += dataRow("Ristrutturazione totale", r(calc.costoRistTot), "€", { eur: true });
    sh1 += dataRow("Oneri comunali", r(data.oneriComunali), "€", { eur: true });
    sh1 += dataRow("Professionisti", r(data.costiProfessionisti), "€", { eur: true });
    sh1 += dataRow("Tasse acquisto", r(calc.tasseAcquisto), "€", { eur: true });
    sh1 += dataRow("Buffer imprevisti", r(calc.buffer), "€", { eur: true });
    sh1 += dataRow("Totale costi", r(calc.costiFraz), "€", { eur: true });
    sh1 += blank();
    sh1 += section("RISULTATI");
    sh1 += dataRow("Investimento totale", r(calc.inv), "€", { eur: true });
    sh1 += dataRow("Ricavo netto", r(calc.ricNet), "€", { eur: true });
    sh1 += row(cell("MARGINE", { bold: true }), cell(r(calc.margine), { bold: true, eur: true, color: calc.margine >= 0 ? "#1A7F37" : "#C82333" }), cell("€"));
    sh1 += dataRow("ROI", calc.roi, "", { pct: true });
    sh1 += dataRow("ROI annualizzato", calc.roiAnn, "", { pct: true });
    let sh2 = "";
    sh2 += row(cell("COMPUTO RISTRUTTURAZIONE", { bold: true, bg: "#0D2240", color: "#FFFFFF" }));
    sh2 += row(cell("Voce", { head: true }), cell("Q.tà", { head: true }), cell("U.M.", { head: true }), cell("Prezzo", { head: true }), cell("Totale", { head: true }));
    ristItems.forEach((it) => { const tot = it.qty * it.prezzo; sh2 += row(cell(it.nome, tot > 0 ? { bold: true } : {}), cell(it.qty), cell(it.unita), cell(it.prezzo, { eur: true }), cell(tot, { eur: true, bold: tot > 0 })); });
    sh2 += row(cell("TOTALE", { bold: true, bg: "#F5E6CC" }), cell(""), cell(""), cell(""), cell(ristTotale, { bold: true, eur: true, bg: "#F5E6CC" }));
    let sh3 = "";
    sh3 += row(cell("ANALISI SCENARI", { bold: true, bg: "#0D2240", color: "#FFFFFF" }));
    sh3 += row(cell(""), cell("Pessimistico", { head: true }), cell("Realistico", { head: true }), cell("Ottimistico", { head: true }));
    sh3 += row(cell("Margine", { bold: true }), cell(r(calc.pess.margine), { eur: true }), cell(r(calc.real.margine), { eur: true }), cell(r(calc.ott.margine), { eur: true }));
    sh3 += row(cell("ROI"), cell(calc.pess.roi, { pct: true }), cell(calc.real.roi, { pct: true }), cell(calc.ott.roi, { pct: true }));
    sh3 += row(cell("ROI annualizzato"), cell(calc.pess.roiAnn, { pct: true }), cell(calc.real.roiAnn, { pct: true }), cell(calc.ott.roiAnn, { pct: true }));
    const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="UTF-8"><!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet><x:Name>Riepilogo</x:Name><x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions></x:ExcelWorksheet><x:ExcelWorksheet><x:Name>Ristrutturazione</x:Name><x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions></x:ExcelWorksheet><x:ExcelWorksheet><x:Name>Scenari</x:Name><x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions></x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]--><style>td{padding:4px 10px;font-family:Arial,sans-serif;font-size:11pt;border:1px solid #E5E1D8;vertical-align:middle}</style></head><body><table>${sh1}</table><div style="page-break-before:always"></div><table>${sh2}</table><div style="page-break-before:always"></div><table>${sh3}</table></body></html>`;
    const blob = new Blob([html], { type: "application/vnd.ms-excel" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const nome = indirizzo.replace(/[^a-zA-Z0-9\u00C0-\u00FA ]/g, "").trim().replace(/\s+/g, "_") || "Analisi";
    a.href = url; a.download = `Frazionamento_${nome}.xls`; a.click();
    URL.revokeObjectURL(url);
  }, [data, calc, ristItems, ristTotale]);

  // ============================================================
  // AUTH SCREENS
  // ============================================================
  const btnPrimary = { background: C.navy, color: "#FFF", border: "none", borderRadius: 6, padding: "11px 24px", fontWeight: 700, fontSize: 15, cursor: "pointer", fontFamily: "-apple-system, sans-serif", width: "100%" };
  const btnSecondary = { background: "transparent", color: C.accent, border: `1px solid ${C.accent}`, borderRadius: 6, padding: "10px 24px", fontWeight: 600, fontSize: 14, cursor: "pointer", fontFamily: "-apple-system, sans-serif", width: "100%" };

  if (authScreen === "login" || authScreen === "register") {
    const isLogin = authScreen === "login";
    return (
      <div style={{ background: C.bg, minHeight: "100vh", fontFamily: "'Georgia', serif", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ background: C.card, borderRadius: 10, padding: "36px 32px", maxWidth: 400, width: "90%", border: `1px solid ${C.border}`, boxShadow: "0 4px 24px rgba(0,0,0,0.08)" }}>
          <div style={{ width: 48, height: 4, background: C.accent, margin: "0 auto 20px", borderRadius: 2 }} />
          <h2 style={{ color: C.dark, fontSize: 22, fontWeight: 700, textAlign: "center", margin: "0 0 6px" }}>
            {isLogin ? "Accedi" : "Registrati"}
          </h2>
          <p style={{ color: C.textMid, fontSize: 14, textAlign: "center", margin: "0 0 24px", fontFamily: "-apple-system, sans-serif" }}>
            {isLogin ? "Accedi per salvare e gestire i tuoi conti economici" : "Crea un account per iniziare a salvare le tue analisi"}
          </p>
          {authError && <div style={{ background: C.redBg, color: C.red, padding: "8px 12px", borderRadius: 4, fontSize: 13, marginBottom: 14, fontFamily: "-apple-system, sans-serif" }}>{authError}</div>}
          <div onKeyDown={(e) => e.key === "Enter" && (isLogin ? handleLogin() : handleRegister())}>
            {!isLogin && <AuthInput label="Nome completo" value={authForm.name} onChange={(v) => setAuthForm((p) => ({ ...p, name: v }))} placeholder="Mario Rossi" autoFocus />}
            <AuthInput label="Email" type="email" value={authForm.email} onChange={(v) => setAuthForm((p) => ({ ...p, email: v }))} placeholder="mario@email.com" autoFocus={isLogin} />
            <AuthInput label="Password" type="password" value={authForm.password} onChange={(v) => setAuthForm((p) => ({ ...p, password: v }))} placeholder="••••••••" />
          </div>
          <button onClick={isLogin ? handleLogin : handleRegister} style={btnPrimary}>{isLogin ? "Accedi" : "Crea account"}</button>
          <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "18px 0" }}>
            <div style={{ flex: 1, height: 1, background: C.border }} />
            <span style={{ color: C.textLight, fontSize: 12, fontFamily: "-apple-system, sans-serif" }}>oppure</span>
            <div style={{ flex: 1, height: 1, background: C.border }} />
          </div>
          <button onClick={() => DB.loginWithGoogle()} style={{ ...btnSecondary, display: "flex", alignItems: "center", justifyContent: "center", gap: 10 }}>
            <svg width="18" height="18" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
            Continua con Google
          </button>
          <div style={{ textAlign: "center", marginTop: 16 }}>
            <button onClick={() => { setAuthScreen(isLogin ? "register" : "login"); setAuthError(""); }} style={{ background: "none", border: "none", color: C.accent, fontSize: 13, cursor: "pointer", fontFamily: "-apple-system, sans-serif" }}>
              {isLogin ? "Non hai un account? Registrati" : "Hai già un account? Accedi"}
            </button>
          </div>
          <div style={{ textAlign: "center", marginTop: 10 }}>
            <button onClick={() => setAuthScreen(null)} style={{ background: "none", border: "none", color: C.textLight, fontSize: 12, cursor: "pointer", fontFamily: "-apple-system, sans-serif" }}>
              Torna al calcolatore
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ============================================================
  // PROJECTS SCREEN (I MIEI CONTI ECONOMICI)
  // ============================================================
  if (authScreen === "projects" && user) {
    const projects = projectsList;
    return (
      <div style={{ background: C.bg, minHeight: "100vh", fontFamily: "'Georgia', serif" }}>
        <div style={{ background: C.navy }}>
          <div style={{ maxWidth: 800, margin: "0 auto", padding: "12px 16px", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
            <div>
              <div style={{ color: C.accent, fontWeight: 700, fontSize: 10, letterSpacing: 2.5, textTransform: "uppercase", fontFamily: "-apple-system, sans-serif" }}>Area privata</div>
              <div style={{ color: "#FFF", fontWeight: 700, fontSize: 16 }}>I miei conti economici</div>
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <button onClick={handleNewProject} style={{ background: C.accent, color: "#FFF", border: "none", borderRadius: 4, padding: "7px 14px", fontWeight: 600, fontSize: 12, cursor: "pointer", fontFamily: "-apple-system, sans-serif" }}>+ Nuova analisi</button>
              <button onClick={() => setAuthScreen(null)} style={{ background: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.7)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 4, padding: "7px 14px", fontWeight: 600, fontSize: 12, cursor: "pointer", fontFamily: "-apple-system, sans-serif" }}>Chiudi</button>
            </div>
          </div>
          <div style={{ height: 3, background: C.accent }} />
        </div>
        <div style={{ maxWidth: 800, margin: "0 auto", padding: "24px 16px" }}>
          {projects.length === 0 ? (
            <div style={{ textAlign: "center", padding: "60px 20px" }}>
              <div style={{ fontSize: 40, marginBottom: 16 }}>📋</div>
              <div style={{ color: C.dark, fontSize: 18, fontWeight: 700, marginBottom: 8 }}>Nessun conto economico salvato</div>
              <div style={{ color: C.textMid, fontSize: 14, marginBottom: 24, fontFamily: "-apple-system, sans-serif" }}>Crea una nuova analisi e salvala per ritrovarla qui.</div>
              <button onClick={handleNewProject} style={{ ...btnPrimary, width: "auto", padding: "11px 32px" }}>Crea nuova analisi</button>
            </div>
          ) : (
            <div style={{ display: "grid", gap: 12 }}>
              {projects.map((p) => {
                const isShared = p._shared;
                const perm = p._permission;
                return (
                  <div key={p.id} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: "16px 20px", boxShadow: "0 1px 4px rgba(0,0,0,0.04)", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
                    <div style={{ flex: 1, minWidth: 200 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                        <div style={{ color: C.dark, fontSize: 16, fontWeight: 700 }}>{p.name}</div>
                        {isShared && (
                          <span style={{ background: perm === "edit" ? C.accentLight : "#E8E5FF", color: perm === "edit" ? C.accent : "#6B5CE7", fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 10, fontFamily: "-apple-system, sans-serif" }}>
                            {perm === "edit" ? "Modifica" : "Solo lettura"}
                          </span>
                        )}
                      </div>
                      <div style={{ color: C.textMid, fontSize: 12, fontFamily: "-apple-system, sans-serif" }}>
                        {isShared ? `Condiviso da ${p.owner_name}` : `Aggiornato: ${new Date(p.updated_at).toLocaleDateString("it-IT", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}`}
                      </div>
                      {p.data && (
                        <div style={{ marginTop: 6, display: "flex", gap: 12, flexWrap: "wrap" }}>
                          <span style={{ color: C.textLight, fontSize: 11, fontFamily: "-apple-system, sans-serif" }}>Acquisto: {fmtEur(p.data.prezzoAcquisto || 0)}</span>
                          <span style={{ color: C.textLight, fontSize: 11, fontFamily: "-apple-system, sans-serif" }}>{p.data.metratura || 0} mq</span>
                          <span style={{ color: C.textLight, fontSize: 11, fontFamily: "-apple-system, sans-serif" }}>{p.data.numUnita || 0} unità</span>
                        </div>
                      )}
                    </div>
                    <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                      <button onClick={() => handleLoadProject(p)} style={{ background: C.navy, color: "#FFF", border: "none", borderRadius: 4, padding: "7px 14px", fontWeight: 600, fontSize: 12, cursor: "pointer", fontFamily: "-apple-system, sans-serif" }}>Apri</button>
                      {!isShared && (
                        <>
                          <button onClick={() => { setShareModal(p.id); setShareEmail(""); setShareError(""); }} style={{ background: "rgba(196,132,29,0.1)", color: C.accent, border: `1px solid ${C.accent}`, borderRadius: 4, padding: "7px 14px", fontWeight: 600, fontSize: 12, cursor: "pointer", fontFamily: "-apple-system, sans-serif" }}>Condividi</button>
                          <button onClick={async () => { if (confirm("Eliminare questo conto economico?")) { await DB.deleteProject(p.id); const updated = await DB.getProjects(); setProjectsList(updated); } }} style={{ background: "rgba(200,35,51,0.08)", color: C.red, border: "1px solid rgba(200,35,51,0.2)", borderRadius: 4, padding: "7px 10px", fontWeight: 600, fontSize: 12, cursor: "pointer", fontFamily: "-apple-system, sans-serif" }}>✕</button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        {/* SHARE MODAL */}
        {shareModal && (
          <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(13,34,64,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999 }} onClick={() => setShareModal(null)}>
            <div onClick={(e) => e.stopPropagation()} style={{ background: C.card, borderRadius: 10, padding: "28px 24px", maxWidth: 440, width: "90%", boxShadow: "0 8px 32px rgba(0,0,0,0.18)" }}>
              <h3 style={{ color: C.dark, fontSize: 18, fontWeight: 700, margin: "0 0 6px" }}>Condividi conto economico</h3>
              <p style={{ color: C.textMid, fontSize: 13, margin: "0 0 18px", fontFamily: "-apple-system, sans-serif" }}>Inserisci l'email della persona con cui vuoi condividere e scegli il livello di accesso.</p>
              {shareError && <div style={{ background: C.redBg, color: C.red, padding: "8px 12px", borderRadius: 4, fontSize: 13, marginBottom: 12, fontFamily: "-apple-system, sans-serif" }}>{shareError}</div>}
              <div onKeyDown={(e) => e.key === "Enter" && handleShare()}>
                <AuthInput label="Email destinatario" type="email" value={shareEmail} onChange={setShareEmail} placeholder="collaboratore@email.com" autoFocus />
              </div>
              <div style={{ marginBottom: 18 }}>
                <label style={{ display: "block", color: C.textMid, fontSize: 12, fontWeight: 600, marginBottom: 6, fontFamily: "-apple-system, sans-serif" }}>Permesso</label>
                <div style={{ display: "flex", gap: 8 }}>
                  {[["view", "Solo visualizzazione"], ["edit", "Può modificare"]].map(([val, lbl]) => (
                    <button key={val} onClick={() => setSharePermission(val)} style={{
                      flex: 1, padding: "10px 12px", borderRadius: 6, border: `2px solid ${sharePermission === val ? C.accent : C.border}`,
                      background: sharePermission === val ? C.accentLight : C.card, color: sharePermission === val ? C.accent : C.textMid,
                      fontWeight: 600, fontSize: 13, cursor: "pointer", fontFamily: "-apple-system, sans-serif",
                    }}>{lbl}</button>
                  ))}
                </div>
              </div>
              <button onClick={handleShare} style={btnPrimary}>Condividi</button>
              {/* Show existing shares */}
              {sharesForModal.length > 0 && (
                  <div style={{ marginTop: 18, borderTop: `1px solid ${C.border}`, paddingTop: 14 }}>
                    <div style={{ color: C.textMid, fontSize: 11, fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 8, fontFamily: "-apple-system, sans-serif" }}>Condiviso con</div>
                    {sharesForModal.map((s, i) => (
                      <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: `1px solid ${C.border}` }}>
                        <div>
                          <div style={{ color: C.dark, fontSize: 13, fontWeight: 600 }}>{s.shared_with_email}</div>
                          <div style={{ color: C.textLight, fontSize: 11 }}>{s.permission === "edit" ? "Può modificare" : "Solo lettura"}</div>
                        </div>
                        <button onClick={async () => { await DB.removeShare(shareModal, s.shared_with_email); const sh = await DB.getShares(shareModal); setSharesForModal(sh); }} style={{ background: "none", border: "none", color: C.red, fontSize: 14, cursor: "pointer", fontWeight: 700 }}>✕</button>
                      </div>
                    ))}
                  </div>
              )}
              <button onClick={() => setShareModal(null)} style={{ ...btnSecondary, marginTop: 12 }}>Chiudi</button>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ============================================================
  // WIZARD SCREEN
  // ============================================================
  if (!showDash) {
    const s = STEPS[step];
    const progress = (step / STEPS.length) * 100;
    return (
      <div style={{ background: C.bg, minHeight: "100vh", fontFamily: "'Georgia', 'Times New Roman', serif" }} onKeyDown={(e) => e.key === "Enter" && goNext()}>
        <div style={{ background: C.navy, padding: "0" }}>
          <div style={{ height: 3, background: "#0a1a33" }}>
            <div style={{ height: 3, background: C.accent, width: `${progress}%`, transition: "width 0.4s ease" }} />
          </div>
          <div style={{ maxWidth: 600, margin: "0 auto", padding: "12px 24px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ color: C.accent, fontWeight: 700, fontSize: 11, letterSpacing: 2.5, textTransform: "uppercase", fontFamily: "-apple-system, sans-serif" }}>
              Calcolatore Frazionamento
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              {step > 0 && <span style={{ color: "#6B7B94", fontSize: 12, fontFamily: "-apple-system, sans-serif" }}>{step} / {STEPS.length - 1}</span>}
              {user ? (
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <button onClick={() => setAuthScreen("projects")} style={{ background: "rgba(196,132,29,0.15)", color: C.accent, border: "none", borderRadius: 4, padding: "4px 10px", fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: "-apple-system, sans-serif" }}>I miei progetti</button>
                  <button onClick={handleLogout} style={{ background: "none", border: "none", color: "#6B7B94", fontSize: 11, cursor: "pointer", fontFamily: "-apple-system, sans-serif" }}>Esci</button>
                </div>
              ) : (
                <button onClick={() => setAuthScreen("login")} style={{ background: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.7)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 4, padding: "4px 10px", fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: "-apple-system, sans-serif" }}>Accedi</button>
              )}
            </div>
          </div>
        </div>
        <div style={{ maxWidth: 520, margin: "0 auto", padding: "40px 20px 30px", textAlign: "center", opacity: fadeIn ? 1 : 0, transform: fadeIn ? "translateY(0)" : "translateY(16px)", transition: "all 0.2s ease" }}>
          {s.isWelcome && <div style={{ width: 64, height: 4, background: C.accent, margin: "0 auto 24px", borderRadius: 2 }} />}
          <h1 style={{ color: C.dark, fontSize: s.isWelcome ? 28 : 22, fontWeight: 700, lineHeight: 1.3, margin: "0 0 10px", whiteSpace: "pre-line" }}>{s.title}</h1>
          <p style={{ color: C.textMid, fontSize: 15, margin: "0 0 36px", lineHeight: 1.5, fontFamily: "-apple-system, sans-serif" }}>{s.subtitle}</p>
          {s.type === "address" && (
            <div style={{ maxWidth: 400, margin: "0 auto", display: "flex", flexDirection: "column", gap: 14 }}>
              <div style={{ display: "flex", gap: 10 }}>
                <div style={{ flex: 3 }}>
                  <label style={{ display: "block", color: C.textMid, fontSize: 11, fontWeight: 600, letterSpacing: 0.3, textTransform: "uppercase", marginBottom: 4, textAlign: "left" }}>Via</label>
                  <input type="text" value={data.via} onChange={(e) => upd("via", e.target.value)} placeholder="Es. Via Roma" autoFocus
                    style={{ width: "100%", boxSizing: "border-box", background: C.card, border: `2px solid ${C.accent}`, borderRadius: 8, color: C.dark, fontSize: 18, fontWeight: 600, padding: "12px 14px", outline: "none", fontFamily: "'Georgia', serif" }} />
                </div>
                <div style={{ flex: 1, minWidth: 70 }}>
                  <label style={{ display: "block", color: C.textMid, fontSize: 11, fontWeight: 600, letterSpacing: 0.3, textTransform: "uppercase", marginBottom: 4, textAlign: "left" }}>N.</label>
                  <input type="text" value={data.civico} onChange={(e) => upd("civico", e.target.value)} placeholder="10"
                    style={{ width: "100%", boxSizing: "border-box", background: C.card, border: `2px solid ${C.accent}`, borderRadius: 8, color: C.dark, fontSize: 18, fontWeight: 600, padding: "12px 14px", outline: "none", fontFamily: "'Georgia', serif", textAlign: "center" }} />
                </div>
              </div>
              <div>
                <label style={{ display: "block", color: C.textMid, fontSize: 11, fontWeight: 600, letterSpacing: 0.3, textTransform: "uppercase", marginBottom: 4, textAlign: "left" }}>Città</label>
                <input type="text" value={data.citta} onChange={(e) => upd("citta", e.target.value)} placeholder="Es. Milano"
                  style={{ width: "100%", boxSizing: "border-box", background: C.card, border: `2px solid ${C.accent}`, borderRadius: 8, color: C.dark, fontSize: 18, fontWeight: 600, padding: "12px 14px", outline: "none", fontFamily: "'Georgia', serif" }} />
              </div>
            </div>
          )}
          {s.type === "number" && <WizardNumberInput value={data[s.field]} onChange={(v) => upd(s.field, v)} suffix={s.suffix} step={s.step} />}
          {s.type === "slider" && <WizardSlider value={data[s.field]} onChange={(v) => upd(s.field, v)} min={s.min} max={s.max} labels={s.labels} unit={s.unit} />}
          {s.field === "prezzoAcquisto" && data.metratura > 0 && <div style={{ marginTop: 14, color: C.textLight, fontSize: 13, fontFamily: "-apple-system, sans-serif" }}>Equivale a {fmtEur(Math.round(data.prezzoAcquisto / data.metratura))}/mq</div>}
          {s.field === "prezzoVenditaMq" && <div style={{ marginTop: 14, color: C.textLight, fontSize: 13, fontFamily: "-apple-system, sans-serif" }}>Ricavo totale stimato: <strong style={{ color: C.dark }}>{fmtEur(data.prezzoVenditaMq * data.metratura)}</strong></div>}
          {s.field === "numUnita" && data.metratura > 0 && <div style={{ marginTop: 14, color: C.textLight, fontSize: 13, fontFamily: "-apple-system, sans-serif" }}>Superficie media per unità: <strong style={{ color: C.dark }}>{fmtMq(Math.round(data.metratura / data.numUnita))}</strong></div>}
        </div>
        <div style={{ maxWidth: 520, margin: "0 auto", padding: "0 20px 24px", display: "flex", justifyContent: "center", gap: 10 }}>
          {step > 0 && <button onClick={goBack} style={{ background: "transparent", color: C.textMid, border: `1px solid ${C.borderDark}`, borderRadius: 6, padding: "12px 24px", fontWeight: 600, fontSize: 14, cursor: "pointer", fontFamily: "-apple-system, sans-serif" }}>Indietro</button>}
          <button onClick={goNext} style={{ background: C.navy, color: "#FFF", border: "none", borderRadius: 6, padding: "12px 36px", fontWeight: 700, fontSize: 15, cursor: "pointer", fontFamily: "-apple-system, sans-serif", boxShadow: "0 2px 8px rgba(13,34,64,0.2)" }}>
            {s.isWelcome ? "Inizia l'analisi" : step === STEPS.length - 1 ? "Vedi i risultati" : "Avanti"}
          </button>
        </div>
        {step > 0 && <div style={{ textAlign: "center", paddingBottom: 20 }}><button onClick={() => setShowDash(true)} style={{ background: "none", border: "none", color: C.textLight, fontSize: 12, cursor: "pointer", fontFamily: "-apple-system, sans-serif", textDecoration: "underline" }}>Salta al risultato</button></div>}
      </div>
    );
  }

  // ============================================================
  // DASHBOARD
  // ============================================================
  const tabs = [
    { id: "risultati", label: "Riepilogo" },
    { id: "ristrutturazione", label: "Ristrutturazione" },
    { id: "scenari", label: "Analisi scenari" },
    { id: "comparabili", label: "Confronto comparabili" },
  ];
  const indirizzo = (() => { const street = [data.via, data.civico].filter(Boolean).join(" "); return [street, data.citta].filter(Boolean).join(", ") || "Nuova operazione"; })();

  return (
    <div style={{ background: C.bg, minHeight: "100vh", fontFamily: "'Georgia', 'Times New Roman', serif" }}>
      {/* HEADER */}
      <div style={{ background: C.navy }}>
        <div style={{ maxWidth: 960, margin: "0 auto", padding: "12px 16px", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ color: C.accent, fontWeight: 700, fontSize: 10, letterSpacing: 2.5, textTransform: "uppercase", fontFamily: "-apple-system, sans-serif", marginBottom: 1 }}>Analisi frazionamento</div>
            <div style={{ color: "#FFF", fontWeight: 700, fontSize: 16, lineHeight: 1.2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{indirizzo}</div>
            {viewOnly && <span style={{ background: "rgba(255,255,255,0.15)", color: "#FFD580", fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 10, fontFamily: "-apple-system, sans-serif" }}>Solo lettura</span>}
          </div>
          <div style={{ display: "flex", gap: 6, flexShrink: 0, flexWrap: "wrap" }}>
            {user && (
              <>
                {saveStatus && (
                  <span style={{ color: saveStatus === "saving" ? "#6B7B94" : "#6FCF97", fontSize: 11, fontWeight: 600, fontFamily: "-apple-system, sans-serif", padding: "6px 4px", display: "flex", alignItems: "center", gap: 4 }}>
                    {saveStatus === "saving" ? "Salvataggio..." : "✓ Salvato"}
                  </span>
                )}
                <button onClick={() => setAuthScreen("projects")} style={{ background: "rgba(196,132,29,0.15)", color: C.accent, border: "none", borderRadius: 4, padding: "6px 10px", fontWeight: 600, fontSize: 11, cursor: "pointer", fontFamily: "-apple-system, sans-serif" }}>
                  I miei progetti
                </button>
              </>
            )}
            {!user && <button onClick={() => setAuthScreen("login")} style={{ background: "rgba(196,132,29,0.15)", color: C.accent, border: "none", borderRadius: 4, padding: "6px 10px", fontWeight: 600, fontSize: 11, cursor: "pointer", fontFamily: "-apple-system, sans-serif" }}>Accedi per salvare</button>}
            <button onClick={() => setShowPopup(true)} style={{ background: "rgba(26,127,55,0.15)", color: "#6FCF97", border: "1px solid rgba(26,127,55,0.3)", borderRadius: 4, padding: "6px 10px", fontWeight: 600, fontSize: 11, cursor: "pointer", fontFamily: "-apple-system, sans-serif" }}>Esporta Excel</button>
            <button onClick={() => { setShowDash(false); setStep(0); }} style={{ background: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.7)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 4, padding: "6px 10px", fontWeight: 600, fontSize: 11, cursor: "pointer", fontFamily: "-apple-system, sans-serif" }}>Modifica dati</button>
            {user && <button onClick={handleLogout} style={{ background: "none", border: "none", color: "#6B7B94", fontSize: 11, cursor: "pointer", fontFamily: "-apple-system, sans-serif", padding: "6px 4px" }}>Esci</button>}
          </div>
        </div>
        <div style={{ height: 3, background: C.accent }} />
      </div>

      <div style={{ maxWidth: 960, margin: "0 auto", padding: "20px 16px" }}>
        {/* VERDICT BANNER */}
        <div style={{ background: verdict ? C.greenBg : C.redBg, border: `1px solid ${verdict ? "#B8DFC9" : "#F5C6C6"}`, borderLeft: `4px solid ${verdict ? C.green : C.red}`, borderRadius: 4, padding: "12px 16px", marginBottom: 18, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ color: verdict ? C.green : C.red, fontWeight: 700, fontSize: 14, fontFamily: "-apple-system, sans-serif" }}>{verdict ? "Operazione sostenibile" : "Attenzione: margine a rischio"}</div>
            <div style={{ color: C.textMid, fontSize: 13, marginTop: 2, fontFamily: "-apple-system, sans-serif" }}>{verdict ? `Margine positivo anche nello scenario pessimistico (${fmtEur(calc.pess.margine)})` : `Il margine diventa negativo nello scenario pessimistico (${fmtEur(calc.pess.margine)})`}</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ color: C.textLight, fontSize: 9, fontWeight: 700, letterSpacing: 0.8, textTransform: "uppercase", fontFamily: "-apple-system, sans-serif" }}>ROI annualizzato</div>
            <div style={{ color: C.dark, fontSize: 28, fontWeight: 700 }}>{fmtPct(calc.roiAnn)}</div>
          </div>
        </div>
        {/* KPI CARDS */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 8, marginBottom: 18 }}>
          <KpiCard label="Investimento totale" value={fmtEur(calc.inv)} subvalue={`${fmtEur(Math.round(calc.pMqAcq))}/mq acquisto`} />
          <KpiCard label="Ricavo netto" value={fmtEur(calc.ricNet)} subvalue={`${data.numUnita} unità x ${fmtEur(Math.round(calc.ricU))}`} />
          <KpiCard label="Margine lordo" value={fmtEur(calc.margine)} positive={calc.margine >= 0} negative={calc.margine < 0} subvalue={`Margine % ${fmtPct(calc.roi)}`} />
          <KpiCard label="ROI" value={fmtPct(calc.roi)} accent subvalue={`Annualizzato: ${fmtPct(calc.roiAnn)}`} />
        </div>
        {/* TABS */}
        <div style={{ borderBottom: `2px solid ${C.border}`, display: "flex", gap: 0, marginBottom: 20, overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
          {tabs.map((t) => (
            <button key={t.id} onClick={() => { if (t.id === "comparabili") { setShowPopup(true); return; } setDashTab(t.id); }} style={{
              background: "transparent", border: "none", borderBottom: dashTab === t.id ? `2px solid ${C.accent}` : "2px solid transparent",
              color: dashTab === t.id ? C.dark : C.textLight, padding: "10px 14px", fontWeight: dashTab === t.id ? 700 : 500, fontSize: 13, cursor: "pointer",
              fontFamily: "-apple-system, sans-serif", marginBottom: -2, transition: "all 0.15s", whiteSpace: "nowrap", flexShrink: 0,
            }}>{t.label}</button>
          ))}
        </div>

        {/* RISULTATI TAB */}
        {dashTab === "risultati" && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 16 }}>
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 6, padding: 20, boxShadow: "0 1px 4px rgba(0,0,0,0.04)" }}>
              <div style={{ color: C.dark, fontWeight: 700, fontSize: 14, marginBottom: 14, fontFamily: "-apple-system, sans-serif", borderBottom: `2px solid ${C.accent}`, paddingBottom: 6 }}>Dati immobile</div>
              <DashInput label="Prezzo acquisto" value={data.prezzoAcquisto} onChange={(v) => upd("prezzoAcquisto", v)} suffix="€" step={5000} disabled={viewOnly} />
              <DashInput label="Superficie" value={data.metratura} onChange={(v) => upd("metratura", v)} suffix="mq" disabled={viewOnly} />
              <DashInput label="N. unità" value={data.numUnita} onChange={(v) => upd("numUnita", v)} min={2} max={10} disabled={viewOnly} />
              <DashInput label="Prezzo vendita/mq" value={data.prezzoVenditaMq} onChange={(v) => upd("prezzoVenditaMq", v)} suffix="€/mq" step={100} disabled={viewOnly} />
              <DashInput label="Durata operazione" value={data.durataOp} onChange={(v) => upd("durataOp", v)} suffix="mesi" min={1} disabled={viewOnly} />
              <div style={{ marginTop: 12, borderTop: `1px solid ${C.border}`, paddingTop: 8 }}>
                <DataRow label="Prezzo/mq acquisto" value={fmtEur(Math.round(calc.pMqAcq)) + "/mq"} />
                <DataRow label="Superficie per unità" value={fmtMq(Math.round(calc.mqU))} />
                <DataRow label="Incremento valore/mq" value={"+" + fmtPct(calc.incMq)} />
                <DataRow label="Ricavo per unità" value={fmtEur(Math.round(calc.ricU))} border={false} />
              </div>
            </div>
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 6, padding: 20, boxShadow: "0 1px 4px rgba(0,0,0,0.04)" }}>
              <div style={{ color: C.dark, fontWeight: 700, fontSize: 14, marginBottom: 14, fontFamily: "-apple-system, sans-serif", borderBottom: `2px solid ${C.accent}`, paddingBottom: 6 }}>Struttura costi</div>
              <DashInput label="Ristrutturazione/mq" value={data.costoRistMq} onChange={(v) => upd("costoRistMq", v)} suffix="€/mq" step={50} note="Comprensivo di impiantistica" disabled={viewOnly} />
              <DashInput label="Oneri comunali" value={data.oneriComunali} onChange={(v) => upd("oneriComunali", v)} suffix="€" step={500} disabled={viewOnly} />
              <DashInput label="Professionisti" value={data.costiProfessionisti} onChange={(v) => upd("costiProfessionisti", v)} suffix="€" step={1000} disabled={viewOnly} />
              <DashPctInput label="Provvigioni agenzia" value={data.provvigioniPct} onChange={(v) => upd("provvigioniPct", v)} disabled={viewOnly} />
              <DashPctInput label="Tasse acquisto (società)" value={data.tasseAcquistoPct} onChange={(v) => upd("tasseAcquistoPct", v)} note="Imposta di registro: 9%" disabled={viewOnly} />
              <DashInput label="Allacciamenti utenze" value={data.allacciamentiUtenze} onChange={(v) => upd("allacciamentiUtenze", v)} suffix="€" step={500} disabled={viewOnly} />
              <DashInput label="Bollette Gas, Luce ecc" value={data.bolletteGasLuce} onChange={(v) => upd("bolletteGasLuce", v)} suffix="€" step={100} disabled={viewOnly} />
              <DashInput label="Consulenze Tecniche" value={data.consulenzeTecniche} onChange={(v) => upd("consulenzeTecniche", v)} suffix="€" step={500} disabled={viewOnly} />
              <DashInput label="Rendering" value={data.rendering} onChange={(v) => upd("rendering", v)} suffix="€" step={100} disabled={viewOnly} />
              <div style={{ marginBottom: 10 }}>
                <label style={{ color: C.textMid, fontSize: 11, fontWeight: 600, letterSpacing: 0.3, display: "block", marginBottom: 3, textTransform: "uppercase" }}>Interessi Banca</label>
                <div style={{ display: "flex", gap: 8 }}>
                  <div style={{ flex: 1 }}><DashInput label="Somma" value={data.speseBancarieSomma} onChange={(v) => upd("speseBancarieSomma", v)} suffix="€" step={1000} disabled={viewOnly} /></div>
                  <div style={{ flex: 1 }}><DashPctInput label="%" value={data.speseBancariePct} onChange={(v) => upd("speseBancariePct", v)} disabled={viewOnly} /></div>
                </div>
                <p style={{ color: C.textLight, fontSize: 10, margin: "0" }}>Costo: {fmtEur(Math.round(data.speseBancarieSomma * data.speseBancariePct))}</p>
              </div>
              <div style={{ marginBottom: 10 }}>
                <label style={{ color: C.textMid, fontSize: 11, fontWeight: 600, letterSpacing: 0.3, display: "block", marginBottom: 3, textTransform: "uppercase" }}>Interessi Investitori</label>
                <div style={{ display: "flex", gap: 8 }}>
                  <div style={{ flex: 1 }}><DashInput label="Somma" value={data.interessiSomma} onChange={(v) => upd("interessiSomma", v)} suffix="€" step={1000} disabled={viewOnly} /></div>
                  <div style={{ flex: 1 }}><DashPctInput label="%" value={data.interessiPct} onChange={(v) => upd("interessiPct", v)} disabled={viewOnly} /></div>
                </div>
                <p style={{ color: C.textLight, fontSize: 10, margin: "0" }}>Costo: {fmtEur(Math.round(data.interessiSomma * data.interessiPct))}</p>
              </div>
              <DashPctInput label="Buffer imprevisti" value={data.bufferPct} onChange={(v) => upd("bufferPct", v)} note="Consigliato: 15-20%" disabled={viewOnly} />
              <div style={{ marginTop: 12, borderTop: `1px solid ${C.border}`, paddingTop: 8 }}>
                <DataRow label="Ristrutturazione + impianti" value={fmtEur(calc.costoRistTot)} />
                <DataRow label="Oneri comunali" value={fmtEur(data.oneriComunali)} />
                <DataRow label="Professionisti" value={fmtEur(data.costiProfessionisti)} />
                <DataRow label="Tasse acquisto" value={fmtEur(Math.round(calc.tasseAcquisto))} />
                <DataRow label="Allacciamenti utenze" value={fmtEur(data.allacciamentiUtenze)} />
                <DataRow label="Bollette Gas, Luce ecc" value={fmtEur(data.bolletteGasLuce)} />
                <DataRow label="Consulenze Tecniche" value={fmtEur(data.consulenzeTecniche)} />
                <DataRow label="Rendering" value={fmtEur(data.rendering)} />
                <DataRow label="Interessi Banca" value={fmtEur(Math.round(calc.speseBancarie))} />
                <DataRow label="Interessi Investitori" value={fmtEur(Math.round(calc.interessi))} />
                <DataRow label="Buffer imprevisti" value={fmtEur(Math.round(calc.buffer))} />
                <DataRow label="Totale costi" value={fmtEur(Math.round(calc.costiFraz))} bold highlight border={false} />
              </div>
            </div>
          </div>
        )}

        {/* RISTRUTTURAZIONE TAB */}
        {dashTab === "ristrutturazione" && (
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 6, boxShadow: "0 1px 4px rgba(0,0,0,0.04)", overflow: "hidden" }}>
            <div style={{ padding: "16px 20px", borderBottom: `1px solid ${C.border}`, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
              <div>
                <div style={{ color: C.dark, fontWeight: 700, fontSize: 14, fontFamily: "-apple-system, sans-serif" }}>Computo ristrutturazione</div>
                <div style={{ color: C.textMid, fontSize: 12, fontFamily: "-apple-system, sans-serif", marginTop: 2 }}>Inserisci le quantità per calcolare il costo totale</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ color: C.textLight, fontSize: 9, fontWeight: 700, letterSpacing: 0.8, textTransform: "uppercase", fontFamily: "-apple-system, sans-serif" }}>Totale</div>
                <div style={{ color: C.dark, fontSize: 22, fontWeight: 700 }}>{fmtEur(ristTotale)}</div>
                {data.metratura > 0 && <div style={{ color: C.textMid, fontSize: 11, fontFamily: "-apple-system, sans-serif" }}>{fmtEur(Math.round(ristTotale / data.metratura))}/mq</div>}
              </div>
            </div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "-apple-system, sans-serif", fontSize: 13 }}>
                <thead>
                  <tr style={{ background: C.navy }}>
                    {["Voce", "Q.tà", "U.M.", "Prezzo", "Totale", "%"].map((h, i) => (
                      <th key={h} style={{ color: "#FFF", fontWeight: 600, fontSize: 10, letterSpacing: 0.5, textTransform: "uppercase", padding: "8px " + (i === 0 ? "12" : "8") + "px", textAlign: i < 3 ? (i === 0 ? "left" : "center") : "right" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {ristItems.map((it, idx) => {
                    const tot = it.qty * it.prezzo;
                    const pct = ristTotale > 0 ? (tot / ristTotale) * 100 : 0;
                    const hasValue = tot > 0;
                    return (
                      <tr key={idx} style={{ background: hasValue ? C.highlight : "transparent", borderBottom: `1px solid ${C.border}` }}>
                        <td style={{ padding: "6px 12px", color: C.dark, fontWeight: hasValue ? 600 : 400 }}>{it.nome}</td>
                        <td style={{ padding: "4px 4px", textAlign: "center" }}>
                          <input type="number" value={it.qty} min={0} disabled={viewOnly}
                            onChange={(e) => updRist(idx, "qty", Math.max(0, Number(e.target.value) || 0))}
                            style={{ width: 54, background: viewOnly ? "#f0f0f0" : C.inputBg, border: `1px solid ${C.inputBorder}`, borderRadius: 3, padding: "4px 6px", textAlign: "center", fontSize: 13, fontWeight: 600, color: C.dark, outline: "none", fontFamily: "inherit" }} />
                        </td>
                        <td style={{ padding: "6px 8px", textAlign: "center", color: C.textLight, fontSize: 11 }}>{it.unita}</td>
                        <td style={{ padding: "4px 4px", textAlign: "right" }}>
                          <input type="number" value={it.prezzo} min={0} step={5} disabled={viewOnly}
                            onChange={(e) => updRist(idx, "prezzo", Math.max(0, Number(e.target.value) || 0))}
                            style={{ width: 74, background: viewOnly ? "#f0f0f0" : C.inputBg, border: `1px solid ${C.inputBorder}`, borderRadius: 3, padding: "4px 6px", textAlign: "right", fontSize: 13, fontWeight: 500, color: C.dark, outline: "none", fontFamily: "inherit" }} />
                        </td>
                        <td style={{ padding: "6px 12px", textAlign: "right", color: hasValue ? C.dark : C.textLight, fontWeight: hasValue ? 700 : 400, fontFamily: "'Georgia', serif" }}>{fmtEur(tot)}</td>
                        <td style={{ padding: "6px 12px", textAlign: "right", color: hasValue ? C.accent : C.textLight, fontWeight: 600, fontSize: 12 }}>{hasValue ? pct.toFixed(1) + "%" : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div style={{ padding: "14px 20px", borderTop: `2px solid ${C.navy}`, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
              <span style={{ color: C.dark, fontWeight: 700, fontSize: 15 }}>TOTALE COSTI</span>
              <div style={{ color: C.dark, fontSize: 22, fontWeight: 700, fontFamily: "'Georgia', serif" }}>{fmtEur(ristTotale)}</div>
            </div>
            {ristTotale > 0 && data.metratura > 0 && !viewOnly && (
              <div style={{ padding: "12px 20px", background: C.highlight, borderTop: `1px solid ${C.accentLight}`, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
                <div style={{ color: C.textMid, fontSize: 13, fontFamily: "-apple-system, sans-serif" }}>Costo calcolato: <strong style={{ color: C.dark }}>{fmtEur(Math.round(ristTotale / data.metratura))}/mq</strong></div>
                <button onClick={() => upd("costoRistMq", Math.round(ristTotale / data.metratura))} style={{ background: C.navy, color: "#FFF", border: "none", borderRadius: 4, padding: "6px 14px", fontWeight: 600, fontSize: 12, cursor: "pointer", fontFamily: "-apple-system, sans-serif" }}>Applica al calcolo</button>
              </div>
            )}
          </div>
        )}

        {/* SCENARI TAB */}
        {dashTab === "scenari" && (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12, marginBottom: 20 }}>
              <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 6, padding: 16, borderTop: `3px solid ${C.red}` }}>
                <div style={{ color: C.red, fontWeight: 700, fontSize: 11, letterSpacing: 0.8, marginBottom: 10, textTransform: "uppercase", fontFamily: "-apple-system, sans-serif" }}>Scenario pessimistico</div>
                <DashPctInput label="Var. prezzo vendita" value={scenari.varPrezzoDown} onChange={(v) => setScenari((p) => ({ ...p, varPrezzoDown: v }))} disabled={viewOnly} />
                <DashPctInput label="Var. costi" value={scenari.varCostiUp} onChange={(v) => setScenari((p) => ({ ...p, varCostiUp: v }))} disabled={viewOnly} />
                <DashInput label="Mesi aggiuntivi" value={scenari.mesiExtra} onChange={(v) => setScenari((p) => ({ ...p, mesiExtra: v }))} suffix="mesi" min={0} disabled={viewOnly} />
              </div>
              <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 6, padding: 16, borderTop: `3px solid ${C.green}` }}>
                <div style={{ color: C.green, fontWeight: 700, fontSize: 11, letterSpacing: 0.8, marginBottom: 10, textTransform: "uppercase", fontFamily: "-apple-system, sans-serif" }}>Scenario ottimistico</div>
                <DashPctInput label="Var. prezzo vendita" value={scenari.varPrezzoUp} onChange={(v) => setScenari((p) => ({ ...p, varPrezzoUp: v }))} disabled={viewOnly} />
                <DashPctInput label="Var. costi" value={scenari.varCostiDown} onChange={(v) => setScenari((p) => ({ ...p, varCostiDown: v }))} disabled={viewOnly} />
                <DashInput label="Mesi in meno" value={scenari.mesiMeno} onChange={(v) => setScenari((p) => ({ ...p, mesiMeno: v }))} suffix="mesi" min={0} disabled={viewOnly} />
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 20 }}>
              <ScenarioBlock title="Pessimistico" subtitle="Worst case" color={C.red} borderColor="#F5C6C6" {...calc.pess} />
              <ScenarioBlock title="Realistico" subtitle="Base case" color={C.accent} borderColor={C.accentLight} {...calc.real} />
              <ScenarioBlock title="Ottimistico" subtitle="Best case" color={C.green} borderColor="#B8DFC9" {...calc.ott} />
            </div>
            <div style={{ background: verdict ? C.greenBg : C.redBg, borderLeft: `4px solid ${verdict ? C.green : C.red}`, borderRadius: 4, padding: "16px 20px" }}>
              <div style={{ color: verdict ? C.green : C.red, fontWeight: 700, fontSize: 15, fontFamily: "-apple-system, sans-serif" }}>{verdict ? "L'operazione regge in tutti gli scenari" : "L'operazione non supera lo stress test"}</div>
              <div style={{ color: C.textMid, fontSize: 13, marginTop: 4, fontFamily: "-apple-system, sans-serif" }}>{verdict ? "Il margine resta positivo anche nelle condizioni peggiori." : "Il margine diventa negativo nello scenario pessimistico."}</div>
            </div>
          </>
        )}

        {/* COMPARABILI TAB */}
        {dashTab === "comparabili" && (
          <>
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 6, boxShadow: "0 1px 4px rgba(0,0,0,0.04)", overflow: "hidden" }}>
              <div style={{ padding: "16px 20px", borderBottom: `1px solid ${C.border}`, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
                <div>
                  <div style={{ color: C.dark, fontWeight: 700, fontSize: 14, fontFamily: "-apple-system, sans-serif" }}>Immobili comparabili</div>
                  <div style={{ color: C.textLight, fontSize: 11 }}>Inserisci gli immobili venduti nella zona per validare il prezzo di vendita al mq</div>
                </div>
                {!viewOnly && <button onClick={addComparabile} style={{ background: C.accent, color: "#FFF", border: "none", borderRadius: 4, padding: "6px 14px", fontWeight: 600, fontSize: 12, cursor: "pointer", fontFamily: "-apple-system, sans-serif" }}>+ Aggiungi</button>}
              </div>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, fontFamily: "-apple-system, sans-serif" }}>
                  <thead>
                    <tr style={{ background: "#F5F3EE" }}>
                      {["#", "Indirizzo", "Mq", "Prezzo", "€/mq", "Note", ""].map((h, i) => (
                        <th key={i} style={{ padding: "8px 12px", textAlign: i > 1 && i < 5 ? "right" : "left", color: C.textMid, fontSize: 10, fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase", borderBottom: `1px solid ${C.border}` }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {comparabili.map((c, i) => (
                      <tr key={i} style={{ borderBottom: `1px solid ${C.border}` }}>
                        <td style={{ padding: "6px 12px", color: C.textLight, fontWeight: 600 }}>{i + 1}</td>
                        <td style={{ padding: "6px 12px" }}>
                          <input type="text" value={c.indirizzo} onChange={(e) => updComparabile(i, "indirizzo", e.target.value)} placeholder="Via, zona..." disabled={viewOnly}
                            style={{ background: viewOnly ? "#f0f0f0" : C.inputBg, border: `1px solid ${C.inputBorder}`, borderRadius: 4, padding: "5px 8px", width: "100%", minWidth: 120, color: C.dark, fontSize: 13, fontFamily: "inherit", outline: "none" }} />
                        </td>
                        <td style={{ padding: "6px 12px" }}>
                          <input type="number" value={c.mq} onChange={(e) => updComparabile(i, "mq", Number(e.target.value) || 0)} step={5} disabled={viewOnly}
                            style={{ background: viewOnly ? "#f0f0f0" : C.inputBg, border: `1px solid ${C.inputBorder}`, borderRadius: 4, padding: "5px 8px", width: 70, textAlign: "right", color: C.dark, fontSize: 13, fontFamily: "inherit", outline: "none" }} />
                        </td>
                        <td style={{ padding: "6px 12px" }}>
                          <input type="number" value={c.prezzo} onChange={(e) => updComparabile(i, "prezzo", Number(e.target.value) || 0)} step={5000} disabled={viewOnly}
                            style={{ background: viewOnly ? "#f0f0f0" : C.inputBg, border: `1px solid ${C.inputBorder}`, borderRadius: 4, padding: "5px 8px", width: 100, textAlign: "right", color: C.dark, fontSize: 13, fontFamily: "inherit", outline: "none" }} />
                        </td>
                        <td style={{ padding: "6px 12px", textAlign: "right", fontWeight: 600, fontFamily: "'Georgia', serif", color: c.prezzoMq > 0 ? C.dark : C.textLight }}>{c.prezzoMq > 0 ? fmtEur(c.prezzoMq) : "—"}</td>
                        <td style={{ padding: "6px 12px" }}>
                          <input type="text" value={c.note} onChange={(e) => updComparabile(i, "note", e.target.value)} placeholder="Note..." disabled={viewOnly}
                            style={{ background: viewOnly ? "#f0f0f0" : C.inputBg, border: `1px solid ${C.inputBorder}`, borderRadius: 4, padding: "5px 8px", width: "100%", minWidth: 80, color: C.dark, fontSize: 13, fontFamily: "inherit", outline: "none" }} />
                        </td>
                        <td style={{ padding: "6px 12px", textAlign: "center" }}>
                          {comparabili.length > 1 && !viewOnly && <button onClick={() => removeComparabile(i)} style={{ background: "none", border: "none", color: C.red, cursor: "pointer", fontSize: 16, fontWeight: 700, padding: "2px 6px" }}>x</button>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            {mediaComparabili.count > 0 && (
              <>
                <div style={{ marginTop: 20, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 14 }}>
                  <KpiCard label="Media €/mq comparabili" value={fmtEur(mediaComparabili.mediaPrezzoMq)} accent subvalue={`su ${mediaComparabili.count} immobili`} />
                  <KpiCard label="Tuo prezzo vendita/mq" value={fmtEur(data.prezzoVenditaMq)} positive={data.prezzoVenditaMq <= mediaComparabili.mediaPrezzoMq} negative={data.prezzoVenditaMq > mediaComparabili.mediaPrezzoMq} subvalue={data.prezzoVenditaMq <= mediaComparabili.mediaPrezzoMq ? "In linea o sotto media" : "Sopra la media zona"} />
                  <KpiCard label="Differenza" value={fmtEur(data.prezzoVenditaMq - mediaComparabili.mediaPrezzoMq)} positive={data.prezzoVenditaMq <= mediaComparabili.mediaPrezzoMq} negative={data.prezzoVenditaMq > mediaComparabili.mediaPrezzoMq} subvalue={fmtPct(mediaComparabili.mediaPrezzoMq > 0 ? (data.prezzoVenditaMq - mediaComparabili.mediaPrezzoMq) / mediaComparabili.mediaPrezzoMq : 0) + " rispetto alla media"} />
                  <KpiCard label="Media superficie" value={fmtMq(mediaComparabili.mediaMq)} subvalue={`Media prezzo: ${fmtEur(mediaComparabili.mediaPrezzo)}`} />
                </div>
                <div style={{ marginTop: 16, background: data.prezzoVenditaMq <= mediaComparabili.mediaPrezzoMq ? C.greenBg : C.redBg, borderLeft: `4px solid ${data.prezzoVenditaMq <= mediaComparabili.mediaPrezzoMq ? C.green : C.red}`, borderRadius: 4, padding: "16px 20px" }}>
                  <div style={{ color: data.prezzoVenditaMq <= mediaComparabili.mediaPrezzoMq ? C.green : C.red, fontWeight: 700, fontSize: 15, fontFamily: "-apple-system, sans-serif" }}>{data.prezzoVenditaMq <= mediaComparabili.mediaPrezzoMq ? "Prezzo di vendita competitivo" : "Prezzo di vendita sopra la media"}</div>
                  <div style={{ color: C.textMid, fontSize: 13, marginTop: 4, fontFamily: "-apple-system, sans-serif" }}>{data.prezzoVenditaMq <= mediaComparabili.mediaPrezzoMq ? "Il prezzo è in linea o inferiore alla media. Buone probabilità di vendita rapida." : "Il prezzo è superiore alla media. Valuta se la ristrutturazione giustifica il premium."}</div>
                </div>
              </>
            )}
          </>
        )}
      </div>

      {/* FOOTER */}
      <div style={{ borderTop: `1px solid ${C.border}`, padding: "16px 0", marginTop: 32 }}>
        <div style={{ maxWidth: 960, margin: "0 auto", padding: "0 24px", textAlign: "center" }}>
          <p style={{ color: C.textLight, fontSize: 11, margin: 0, fontFamily: "-apple-system, sans-serif" }}>Lorenzo Loseto — Calcolatore Frazionamento Immobiliare — go.lorenzoloseto.com</p>
        </div>
      </div>

      {/* POPUP REINNOVA */}
      {showPopup && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(13,34,64,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999 }} onClick={() => setShowPopup(false)}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: C.card, borderRadius: 8, padding: "28px 24px", maxWidth: 420, width: "90%", boxShadow: "0 8px 32px rgba(0,0,0,0.18)", border: `1px solid ${C.border}`, textAlign: "center" }}>
            <div style={{ width: 48, height: 48, borderRadius: "50%", background: C.accentLight, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}>
              <span style={{ color: C.accent, fontSize: 22 }}>★</span>
            </div>
            <div style={{ color: C.dark, fontSize: 20, fontWeight: 700, fontFamily: "'Georgia', serif", marginBottom: 8 }}>Tecnologia per studenti Reinnova</div>
            <div style={{ color: C.textMid, fontSize: 14, lineHeight: 1.5, fontFamily: "-apple-system, sans-serif", marginBottom: 24 }}>Tecnologia esclusiva per gli studenti del programma Reinnova.</div>
            <button onClick={() => setShowPopup(false)} style={{ background: C.accent, color: "#FFF", border: "none", borderRadius: 6, padding: "10px 32px", fontWeight: 700, fontSize: 14, cursor: "pointer", fontFamily: "-apple-system, sans-serif", boxShadow: "0 2px 8px rgba(196,132,29,0.3)" }}>Ho capito</button>
          </div>
        </div>
      )}
    </div>
  );
}
