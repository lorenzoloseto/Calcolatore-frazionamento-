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
