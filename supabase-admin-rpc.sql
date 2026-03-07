-- ============================================================
-- FRAZIO Admin Control Panel - RPC Functions
-- Incolla questo intero file nel Supabase SQL Editor e esegui.
-- ============================================================

-- 1. admin_get_all_projects
CREATE OR REPLACE FUNCTION admin_get_all_projects(admin_email text)
RETURNS TABLE (
  id uuid,
  owner_id uuid,
  owner_name text,
  owner_email text,
  name text,
  data jsonb,
  scenari jsonb,
  comparabili jsonb,
  rist_items jsonb,
  updated_at timestamptz,
  share_count bigint,
  snapshot_count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF admin_email <> 'lorenzoloseto@hotmail.it' THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  RETURN QUERY
  SELECT
    p.id,
    p.owner_id,
    p.owner_name,
    pr.email AS owner_email,
    p.name,
    p.data,
    p.scenari,
    p.comparabili,
    p.rist_items,
    p.updated_at,
    COALESCE(ps.share_count, 0::bigint) AS share_count,
    COALESCE(ss.snapshot_count, 0::bigint) AS snapshot_count
  FROM projects p
  LEFT JOIN profiles pr ON pr.id = p.owner_id
  LEFT JOIN (
    SELECT project_id, COUNT(*)::bigint AS share_count
    FROM project_shares
    GROUP BY project_id
  ) ps ON ps.project_id = p.id
  LEFT JOIN (
    SELECT project_id, COUNT(*)::bigint AS snapshot_count
    FROM shared_snapshots
    GROUP BY project_id
  ) ss ON ss.project_id = p.id
  ORDER BY p.updated_at DESC;
END;
$$;

-- 2. admin_get_all_shares
CREATE OR REPLACE FUNCTION admin_get_all_shares(admin_email text)
RETURNS TABLE (
  project_id uuid,
  shared_with_email text,
  permission text,
  shared_by uuid,
  project_name text,
  owner_id uuid,
  owner_name text,
  owner_email text
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF admin_email <> 'lorenzoloseto@hotmail.it' THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  RETURN QUERY
  SELECT
    ps.project_id,
    ps.shared_with_email,
    ps.permission,
    ps.shared_by,
    p.name AS project_name,
    p.owner_id,
    p.owner_name,
    pr.email AS owner_email
  FROM project_shares ps
  LEFT JOIN projects p ON p.id = ps.project_id
  LEFT JOIN profiles pr ON pr.id = p.owner_id
  ORDER BY p.name;
END;
$$;

-- 3. admin_get_all_visitors
CREATE OR REPLACE FUNCTION admin_get_all_visitors(admin_email text)
RETURNS TABLE (
  id uuid,
  snapshot_id uuid,
  nome text,
  cognome text,
  email text,
  cf text,
  data_nascita text,
  sesso text,
  luogo_nascita text,
  privacy_consent boolean,
  nda_accepted boolean,
  cf_consent boolean,
  visited_at timestamptz,
  project_id uuid,
  project_name text,
  owner_name text
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF admin_email <> 'lorenzoloseto@hotmail.it' THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  RETURN QUERY
  SELECT
    sv.id,
    sv.snapshot_id,
    sv.nome,
    sv.cognome,
    sv.email,
    sv.cf,
    sv.data_nascita,
    sv.sesso,
    sv.luogo_nascita,
    sv.privacy_consent,
    sv.nda_accepted,
    sv.cf_consent,
    sv.visited_at,
    ss.project_id,
    p.name AS project_name,
    p.owner_name
  FROM snapshot_visitors sv
  LEFT JOIN shared_snapshots ss ON ss.id = sv.snapshot_id
  LEFT JOIN projects p ON p.id = ss.project_id
  ORDER BY sv.visited_at DESC;
END;
$$;

-- 4. admin_get_user_details
CREATE OR REPLACE FUNCTION admin_get_user_details(admin_email text, target_user_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result json;
  user_profile json;
  user_projects json;
  shares_given json;
  shares_received json;
  recent_events json;
  user_email_addr text;
BEGIN
  IF admin_email <> 'lorenzoloseto@hotmail.it' THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  -- Profile
  SELECT json_build_object(
    'id', pr.id,
    'name', pr.name,
    'email', pr.email,
    'privacy_consent_at', pr.privacy_consent_at
  ) INTO user_profile
  FROM profiles pr
  WHERE pr.id = target_user_id;

  -- Get user email for shares_received lookup
  SELECT pr.email INTO user_email_addr
  FROM profiles pr
  WHERE pr.id = target_user_id;

  -- Projects
  SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json) INTO user_projects
  FROM (
    SELECT p.id, p.name, p.owner_name, p.updated_at
    FROM projects p
    WHERE p.owner_id = target_user_id
    ORDER BY p.updated_at DESC
  ) t;

  -- Shares given (projects this user shared with others)
  SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json) INTO shares_given
  FROM (
    SELECT ps.project_id, ps.shared_with_email, ps.permission, p.name AS project_name
    FROM project_shares ps
    LEFT JOIN projects p ON p.id = ps.project_id
    WHERE ps.shared_by = target_user_id
  ) t;

  -- Shares received (projects shared with this user's email)
  SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json) INTO shares_received
  FROM (
    SELECT ps.project_id, ps.permission, ps.shared_by, p.name AS project_name, p.owner_name
    FROM project_shares ps
    LEFT JOIN projects p ON p.id = ps.project_id
    WHERE ps.shared_with_email = user_email_addr
  ) t;

  -- Recent analytics events (last 50)
  SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json) INTO recent_events
  FROM (
    SELECT ae.event_type, ae.metadata, ae.session_id, ae.created_at
    FROM analytics_events ae
    WHERE ae.user_id = target_user_id
    ORDER BY ae.created_at DESC
    LIMIT 50
  ) t;

  result := json_build_object(
    'profile', user_profile,
    'projects', user_projects,
    'shares_given', shares_given,
    'shares_received', shares_received,
    'recent_events', recent_events
  );

  RETURN result;
END;
$$;

-- 5. admin_delete_project
CREATE OR REPLACE FUNCTION admin_delete_project(admin_email text, target_project_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF admin_email <> 'lorenzoloseto@hotmail.it' THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  -- 1. Delete snapshot_visitors for all snapshots of this project
  DELETE FROM snapshot_visitors
  WHERE snapshot_id IN (
    SELECT id FROM shared_snapshots WHERE project_id = target_project_id
  );

  -- 2. Delete shared_snapshots
  DELETE FROM shared_snapshots
  WHERE project_id = target_project_id;

  -- 3. Delete project_shares
  DELETE FROM project_shares
  WHERE project_id = target_project_id;

  -- 4. Delete the project itself
  DELETE FROM projects
  WHERE id = target_project_id;

  RETURN json_build_object('ok', true);
END;
$$;

-- 6. admin_remove_share
CREATE OR REPLACE FUNCTION admin_remove_share(admin_email text, target_project_id uuid, target_email text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF admin_email <> 'lorenzoloseto@hotmail.it' THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  DELETE FROM project_shares
  WHERE project_id = target_project_id
    AND shared_with_email = target_email;

  RETURN json_build_object('ok', true);
END;
$$;

-- 7. admin_delete_user_data
CREATE OR REPLACE FUNCTION admin_delete_user_data(admin_email text, target_user_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  user_email_addr text;
  user_project_ids uuid[];
BEGIN
  IF admin_email <> 'lorenzoloseto@hotmail.it' THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  -- Get user email for cleaning up received shares
  SELECT pr.email INTO user_email_addr
  FROM profiles pr
  WHERE pr.id = target_user_id;

  -- Collect all project IDs owned by this user
  SELECT ARRAY(
    SELECT p.id FROM projects p WHERE p.owner_id = target_user_id
  ) INTO user_project_ids;

  -- 1. Delete snapshot_visitors for all snapshots of user's projects
  DELETE FROM snapshot_visitors
  WHERE snapshot_id IN (
    SELECT ss.id FROM shared_snapshots ss
    WHERE ss.project_id = ANY(user_project_ids)
  );

  -- 2. Delete shared_snapshots for user's projects
  DELETE FROM shared_snapshots
  WHERE project_id = ANY(user_project_ids);

  -- 3. Delete project_shares: both owned projects and shares received by this user's email
  DELETE FROM project_shares
  WHERE project_id = ANY(user_project_ids)
     OR shared_with_email = user_email_addr;

  -- 4. Delete all projects owned by this user
  DELETE FROM projects
  WHERE owner_id = target_user_id;

  -- 5. Delete analytics events
  DELETE FROM analytics_events
  WHERE user_id = target_user_id;

  -- 6. Delete the profile
  DELETE FROM profiles
  WHERE id = target_user_id;

  RETURN json_build_object('ok', true);
END;
$$;
