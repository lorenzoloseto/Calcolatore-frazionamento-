import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { createClient } from "@supabase/supabase-js";
import { Capacitor } from "@capacitor/core";
import { Browser } from "@capacitor/browser";
import { StatusBar, Style } from "@capacitor/status-bar";
import { App as CapApp } from "@capacitor/app";
// ============================================================
// FRAZIO — Condivisione protetta di analisi immobiliari con NDA
// Aesthetic: Legal-tech / Fintech — professional secure sharing
// Gruppo Loseto srl
// ============================================================

// ============================================================
// SUPABASE CLIENT — Libreria ufficial
// ============================================================
const SB_URL = "https://hyfktrxffwdnawbvfajr.supabase.co";
const SB_KEY = "sb_publishable_uJdFDJ4lGsrGdrqmu-NmdQ_7Dy2WVfb";
const supabase = createClient(SB_URL, SB_KEY);
const isNative = Capacitor.isNativePlatform();
const WEB_ORIGIN = "https://go.lorenzoloseto.com";
const SESSION_ID = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36);
const ADMIN_EMAIL = "lorenzoloseto@hotmail.it";

const DB = {
  _user: null,
  async _getUser() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { this._user = null; return null; }
    this._user = { id: user.id, name: user.user_metadata?.name || user.user_metadata?.full_name || user.email?.split("@")[0] || "Utente", email: user.email };
    return this._user;
  },
  getUser() {
    const session = JSON.parse(localStorage.getItem(`sb-${SB_URL.split("//")[1].split(".")[0]}-auth-token`) || "null");
    if (!session?.user) { this._user = null; return null; }
    const u = session.user;
    this._user = { id: u.id, name: u.user_metadata?.name || u.user_metadata?.full_name || u.email?.split("@")[0] || "Utente", email: u.email };
    return this._user;
  },
  async register(name, email, password) {
    const { data, error } = await supabase.auth.signUp({ email, password, options: { data: { name } } });
    if (error) return { ok: false, error: error.message };
    if (data.user && !data.session) return { ok: true, user: null, confirmEmail: true };
    if (data.user && data.session) {
      this._user = { id: data.user.id, name, email };
      return { ok: true, user: this._user };
    }
    return { ok: false, error: "Errore sconosciuto" };
  },
  async login(email, password) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return { ok: false, error: error.message };
    this._user = { id: data.user.id, name: data.user.user_metadata?.name || email.split("@")[0], email };
    return { ok: true, user: this._user };
  },
  async loginWithGoogle() {
    if (isNative) {
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: "com.lorenzoloseto.frazio://auth/callback",
          skipBrowserRedirect: true,
        }
      });
      if (error) return { ok: false, error: error.message };
      if (data?.url) await Browser.open({ url: data.url });
      return { ok: true };
    }
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin + window.location.pathname }
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  },
  async resetPasswordForEmail(email) {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: isNative ? "com.lorenzoloseto.frazio://auth/callback" : window.location.origin + window.location.pathname,
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  },
  async updatePassword(newPassword) {
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  },
  async logout() {
    await supabase.auth.signOut();
    this._user = null;
  },
  async ensureProfile(user) {
    if (!user) return;
    const { error } = await supabase.from("profiles").upsert(
      { id: user.id, name: user.name, email: user.email },
      { onConflict: "id" }
    );
    if (error) console.warn("ensureProfile:", error.message);
  },
  async saveProject(pd) {
    if (!this._user) return { ok: false, error: "Non autenticato" };
    const body = { name: pd.name, data: pd.data, scenari: pd.scenari, comparabili: pd.comparabili, rist_items: pd.ristItems };
    if (pd.id) {
      const { data, error } = await supabase.from("projects").update(body).eq("id", pd.id).select().single();
      if (error) return { ok: false, error: error.message };
      return { ok: true, project: data };
    } else {
      body.owner_id = this._user.id;
      body.owner_name = this._user.name;
      const { data, error } = await supabase.from("projects").insert(body).select().single();
      if (error) return { ok: false, error: error.message };
      return { ok: true, project: data };
    }
  },
  async getProjects() {
    if (!this._user) return [];
    const { data: own } = await supabase.from("projects").select("*").eq("owner_id", this._user.id).order("updated_at", { ascending: false });
    const { data: shares } = await supabase.from("project_shares").select("project_id, permission").eq("shared_with_email", this._user.email);
    let shared = [];
    if (shares && shares.length > 0) {
      const ids = shares.map((s) => s.project_id);
      const { data: shProjects } = await supabase.from("projects").select("*").in("id", ids).order("updated_at", { ascending: false });
      shared = (shProjects || []).map((p) => {
        const sh = shares.find((s) => s.project_id === p.id);
        return { ...p, _shared: true, _permission: sh?.permission || "view" };
      });
    }
    return [...(own || []), ...shared];
  },
  async deleteProject(pid) {
    const { error } = await supabase.from("projects").delete().eq("id", pid);
    return { ok: !error };
  },
  async shareProject(pid, email, permission) {
    if (!this._user) return { ok: false, error: "Non autenticato" };
    if (email === this._user.email) return { ok: false, error: "Non puoi condividere con te stesso" };
    const { error } = await supabase.from("project_shares").insert({ project_id: pid, shared_with_email: email, permission, shared_by: this._user.id });
    if (error) return { ok: false, error: error.message.includes("duplicate") ? "Già condiviso con questa email" : error.message };
    return { ok: true };
  },
  async removeShare(pid, email) {
    const { error } = await supabase.from("project_shares").delete().eq("project_id", pid).eq("shared_with_email", email);
    return { ok: !error };
  },
  async getShares(pid) {
    const { data } = await supabase.from("project_shares").select("*").eq("project_id", pid);
    return data || [];
  },
  trackEvent(eventType, metadata = {}) {
    const userId = this._user?.id || null;
    supabase.from("analytics_events").insert({ user_id: userId, event_type: eventType, metadata, session_id: SESSION_ID }).then(() => {}).catch(() => {});
  },
};

// ============================================================
// FORMAT HELPERS & COLORS
// ============================================================
// ============================================================
// PRIVACY POLICY MODAL — Informativa Privacy GDPR Art. 13
// ============================================================
function PrivacyPolicyModal({ onClose }) {
  const sectionTitle = { color: C.dark, fontWeight: 700, fontSize: 15, margin: "22px 0 8px", fontFamily: "-apple-system, sans-serif" };
  const paragraph = { color: C.textMid, fontSize: 13, lineHeight: 1.7, margin: "0 0 10px", fontFamily: "-apple-system, sans-serif" };
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "#FFF", borderRadius: 10, maxWidth: 600, width: "100%", maxHeight: "85vh", overflow: "auto", padding: "32px 28px", boxShadow: "0 8px 40px rgba(0,0,0,0.2)" }}>
        <div style={{ width: 48, height: 4, background: C.accent, margin: "0 auto 20px", borderRadius: 2 }} />
        <h2 style={{ color: C.dark, fontSize: 20, fontWeight: 700, textAlign: "center", margin: "0 0 6px" }}>Informativa sulla Privacy</h2>
        <p style={{ color: C.textLight, fontSize: 12, textAlign: "center", margin: "0 0 24px", fontFamily: "-apple-system, sans-serif" }}>Ai sensi dell'art. 13 del Regolamento UE 2016/679 (GDPR)</p>

        <h3 style={sectionTitle}>1. Titolare del trattamento</h3>
        <p style={paragraph}>Il Titolare del trattamento dei dati personali è <strong>Gruppo Loseto srl</strong>, contattabile all'indirizzo email: <strong>lorenzoloseto@hotmail.it</strong>.</p>

        <h3 style={sectionTitle}>2. Dati personali raccolti</h3>
        <p style={paragraph}>Il Titolare raccoglie le seguenti categorie di dati personali:</p>
        <ul style={{ ...paragraph, paddingLeft: 20 }}>
          <li><strong>Utenti registrati:</strong> nome, indirizzo email, password (criptata).</li>
          <li><strong>Visitatori link condivisi:</strong> nome, cognome, indirizzo email, codice fiscale, data di nascita, sesso, luogo di nascita. Il codice fiscale è raccolto per l'identificazione univoca del soggetto che accede a informazioni economiche riservate, a tutela del titolare del progetto e per eventuale utilizzo in sede legale in caso di violazione dell'impegno di riservatezza. Il CF è trattato con misure di sicurezza rafforzate.</li>
          <li><strong>Dati tecnici:</strong> token di sessione memorizzati nel browser (localStorage) per il mantenimento dell'accesso.</li>
        </ul>

        <h3 style={sectionTitle}>3. Finalità del trattamento</h3>
        <p style={paragraph}>I dati personali sono trattati per le seguenti finalità:</p>
        <ul style={{ ...paragraph, paddingLeft: 20 }}>
          <li>Creazione e gestione dell'account utente;</li>
          <li>Esecuzione delle analisi economiche immobiliari e salvataggio dei progetti;</li>
          <li>Condivisione dei progetti con soggetti terzi tramite link;</li>
          <li>Tracciamento degli accessi ai progetti condivisi, a tutela del titolare del progetto;</li>
          <li>Adempimento di obblighi di legge.</li>
        </ul>

        <h3 style={sectionTitle}>4. Base giuridica del trattamento</h3>
        <p style={paragraph}>Il trattamento dei dati è fondato sulle seguenti basi giuridiche ai sensi dell'art. 6 del GDPR:</p>
        <ul style={{ ...paragraph, paddingLeft: 20 }}>
          <li><strong>Consenso esplicito</strong> (Art. 6.1.a): per la raccolta dei dati identificativi dei visitatori dei link condivisi;</li>
          <li><strong>Consenso esplicito per dati particolari</strong> (Art. 9.2.a): per il trattamento del codice fiscale, dato che consente l'identificazione univoca della persona fisica;</li>
          <li><strong>Esecuzione di un contratto</strong> (Art. 6.1.b): per la gestione dell'account e l'erogazione del servizio;</li>
          <li><strong>Legittimo interesse</strong> (Art. 6.1.f): per la sicurezza e il tracciamento degli accessi ai progetti riservati.</li>
        </ul>

        <h3 style={sectionTitle}>5. Conservazione dei dati</h3>
        <p style={paragraph}>I dati personali saranno conservati per il tempo strettamente necessario al perseguimento delle finalità per le quali sono stati raccolti e comunque per la durata del rapporto contrattuale. I dati dei visitatori dei link condivisi saranno conservati per un periodo massimo di 2 anni dall'accesso.</p>

        <h3 style={sectionTitle}>6. Comunicazione e diffusione dei dati</h3>
        <p style={paragraph}>I dati personali non saranno diffusi. Potranno essere comunicati a:</p>
        <ul style={{ ...paragraph, paddingLeft: 20 }}>
          <li>Supabase Inc. (fornitore del servizio di database e autenticazione), i cui server sono situati nell'Unione Europea;</li>
          <li>Soggetti autorizzati al trattamento in qualità di responsabili o incaricati.</li>
        </ul>

        <h3 style={sectionTitle}>7. Diritti dell'interessato</h3>
        <p style={paragraph}>Ai sensi degli artt. 15-22 del GDPR, l'interessato ha il diritto di:</p>
        <ul style={{ ...paragraph, paddingLeft: 20 }}>
          <li>Accedere ai propri dati personali;</li>
          <li>Ottenere la rettifica o la cancellazione degli stessi;</li>
          <li>Ottenere la limitazione del trattamento;</li>
          <li>Opporsi al trattamento;</li>
          <li>Richiedere la portabilità dei dati;</li>
          <li>Revocare il consenso in qualsiasi momento, senza pregiudicare la liceità del trattamento basato sul consenso prestato prima della revoca;</li>
          <li>Proporre reclamo all'Autorità Garante per la Protezione dei Dati Personali.</li>
        </ul>
        <p style={paragraph}>Per esercitare i propri diritti, l'interessato può contattare il Titolare all'indirizzo email: <strong>lorenzoloseto@hotmail.it</strong>.</p>

        <h3 style={sectionTitle}>8. Cookie e tecnologie di tracciamento</h3>
        <p style={paragraph}>Questo sito utilizza esclusivamente cookie tecnici e di sessione (token di autenticazione memorizzati in localStorage) necessari al funzionamento del servizio. Non vengono utilizzati cookie di profilazione o di terze parti a fini pubblicitari.</p>
        <p style={paragraph}>In caso di autenticazione tramite Google OAuth, Google potrà impostare cookie propri necessari al processo di autenticazione. Per maggiori informazioni sulla gestione dei dati da parte di Google, si rimanda alla <a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer" style={{ color: C.accent }}>Privacy Policy di Google</a>.</p>

        <h3 style={sectionTitle}>9. Notifica di violazione dei dati (Data Breach)</h3>
        <p style={paragraph}>In caso di violazione dei dati personali che possa comportare un rischio per i diritti e le libertà degli interessati, il Titolare si impegna a:</p>
        <ul style={{ ...paragraph, paddingLeft: 20 }}>
          <li>Notificare la violazione al Garante per la Protezione dei Dati Personali entro 72 ore dalla scoperta, ai sensi dell'art. 33 del GDPR;</li>
          <li>Comunicare la violazione agli interessati senza ingiustificato ritardo, qualora la violazione sia suscettibile di presentare un rischio elevato per i loro diritti e libertà, ai sensi dell'art. 34 del GDPR;</li>
          <li>Adottare tutte le misure tecniche e organizzative necessarie per contenere la violazione e prevenire ulteriori danni.</li>
        </ul>

        <div style={{ marginTop: 28, textAlign: "center" }}>
          <button onClick={onClose} style={{ background: C.navy, color: "#FFF", border: "none", borderRadius: 6, padding: "12px 36px", fontWeight: 700, fontSize: 14, cursor: "pointer", fontFamily: "-apple-system, sans-serif" }}>Chiudi</button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// COOKIE BANNER
// ============================================================
function CookieBanner({ onAccept, onShowPrivacy }) {
  return (
    <div className={isNative ? "cap-safe-bottom" : ""} style={{ position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 9998, background: C.dark, padding: "14px 20px", display: "flex", alignItems: "center", justifyContent: "center", gap: 12, flexWrap: "wrap", boxShadow: "0 -2px 12px rgba(0,0,0,0.15)" }}>
      <p style={{ color: "rgba(255,255,255,0.85)", fontSize: 12, margin: 0, fontFamily: "-apple-system, sans-serif", lineHeight: 1.5, flex: 1, minWidth: 200 }}>
        Questo sito utilizza cookie tecnici necessari al funzionamento.{" "}
        <span onClick={onShowPrivacy} style={{ color: C.accent, cursor: "pointer", textDecoration: "underline" }}>Informativa Privacy</span>
      </p>
      <button onClick={onAccept} style={{ background: C.accent, color: "#FFF", border: "none", borderRadius: 4, padding: "8px 20px", fontWeight: 600, fontSize: 12, cursor: "pointer", fontFamily: "-apple-system, sans-serif", whiteSpace: "nowrap" }}>OK, accetto</button>
    </div>
  );
}

// ============================================================
// PRIVACY LINK — Reusable inline link
// ============================================================
function PrivacyLink({ onClick }) {
  return (
    <span onClick={onClick} style={{ color: C.accent, cursor: "pointer", textDecoration: "underline", fontSize: 12, fontFamily: "-apple-system, sans-serif" }}>
      Informativa Privacy
    </span>
  );
}

