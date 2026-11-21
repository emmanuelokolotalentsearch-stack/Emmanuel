\set ON_ERROR_STOP on
BEGIN;

INSERT INTO auth.users(id,email) VALUES
 ('10000000-0000-4000-8000-000000000001','owner-a@example.test'),
 ('10000000-0000-4000-8000-000000000002','owner-b@example.test'),
 ('10000000-0000-4000-8000-000000000003','platform-admin@example.test')
ON CONFLICT (id) DO NOTHING;

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',false);
SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',false);
SELECT public.create_workspace('QA Workspace Alpha','qa-workspace-alpha') AS workspace_a \gset

-- Direct workspace creation is blocked; the security-definer RPC is the supported path.
DO $$
BEGIN
  BEGIN
    INSERT INTO public.workspaces(name,slug,created_by)
    VALUES('Orphan Workspace','qa-orphan-workspace',auth.uid());
    RAISE EXCEPTION 'Direct workspace INSERT unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END $$;

-- Workspace membership cannot be forged or escalated through the client.
DO $$
BEGIN
  BEGIN
    INSERT INTO public.workspace_members(workspace_id,user_id,role)
    VALUES(:'workspace_a'::uuid,'10000000-0000-4000-8000-000000000002','owner');
    RAISE EXCEPTION 'Direct membership INSERT unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END $$;

INSERT INTO public.contacts(workspace_id,created_by,full_name,email)
VALUES(:'workspace_a'::uuid,auth.uid(),'Alpha Private Contact','alpha@example.test')
RETURNING id AS contact_a \gset

INSERT INTO public.jobs(workspace_id,created_by,title,company)
VALUES(:'workspace_a'::uuid,auth.uid(),'QA Engineer','Alpha Co')
RETURNING id AS job_a \gset

SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',false);
SELECT public.create_workspace('QA Workspace Beta','qa-workspace-beta') AS workspace_b \gset
INSERT INTO public.contacts(workspace_id,created_by,full_name,email)
VALUES(:'workspace_b'::uuid,auth.uid(),'Beta Private Contact','beta@example.test');

-- Tenant A cannot see tenant B data and vice versa.
DO $$
BEGIN
  IF (SELECT count(*) FROM public.contacts WHERE workspace_id=:'workspace_a'::uuid) <> 0 THEN
    RAISE EXCEPTION 'Tenant B can see Tenant A contacts';
  END IF;
END $$;

-- Composite foreign key must reject an application that references another workspace's job.
DO $$
BEGIN
  BEGIN
    INSERT INTO public.applications(workspace_id,job_id,created_by)
    VALUES(:'workspace_b'::uuid,:'job_a'::uuid,auth.uid());
    RAISE EXCEPTION 'Cross-workspace application unexpectedly succeeded';
  EXCEPTION WHEN foreign_key_violation THEN
    NULL;
  END;
END $$;

-- Tenant B must not be able to move a tenant A contact into its workspace.
DO $$
BEGIN
  BEGIN
    UPDATE public.contacts SET workspace_id=:'workspace_b'::uuid WHERE id=:'contact_a'::uuid;
    RAISE EXCEPTION 'Tenant ownership mutation unexpectedly succeeded';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'Tenant ownership mutation unexpectedly succeeded' THEN RAISE; END IF;
  END;
END $$;

-- Add a second workspace member using the service role (the same trust boundary as the team API).
RESET ROLE;
SET ROLE service_role;
SELECT set_config('request.jwt.claim.role','service_role',false);
INSERT INTO public.workspace_members(workspace_id,user_id,role)
VALUES(:'workspace_a'::uuid,'10000000-0000-4000-8000-000000000002','member');

-- A normal member cannot see subscription records.
RESET ROLE;
SET ROLE postgres;
INSERT INTO public.subscriptions(workspace_id,plan,status)
VALUES(:'workspace_a'::uuid,'free','free')
ON CONFLICT (workspace_id) DO NOTHING;
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',false);
SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',false);
DO $$
BEGIN
  IF (SELECT count(*) FROM public.subscriptions WHERE workspace_id=:'workspace_a'::uuid) <> 0 THEN
    RAISE EXCEPTION 'Non-admin member can see subscription details';
  END IF;
END $$;

-- Free plan quota is atomic and blocks the 21st unit for one feature.
DO $$
DECLARE usage_row record;
BEGIN
  FOR i IN 1..21 LOOP
    SELECT * INTO usage_row FROM public.consume_feature_usage(:'workspace_b'::uuid,'qa_feature',1);
    IF i <= 20 AND usage_row.allowed IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'Free quota blocked too early at usage %', i;
    END IF;
    IF i = 21 AND usage_row.allowed IS DISTINCT FROM false THEN
      RAISE EXCEPTION 'Free quota did not block the 21st unit';
    END IF;
  END LOOP;
END $$;

-- The service-only scheduled-send counter accepts retries idempotently.
RESET ROLE;
SET ROLE service_role;
SELECT set_config('request.jwt.claim.role','service_role',false);
DO $$
DECLARE first_use record; retry_use record;
BEGIN
  SELECT * INTO first_use FROM public.consume_service_feature_usage(
    :'workspace_a'::uuid,'10000000-0000-4000-8000-000000000001','qa_campaign',1,'qa-recipient-001'
  );
  SELECT * INTO retry_use FROM public.consume_service_feature_usage(
    :'workspace_a'::uuid,'10000000-0000-4000-8000-000000000001','qa_campaign',1,'qa-recipient-001'
  );
  IF first_use.allowed IS DISTINCT FROM true OR retry_use.allowed IS DISTINCT FROM true OR first_use.used <> retry_use.used THEN
    RAISE EXCEPTION 'Idempotent usage retry was charged more than once';
  END IF;
END $$;

-- Last owner cannot be removed, even through the service-role team API boundary.
DO $$
BEGIN
  BEGIN
    DELETE FROM public.workspace_members
    WHERE workspace_id=:'workspace_a'::uuid
      AND user_id='10000000-0000-4000-8000-000000000001';
    RAISE EXCEPTION 'Last owner removal unexpectedly succeeded';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'Last owner removal unexpectedly succeeded' THEN RAISE; END IF;
  END;
END $$;

-- Platform admin metrics are accessible only to an explicitly bootstrapped user.
RESET ROLE;
SET ROLE postgres;
INSERT INTO public.platform_admins(user_id)
VALUES('10000000-0000-4000-8000-000000000003')
ON CONFLICT DO NOTHING;
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',false);
SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000003',false);
DO $$
DECLARE metrics jsonb;
BEGIN
  metrics := public.platform_admin_stats();
  IF (metrics->>'workspaces')::integer < 2 THEN RAISE EXCEPTION 'Platform admin metrics returned an unexpected workspace count'; END IF;
END $$;

ROLLBACK;
