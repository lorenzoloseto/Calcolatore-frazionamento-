-- ============================================================
-- PROTEZIONE DATI VISITATORI NDA (snapshot_visitors)
-- ============================================================
-- PROBLEMA: la tabella snapshot_visitors era leggibile da CHIUNQUE
-- con la anon key (che è pubblica, dentro il bundle JS del sito):
-- nome, cognome, email, data di nascita e CODICE FISCALE di tutti
-- quelli che hanno firmato un NDA erano esposti.
--
-- COME APPLICARE: Supabase Dashboard → SQL Editor → incolla tutto → Run.
--
-- Cosa cambia:
--  - chiunque può ancora INSERIRE la propria firma NDA (serve per il gate)
--  - solo il proprietario del progetto può LEGGERE/CANCELLARE i visitatori
--    dei propri snapshot (pagina "I miei conti economici" e cancellazione account)
--  - il pannello Admin non è toccato (le RPC admin sono SECURITY DEFINER)

ALTER TABLE snapshot_visitors ENABLE ROW LEVEL SECURITY;

-- Rimuove tutte le policy esistenti sulla tabella (comprese quelle permissive)
DO $$
DECLARE pol record;
BEGIN
  FOR pol IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'snapshot_visitors' LOOP
    EXECUTE format('DROP POLICY %I ON public.snapshot_visitors', pol.policyname);
  END LOOP;
END $$;

-- 1. Chiunque (anche non loggato) può registrare la propria firma NDA
CREATE POLICY "visitors_insert_public" ON public.snapshot_visitors
  FOR INSERT TO anon, authenticated
  WITH CHECK (true);

-- 2. Solo il proprietario del progetto legge i visitatori dei propri snapshot
CREATE POLICY "visitors_select_owner" ON public.snapshot_visitors
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.shared_snapshots ss
      JOIN public.projects p ON p.id = ss.project_id
      WHERE ss.id = snapshot_visitors.snapshot_id
        AND p.owner_id = auth.uid()
    )
  );

-- 3. Solo il proprietario può cancellarli (usato dalla cancellazione account)
CREATE POLICY "visitors_delete_owner" ON public.snapshot_visitors
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.shared_snapshots ss
      JOIN public.projects p ON p.id = ss.project_id
      WHERE ss.id = snapshot_visitors.snapshot_id
        AND p.owner_id = auth.uid()
    )
  );

-- Verifica (facoltativa): da eseguire dopo. Deve restituire 4 righe
-- (rowsecurity = true + le 3 policy qui sopra).
-- SELECT relrowsecurity FROM pg_class WHERE relname = 'snapshot_visitors';
-- SELECT policyname, cmd FROM pg_policies WHERE tablename = 'snapshot_visitors';

-- ============================================================
-- TRACKING EVENTI ANONIMI (analytics_events)
-- ============================================================
-- PROBLEMA: la policy anon consentiva di inserire SOLO event_type='snapshot_view',
-- quindi tutti gli eventi del lead magnet generati da visitatori non loggati
-- (page_view, dash_tab_open, unlock_banner_click, lead_capture, wizard_step_change...)
-- venivano rifiutati in silenzio da DB.trackEvent → funnel del calcolatore gratuito
-- completamente cieco su Supabase.
--
-- FIX: l'anonimo può inserire QUALSIASI evento, purché user_id sia NULL (così non
-- può falsificare eventi attribuiti a un utente reale). Nessuna policy di SELECT per
-- anon → i dati restano non leggibili senza login.

DROP POLICY IF EXISTS "Anon can insert snapshot_view" ON public.analytics_events;

CREATE POLICY "Anon can insert events" ON public.analytics_events
  FOR INSERT TO anon
  WITH CHECK (user_id IS NULL);

-- Verifica: un anonimo (publishable key) deve poter inserire un evento con user_id
-- NULL (201), ma NON con user_id valorizzato (violazione RLS), e NON deve poter leggere.