// ============================================================
// TERMINI DI SERVIZIO MODAL
// ============================================================
function TosModal({ onClose }) {
  const sectionTitle = { color: C.dark, fontWeight: 700, fontSize: 15, margin: "22px 0 8px", fontFamily: "-apple-system, sans-serif" };
  const paragraph = { color: C.textMid, fontSize: 13, lineHeight: 1.7, margin: "0 0 10px", fontFamily: "-apple-system, sans-serif" };
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "#FFF", borderRadius: 10, maxWidth: 600, width: "100%", maxHeight: "85vh", overflow: "auto", padding: "32px 28px", boxShadow: "0 8px 40px rgba(0,0,0,0.2)" }}>
        <div style={{ width: 48, height: 4, background: C.accent, margin: "0 auto 20px", borderRadius: 2 }} />
        <h2 style={{ color: C.dark, fontSize: 20, fontWeight: 700, textAlign: "center", margin: "0 0 6px" }}>Termini di Servizio</h2>
        <p style={{ color: C.textLight, fontSize: 12, textAlign: "center", margin: "0 0 24px", fontFamily: "-apple-system, sans-serif" }}>Condizioni generali di utilizzo del servizio</p>

        <h3 style={sectionTitle}>1. Oggetto del servizio</h3>
        <p style={paragraph}>Il presente servizio, fornito da <strong>Gruppo Loseto srl</strong>, consiste in uno strumento web per la creazione, condivisione e gestione di conti economici relativi a operazioni immobiliari. Il servizio permette agli utenti registrati di creare, salvare, modificare e condividere analisi economiche con protezione NDA integrata.</p>

        <h3 style={sectionTitle}>2. Obblighi dell'utente</h3>
        <p style={paragraph}>L'utente si impegna a:</p>
        <ul style={{ ...paragraph, paddingLeft: 20 }}>
          <li>Fornire dati veritieri e aggiornati in fase di registrazione;</li>
          <li>Mantenere riservate le proprie credenziali di accesso;</li>
          <li>Utilizzare il servizio esclusivamente per finalità lecite e conformi alla normativa vigente;</li>
          <li>Non tentare di accedere a dati di altri utenti in modo non autorizzato;</li>
          <li>Non utilizzare il servizio per attività fraudolente o illecite.</li>
        </ul>

        <h3 style={sectionTitle}>3. Proprietà intellettuale</h3>
        <p style={paragraph}>Il software, il design, i loghi e tutti i contenuti del servizio sono di proprietà esclusiva di Gruppo Loseto srl e sono protetti dalle leggi sulla proprietà intellettuale. L'utente non acquisisce alcun diritto di proprietà intellettuale sui contenuti del servizio. I dati e i progetti inseriti dall'utente restano di proprietà dell'utente stesso.</p>

        <h3 style={sectionTitle}>4. Limitazione di responsabilità</h3>
        <p style={paragraph}>Il servizio è fornito "così com'è" senza garanzie di alcun tipo. Gruppo Loseto srl non garantisce che il servizio sia privo di errori o interruzioni. Le analisi e i calcoli prodotti dal servizio hanno finalità puramente indicative e non costituiscono consulenza finanziaria, immobiliare o legale. L'utente è l'unico responsabile delle decisioni prese sulla base dei risultati ottenuti.</p>

        <h3 style={sectionTitle}>5. Sospensione e cancellazione</h3>
        <p style={paragraph}>Gruppo Loseto srl si riserva il diritto di sospendere o cancellare l'account dell'utente in caso di violazione dei presenti Termini di Servizio, senza preavviso. L'utente può cancellare il proprio account in qualsiasi momento dalla sezione "I miei conti economici".</p>

        <h3 style={sectionTitle}>6. Modifiche ai termini</h3>
        <p style={paragraph}>Gruppo Loseto srl si riserva il diritto di modificare i presenti Termini di Servizio in qualsiasi momento. Le modifiche saranno comunicate agli utenti tramite il sito. L'uso continuato del servizio dopo la pubblicazione delle modifiche costituisce accettazione dei nuovi termini.</p>

        <h3 style={sectionTitle}>7. Legge applicabile e foro competente</h3>
        <p style={paragraph}>I presenti Termini di Servizio sono regolati dalla legge italiana. Per qualsiasi controversia derivante dall'utilizzo del servizio sarà competente in via esclusiva il Foro di Bari.</p>

        <div style={{ marginTop: 28, textAlign: "center" }}>
          <button onClick={onClose} style={{ background: C.navy, color: "#FFF", border: "none", borderRadius: 6, padding: "12px 36px", fontWeight: 700, fontSize: 14, cursor: "pointer", fontFamily: "-apple-system, sans-serif" }}>Chiudi</button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// LANDING PAGE — Hooks, Icons & Components
// ============================================================
function useScrollReveal(threshold = 0.15) {
  const ref = useRef(null);
  const [isVisible, setIsVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setIsVisible(true); observer.disconnect(); } },
      { threshold, rootMargin: "0px 0px -60px 0px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [threshold]);
  return [ref, isVisible];
}
function useAnimatedCounter(target, duration = 2000, startAnimation = false) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!startAnimation) return;
    let start = null;
    const step = (ts) => {
      if (!start) start = ts;
      const p = Math.min((ts - start) / duration, 1);
      setCount(Math.floor((1 - Math.pow(1 - p, 3)) * target));
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }, [target, duration, startAnimation]);
  return count;
}

const LpIconLightning = () => <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={C.accent} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>;
const LpIconChart = () => <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={C.accent} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>;
const LpIconGrid = () => <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={C.accent} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>;
const LpIconShield = () => <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={C.accent} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>;
const LpIconCloud = () => <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={C.accent} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 10h-1.26A8 8 0 109 20h9a5 5 0 000-10z"/></svg>;
const LpIconDownload = () => <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={C.accent} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>;
const LpIconLock = () => <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={C.accent} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>;
const LpIconServer = () => <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={C.accent} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="2" width="20" height="8" rx="2" ry="2"/><rect x="2" y="14" width="20" height="8" rx="2" ry="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/></svg>;

function LpBrandLogo({ size = 32 }) {
  const s = size;
  const sw = 1.5;
  const dl = "lp-strokeDraw 1.5s ease-out forwards";
  const splitDelay = "1.8s";
  return (
    <svg width={s} height={s * 0.875} viewBox="0 0 32 28" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Metà sinistra edificio */}
      <g style={{ animation: `lp-splitLeft 0.8s ease-out ${splitDelay} forwards` }}>
        <path d="M2 26V6l13-4v24" stroke={C.accent} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round"
          style={{ strokeDasharray: 80, strokeDashoffset: 80, animation: dl }} />
        {/* Finestre sinistra */}
        <rect x="5" y="10" width="3" height="3" rx="0.5" stroke={C.accent} strokeWidth={sw}
          style={{ strokeDasharray: 20, strokeDashoffset: 20, animation: `lp-strokeDraw 1s ease-out 0.6s forwards` }} />
        <rect x="5" y="17" width="3" height="3" rx="0.5" stroke={C.accent} strokeWidth={sw}
          style={{ strokeDasharray: 20, strokeDashoffset: 20, animation: `lp-strokeDraw 1s ease-out 0.8s forwards` }} />
        <rect x="11" y="10" width="3" height="3" rx="0.5" stroke={C.accent} strokeWidth={sw}
          style={{ strokeDasharray: 20, strokeDashoffset: 20, animation: `lp-strokeDraw 1s ease-out 0.7s forwards` }} />
      </g>
      {/* Metà destra edificio */}
      <g style={{ animation: `lp-split 0.8s ease-out ${splitDelay} forwards` }}>
        <path d="M17 2v24l13 0V8z" stroke={C.accent} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round"
          style={{ strokeDasharray: 90, strokeDashoffset: 90, animation: dl }} />
        {/* Finestre destra */}
        <rect x="20" y="12" width="3" height="3" rx="0.5" stroke={C.accent} strokeWidth={sw}
          style={{ strokeDasharray: 20, strokeDashoffset: 20, animation: `lp-strokeDraw 1s ease-out 0.7s forwards` }} />
        <rect x="20" y="19" width="3" height="3" rx="0.5" stroke={C.accent} strokeWidth={sw}
          style={{ strokeDasharray: 20, strokeDashoffset: 20, animation: `lp-strokeDraw 1s ease-out 0.9s forwards` }} />
        <rect x="26" y="12" width="3" height="3" rx="0.5" stroke={C.accent} strokeWidth={sw}
          style={{ strokeDasharray: 20, strokeDashoffset: 20, animation: `lp-strokeDraw 1s ease-out 0.8s forwards` }} />
      </g>
      {/* Linea di frazionamento centrale */}
      <line x1="16" y1="4" x2="16" y2="26" stroke={C.accent} strokeWidth={1} strokeDasharray="3 2"
        style={{ opacity: 0, animation: `lp-strokeDraw 0.6s ease-out ${splitDelay} forwards` }} />
    </svg>
  );
}

function LpDashboardMockup({ compact = false }) {
  return (
    <div style={{ background: C.card, borderRadius: 12, overflow: "hidden", border: `1px solid ${C.border}`, boxShadow: "0 20px 60px rgba(13,34,64,0.15)" }}>
      <div style={{ background: C.navy, padding: "10px 16px", display: "flex", gap: 6, alignItems: "center" }}>
        <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#ff5f56" }} />
        <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#ffbd2e" }} />
        <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#27c93f" }} />
        <span style={{ color: "rgba(255,255,255,0.5)", fontSize: 11, marginLeft: 8, fontFamily: "-apple-system, sans-serif" }}>FRAZIO — Conto Economico</span>
      </div>
      <div style={{ background: C.greenBg, borderLeft: `3px solid ${C.green}`, margin: "12px 12px 8px", borderRadius: 4, padding: "8px 12px" }}>
        <span style={{ color: C.green, fontWeight: 700, fontSize: compact ? 10 : 12, fontFamily: "-apple-system, sans-serif" }}>✓ Operazione sostenibile — Margine positivo in tutti gli scenari</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, padding: "4px 12px 12px" }}>
        {[
          { label: "MARGINE NETTO", value: "+87.400 €", color: C.green },
          { label: "ROI", value: "34,2%", color: C.accent },
          { label: "ROI ANNUO", value: "51,3%", color: C.accent },
          { label: "INVESTIMENTO", value: "255.600 €", color: C.dark },
        ].map((kpi, i) => (
          <div key={i} style={{ background: C.bg, borderRadius: 6, padding: compact ? "6px 8px" : "10px 12px" }}>
            <div style={{ color: C.textLight, fontSize: compact ? 7 : 9, fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase" }}>{kpi.label}</div>
            <div style={{ color: kpi.color, fontSize: compact ? 14 : 18, fontWeight: 700, fontFamily: "'Georgia', serif" }}>{kpi.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

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
  oneriComunali: 5000, costiProfessionisti: 15000, provvigioniInPct: 0, provvigioniPct: 0.03, notaio: 0, bufferPct: 0.15, tasseAcquistoPct: 0.09,
  allacciamentiUtenze: 0, bolletteGasLuce: 0, consulenzeTecniche: 0, rendering: 0, imu: 0,
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
// SHARE LINK — Supabase snapshots (link corti)
// ============================================================
async function saveProjectSnapshot(projectId, name, data, scenari, comparabili, ristItems) {
  const payload = {
    n: name, d: data, s: scenari, c: comparabili,
    r: (ristItems || []).filter(it => it.qty > 0).map(it => {
      const idx = RIST_INIT.findIndex(r => r.nome === it.nome);
      return { i: idx, q: it.qty, p: it.prezzo };
    }).filter(it => it.i >= 0),
  };
  const { data: row, error } = await supabase.from("shared_snapshots").insert({ project_data: payload, project_id: projectId }).select("id").single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, id: row.id };
}
async function loadProjectSnapshot(id) {
  const { data: row, error } = await supabase.from("shared_snapshots").select("project_data").eq("id", id).single();
  if (error || !row) return null;
  const compact = row.project_data;
  const ristItems = RIST_INIT.map(it => ({ ...it }));
  (compact.r || []).forEach(({ i, q, p }) => {
    if (i >= 0 && i < ristItems.length) {
      ristItems[i] = { ...ristItems[i], qty: q, prezzo: p };
    }
  });
  return {
    name: compact.n || "Progetto condiviso",
    data: { ...DEFAULT_DATA, ...compact.d },
    scenari: { ...DEFAULT_SCENARI, ...compact.s },
    comparabili: compact.c || [{ indirizzo: "", mq: 0, prezzo: 0, prezzoMq: 0, note: "" }],
    ristItems,
  };
}

// ============================================================
// CODICE FISCALE VALIDATION
// ============================================================
const CF_MONTHS = 'ABCDEHLMPRST';
const CF_ODD = {'0':1,'1':0,'2':5,'3':7,'4':9,'5':13,'6':15,'7':17,'8':19,'9':21,'A':1,'B':0,'C':5,'D':7,'E':9,'F':13,'G':15,'H':17,'I':19,'J':21,'K':2,'L':4,'M':18,'N':20,'O':11,'P':3,'Q':6,'R':8,'S':12,'T':14,'U':16,'V':10,'W':22,'X':25,'Y':24,'Z':23};
const CF_EVEN = {'0':0,'1':1,'2':2,'3':3,'4':4,'5':5,'6':6,'7':7,'8':8,'9':9,'A':0,'B':1,'C':2,'D':3,'E':4,'F':5,'G':6,'H':7,'I':8,'J':9,'K':10,'L':11,'M':12,'N':13,'O':14,'P':15,'Q':16,'R':17,'S':18,'T':19,'U':20,'V':21,'W':22,'X':23,'Y':24,'Z':25};
function cfExtract(s) {
  const clean = s.toUpperCase().replace(/[^A-Z]/g, '');
  return { cons: clean.split('').filter(c => !'AEIOU'.includes(c)), vow: clean.split('').filter(c => 'AEIOU'.includes(c)) };
}
function cfSurname(cognome) {
  const { cons, vow } = cfExtract(cognome);
  return [...cons, ...vow, 'X', 'X', 'X'].slice(0, 3).join('');
}
function cfName(nome) {
  const { cons, vow } = cfExtract(nome);
  if (cons.length >= 4) return [cons[0], cons[2], cons[3]].join('');
  return [...cons, ...vow, 'X', 'X', 'X'].slice(0, 3).join('');
}
function cfCheckChar(first15) {
  let sum = 0;
  for (let i = 0; i < 15; i++) { sum += (i % 2 === 0) ? (CF_ODD[first15[i]] || 0) : (CF_EVEN[first15[i]] || 0); }
  return 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'[sum % 26];
}
function validateCF(cf, nome, cognome, giorno, mese, anno, sesso) {
  if (!cf || cf.length !== 16) return "Il codice fiscale deve essere di 16 caratteri";
  const u = cf.toUpperCase();
  if (!/^[A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z]$/.test(u)) return "Formato codice fiscale non valido";
  if (u.slice(0, 3) !== cfSurname(cognome)) return "Il cognome non corrisponde al codice fiscale";
  if (u.slice(3, 6) !== cfName(nome)) return "Il nome non corrisponde al codice fiscale";
  if (u.slice(6, 8) !== String(anno).slice(-2)) return "L'anno di nascita non corrisponde al codice fiscale";
  if (u[8] !== CF_MONTHS[mese - 1]) return "Il mese di nascita non corrisponde al codice fiscale";
  const expectedDay = sesso === 'F' ? giorno + 40 : giorno;
  if (u.slice(9, 11) !== String(expectedDay).padStart(2, '0')) return "Il giorno o il sesso non corrisponde al codice fiscale";
  if (!/^[A-Z]\d{3}$/.test(u.slice(11, 15))) return "Codice comune non valido nel codice fiscale";
  if (u[15] !== cfCheckChar(u.slice(0, 15))) return "Il carattere di controllo del codice fiscale non è corretto";
  return null;
}

// Parse share link ID on page load (data loaded async in useEffect)
const __sharedId = new URLSearchParams(window.location.search).get("s");
if (__sharedId) window.history.replaceState({}, "", window.location.pathname);

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
  const [localVal, setLocalVal] = useState(String(value));
  const valRef = useRef(value);
  if (!focused && value !== valRef.current) { setLocalVal(String(value)); valRef.current = value; }
  return (
    <div style={{ marginBottom: 10 }}>
      <label style={{ color: C.textMid, fontSize: 11, fontWeight: 600, letterSpacing: 0.3, display: "block", marginBottom: 3, textTransform: "uppercase" }}>{label}</label>
      <div style={{ display: "flex", alignItems: "center", background: disabled ? "#f0f0f0" : C.inputBg, borderRadius: 4, border: `1px solid ${focused ? C.inputFocus : C.inputBorder}`, transition: "border-color 0.15s" }}>
        <input type="number" value={focused ? localVal : value} onChange={(e) => { if (disabled) return; setLocalVal(e.target.value); onChange(Number(e.target.value) || 0); }}
          onFocus={(e) => { setFocused(true); setLocalVal(String(value)); e.target.select(); }} onBlur={() => { setFocused(false); if (localVal === "" || isNaN(Number(localVal))) { setLocalVal(String(value)); } }} step={step} min={min} max={max} disabled={disabled}
          style={{ flex: 1, background: "transparent", border: "none", outline: "none", color: disabled ? C.textLight : C.dark, fontSize: 14, fontWeight: 600, padding: "7px 8px", fontFamily: "inherit", width: "100%", minWidth: 0 }} />
        {suffix && <span style={{ padding: "0 8px 0 0", color: C.textLight, fontSize: 12, fontWeight: 600, whiteSpace: "nowrap" }}>{suffix}</span>}
      </div>
      {note && <p style={{ color: C.textLight, fontSize: 10, margin: "2px 0 0" }}>{note}</p>}
    </div>
  );
}
function DashPctInput({ label, value, onChange, note, disabled }) {
  return <DashInput label={label} value={Math.round((value || 0) * 1000) / 10} onChange={(v) => onChange(v / 100)} suffix="%" step={0.5} min={-100} max={100} note={note} disabled={disabled} />;
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
  const [showPw, setShowPw] = useState(false);
  useEffect(() => { if (autoFocus && ref.current) ref.current.focus(); }, [autoFocus]);
  const isPassword = type === "password";
  return (
    <div style={{ marginBottom: 16 }}>
      <label style={{ display: "block", color: C.textMid, fontSize: 12, fontWeight: 600, marginBottom: 4, fontFamily: "-apple-system, sans-serif" }}>{label}</label>
      <div style={{ position: "relative" }}>
        <input ref={ref} type={isPassword && showPw ? "text" : type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
          style={{ width: "100%", boxSizing: "border-box", padding: isPassword ? "10px 42px 10px 14px" : "10px 14px", border: `1px solid ${C.borderDark}`, borderRadius: 6, fontSize: 15, color: C.dark, outline: "none", fontFamily: "-apple-system, sans-serif", background: C.card }} />
        {isPassword && (
          <button type="button" onClick={() => setShowPw(p => !p)} style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", padding: 4, color: C.textLight, lineHeight: 1, display: "flex", alignItems: "center" }} title={showPw ? "Nascondi password" : "Mostra password"}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              {showPw ? (<><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></>) : (<><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></>)}
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}

// ============================================================
// WIZARD STEPS
// ============================================================
const STEPS = [
  { id: "welcome", title: "Nuovo\nconto economico", subtitle: "Costruisci l'analisi della tua operazione immobiliare. Potrai condividerla con protezione NDA al termine.", isWelcome: true },
  { id: "indirizzo", title: "Indirizzo dell'immobile", subtitle: "Inserisci l'indirizzo per identificare questa operazione.", type: "address" },
  { id: "metratura", title: "Superficie totale", subtitle: "La metratura commerciale dell'immobile.", field: "metratura", type: "number", suffix: "mq", step: 5 },
  { id: "prezzo", title: "Prezzo di acquisto", subtitle: "Il prezzo richiesto o negoziato per l'immobile.", field: "prezzoAcquisto", type: "number", suffix: "€", step: 5000 },
  { id: "unita", title: "Numero di unità", subtitle: "In quante unità indipendenti vuoi dividere l'immobile.", field: "numUnita", type: "slider", min: 2, max: 6, labels: ["2", "3", "4", "5", "6"] },
  { id: "vendita", title: "Prezzo di vendita al mq", subtitle: "Prezzo medio al metro quadro delle unità piccole nella zona.", field: "prezzoVenditaMq", type: "number", suffix: "€/mq", step: 100 },
  { id: "rist", title: "Costo ristrutturazione", subtitle: "Costo al mq comprensivo di ristrutturazione e impiantistica.", field: "costoRistMq", type: "number", suffix: "€/mq", step: 50 },
  { id: "durata", title: "Durata dell'operazione", subtitle: "Tempistica prevista dalla firma all'ultima vendita.", field: "durataOp", type: "slider", min: 3, max: 24, labels: ["3 mesi", "12", "24 mesi"], unit: "mesi" },
];

// ============================================================
// ADMIN DASHBOARD
// ============================================================
const EVENT_LABELS = {
  login: "Accesso", logout: "Uscita", register: "Registrazione",
  project_create: "Nuovo progetto", project_open: "Apertura", project_save: "Salvataggio",
  project_delete: "Eliminazione", project_share: "Condivisione", link_share: "Link condiviso",
  snapshot_view: "Visualizzazione", wizard_step_change: "Step wizard", excel_export: "Export Excel",
  scenario_toggle: "Analisi scenari",
};
const EVENT_COLORS = {
  login: C.green, logout: C.textLight, register: C.accent,
  project_create: C.navy, project_open: "#3B82F6", project_save: "#6B7B94",
  project_delete: C.red, project_share: C.accent, link_share: "#8B5CF6",
  snapshot_view: "#0EA5E9", wizard_step_change: "#6B7B94", excel_export: C.green,
  scenario_toggle: "#D97706",
};

function AdminDashboard({ user, onClose }) {
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("overview");
  const [stats, setStats] = useState(null);
  const [userList, setUserList] = useState([]);
  const [recentEvents, setRecentEvents] = useState([]);
  const [funnelData, setFunnelData] = useState(null);
  const [dailyActive, setDailyActive] = useState([]);
  const [visitors, setVisitors] = useState([]);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const [statsRes, usersRes, eventsRes, funnelRes, dauRes, visitorsRes] = await Promise.all([
          supabase.rpc("admin_get_stats", { admin_email: ADMIN_EMAIL }),
          supabase.rpc("admin_get_users", { admin_email: ADMIN_EMAIL }),
          supabase.rpc("admin_get_recent_events", { admin_email: ADMIN_EMAIL }),
          supabase.rpc("admin_get_funnel", { admin_email: ADMIN_EMAIL }),
          supabase.rpc("admin_get_dau", { admin_email: ADMIN_EMAIL }),
          supabase.from("snapshot_visitors").select("*").order("visited_at", { ascending: false }).limit(100),
        ]);
        if (statsRes.data) setStats(statsRes.data);
        if (usersRes.data) setUserList(usersRes.data);
        if (eventsRes.data) setRecentEvents(eventsRes.data);
        if (funnelRes.data) setFunnelData(funnelRes.data);
        if (dauRes.data) setDailyActive(dauRes.data);
        if (visitorsRes.data) setVisitors(visitorsRes.data);
      } catch (e) { console.error("Admin load error:", e); }
      setLoading(false);
    }
    load();
  }, []);

  const tabs = [
    { id: "overview", label: "Panoramica" },
    { id: "users", label: "Utenti" },
    { id: "activity", label: "Attività" },
    { id: "analytics", label: "Comportamento" },
  ];

  const cardStyle = { background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: "18px 20px", boxShadow: "0 1px 4px rgba(0,0,0,0.04)" };
  const kpiVal = { color: C.dark, fontSize: 28, fontWeight: 700, margin: "4px 0 2px" };
  const kpiLabel = { color: C.textMid, fontSize: 12, fontWeight: 600, fontFamily: "-apple-system, sans-serif", textTransform: "uppercase", letterSpacing: 0.5 };

  const renderOverview = () => {
    if (!stats) return null;
    const s = typeof stats === "string" ? JSON.parse(stats) : (Array.isArray(stats) ? stats[0] : stats);
    const kpis = [
      { label: "Utenti totali", value: s.total_users || 0, color: C.navy },
      { label: "Nuovi (7gg)", value: s.new_users_7d || 0, color: C.green },
      { label: "Nuovi (30gg)", value: s.new_users_30d || 0, color: C.accent },
      { label: "Progetti totali", value: s.total_projects || 0, color: C.navy },
      { label: "Condivisioni", value: s.total_shares || 0, color: "#8B5CF6" },
    ];
    const funnel = funnelData ? (typeof funnelData === "string" ? JSON.parse(funnelData) : (Array.isArray(funnelData) ? funnelData[0] : funnelData)) : null;
    const funnelSteps = funnel ? [
      { label: "Registrazioni", value: funnel.registrations || 0 },
      { label: "Hanno creato progetto", value: funnel.created_project || 0 },
      { label: "Hanno condiviso", value: funnel.shared_project || 0 },
      { label: "Hanno esportato", value: funnel.exported || 0 },
    ] : [];
    const maxFunnel = funnelSteps.length > 0 ? Math.max(...funnelSteps.map(f => f.value), 1) : 1;

    return (
      <div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, marginBottom: 24 }}>
          {kpis.map((k, i) => (
            <div key={i} style={{ ...cardStyle, borderLeft: `4px solid ${k.color}` }}>
              <div style={kpiLabel}>{k.label}</div>
              <div style={kpiVal}>{k.value}</div>
            </div>
          ))}
        </div>
        {funnelSteps.length > 0 && (
          <div style={cardStyle}>
            <div style={{ color: C.dark, fontSize: 16, fontWeight: 700, marginBottom: 16 }}>Funnel di conversione</div>
            {funnelSteps.map((f, i) => (
              <div key={i} style={{ marginBottom: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                  <span style={{ color: C.textMid, fontSize: 13, fontFamily: "-apple-system, sans-serif" }}>{f.label}</span>
                  <span style={{ color: C.dark, fontSize: 13, fontWeight: 700, fontFamily: "-apple-system, sans-serif" }}>{f.value}</span>
                </div>
                <div style={{ height: 8, background: C.border, borderRadius: 4, overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${(f.value / maxFunnel) * 100}%`, background: C.accent, borderRadius: 4, transition: "width 0.5s ease" }} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  const renderUsers = () => {
    const users = Array.isArray(userList) ? userList : [];
    return (
      <div style={cardStyle}>
        <div style={{ color: C.dark, fontSize: 16, fontWeight: 700, marginBottom: 16 }}>Utenti registrati ({users.length})</div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, fontFamily: "-apple-system, sans-serif" }}>
            <thead>
              <tr style={{ borderBottom: `2px solid ${C.border}` }}>
                {["Nome", "Email", "Registrazione", "Ultima attività", "Progetti", "Condivisioni"].map((h) => (
                  <th key={h} style={{ textAlign: "left", padding: "8px 12px", color: C.textMid, fontWeight: 700, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {users.map((u, i) => (
                <tr key={i} style={{ borderBottom: `1px solid ${C.border}` }}>
                  <td style={{ padding: "10px 12px", color: C.dark, fontWeight: 600 }}>{u.name || "-"}</td>
                  <td style={{ padding: "10px 12px", color: C.textMid }}>{u.email || "-"}</td>
                  <td style={{ padding: "10px 12px", color: C.textMid }}>{u.created_at ? new Date(u.created_at).toLocaleDateString("it-IT", { day: "2-digit", month: "short", year: "numeric" }) : "-"}</td>
                  <td style={{ padding: "10px 12px", color: C.textMid }}>{u.last_active ? new Date(u.last_active).toLocaleDateString("it-IT", { day: "2-digit", month: "short", year: "numeric" }) : "-"}</td>
                  <td style={{ padding: "10px 12px", color: C.dark, fontWeight: 700, textAlign: "center" }}>{u.project_count ?? 0}</td>
                  <td style={{ padding: "10px 12px", color: C.dark, fontWeight: 700, textAlign: "center" }}>{u.share_count ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  const renderActivity = () => {
    const events = Array.isArray(recentEvents) ? recentEvents : [];
    return (
      <div style={cardStyle}>
        <div style={{ color: C.dark, fontSize: 16, fontWeight: 700, marginBottom: 16 }}>Ultimi 50 eventi</div>
        <div style={{ display: "grid", gap: 6 }}>
          {events.slice(0, 50).map((ev, i) => {
            const label = EVENT_LABELS[ev.event_type] || ev.event_type;
            const color = EVENT_COLORS[ev.event_type] || C.textMid;
            return (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", background: i % 2 === 0 ? C.bg : C.card, borderRadius: 4, fontSize: 13, fontFamily: "-apple-system, sans-serif" }}>
                <span style={{ background: color, color: "#FFF", padding: "2px 8px", borderRadius: 10, fontSize: 11, fontWeight: 700, whiteSpace: "nowrap", minWidth: 80, textAlign: "center" }}>{label}</span>
                <span style={{ color: C.textMid, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {ev.user_email || "Anonimo"} {ev.metadata && Object.keys(ev.metadata).length > 0 ? "— " + JSON.stringify(ev.metadata) : ""}
                </span>
                <span style={{ color: C.textLight, fontSize: 11, whiteSpace: "nowrap" }}>
                  {ev.created_at ? new Date(ev.created_at).toLocaleDateString("it-IT", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : ""}
                </span>
              </div>
            );
          })}
          {events.length === 0 && <div style={{ color: C.textLight, padding: 20, textAlign: "center" }}>Nessun evento registrato</div>}
        </div>
      </div>
    );
  };

  const renderAnalytics = () => {
    // Wizard funnel from events
    const wizardEvents = Array.isArray(recentEvents) ? recentEvents.filter(e => e.event_type === "wizard_step_change") : [];
    const stepCounts = {};
    wizardEvents.forEach(e => {
      const s = e.metadata?.from_step;
      if (s !== undefined) stepCounts[s] = (stepCounts[s] || 0) + 1;
    });
    const stepKeys = Object.keys(stepCounts).sort((a, b) => Number(a) - Number(b));
    const maxStepCount = stepKeys.length > 0 ? Math.max(...stepKeys.map(k => stepCounts[k]), 1) : 1;

    // DAU chart
    const dau = Array.isArray(dailyActive) ? dailyActive : [];
    const maxDau = dau.length > 0 ? Math.max(...dau.map(d => d.active_users || 0), 1) : 1;

    // Feature usage
    const allEvents = Array.isArray(recentEvents) ? recentEvents : [];
    const featureCounts = {};
    allEvents.forEach(e => {
      const label = EVENT_LABELS[e.event_type] || e.event_type;
      featureCounts[label] = (featureCounts[label] || 0) + 1;
    });
    const featureKeys = Object.keys(featureCounts).sort((a, b) => featureCounts[b] - featureCounts[a]);
    const maxFeature = featureKeys.length > 0 ? Math.max(...featureKeys.map(k => featureCounts[k]), 1) : 1;

    return (
      <div style={{ display: "grid", gap: 16 }}>
        {/* Wizard Funnel */}
        <div style={cardStyle}>
          <div style={{ color: C.dark, fontSize: 16, fontWeight: 700, marginBottom: 16 }}>Funnel wizard (per step)</div>
          {stepKeys.length > 0 ? (
            <div style={{ display: "flex", alignItems: "flex-end", gap: 8, height: 180, padding: "0 8px" }}>
              {stepKeys.map((k) => (
                <div key={k} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", height: "100%" }}>
                  <div style={{ color: C.dark, fontSize: 12, fontWeight: 700, marginBottom: 4, fontFamily: "-apple-system, sans-serif" }}>{stepCounts[k]}</div>
                  <div style={{ width: "100%", maxWidth: 40, height: `${(stepCounts[k] / maxStepCount) * 140}px`, background: C.navy, borderRadius: "4px 4px 0 0", minHeight: 4 }} />
                  <div style={{ color: C.textMid, fontSize: 10, marginTop: 4, fontFamily: "-apple-system, sans-serif" }}>Step {k}</div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ color: C.textLight, textAlign: "center", padding: 20 }}>Nessun dato wizard disponibile</div>
          )}
        </div>

        {/* DAU Chart */}
        <div style={cardStyle}>
          <div style={{ color: C.dark, fontSize: 16, fontWeight: 700, marginBottom: 16 }}>Utenti attivi giornalieri (ultimi 30 giorni)</div>
          {dau.length > 0 ? (
            <div style={{ display: "grid", gap: 4 }}>
              {dau.slice(-30).map((d, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, fontFamily: "-apple-system, sans-serif" }}>
                  <span style={{ color: C.textMid, minWidth: 70, textAlign: "right" }}>{d.day ? new Date(d.day).toLocaleDateString("it-IT", { day: "2-digit", month: "short" }) : ""}</span>
                  <div style={{ flex: 1, height: 14, background: C.border, borderRadius: 3, overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${((d.active_users || 0) / maxDau) * 100}%`, background: C.accent, borderRadius: 3, minWidth: d.active_users > 0 ? 4 : 0 }} />
                  </div>
                  <span style={{ color: C.dark, fontWeight: 700, minWidth: 24 }}>{d.active_users || 0}</span>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ color: C.textLight, textAlign: "center", padding: 20 }}>Nessun dato DAU disponibile</div>
          )}
        </div>

        {/* Feature Usage */}
        <div style={cardStyle}>
          <div style={{ color: C.dark, fontSize: 16, fontWeight: 700, marginBottom: 16 }}>Utilizzo funzionalità</div>
          {featureKeys.length > 0 ? (
            <div style={{ display: "grid", gap: 8 }}>
              {featureKeys.map((k) => (
                <div key={k} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13, fontFamily: "-apple-system, sans-serif" }}>
                  <span style={{ color: C.textMid, minWidth: 130, textAlign: "right" }}>{k}</span>
                  <div style={{ flex: 1, height: 16, background: C.border, borderRadius: 4, overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${(featureCounts[k] / maxFeature) * 100}%`, background: C.green, borderRadius: 4, minWidth: 4 }} />
                  </div>
                  <span style={{ color: C.dark, fontWeight: 700, minWidth: 30 }}>{featureCounts[k]}</span>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ color: C.textLight, textAlign: "center", padding: 20 }}>Nessun dato disponibile</div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div style={{ background: C.bg, minHeight: "100vh", fontFamily: "'Georgia', serif" }}>
      <div style={{ background: C.navy }}>
        <div style={{ maxWidth: 1100, margin: "0 auto", padding: "12px 16px", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
          <div>
            <div style={{ color: C.accent, fontWeight: 700, fontSize: 10, letterSpacing: 2.5, textTransform: "uppercase", fontFamily: "-apple-system, sans-serif" }}>Admin Dashboard</div>
            <div style={{ color: "#FFF", fontWeight: 700, fontSize: 16 }}>Pannello di controllo</div>
          </div>
          <button onClick={onClose} style={{ background: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.7)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 4, padding: "7px 14px", fontWeight: 600, fontSize: 12, cursor: "pointer", fontFamily: "-apple-system, sans-serif" }}>Chiudi</button>
        </div>
        <div style={{ maxWidth: 1100, margin: "0 auto", padding: "0 16px", display: "flex", gap: 0 }}>
          {tabs.map((t) => (
            <button key={t.id} onClick={() => setActiveTab(t.id)} style={{
              background: activeTab === t.id ? C.accent : "transparent", color: activeTab === t.id ? "#FFF" : "rgba(255,255,255,0.6)",
              border: "none", borderRadius: "6px 6px 0 0", padding: "8px 18px", fontWeight: 700, fontSize: 12, cursor: "pointer", fontFamily: "-apple-system, sans-serif",
            }}>{t.label}</button>
          ))}
        </div>
        <div style={{ height: 3, background: C.accent }} />
      </div>
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "24px 16px" }}>
        {loading ? (
          <div style={{ textAlign: "center", padding: "60px 20px", color: C.textMid, fontSize: 15, fontFamily: "-apple-system, sans-serif" }}>Caricamento dati...</div>
        ) : (
          <>
            {activeTab === "overview" && renderOverview()}
            {activeTab === "users" && renderUsers()}
            {activeTab === "activity" && renderActivity()}
            {activeTab === "analytics" && renderAnalytics()}
          </>
        )}
      </div>
    </div>
  );
}

// ============================================================
// MAIN APP
// ============================================================
export default function App() {
  // AUTH STATE
  const [user, setUser] = useState(() => DB.getUser());
  const [projectsList, setProjectsList] = useState([]);
  const [sharesForModal, setSharesForModal] = useState([]);
  const [authScreen, setAuthScreen] = useState(null); // null | "login" | "register" | "projects" | "forgot" | "reset-password"
  const authScreenRef = useRef(null);
  const setAuthScreenTracked = (v) => { authScreenRef.current = v; setAuthScreen(v); };
  const [authForm, setAuthForm] = useState(() => {
    try { const saved = JSON.parse(localStorage.getItem("frazio_remember") || "null"); if (saved && saved.exp > Date.now() && saved.email) return { name: "", email: saved.email, password: "" }; } catch {}
    return { name: "", email: "", password: "" };
  });
  const [authLoading, setAuthLoading] = useState(false);

  // Gestisci il callback OAuth e cambi di sessione
  useEffect(() => {
    // 0. Controlla se l'URL contiene type=recovery (link reset password da email)
    const hashParams = new URLSearchParams(window.location.hash.substring(1));
    const isRecovery = hashParams.get("type") === "recovery";
    if (isRecovery) {
      authScreenRef.current = "reset-password";
    }
    // 1. Controlla se c'è già una sessione attiva (anche dal redirect OAuth)
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        const u = {
          id: session.user.id,
          name: session.user.user_metadata?.name || session.user.user_metadata?.full_name || session.user.email?.split("@")[0] || "Utente",
          email: session.user.email,
        };
        DB._user = u;
        DB.ensureProfile(u);
        setUser(u);
        setShowLanding(false);
        // Se è un recovery, NON mandare a projects — mostra il form nuova password
        if (authScreenRef.current === "reset-password") {
          setAuthScreen("reset-password");
        } else {
          setAuthScreen("projects");
        }
        setAuthLoading(false);
      }
    });
    // 2. Ascolta cambi futuri di sessione
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === "PASSWORD_RECOVERY") {
        // Utente ha cliccato il link di reset password — mostra il form nuova password
        if (session?.user) {
          const u = {
            id: session.user.id,
            name: session.user.user_metadata?.name || session.user.user_metadata?.full_name || session.user.email?.split("@")[0] || "Utente",
            email: session.user.email,
          };
          DB._user = u;
          setUser(u);
        }
        setShowLanding(false);
        authScreenRef.current = "reset-password";
        setAuthScreen("reset-password");
        setAuthLoading(false);
        return;
      }
      if ((event === "SIGNED_IN" || event === "TOKEN_REFRESHED" || event === "INITIAL_SESSION") && session?.user) {
        const u = {
          id: session.user.id,
          name: session.user.user_metadata?.name || session.user.user_metadata?.full_name || session.user.email?.split("@")[0] || "Utente",
          email: session.user.email,
        };
        DB._user = u;
        DB.ensureProfile(u);
        setUser(u);
        setShowLanding(false);
        if (authScreenRef.current !== "reset-password") setAuthScreen("projects");
        setAuthLoading(false);
        if (event === "SIGNED_IN") DB.trackEvent("login", { method: "google" });
      } else if (event === "SIGNED_OUT") {
        DB._user = null;
        setUser(null);
      }
    });
    return () => subscription.unsubscribe();
  }, []);
  // Capacitor: status bar + deep link handler per OAuth callback
  useEffect(() => {
    if (!isNative) return;
    StatusBar.setStyle({ style: Style.Dark }).catch(() => {});
    const listener = CapApp.addListener("appUrlOpen", async (event) => {
      if (event.url.includes("auth/callback")) {
        await Browser.close().catch(() => {});
        const fakeUrl = new URL(event.url.replace("com.lorenzoloseto.frazio://", "https://placeholder/"));
        const params = new URLSearchParams(fakeUrl.hash.substring(1));
        const accessToken = params.get("access_token");
        const refreshToken = params.get("refresh_token");
        if (accessToken && refreshToken) {
          await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
        }
      }
    });
    return () => { listener.then(l => l.remove()); };
  }, []);
  // Carica dati condivisi da Supabase se c'è un __sharedId
  useEffect(() => {
    if (!__sharedId) return;
    loadProjectSnapshot(__sharedId).then((proj) => {
      if (proj) {
        setProjectName(proj.name);
        setData(proj.data);
        setScenari(proj.scenari);
        setComparabili(proj.comparabili);
        setRistItems(proj.ristItems);
        setShowDash(true);
        setViewOnly(true);
      }
      setSharedLoading(false);
    });
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
  const [viewOnly, setViewOnly] = useState(false);
  const [data, setData] = useState({ ...DEFAULT_DATA });
  const [scenari, setScenari] = useState({ ...DEFAULT_SCENARI });
  const [comparabili, setComparabili] = useState([{ indirizzo: "", mq: 0, prezzo: 0, prezzoMq: 0, note: "" }]);
  const [ristItems, setRistItems] = useState([...RIST_INIT]);
  const [shareLinkUrl, setShareLinkUrl] = useState("");
  const [linkCopied, setLinkCopied] = useState(false);
  const [shareLinkLoading, setShareLinkLoading] = useState(false);
  const [sharedLoading, setSharedLoading] = useState(!!__sharedId);
  const [shareGateCompleted, setShareGateCompleted] = useState(false);
  const [gateForm, setGateForm] = useState({ nome: '', cognome: '', email: '', giorno: '', mese: '', anno: '', sesso: '', luogoNascita: '', cf: '' });
  const [gateError, setGateError] = useState('');
  const [gateNda, setGateNda] = useState(false);
  const [gatePrivacy, setGatePrivacy] = useState(false);
  const [gateCfConsent, setGateCfConsent] = useState(false);
  const [rememberMe, setRememberMe] = useState(() => {
    try { const saved = JSON.parse(localStorage.getItem("frazio_remember") || "null"); return saved && saved.exp > Date.now(); } catch { return false; }
  });
  const [regPrivacy, setRegPrivacy] = useState(false);
  const [showPrivacy, setShowPrivacy] = useState(false);
  const [showTos, setShowTos] = useState(false);
  const [regTos, setRegTos] = useState(false);
  const [cookieBannerDismissed, setCookieBannerDismissed] = useState(() => localStorage.getItem("cookie_consent") === "1");
  const [showDeleteAccount, setShowDeleteAccount] = useState(false);
  const [deleteAccountLoading, setDeleteAccountLoading] = useState(false);
  const [projectVisitors, setProjectVisitors] = useState({});
  const [expandedVisitors, setExpandedVisitors] = useState({});
  // LANDING STATE
  const [showLanding, setShowLanding] = useState(() => !DB.getUser() && !__sharedId);
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768);
  const [hoveredFeature, setHoveredFeature] = useState(null);
  const [dashMockupHover, setDashMockupHover] = useState(false);

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
    const timeOnStep = window._stepEnteredAt ? Math.round((Date.now() - window._stepEnteredAt) / 1000) : null;
    DB.trackEvent("wizard_step_change", { from_step: step, to_step: step < STEPS.length - 1 ? step + 1 : "dashboard", direction: "next", seconds_on_step: timeOnStep });
    if (step < STEPS.length - 1) animTo(() => { setStep((s) => s + 1); window._stepEnteredAt = Date.now(); });
    else animTo(() => {
      setShowDash(true);
      window._stepEnteredAt = Date.now();
      // Auto-crea progetto al primo accesso alla dashboard se loggato
      if (user && !editingProjectId) {
        setTimeout(async () => {
          const res = await handleSaveProject();
          if (res.ok) setEditingProjectId(res.project.id);
        }, 300);
      }
    });
  };
  const goBack = () => { if (step > 0) { const timeOnStep = window._stepEnteredAt ? Math.round((Date.now() - window._stepEnteredAt) / 1000) : null; DB.trackEvent("wizard_step_change", { from_step: step, to_step: step - 1, direction: "back", seconds_on_step: timeOnStep }); animTo(() => { setStep((s) => s - 1); window._stepEnteredAt = Date.now(); }); } };

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
      await handleSaveProject(true);
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
    if (res.ok) {
      if (rememberMe) {
        localStorage.setItem("frazio_remember", JSON.stringify({ email: authForm.email, exp: Date.now() + 30 * 24 * 60 * 60 * 1000 }));
      } else {
        localStorage.removeItem("frazio_remember");
      }
      setUser(res.user); setAuthScreen(null); setAuthForm({ name: "", email: "", password: "" }); DB.trackEvent("login", { method: "email" });
    }
    else setAuthError(res.error);
  };
  const handleRegister = async () => {
    setAuthError("");
    if (!authForm.name.trim()) { setAuthError("Inserisci il tuo nome"); return; }
    if (!authForm.email.trim()) { setAuthError("Inserisci la tua email"); return; }
    if (authForm.password.length < 8) { setAuthError("La password deve essere di almeno 8 caratteri"); return; }
    if (!regPrivacy) { setAuthError("Devi accettare l'informativa privacy per proseguire"); return; }
    if (!regTos) { setAuthError("Devi accettare i Termini di Servizio per proseguire"); return; }
    const res = await DB.register(authForm.name, authForm.email, authForm.password);
    if (res.ok && res.user) {
      supabase.from("profiles").update({ privacy_consent_at: new Date().toISOString() }).eq("id", res.user.id).then(() => {});
      setUser(res.user); setAuthScreen(null); setAuthForm({ name: "", email: "", password: "" }); setRegPrivacy(false); setRegTos(false);
      DB.trackEvent("register", { method: "email" });
    }
    else if (res.ok && res.confirmEmail) { setAuthError("Controlla la tua email per confermare la registrazione, poi accedi."); }
    else setAuthError(res.error);
  };
  const handleForgotPassword = async () => {
    setAuthError("");
    if (!authForm.email.trim()) { setAuthError("Inserisci la tua email per ricevere il link di reset"); return; }
    const res = await DB.resetPasswordForEmail(authForm.email);
    if (res.ok) { setAuthError("✅ Email inviata! Controlla la tua casella (anche spam) e clicca il link per reimpostare la password."); }
    else setAuthError(res.error);
  };
  const handleUpdatePassword = async () => {
    setAuthError("");
    if (!newPassword.trim() || newPassword.length < 8) { setAuthError("La nuova password deve essere di almeno 8 caratteri"); return; }
    if (newPassword !== confirmPassword) { setAuthError("Le password non coincidono"); return; }
    const res = await DB.updatePassword(newPassword);
    if (res.ok) {
      setNewPassword(""); setConfirmPassword("");
      authScreenRef.current = "projects";
      setAuthScreen("projects");
      DB.trackEvent("password_reset");
    } else setAuthError(res.error);
  };
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const handleLogout = async () => { DB.trackEvent("logout"); await DB.logout(); setUser(null); setAuthScreen(null); };
  const handleLandingCTA = (goToAuth = false) => { setShowLanding(false); if (goToAuth) setAuthScreen("login"); };
  // Landing: responsive
  useEffect(() => { const h = () => setIsMobile(window.innerWidth < 768); window.addEventListener("resize", h); return () => window.removeEventListener("resize", h); }, []);
  const handleDeleteAccount = async () => {
    if (!user) return;
    setDeleteAccountLoading(true);
    try {
      // 1. Cancella condivisioni dei progetti dell'utente
      const projects = await DB.getProjects();
      const ownProjects = projects.filter(p => !p._shared);
      for (const p of ownProjects) {
        // Cancella condivisioni
        await supabase.from("project_shares").delete().eq("project_id", p.id);
        // Cancella snapshot e visitatori
        const { data: snapshots } = await supabase.from("shared_snapshots").select("id").eq("project_id", p.id);
        if (snapshots) {
          for (const s of snapshots) {
            await supabase.from("snapshot_visitors").delete().eq("snapshot_id", s.id);
          }
          await supabase.from("shared_snapshots").delete().eq("project_id", p.id);
        }
        // Cancella progetto
        await supabase.from("projects").delete().eq("id", p.id);
      }
      // 2. Cancella condivisioni ricevute
      await supabase.from("project_shares").delete().eq("shared_with_email", user.email);
      // 3. Cancella profilo
      await supabase.from("profiles").delete().eq("id", user.id);
      // 4. Logout
      await DB.logout();
      setUser(null);
      setAuthScreen(null);
      setShowDeleteAccount(false);
      setDeleteAccountLoading(false);
      alert("Il tuo account e tutti i dati associati sono stati cancellati con successo.");
    } catch (err) {
      console.error("Errore cancellazione account:", err);
      setDeleteAccountLoading(false);
      alert("Si è verificato un errore durante la cancellazione. Riprova o contatta lorenzoloseto@hotmail.it");
    }
  };
  const handleSaveProject = async (isAutoSave = false) => {
    const indirizzo = [data.via, data.civico].filter(Boolean).join(" ");
    const nome = projectName || [indirizzo, data.citta].filter(Boolean).join(", ") || "Nuova operazione";
    const isCreate = !editingProjectId;
    const res = await DB.saveProject({
      id: editingProjectId,
      name: nome,
      data: { ...data },
      scenari: { ...scenari },
      comparabili: [...comparabili],
      ristItems: [...ristItems],
    });
    if (res.ok) {
      setEditingProjectId(res.project.id); setProjectName(nome);
      if (!isAutoSave) DB.trackEvent(isCreate ? "project_create" : "project_save", { project_id: res.project.id, project_name: nome });
    }
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
    DB.trackEvent("project_open", { project_id: project.id, project_name: project.name });
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
    if (res.ok) { setShareEmail(""); setShareError(""); const sh = await DB.getShares(shareModal); setSharesForModal(sh); DB.trackEvent("project_share", { project_id: shareModal, shared_with_email: shareEmail }); }
    else setShareError(res.error);
  };
  const handleGateSubmit = () => {
    setGateError('');
    const { nome, cognome, email, giorno, mese, anno, sesso, luogoNascita, cf } = gateForm;
    if (!nome.trim()) { setGateError("Inserisci il nome"); return; }
    if (!cognome.trim()) { setGateError("Inserisci il cognome"); return; }
    if (!email.trim() || !email.includes('@')) { setGateError("Inserisci un'email valida"); return; }
    if (!giorno || !mese || !anno) { setGateError("Inserisci la data di nascita completa"); return; }
    const g = Number(giorno), m = Number(mese), a = Number(anno);
    if (g < 1 || g > 31) { setGateError("Giorno di nascita non valido"); return; }
    if (m < 1 || m > 12) { setGateError("Mese di nascita non valido"); return; }
    if (a < 1920 || a > 2010) { setGateError("Anno di nascita non valido"); return; }
    if (!sesso) { setGateError("Seleziona il sesso"); return; }
    if (!luogoNascita.trim()) { setGateError("Inserisci il luogo di nascita"); return; }
    if (!cf.trim()) { setGateError("Inserisci il codice fiscale"); return; }
    const cfErr = validateCF(cf, nome, cognome, g, m, a, sesso);
    if (cfErr) { setGateError(cfErr); return; }
    if (!gatePrivacy) { setGateError("Devi accettare l'informativa privacy per il trattamento dei dati"); return; }
    if (!gateCfConsent) { setGateError("Devi acconsentire al trattamento del codice fiscale per proseguire"); return; }
    if (!gateNda) { setGateError("Devi accettare l'impegno di non divulgazione per proseguire"); return; }
    // Salva dati visitatore su Supabase (con consensi GDPR)
    supabase.from("snapshot_visitors").insert({
      snapshot_id: __sharedId,
      nome: nome.trim(), cognome: cognome.trim(), email: email.trim(),
      cf: cf.toUpperCase(), data_nascita: `${giorno}/${mese}/${anno}`,
      sesso, luogo_nascita: luogoNascita.trim(),
      privacy_consent: true, nda_accepted: true, cf_consent: true
    }).then(() => {});
    setShareGateCompleted(true);
    DB.trackEvent("snapshot_view", { visitor_email: gateForm.email?.trim() || "" });
  };
  // Load projects and their visitors when opening projects screen
  useEffect(() => {
    if (authScreen === "projects" && user) {
      DB.getProjects().then(async (projects) => {
        setProjectsList(projects);
        // Carica visitatori per ogni progetto
        const ownProjects = projects.filter(p => !p._shared);
        if (ownProjects.length === 0) return;
        const ids = ownProjects.map(p => p.id);
        const { data: visitors } = await supabase
          .from("snapshot_visitors")
          .select("*, shared_snapshots!inner(project_id)")
          .in("shared_snapshots.project_id", ids)
          .order("visited_at", { ascending: false });
        if (visitors) {
          const byProject = {};
          visitors.forEach(v => {
            const pid = v.shared_snapshots?.project_id;
            if (pid) { if (!byProject[pid]) byProject[pid] = []; byProject[pid].push(v); }
          });
          setProjectVisitors(byProject);
        }
      });
    }
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
    const provvigioniIn = d.prezzoAcquisto * (d.provvigioniInPct || 0);
    const altriCosti = d.allacciamentiUtenze + d.bolletteGasLuce + d.consulenzeTecniche + d.rendering + (d.imu || 0) + (d.notaio || 0) + provvigioniIn + speseBancarie + interessi;
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
    return { costoRistTot, buffer, tasseAcquisto, provvigioniIn, speseBancarie, interessi, altriCosti, costiFraz, inv, mqU, pMqAcq, ricU, ricTot, prov, ricNet, margine, roi, roiAnn, incMq, pess: sc(scenari.varPrezzoDown, scenari.varCostiUp, scenari.mesiExtra), real: sc(0, 0, 0), ott: sc(scenari.varPrezzoUp, scenari.varCostiDown, -scenari.mesiMeno) };
  }, [data, scenari]);
  const verdict = calc.pess.margine > 0;

  // ============================================================
  // EXPORT EXCEL (same as v1)
  // ============================================================
  const exportExcel = useCallback(() => {
    DB.trackEvent("excel_export", { project_id: editingProjectId });
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
    sh1 += row(cell("ANALISI OPERAZIONE IMMOBILIARE", { bold: true, bg: "#0D2240", color: "#FFFFFF" }));
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
    a.href = url; a.download = `FRAZIO_${nome}.xls`; a.click();
    URL.revokeObjectURL(url);
  }, [data, calc, ristItems, ristTotale]);

  // ============================================================
  // AUTH SCREENS
  // ============================================================
  const btnPrimary = { background: C.navy, color: "#FFF", border: "none", borderRadius: 6, padding: "11px 24px", fontWeight: 700, fontSize: 15, cursor: "pointer", fontFamily: "-apple-system, sans-serif", width: "100%" };
  const btnSecondary = { background: "transparent", color: C.accent, border: `1px solid ${C.accent}`, borderRadius: 6, padding: "10px 24px", fontWeight: 600, fontSize: 14, cursor: "pointer", fontFamily: "-apple-system, sans-serif", width: "100%" };

  // ============================================================
  // LANDING PAGE
  // ============================================================
  const LP_FEATURES = [
    { Icon: LpIconShield, title: "NDA e Identificazione Integrati", desc: "Ogni destinatario deve identificarsi con codice fiscale verificato e firmare un impegno di non divulgazione prima di accedere." },
    { Icon: LpIconLock, title: "Tracciamento Completo degli Accessi", desc: "Ogni accesso è registrato con identità verificata, data, ora e IP. Sai sempre chi ha visto i tuoi numeri." },
    { Icon: LpIconLightning, title: "Conto Economico in 30 Secondi", desc: "Inserisci i dati dell'operazione e ottieni margine, ROI e scenari. Il wizard ti guida passo per passo." },
    { Icon: LpIconChart, title: "3 Scenari a Confronto", desc: "Pessimistico, realistico e ottimistico. Valuta la sostenibilità dell'operazione in ogni condizione di mercato." },
    { Icon: LpIconCloud, title: "Multi-Progetto Cloud", desc: "Gestisci tutte le tue operazioni in un unico spazio sicuro. Autosalvataggio e accesso da qualsiasi dispositivo." },
    { Icon: LpIconDownload, title: "Export Professionale", desc: "Scarica il conto economico completo in formato Excel, pronto per finanziatori e istituti di credito." },
  ];
  const LP_STEPS = [
    { num: "01", title: "Costruisci l'analisi", desc: "Inserisci i dati dell'operazione: indirizzo, metratura, prezzi, costi. Il wizard guidato ti accompagna in ogni passaggio." },
    { num: "02", title: "Visualizza i risultati", desc: "Dashboard professionale con margine netto, ROI, scenari e verdetto automatico. Tutto in tempo reale." },
    { num: "03", title: "Condividi con NDA", desc: "Genera un link protetto. Chi lo riceve deve identificarsi con codice fiscale e firmare la riservatezza prima di accedere." },
  ];
  const LP_TRUST = [
    { Icon: LpIconShield, title: "GDPR Compliant", desc: "Trattamento conforme al Regolamento UE 2016/679. Doppio consenso esplicito: uno per il trattamento dati, uno specifico per il codice fiscale ai sensi dell'Art. 9." },
    { Icon: LpIconLock, title: "NDA con Valore Legale", desc: "Ogni destinatario firma digitalmente un impegno di non divulgazione. Identificazione univoca tramite codice fiscale verificato algoritmicamente." },
    { Icon: LpIconServer, title: "Infrastruttura Cloud UE", desc: "Dati custoditi su server nell'Unione Europea. Ogni accesso è registrato con timestamp, identità verificata e indirizzo IP." },
  ];

  // Landing scroll-reveal hooks
  const [statsRef, statsVisible] = useScrollReveal();
  const [featRef, featVisible] = useScrollReveal();
  const [howRef, howVisible] = useScrollReveal();
  const [dashRef, dashVisible] = useScrollReveal();
  const [trustRef, trustVisible] = useScrollReveal();
  const [ctaRef, ctaVisible] = useScrollReveal();
  const stat1 = useAnimatedCounter(3, 1200, statsVisible);
  const stat2 = useAnimatedCounter(16, 1800, statsVisible);
  const stat3 = useAnimatedCounter(100, 2000, statsVisible);

  if (showLanding && !__sharedId) {
    const sectionPad = { maxWidth: 1200, margin: "0 auto", padding: isMobile ? "48px 20px" : "80px 24px" };
    const overline = { color: C.accent, fontSize: 11, fontWeight: 700, letterSpacing: 3, textTransform: "uppercase", marginBottom: 12, fontFamily: "-apple-system, sans-serif" };
    const sectionTitle = (color = C.dark) => ({ color, fontSize: isMobile ? 28 : 40, fontWeight: 700, lineHeight: 1.2, margin: "0 0 16px", fontFamily: "'Playfair Display', Georgia, serif" });
    return (
      <div style={{ background: C.bg, fontFamily: "'Georgia', serif", overflowX: "hidden" }}>
        <style>{`
          @keyframes lp-fadeUp { from { opacity: 0; transform: translateY(40px); } to { opacity: 1; transform: translateY(0); } }
          @keyframes lp-gradientShift { 0% { background-position: 0% 50%; } 50% { background-position: 100% 50%; } 100% { background-position: 0% 50%; } }
          @keyframes lp-float { 0%, 100% { transform: translateY(0px); } 50% { transform: translateY(-12px); } }
          @keyframes lp-shimmer { 0% { background-position: -200% 0; } 100% { background-position: 200% 0; } }
          @keyframes lp-borderGlow { 0%, 100% { box-shadow: 0 20px 60px rgba(13,34,64,0.15); } 50% { box-shadow: 0 20px 60px rgba(196,132,29,0.25); } }
          @keyframes lp-strokeDraw { from { stroke-dashoffset: inherit; opacity: 0.2; } to { stroke-dashoffset: 0; opacity: 1; } }
          @keyframes lp-split { 0% { transform: translateX(0); } 100% { transform: translateX(3px); } }
          @keyframes lp-splitLeft { 0% { transform: translateX(0); } 100% { transform: translateX(-3px); } }
        `}</style>

        {/* === NAVBAR === */}
        <div className={isNative ? "cap-safe-top" : ""} style={{ position: "sticky", top: 0, zIndex: 1000, background: C.navy, borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
          <div style={{ maxWidth: 1200, margin: "0 auto", padding: "0 24px", height: isMobile ? 52 : 60, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })} style={{ display: "flex", alignItems: "center", gap: isMobile ? 8 : 10, cursor: "pointer" }}>
              <LpBrandLogo size={isMobile ? 24 : 32} />
              <div style={{
                fontSize: isMobile ? 11 : 14, fontWeight: 800, letterSpacing: 3, textTransform: "uppercase",
                fontFamily: "-apple-system, sans-serif",
                background: "linear-gradient(90deg, #C4841D 0%, #E8B85D 50%, #C4841D 100%)",
                backgroundSize: "200% auto", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
                backgroundClip: "text", animation: "lp-shimmer 3s linear infinite"
              }}>FRAZIO</div>
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => handleLandingCTA(true)} style={{ background: "transparent", color: "rgba(255,255,255,0.7)", border: "1px solid rgba(255,255,255,0.2)", borderRadius: 6, padding: isMobile ? "6px 14px" : "8px 20px", fontWeight: 600, fontSize: 13, cursor: "pointer", fontFamily: "-apple-system, sans-serif" }}>Accedi</button>
              <button onClick={() => handleLandingCTA(false)} style={{ background: C.accent, color: "#FFF", border: "none", borderRadius: 6, padding: isMobile ? "6px 14px" : "8px 20px", fontWeight: 700, fontSize: 13, cursor: "pointer", fontFamily: "-apple-system, sans-serif" }}>Inizia gratis</button>
            </div>
          </div>
        </div>

        {/* === HERO === */}
        <div style={{ background: `linear-gradient(135deg, #0D2240 0%, #162D50 40%, #1A3558 70%, #0D2240 100%)`, backgroundSize: "400% 400%", animation: "lp-gradientShift 15s ease infinite", minHeight: isMobile ? "auto" : "92vh", display: "flex", alignItems: "center" }}>
          <div style={{ maxWidth: 1200, margin: "0 auto", padding: isMobile ? "48px 20px 56px" : "80px 24px", display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: isMobile ? 40 : 60, alignItems: "center", width: "100%" }}>
            <div>
              <div style={{ ...overline, animation: "lp-fadeUp 0.8s ease-out both" }}>La piattaforma per condividere conti economici in sicurezza</div>
              <h1 style={{ color: "#FFF", fontSize: isMobile ? 34 : 50, fontWeight: 700, lineHeight: 1.15, margin: "0 0 20px", fontFamily: "'Playfair Display', Georgia, serif", animation: "lp-fadeUp 0.8s ease-out 0.1s both" }}>
                Condividi i tuoi conti economici con <span style={{ color: C.accent }}>protezione NDA</span>
              </h1>
              <p style={{ color: "rgba(255,255,255,0.65)", fontSize: isMobile ? 16 : 18, lineHeight: 1.6, margin: "0 0 32px", fontFamily: "-apple-system, sans-serif", animation: "lp-fadeUp 0.8s ease-out 0.2s both" }}>
                Crea il conto economico della tua operazione immobiliare e condividilo con partner, finanziatori e collaboratori. Chi accede si identifica con codice fiscale e firma un impegno di riservatezza.
              </p>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap", animation: "lp-fadeUp 0.8s ease-out 0.35s both" }}>
                <button onClick={() => handleLandingCTA(false)} style={{ background: C.accent, color: "#FFF", border: "none", borderRadius: 8, padding: isMobile ? "14px 28px" : "16px 36px", fontWeight: 700, fontSize: isMobile ? 15 : 16, cursor: "pointer", fontFamily: "-apple-system, sans-serif", boxShadow: "0 4px 20px rgba(196,132,29,0.4)" }}>
                  Crea il tuo primo progetto →
                </button>
                <button onClick={() => document.getElementById("lp-how")?.scrollIntoView({ behavior: "smooth" })} style={{ background: "transparent", color: "#FFF", border: "1px solid rgba(255,255,255,0.25)", borderRadius: 8, padding: isMobile ? "14px 24px" : "16px 28px", fontWeight: 600, fontSize: isMobile ? 14 : 15, cursor: "pointer", fontFamily: "-apple-system, sans-serif" }}>
                  Scopri come funziona
                </button>
              </div>
              <p style={{ color: "rgba(255,255,255,0.35)", fontSize: 13, marginTop: 20, fontFamily: "-apple-system, sans-serif", animation: "lp-fadeUp 0.8s ease-out 0.5s both" }}>
                Gratuito · NDA integrato · Identificazione con codice fiscale
              </p>
            </div>
            {!isMobile && (
              <div style={{ animation: "lp-float 6s ease-in-out infinite, lp-fadeUp 1s ease-out 0.6s both" }}>
                <div style={{ animation: "lp-borderGlow 4s ease-in-out infinite", borderRadius: 12 }}>
                  <LpDashboardMockup />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* === STATS BAR === */}
        <div ref={statsRef} style={{ background: C.bg, borderBottom: `1px solid ${C.border}` }}>
          <div style={{ ...sectionPad, padding: isMobile ? "36px 20px" : "48px 24px", display: "flex", flexDirection: isMobile ? "column" : "row", alignItems: "center", justifyContent: "center", gap: isMobile ? 28 : 0, opacity: statsVisible ? 1 : 0, transition: "opacity 0.6s ease" }}>
            {[[stat1, "verifiche prima dell'accesso"], [stat2, "caratteri di codice fiscale controllati"], [stat3, "% degli accessi tracciati e registrati"]].map(([num, label], i) => (
              <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center", flex: 1, position: "relative" }}>
                {i > 0 && !isMobile && <div style={{ position: "absolute", left: 0, top: "50%", transform: "translateY(-50%)", width: 1, height: 40, background: C.border }} />}
                <div style={{ color: C.navy, fontSize: 48, fontWeight: 700, fontFamily: "'Georgia', serif", lineHeight: 1 }}>{num}</div>
                <div style={{ color: C.textMid, fontSize: 14, marginTop: 6, fontFamily: "-apple-system, sans-serif", textAlign: "center" }}>{label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* === FEATURES === */}
        <div ref={featRef} style={{ background: C.navy }}>
          <div style={{ ...sectionPad, textAlign: "center" }}>
            <div style={overline}>La piattaforma</div>
            <h2 style={sectionTitle("#FFF")}>Condivisione protetta e analisi professionale in un unico strumento</h2>
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(3, 1fr)", gap: 20, marginTop: 48 }}>
              {LP_FEATURES.map(({ Icon, title, desc }, i) => (
                <div key={i}
                  onMouseEnter={() => !isMobile && setHoveredFeature(i)} onMouseLeave={() => setHoveredFeature(null)}
                  style={{
                    background: hoveredFeature === i ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.04)",
                    border: `1px solid ${hoveredFeature === i ? C.accent : "rgba(255,255,255,0.08)"}`,
                    borderRadius: 12, padding: "28px 24px", textAlign: "left",
                    transform: hoveredFeature === i ? "translateY(-4px)" : "translateY(0)",
                    transition: "all 0.3s ease",
                    opacity: featVisible ? 1 : 0, animation: featVisible ? `lp-fadeUp 0.6s ease-out ${i * 0.1}s both` : "none",
                  }}>
                  <div style={{ width: 44, height: 44, borderRadius: "50%", background: "rgba(196,132,29,0.15)", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 16 }}>
                    <Icon />
                  </div>
                  <div style={{ color: "#FFF", fontSize: 17, fontWeight: 700, marginBottom: 8, fontFamily: "'Georgia', serif" }}>{title}</div>
                  <div style={{ color: "rgba(255,255,255,0.6)", fontSize: 14, lineHeight: 1.6, fontFamily: "-apple-system, sans-serif" }}>{desc}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* === HOW IT WORKS === */}
        <div ref={howRef} id="lp-how" style={{ background: C.bg }}>
          <div style={{ ...sectionPad, textAlign: "center" }}>
            <div style={overline}>Come funziona</div>
            <h2 style={sectionTitle()}>Da zero a condivisione protetta in 3 passaggi</h2>
            <div style={{ display: "flex", flexDirection: isMobile ? "column" : "row", gap: isMobile ? 32 : 24, marginTop: 48, alignItems: isMobile ? "center" : "flex-start" }}>
              {LP_STEPS.map(({ num, title, desc }, i) => (
                <div key={i} style={{ flex: 1, textAlign: "center", position: "relative", opacity: howVisible ? 1 : 0, animation: howVisible ? `lp-fadeUp 0.6s ease-out ${i * 0.15}s both` : "none" }}>
                  {i > 0 && !isMobile && (
                    <div style={{ position: "absolute", top: 30, left: -12, width: 24, height: 0, borderTop: `2px dashed ${C.accent}` }} />
                  )}
                  <div style={{ width: 60, height: 60, borderRadius: "50%", border: `2px solid ${C.accent}`, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px", background: C.highlight }}>
                    <span style={{ color: C.accent, fontSize: 22, fontWeight: 700, fontFamily: "'Georgia', serif" }}>{num}</span>
                  </div>
                  <div style={{ color: C.dark, fontSize: 20, fontWeight: 700, marginBottom: 8, fontFamily: "'Georgia', serif" }}>{title}</div>
                  <div style={{ color: C.textMid, fontSize: 14, lineHeight: 1.6, fontFamily: "-apple-system, sans-serif", maxWidth: 320, margin: "0 auto" }}>{desc}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* === DASHBOARD PREVIEW === */}
        <div ref={dashRef} style={{ background: C.navy }}>
          <div style={{ ...sectionPad, textAlign: "center" }}>
            <div style={overline}>L'esperienza</div>
            <h2 style={sectionTitle("#FFF")}>Protezione di livello professionale</h2>
            <p style={{ color: "rgba(255,255,255,0.5)", fontSize: 16, marginBottom: 40, fontFamily: "-apple-system, sans-serif" }}>
              Ogni link condiviso richiede identificazione con codice fiscale, consenso GDPR e firma NDA. I tuoi conti economici sono accessibili solo a chi autorizzato.
            </p>
            <div
              onMouseEnter={() => !isMobile && setDashMockupHover(true)} onMouseLeave={() => setDashMockupHover(false)}
              style={{
                maxWidth: 700, margin: "0 auto",
                transform: !isMobile ? (dashMockupHover ? "perspective(1200px) rotateY(0deg) rotateX(0deg)" : "perspective(1200px) rotateY(-3deg) rotateX(2deg)") : "none",
                transition: "transform 0.5s ease",
                opacity: dashVisible ? 1 : 0, animation: dashVisible ? "lp-fadeUp 0.8s ease-out both" : "none",
              }}>
              <div style={{ animation: "lp-borderGlow 4s ease-in-out infinite", borderRadius: 12 }}>
                <LpDashboardMockup />
              </div>
            </div>
            <button onClick={() => handleLandingCTA(false)} style={{ marginTop: 40, background: C.accent, color: "#FFF", border: "none", borderRadius: 8, padding: "16px 36px", fontWeight: 700, fontSize: 16, cursor: "pointer", fontFamily: "-apple-system, sans-serif", boxShadow: "0 4px 20px rgba(196,132,29,0.4)" }}>
              Prova gratuitamente →
            </button>
          </div>
        </div>

        {/* === TRUST === */}
        <div ref={trustRef} style={{ background: C.bg, borderTop: `3px solid ${C.accent}`, backgroundImage: `radial-gradient(circle, ${C.border} 1px, transparent 1px)`, backgroundSize: "20px 20px" }}>
          <div style={{ ...sectionPad, textAlign: "center" }}>
            <h2 style={sectionTitle()}>Sicurezza e conformità legale</h2>
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(3, 1fr)", gap: 20, marginTop: 40 }}>
              {LP_TRUST.map(({ Icon, title, desc }, i) => (
                <div key={i} style={{
                  background: "#FFF", borderTop: `3px solid ${C.accent}`, borderRadius: 8, padding: "28px 24px", textAlign: "left",
                  boxShadow: "0 4px 20px rgba(0,0,0,0.06)",
                  opacity: trustVisible ? 1 : 0, animation: trustVisible ? `lp-fadeUp 0.6s ease-out ${i * 0.12}s both` : "none",
                }}>
                  <div style={{ width: 48, height: 48, borderRadius: "50%", background: C.accentLight, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 16 }}>
                    <Icon />
                  </div>
                  <div style={{ color: C.dark, fontSize: 16, fontWeight: 700, marginBottom: 8, fontFamily: "'Georgia', serif" }}>{title}</div>
                  <div style={{ color: C.textMid, fontSize: 14, lineHeight: 1.6, fontFamily: "-apple-system, sans-serif" }}>{desc}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* === CTA FINALE + FOOTER === */}
        <div ref={ctaRef} style={{ background: C.navy }}>
          <div style={{ ...sectionPad, textAlign: "center", padding: isMobile ? "56px 20px 32px" : "80px 24px 40px" }}>
            <h2 style={{ ...sectionTitle("#FFF"), fontSize: isMobile ? 26 : 38, opacity: ctaVisible ? 1 : 0, animation: ctaVisible ? "lp-fadeUp 0.8s ease-out both" : "none" }}>
              Pronto a condividere le tue analisi in sicurezza?
            </h2>
            <p style={{ color: "rgba(255,255,255,0.5)", fontSize: 18, marginBottom: 36, fontFamily: "-apple-system, sans-serif" }}>Gratuito · NDA integrato · Tutela legale</p>
            <div style={{ display: "inline-block", padding: 2, borderRadius: 10, background: "linear-gradient(90deg, transparent 0%, rgba(196,132,29,0.4) 50%, transparent 100%)", backgroundSize: "200% 100%", animation: "lp-shimmer 3s infinite" }}>
              <button onClick={() => handleLandingCTA(false)} style={{ background: C.accent, color: "#FFF", border: "none", borderRadius: 8, padding: isMobile ? "16px 36px" : "18px 56px", fontWeight: 700, fontSize: isMobile ? 16 : 18, cursor: "pointer", fontFamily: "-apple-system, sans-serif", display: "block" }}>
                Inizia ora →
              </button>
            </div>
            <div style={{ marginTop: 20 }}>
              <button onClick={() => handleLandingCTA(true)} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.45)", fontSize: 14, cursor: "pointer", fontFamily: "-apple-system, sans-serif", textDecoration: "underline" }}>
                Hai già un account? Accedi
              </button>
            </div>
            <div style={{ marginTop: 60, borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: 20 }}>
              <p style={{ color: "rgba(255,255,255,0.25)", fontSize: 11, margin: "0 0 8px", fontFamily: "-apple-system, sans-serif" }}>FRAZIO by Gruppo Loseto srl — Condivisione protetta di analisi immobiliari — go.lorenzoloseto.com</p>
              <div style={{ display: "flex", justifyContent: "center", gap: 16 }}>
                <span onClick={() => setShowPrivacy(true)} style={{ color: "rgba(255,255,255,0.35)", cursor: "pointer", textDecoration: "underline", fontSize: 12, fontFamily: "-apple-system, sans-serif" }}>Informativa Privacy</span>
                <span onClick={() => setShowTos(true)} style={{ color: "rgba(255,255,255,0.35)", cursor: "pointer", textDecoration: "underline", fontSize: 12, fontFamily: "-apple-system, sans-serif" }}>Termini di Servizio</span>
              </div>
            </div>
          </div>
        </div>

        {showPrivacy && <PrivacyPolicyModal onClose={() => setShowPrivacy(false)} />}
        {showTos && <TosModal onClose={() => setShowTos(false)} />}
      </div>
    );
  }

  // ============================================================
  // SHARE — Loading e Gate
  // ============================================================
  if (__sharedId && sharedLoading) {
    return (
      <div style={{ background: C.bg, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <p style={{ color: C.textMid, fontSize: 16, fontFamily: "-apple-system, sans-serif" }}>Caricamento progetto condiviso...</p>
      </div>
    );
  }
  if (__sharedId && !shareGateCompleted) {
    return (
      <div style={{ background: C.bg, minHeight: "100vh", fontFamily: "'Georgia', serif", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
        <div style={{ background: C.card, borderRadius: 10, padding: "32px 28px", maxWidth: 480, width: "100%", border: `1px solid ${C.border}`, boxShadow: "0 4px 24px rgba(0,0,0,0.08)" }}>
          <div style={{ width: 48, height: 4, background: C.accent, margin: "0 auto 20px", borderRadius: 2 }} />
          <h2 style={{ color: C.dark, fontSize: 20, fontWeight: 700, textAlign: "center", margin: "0 0 6px" }}>Verifica identità e riservatezza</h2>
          <p style={{ color: C.textMid, fontSize: 13, textAlign: "center", margin: "0 0 24px", fontFamily: "-apple-system, sans-serif" }}>Per accedere a questo conto economico riservato, è necessario verificare la tua identità e sottoscrivere un impegno di non divulgazione.</p>
          {gateError && <div style={{ background: C.redBg, color: C.red, padding: "8px 12px", borderRadius: 4, fontSize: 13, marginBottom: 14, fontFamily: "-apple-system, sans-serif" }}>{gateError}</div>}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 12px" }}>
            <AuthInput label="Nome" value={gateForm.nome} onChange={(v) => setGateForm(p => ({ ...p, nome: v }))} placeholder="Mario" autoFocus />
            <AuthInput label="Cognome" value={gateForm.cognome} onChange={(v) => setGateForm(p => ({ ...p, cognome: v }))} placeholder="Rossi" />
          </div>
          <AuthInput label="Email" type="email" value={gateForm.email} onChange={(v) => setGateForm(p => ({ ...p, email: v }))} placeholder="mario@email.com" />
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: "block", color: C.textMid, fontSize: 12, fontWeight: 600, marginBottom: 4, fontFamily: "-apple-system, sans-serif" }}>Data di nascita</label>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr 1.2fr", gap: 8 }}>
              <input type="number" value={gateForm.giorno} onChange={(e) => setGateForm(p => ({ ...p, giorno: e.target.value }))} placeholder="GG" min={1} max={31}
                style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", border: `1px solid ${C.borderDark}`, borderRadius: 6, fontSize: 15, color: C.dark, outline: "none", fontFamily: "-apple-system, sans-serif", background: C.card, textAlign: "center" }} />
              <select value={gateForm.mese} onChange={(e) => setGateForm(p => ({ ...p, mese: e.target.value }))}
                style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", border: `1px solid ${C.borderDark}`, borderRadius: 6, fontSize: 15, color: gateForm.mese ? C.dark : C.textLight, outline: "none", fontFamily: "-apple-system, sans-serif", background: C.card }}>
                <option value="">Mese</option>
                {["Gennaio","Febbraio","Marzo","Aprile","Maggio","Giugno","Luglio","Agosto","Settembre","Ottobre","Novembre","Dicembre"].map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
              </select>
              <input type="number" value={gateForm.anno} onChange={(e) => setGateForm(p => ({ ...p, anno: e.target.value }))} placeholder="AAAA" min={1920} max={2010}
                style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", border: `1px solid ${C.borderDark}`, borderRadius: 6, fontSize: 15, color: C.dark, outline: "none", fontFamily: "-apple-system, sans-serif", background: C.card, textAlign: "center" }} />
            </div>
          </div>
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: "block", color: C.textMid, fontSize: 12, fontWeight: 600, marginBottom: 4, fontFamily: "-apple-system, sans-serif" }}>Sesso</label>
            <div style={{ display: "flex", gap: 8 }}>
              {[["M", "Maschio"], ["F", "Femmina"]].map(([val, lbl]) => (
                <button key={val} onClick={() => setGateForm(p => ({ ...p, sesso: val }))} style={{
                  flex: 1, padding: "10px 12px", borderRadius: 6, border: `2px solid ${gateForm.sesso === val ? C.accent : C.border}`,
                  background: gateForm.sesso === val ? C.accentLight : C.card, color: gateForm.sesso === val ? C.accent : C.textMid,
                  fontWeight: 600, fontSize: 14, cursor: "pointer", fontFamily: "-apple-system, sans-serif",
                }}>{lbl}</button>
              ))}
            </div>
          </div>
          <AuthInput label="Luogo di nascita (Comune)" value={gateForm.luogoNascita} onChange={(v) => setGateForm(p => ({ ...p, luogoNascita: v }))} placeholder="Es. Roma" />
          <AuthInput label="Codice Fiscale" value={gateForm.cf} onChange={(v) => setGateForm(p => ({ ...p, cf: v.toUpperCase() }))} placeholder="RSSMRA80A01H501X" />
          <div style={{ marginBottom: 12, display: "flex", alignItems: "flex-start", gap: 10, background: C.card, borderRadius: 6, padding: "12px 16px", border: `1px solid ${C.border}` }}>
            <input type="checkbox" checked={gatePrivacy} onChange={(e) => setGatePrivacy(e.target.checked)}
              style={{ marginTop: 3, accentColor: C.accent, flexShrink: 0, width: 18, height: 18, cursor: "pointer" }} />
            <label style={{ color: C.textMid, fontSize: 12, lineHeight: 1.5, fontFamily: "-apple-system, sans-serif", cursor: "pointer" }} onClick={() => setGatePrivacy(p => !p)}>
              Ho letto e accetto l'<span onClick={(e) => { e.stopPropagation(); setShowPrivacy(true); }} style={{ color: C.accent, textDecoration: "underline", cursor: "pointer" }}>Informativa Privacy</span> per il trattamento dei miei dati personali ai sensi del GDPR.
            </label>
          </div>
          <div style={{ marginBottom: 12, display: "flex", alignItems: "flex-start", gap: 10, background: C.card, borderRadius: 6, padding: "12px 16px", border: `1px solid ${C.border}` }}>
            <input type="checkbox" checked={gateCfConsent} onChange={(e) => setGateCfConsent(e.target.checked)}
              style={{ marginTop: 3, accentColor: C.accent, flexShrink: 0, width: 18, height: 18, cursor: "pointer" }} />
            <label style={{ color: C.textMid, fontSize: 12, lineHeight: 1.5, fontFamily: "-apple-system, sans-serif", cursor: "pointer" }} onClick={() => setGateCfConsent(p => !p)}>
              Ai sensi dell'Art. 9 del GDPR, <strong style={{ color: C.dark }}>acconsento al trattamento del mio codice fiscale</strong> per le finalità di identificazione univoca descritte nell'informativa privacy.
            </label>
          </div>
          <div style={{ marginBottom: 20, display: "flex", alignItems: "flex-start", gap: 10, background: C.highlight, borderRadius: 6, padding: "14px 16px", border: `1px solid ${C.accentLight}` }}>
            <input type="checkbox" checked={gateNda} onChange={(e) => setGateNda(e.target.checked)}
              style={{ marginTop: 3, accentColor: C.accent, flexShrink: 0, width: 18, height: 18, cursor: "pointer" }} />
            <label style={{ color: C.textMid, fontSize: 12, lineHeight: 1.5, fontFamily: "-apple-system, sans-serif", cursor: "pointer" }} onClick={() => setGateNda(p => !p)}>
              Dichiaro di impegnarmi a <strong style={{ color: C.dark }}>non divulgare, condividere o riprodurre</strong> in alcun modo le informazioni riservate contenute nel progetto che sto per visualizzare. Riconosco che tali informazioni sono proprietà esclusiva del titolare e che qualsiasi violazione potrà avere conseguenze legali.
            </label>
          </div>
          <button onClick={handleGateSubmit} style={btnPrimary}>Accedi al progetto</button>
          <div style={{ textAlign: "center", marginTop: 14 }}>
            <PrivacyLink onClick={() => setShowPrivacy(true)} />
          </div>
        </div>
        {showPrivacy && <PrivacyPolicyModal onClose={() => setShowPrivacy(false)} />}
        {!cookieBannerDismissed && <CookieBanner onAccept={() => { localStorage.setItem("cookie_consent", "1"); setCookieBannerDismissed(true); }} onShowPrivacy={() => setShowPrivacy(true)} />}
      </div>
    );
  }

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
            {isLogin ? "Accedi per gestire e condividere i tuoi conti economici in sicurezza" : "Crea un account per condividere le tue analisi con protezione NDA"}
          </p>
          {authError && <div style={{ background: C.redBg, color: C.red, padding: "8px 12px", borderRadius: 4, fontSize: 13, marginBottom: 14, fontFamily: "-apple-system, sans-serif" }}>{authError}</div>}
          <div onKeyDown={(e) => e.key === "Enter" && (isLogin ? handleLogin() : handleRegister())}>
            {!isLogin && <AuthInput label="Nome completo" value={authForm.name} onChange={(v) => setAuthForm((p) => ({ ...p, name: v }))} placeholder="Mario Rossi" autoFocus />}
            <AuthInput label="Email" type="email" value={authForm.email} onChange={(v) => setAuthForm((p) => ({ ...p, email: v }))} placeholder="mario@email.com" autoFocus={isLogin} />
            <AuthInput label="Password" type="password" value={authForm.password} onChange={(v) => setAuthForm((p) => ({ ...p, password: v }))} placeholder="••••••••" />
          </div>
          {!isLogin && (
            <>
            <div style={{ marginBottom: 10, display: "flex", alignItems: "flex-start", gap: 10 }}>
              <input type="checkbox" checked={regPrivacy} onChange={(e) => setRegPrivacy(e.target.checked)}
                style={{ marginTop: 3, accentColor: C.accent, flexShrink: 0, width: 16, height: 16, cursor: "pointer" }} />
              <label style={{ color: C.textMid, fontSize: 12, lineHeight: 1.5, fontFamily: "-apple-system, sans-serif", cursor: "pointer" }} onClick={() => setRegPrivacy(p => !p)}>
                Ho letto e accetto l'<span onClick={(e) => { e.stopPropagation(); setShowPrivacy(true); }} style={{ color: C.accent, textDecoration: "underline", cursor: "pointer" }}>Informativa Privacy</span>
              </label>
            </div>
            <div style={{ marginBottom: 16, display: "flex", alignItems: "flex-start", gap: 10 }}>
              <input type="checkbox" checked={regTos} onChange={(e) => setRegTos(e.target.checked)}
                style={{ marginTop: 3, accentColor: C.accent, flexShrink: 0, width: 16, height: 16, cursor: "pointer" }} />
              <label style={{ color: C.textMid, fontSize: 12, lineHeight: 1.5, fontFamily: "-apple-system, sans-serif", cursor: "pointer" }} onClick={() => setRegTos(p => !p)}>
                Accetto i <span onClick={(e) => { e.stopPropagation(); setShowTos(true); }} style={{ color: C.accent, textDecoration: "underline", cursor: "pointer" }}>Termini di Servizio</span>
              </label>
            </div>
            </>
          )}
          {isLogin && (
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <input type="checkbox" checked={rememberMe} onChange={(e) => setRememberMe(e.target.checked)}
                  style={{ accentColor: C.accent, width: 14, height: 14, cursor: "pointer" }} />
                <label onClick={() => setRememberMe(p => !p)} style={{ color: C.textMid, fontSize: 12, fontFamily: "-apple-system, sans-serif", cursor: "pointer" }}>
                  Ricordami per 30 giorni
                </label>
              </div>
              <button onClick={() => { setAuthScreen("forgot"); setAuthError(""); }} style={{ background: "none", border: "none", color: C.accent, fontSize: 12, cursor: "pointer", fontFamily: "-apple-system, sans-serif", textDecoration: "underline" }}>
                Password dimenticata?
              </button>
            </div>
          )}
          <button onClick={isLogin ? handleLogin : handleRegister} style={btnPrimary}>{isLogin ? "Accedi" : "Crea account"}</button>
          <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "18px 0" }}>
            <div style={{ flex: 1, height: 1, background: C.border }} />
            <span style={{ color: C.textLight, fontSize: 12, fontFamily: "-apple-system, sans-serif" }}>oppure</span>
            <div style={{ flex: 1, height: 1, background: C.border }} />
          </div>
          <p style={{ color: C.textLight, fontSize: 11, textAlign: "center", margin: "0 0 10px", fontFamily: "-apple-system, sans-serif", lineHeight: 1.4 }}>
            Accedendo con Google, i tuoi dati di profilo (nome ed email) saranno condivisi con Google per l'autenticazione. Consulta la <span onClick={() => setShowPrivacy(true)} style={{ color: C.accent, textDecoration: "underline", cursor: "pointer" }}>Privacy Policy</span>.
          </p>
          <button onClick={async () => await DB.loginWithGoogle()} style={{ ...btnSecondary, display: "flex", alignItems: "center", justifyContent: "center", gap: 10 }}>
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
          <div style={{ textAlign: "center", marginTop: 14, borderTop: `1px solid ${C.border}`, paddingTop: 12, display: "flex", justifyContent: "center", gap: 16 }}>
            <PrivacyLink onClick={() => setShowPrivacy(true)} />
            <span onClick={() => setShowTos(true)} style={{ color: C.accent, cursor: "pointer", textDecoration: "underline", fontSize: 12, fontFamily: "-apple-system, sans-serif" }}>Termini di Servizio</span>
          </div>
        </div>
        {showPrivacy && <PrivacyPolicyModal onClose={() => setShowPrivacy(false)} />}
        {showTos && <TosModal onClose={() => setShowTos(false)} />}
        {!cookieBannerDismissed && <CookieBanner onAccept={() => { localStorage.setItem("cookie_consent", "1"); setCookieBannerDismissed(true); }} onShowPrivacy={() => setShowPrivacy(true)} />}
      </div>
    );
  }

  // ============================================================
  // FORGOT PASSWORD SCREEN (richiesta email)
  // ============================================================
  if (authScreen === "forgot") {
    return (
      <div style={{ background: C.bg, minHeight: "100vh", fontFamily: "'Georgia', serif", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ background: C.card, borderRadius: 10, padding: "36px 32px", maxWidth: 400, width: "90%", border: `1px solid ${C.border}`, boxShadow: "0 4px 24px rgba(0,0,0,0.08)" }}>
          <div style={{ width: 48, height: 4, background: C.accent, margin: "0 auto 20px", borderRadius: 2 }} />
          <h2 style={{ color: C.dark, fontSize: 22, fontWeight: 700, textAlign: "center", margin: "0 0 6px" }}>Password dimenticata</h2>
          <p style={{ color: C.textMid, fontSize: 14, textAlign: "center", margin: "0 0 24px", fontFamily: "-apple-system, sans-serif" }}>
            Inserisci la tua email e ti invieremo un link per reimpostare la password.
          </p>
          {authError && <div style={{ background: authError.startsWith("✅") ? "#e8f5e9" : C.redBg, color: authError.startsWith("✅") ? "#2e7d32" : C.red, padding: "8px 12px", borderRadius: 4, fontSize: 13, marginBottom: 14, fontFamily: "-apple-system, sans-serif" }}>{authError}</div>}
          <div onKeyDown={(e) => e.key === "Enter" && handleForgotPassword()}>
            <AuthInput label="Email" type="email" value={authForm.email} onChange={(v) => setAuthForm((p) => ({ ...p, email: v }))} placeholder="mario@email.com" autoFocus />
          </div>
          <button onClick={handleForgotPassword} style={btnPrimary}>Invia link di reset</button>
          <div style={{ textAlign: "center", marginTop: 16 }}>
            <button onClick={() => { setAuthScreen("login"); setAuthError(""); }} style={{ background: "none", border: "none", color: C.accent, fontSize: 13, cursor: "pointer", fontFamily: "-apple-system, sans-serif" }}>
              ← Torna al login
            </button>
          </div>
        </div>
        {!cookieBannerDismissed && <CookieBanner onAccept={() => { localStorage.setItem("cookie_consent", "1"); setCookieBannerDismissed(true); }} onShowPrivacy={() => setShowPrivacy(true)} />}
      </div>
    );
  }

  // ============================================================
  // RESET PASSWORD SCREEN (inserimento nuova password)
  // ============================================================
  if (authScreen === "reset-password") {
    return (
      <div style={{ background: C.bg, minHeight: "100vh", fontFamily: "'Georgia', serif", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ background: C.card, borderRadius: 10, padding: "36px 32px", maxWidth: 400, width: "90%", border: `1px solid ${C.border}`, boxShadow: "0 4px 24px rgba(0,0,0,0.08)" }}>
          <div style={{ width: 48, height: 4, background: C.accent, margin: "0 auto 20px", borderRadius: 2 }} />
          <h2 style={{ color: C.dark, fontSize: 22, fontWeight: 700, textAlign: "center", margin: "0 0 6px" }}>Nuova password</h2>
          <p style={{ color: C.textMid, fontSize: 14, textAlign: "center", margin: "0 0 24px", fontFamily: "-apple-system, sans-serif" }}>
            Scegli una nuova password per il tuo account.
          </p>
          {authError && <div style={{ background: C.redBg, color: C.red, padding: "8px 12px", borderRadius: 4, fontSize: 13, marginBottom: 14, fontFamily: "-apple-system, sans-serif" }}>{authError}</div>}
          <div onKeyDown={(e) => e.key === "Enter" && handleUpdatePassword()}>
            <AuthInput label="Nuova password" type="password" value={newPassword} onChange={setNewPassword} placeholder="Minimo 8 caratteri" autoFocus />
            <AuthInput label="Conferma password" type="password" value={confirmPassword} onChange={setConfirmPassword} placeholder="Ripeti la password" />
          </div>
          <button onClick={handleUpdatePassword} style={btnPrimary}>Salva nuova password</button>
        </div>
        {!cookieBannerDismissed && <CookieBanner onAccept={() => { localStorage.setItem("cookie_consent", "1"); setCookieBannerDismissed(true); }} onShowPrivacy={() => setShowPrivacy(true)} />}
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
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              {user?.email === ADMIN_EMAIL && <button onClick={() => setAuthScreen("admin")} style={{ background: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.8)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 4, padding: "7px 10px", fontSize: 12, cursor: "pointer", fontFamily: "-apple-system, sans-serif", display: "flex", alignItems: "center", gap: 5 }} title="Admin Dashboard"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg> Admin</button>}
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
                          <button onClick={async () => { setShareLinkLoading(true); const res = await saveProjectSnapshot(p.id, p.name, p.data || {}, p.scenari || {}, p.comparabili || [], p.rist_items || []); setShareLinkLoading(false); if (res.ok) { const base = isNative ? WEB_ORIGIN : `${window.location.origin}${window.location.pathname}`; setShareLinkUrl(`${base}?s=${res.id}`); setLinkCopied(false); DB.trackEvent("link_share", { project_id: p.id }); } else { alert("Errore: " + res.error); } }} style={{ background: "rgba(196,132,29,0.1)", color: C.accent, border: `1px solid ${C.accent}`, borderRadius: 4, padding: "7px 14px", fontWeight: 600, fontSize: 12, cursor: "pointer", fontFamily: "-apple-system, sans-serif" }}>{shareLinkLoading ? "..." : "Condividi"}</button>
                          <button onClick={async () => { if (confirm("Eliminare questo conto economico?")) { await DB.deleteProject(p.id); DB.trackEvent("project_delete", { project_id: p.id }); const updated = await DB.getProjects(); setProjectsList(updated); } }} style={{ background: "rgba(200,35,51,0.08)", color: C.red, border: "1px solid rgba(200,35,51,0.2)", borderRadius: 4, padding: "7px 10px", fontWeight: 600, fontSize: 12, cursor: "pointer", fontFamily: "-apple-system, sans-serif" }}>✕</button>
                        </>
                      )}
                    </div>
                    {!isShared && projectVisitors[p.id] && projectVisitors[p.id].length > 0 && (
                      <div style={{ width: "100%", borderTop: `1px solid ${C.border}`, marginTop: 8, paddingTop: 8 }}>
                        <div onClick={() => setExpandedVisitors(prev => ({ ...prev, [p.id]: !prev[p.id] }))}
                          style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", color: C.textMid, fontSize: 12, fontFamily: "-apple-system, sans-serif" }}>
                          <span>{expandedVisitors[p.id] ? "▾" : "▸"}</span>
                          <span style={{ fontWeight: 600 }}>👥 {projectVisitors[p.id].length} visitator{projectVisitors[p.id].length === 1 ? "e" : "i"}</span>
                        </div>
                        {expandedVisitors[p.id] && (
                          <div style={{ marginTop: 8, display: "grid", gap: 6 }}>
                            {projectVisitors[p.id].map((v, vi) => (
                              <div key={vi} style={{ background: C.bg, borderRadius: 6, padding: "8px 12px", fontSize: 12, fontFamily: "-apple-system, sans-serif", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 6 }}>
                                <div>
                                  <span style={{ color: C.dark, fontWeight: 600 }}>{v.nome} {v.cognome}</span>
                                  <span style={{ color: C.textLight, marginLeft: 8 }}>{v.email}</span>
                                </div>
                                <div style={{ display: "flex", gap: 12, color: C.textLight, fontSize: 11 }}>
                                  <span>CF: {v.cf}</span>
                                  <span>{new Date(v.visited_at).toLocaleDateString("it-IT", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          <div style={{ borderTop: `1px solid ${C.border}`, marginTop: 32, paddingTop: 20, textAlign: "center" }}>
            <button onClick={() => setShowDeleteAccount(true)} style={{ background: "none", border: "none", color: C.red, fontSize: 13, cursor: "pointer", fontFamily: "-apple-system, sans-serif", textDecoration: "underline", opacity: 0.7 }}>
              Cancella il mio account e tutti i dati
            </button>
          </div>
        </div>
        {/* DELETE ACCOUNT MODAL */}
        {showDeleteAccount && (
          <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(13,34,64,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999 }} onClick={() => !deleteAccountLoading && setShowDeleteAccount(false)}>
            <div onClick={(e) => e.stopPropagation()} style={{ background: C.card, borderRadius: 10, padding: "28px 24px", maxWidth: 440, width: "90%", boxShadow: "0 8px 32px rgba(0,0,0,0.18)", border: `2px solid ${C.red}` }}>
              <div style={{ textAlign: "center", marginBottom: 20 }}>
                <div style={{ width: 48, height: 48, borderRadius: "50%", background: C.redBg, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 12px" }}>
                  <span style={{ fontSize: 22 }}>⚠️</span>
                </div>
                <h3 style={{ color: C.red, fontSize: 18, fontWeight: 700, margin: "0 0 8px" }}>Cancella account</h3>
                <p style={{ color: C.textMid, fontSize: 13, margin: 0, fontFamily: "-apple-system, sans-serif", lineHeight: 1.5 }}>
                  Stai per cancellare definitivamente il tuo account e <strong>tutti i dati associati</strong>: profilo, progetti, condivisioni, snapshot e visitatori. Questa azione è <strong>irreversibile</strong>.
                </p>
              </div>
              <button onClick={handleDeleteAccount} disabled={deleteAccountLoading} style={{ background: C.red, color: "#FFF", border: "none", borderRadius: 6, padding: "11px 24px", fontWeight: 700, fontSize: 15, cursor: deleteAccountLoading ? "not-allowed" : "pointer", fontFamily: "-apple-system, sans-serif", width: "100%", opacity: deleteAccountLoading ? 0.6 : 1, marginBottom: 10 }}>
                {deleteAccountLoading ? "Cancellazione in corso..." : "Sì, cancella tutto"}
              </button>
              <button onClick={() => setShowDeleteAccount(false)} disabled={deleteAccountLoading} style={{ background: "transparent", color: C.textMid, border: `1px solid ${C.border}`, borderRadius: 6, padding: "10px 24px", fontWeight: 600, fontSize: 14, cursor: "pointer", fontFamily: "-apple-system, sans-serif", width: "100%" }}>
                Annulla
              </button>
            </div>
          </div>
        )}
        {/* SHARE MODAL */}
        {shareModal && (
          <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(13,34,64,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999 }} onClick={() => setShareModal(null)}>
            <div onClick={(e) => e.stopPropagation()} style={{ background: C.card, borderRadius: 10, padding: "28px 24px", maxWidth: 440, width: "90%", boxShadow: "0 8px 32px rgba(0,0,0,0.18)" }}>
              <h3 style={{ color: C.dark, fontSize: 18, fontWeight: 700, margin: "0 0 6px" }}>Condividi con protezione NDA</h3>
              <p style={{ color: C.textMid, fontSize: 13, margin: "0 0 18px", fontFamily: "-apple-system, sans-serif" }}>Il destinatario riceverà accesso al progetto. Per visualizzarlo dovrà identificarsi con codice fiscale e firmare un impegno di riservatezza.</p>
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
        {shareLinkUrl && (
          <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(13,34,64,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999 }} onClick={() => setShareLinkUrl("")}>
            <div onClick={(e) => e.stopPropagation()} style={{ background: C.card, borderRadius: 10, padding: "28px 24px", maxWidth: 480, width: "90%", boxShadow: "0 8px 32px rgba(0,0,0,0.18)", border: `1px solid ${C.border}` }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
                <div style={{ width: 40, height: 40, borderRadius: "50%", background: C.accentLight, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <span style={{ color: C.accent, fontSize: 18 }}>🔗</span>
                </div>
                <div>
                  <h3 style={{ color: C.dark, fontSize: 18, fontWeight: 700, margin: 0 }}>Link protetto con NDA</h3>
                  <p style={{ color: C.textMid, fontSize: 13, margin: "2px 0 0", fontFamily: "-apple-system, sans-serif" }}>Chi accede al link dovrà identificarsi con codice fiscale e firmare un NDA prima di visualizzare il progetto.</p>
                </div>
              </div>
              <div style={{ background: C.inputBg, border: `1px solid ${C.inputBorder}`, borderRadius: 6, padding: "10px 12px", marginBottom: 16, wordBreak: "break-all", fontSize: 12, color: C.textMid, fontFamily: "monospace", maxHeight: 80, overflow: "auto" }}>
                {shareLinkUrl}
              </div>
              <button onClick={() => { navigator.clipboard.writeText(shareLinkUrl).then(() => { setLinkCopied(true); setTimeout(() => setLinkCopied(false), 2500); }); }} style={{ ...btnPrimary, background: linkCopied ? C.green : C.navy, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                {linkCopied ? "✓ Link copiato!" : "Copia link"}
              </button>
              <button onClick={() => setShareLinkUrl("")} style={{ ...btnSecondary, marginTop: 10 }}>Chiudi</button>
            </div>
          </div>
        )}
        {/* GDPR: Privacy Modal + Cookie Banner */}
        {showPrivacy && <PrivacyPolicyModal onClose={() => setShowPrivacy(false)} />}
        {!cookieBannerDismissed && <CookieBanner onAccept={() => { localStorage.setItem("cookie_consent", "1"); setCookieBannerDismissed(true); }} onShowPrivacy={() => setShowPrivacy(true)} />}
      </div>
    );
  }

  // ============================================================
  // ADMIN DASHBOARD SCREEN
  // ============================================================
  if (authScreen === "admin" && user?.email === ADMIN_EMAIL) {
    return <AdminDashboard user={user} onClose={() => setAuthScreen(null)} />;
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
              FRAZIO
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              {step > 0 && <span style={{ color: "#6B7B94", fontSize: 12, fontFamily: "-apple-system, sans-serif" }}>{step} / {STEPS.length - 1}</span>}
              {user ? (
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <button onClick={() => setAuthScreen("projects")} style={{ background: "rgba(196,132,29,0.15)", color: C.accent, border: "none", borderRadius: 4, padding: "4px 10px", fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: "-apple-system, sans-serif" }}>I miei progetti</button>
                  {user?.email === ADMIN_EMAIL && <button onClick={() => setAuthScreen("admin")} style={{ background: "rgba(13,34,64,0.15)", color: "#FFF", border: "none", borderRadius: 4, padding: "4px 8px", fontSize: 11, cursor: "pointer", fontFamily: "-apple-system, sans-serif", display: "flex", alignItems: "center" }} title="Admin Dashboard"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg></button>}
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
        {/* GDPR: Privacy Modal + Cookie Banner */}
        {showPrivacy && <PrivacyPolicyModal onClose={() => setShowPrivacy(false)} />}
        {!cookieBannerDismissed && <CookieBanner onAccept={() => { localStorage.setItem("cookie_consent", "1"); setCookieBannerDismissed(true); }} onShowPrivacy={() => setShowPrivacy(true)} />}
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
            <div style={{ color: C.accent, fontWeight: 700, fontSize: 10, letterSpacing: 2.5, textTransform: "uppercase", fontFamily: "-apple-system, sans-serif", marginBottom: 1 }}>Conto economico</div>
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
                {user?.email === ADMIN_EMAIL && <button onClick={() => setAuthScreen("admin")} style={{ background: "rgba(13,34,64,0.15)", color: "#FFF", border: "none", borderRadius: 4, padding: "6px 8px", fontSize: 11, cursor: "pointer", fontFamily: "-apple-system, sans-serif", display: "flex", alignItems: "center" }} title="Admin Dashboard"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg></button>}
              </>
            )}
            {!user && <button onClick={() => setAuthScreen("login")} style={{ background: "rgba(196,132,29,0.15)", color: C.accent, border: "none", borderRadius: 4, padding: "6px 10px", fontWeight: 600, fontSize: 11, cursor: "pointer", fontFamily: "-apple-system, sans-serif" }}>Accedi per condividere</button>}
            <button onClick={exportExcel} style={{ background: "rgba(26,127,55,0.15)", color: "#6FCF97", border: "1px solid rgba(26,127,55,0.3)", borderRadius: 4, padding: "6px 10px", fontWeight: 600, fontSize: 11, cursor: "pointer", fontFamily: "-apple-system, sans-serif" }}>Esporta Excel</button>
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
            <button key={t.id} onClick={() => setDashTab(t.id)} style={{
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
              <DashPctInput label="Provvigioni agenzia (IN)" value={data.provvigioniInPct || 0} onChange={(v) => upd("provvigioniInPct", v)} note="Sull'acquisto" disabled={viewOnly} />
              <DashPctInput label="Provvigioni agenzia (OUT)" value={data.provvigioniPct} onChange={(v) => upd("provvigioniPct", v)} note="Sulla vendita" disabled={viewOnly} />
              <DashInput label="Notaio" value={data.notaio || 0} onChange={(v) => upd("notaio", v)} suffix="€" step={500} disabled={viewOnly} />
              <DashPctInput label="Tasse acquisto (società)" value={data.tasseAcquistoPct} onChange={(v) => upd("tasseAcquistoPct", v)} note="Imposta di registro: 9%" disabled={viewOnly} />
              <DashInput label="Allacciamenti utenze" value={data.allacciamentiUtenze} onChange={(v) => upd("allacciamentiUtenze", v)} suffix="€" step={500} disabled={viewOnly} />
              <DashInput label="Bollette Gas, Luce ecc" value={data.bolletteGasLuce} onChange={(v) => upd("bolletteGasLuce", v)} suffix="€" step={100} disabled={viewOnly} />
              <DashInput label="Consulenze Tecniche" value={data.consulenzeTecniche} onChange={(v) => upd("consulenzeTecniche", v)} suffix="€" step={500} disabled={viewOnly} />
              <DashInput label="Rendering" value={data.rendering} onChange={(v) => upd("rendering", v)} suffix="€" step={100} disabled={viewOnly} />
              <DashInput label="IMU" value={data.imu} onChange={(v) => upd("imu", v)} suffix="€" step={100} disabled={viewOnly} />
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
                <DataRow label="Provvigioni IN" value={fmtEur(Math.round(calc.provvigioniIn))} />
                <DataRow label="Notaio" value={fmtEur(data.notaio || 0)} />
                <DataRow label="Tasse acquisto" value={fmtEur(Math.round(calc.tasseAcquisto))} />
                <DataRow label="Allacciamenti utenze" value={fmtEur(data.allacciamentiUtenze)} />
                <DataRow label="Bollette Gas, Luce ecc" value={fmtEur(data.bolletteGasLuce)} />
                <DataRow label="Consulenze Tecniche" value={fmtEur(data.consulenzeTecniche)} />
                <DataRow label="Rendering" value={fmtEur(data.rendering)} />
                <DataRow label="IMU" value={fmtEur(data.imu || 0)} />
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
          <p style={{ color: C.textLight, fontSize: 11, margin: "0 0 6px", fontFamily: "-apple-system, sans-serif" }}>FRAZIO by Gruppo Loseto srl — Condivisione protetta di analisi immobiliari — go.lorenzoloseto.com</p>
          <PrivacyLink onClick={() => setShowPrivacy(true)} />
        </div>
      </div>


      {/* GDPR: Privacy Modal + Cookie Banner */}
      {showPrivacy && <PrivacyPolicyModal onClose={() => setShowPrivacy(false)} />}
      {!cookieBannerDismissed && <CookieBanner onAccept={() => { localStorage.setItem("cookie_consent", "1"); setCookieBannerDismissed(true); }} onShowPrivacy={() => setShowPrivacy(true)} />}
    </div>
  );
}
