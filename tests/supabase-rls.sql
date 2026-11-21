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
SELECT set_config('qa.workspace_a', :'workspace_a', false);

DO $$
BEGIN
  BEGIN
    INSERT INTO public.workspaces(name,slug,created_by)
    VALUES('Orphan Workspace','qa-orphan-workspace',auth.uid());
    RAISE EXCEPTION 'Direct workspace INSERT unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;

DO $$
BEGIN
  BEGIN
    INSERT INTO public.workspace_members(workspace_id,user_id,role)
    VALUES(current_setting('qa.workspace_a')::uuid,'10000000-0000-4000-8000-000000000002','owner');
    RAISE EXCEPTION 'Direct membership INSERT unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;

INSERT INTO public.contacts(workspace_id,created_by,full_name,email)
VALUES(:'workspace_a'::uuid,auth.uid(),'Alpha Private Contact','alpha@example.test')
RETURNING id AS contact_a \gset
SELECT set_config('qa.contact_a', :'contact_a', false);

INSERT INTO public.jobs(workspace_id,created_by,title,company)
VALUES(:'workspace_a'::uuid,auth.uid(),'QA Engineer','Alpha Co')
RETURNING id AS job_a \gset
SELECT set_config('qa.job_a', :'job_a', false);

-- Consent records must contain evidence, not only a checkbox.
INSERT INTO public.contacts(
  workspace_id,created_by,full_name,email,email_opt_in,email_opt_in_at,email_consent_source,email_consent_note
)
VALUES(
  :'workspace_a'::uuid,auth.uid(),'Opt-in Test Contact','optin@example.test',true,now(),
  'workspace_user_attestation','Signed up through the organization website on the test date.'
)
RETURNING id AS consent_contact \gset
SELECT set_config('qa.consent_contact', :'consent_contact', false);

DO $$
DECLARE blocked boolean := false;
BEGIN
  BEGIN
    INSERT INTO public.contacts(workspace_id,created_by,full_name,email,email_opt_in)
    VALUES(current_setting('qa.workspace_a')::uuid,auth.uid(),'Invalid Opt-in','invalid@example.test',true);
  EXCEPTION WHEN check_violation THEN blocked := true;
  END;
  IF NOT blocked THEN RAISE EXCEPTION 'Marketing opt-in without evidence unexpectedly succeeded'; END IF;
END $$;

-- Only an eligible, opted-in contact may be scheduled as a campaign recipient.
DO $$
DECLARE result_row record;
BEGIN
  SELECT * INTO result_row FROM public.schedule_outreach_campaign(
    current_setting('qa.workspace_a')::uuid,
    'QA scheduled campaign',
    'QA campaign subject',
    'This is a controlled QA message.',
    ARRAY[current_setting('qa.consent_contact')::uuid],
    now() + interval '1 hour'
  );
  IF result_row.recipient_count <> 1 THEN RAISE EXCEPTION 'Expected one opted-in campaign recipient'; END IF;
END $$;

SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',false);
SELECT public.create_workspace('QA Workspace Beta','qa-workspace-beta') AS workspace_b \gset
SELECT set_config('qa.workspace_b', :'workspace_b', false);
INSERT INTO public.contacts(workspace_id,created_by,full_name,email)
VALUES(:'workspace_b'::uuid,auth.uid(),'Beta Private Contact','beta@example.test');

DO $$
BEGIN
  IF (SELECT count(*) FROM public.contacts WHERE workspace_id=current_setting('qa.workspace_a')::uuid) <> 0 THEN
    RAISE EXCEPTION 'Tenant B can see Tenant A contacts';
  END IF;
END $$;

DO $$
BEGIN
  BEGIN
    INSERT INTO public.applications(workspace_id,job_id,created_by)
    VALUES(current_setting('qa.workspace_b')::uuid,current_setting('qa.job_a')::uuid,auth.uid());
    RAISE EXCEPTION 'Cross-workspace application unexpectedly succeeded';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
END $$;

-- Membership changes must go through the server-side admin API.
RESET ROLE;
SET ROLE service_role;
SELECT set_config('request.jwt.claim.role','service_role',false);
INSERT INTO public.workspace_members(workspace_id,user_id,role)
VALUES(current_setting('qa.workspace_a')::uuid,'10000000-0000-4000-8000-000000000002','member');

-- A member of both workspaces still cannot mutate the immutable tenant ownership of a row.
RESET ROLE;
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',false);
SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',false);
DO $$
DECLARE blocked boolean := false;
BEGIN
  BEGIN
    UPDATE public.contacts
      SET workspace_id=current_setting('qa.workspace_b')::uuid
      WHERE id=current_setting('qa.contact_a')::uuid;
  EXCEPTION WHEN raise_exception THEN blocked := true;
  END;
  IF NOT blocked THEN RAISE EXCEPTION 'Tenant ownership mutation unexpectedly succeeded'; END IF;
END $$;

RESET ROLE;
SET ROLE postgres;
INSERT INTO public.subscriptions(workspace_id,plan,status)
VALUES(current_setting('qa.workspace_a')::uuid,'free','free')
ON CONFLICT (workspace_id) DO NOTHING;

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',false);
SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',false);
DO $$
BEGIN
  IF (SELECT count(*) FROM public.subscriptions WHERE workspace_id=current_setting('qa.workspace_a')::uuid) <> 0 THEN
    RAISE EXCEPTION 'Non-admin member can see subscription details';
  END IF;
END $$;

DO $$
DECLARE usage_row record; i integer;
BEGIN
  FOR i IN 1..21 LOOP
    SELECT * INTO usage_row FROM public.consume_feature_usage(current_setting('qa.workspace_b')::uuid,'qa_feature',1);
    IF i <= 20 AND usage_row.allowed IS DISTINCT FROM true THEN RAISE EXCEPTION 'Free quota blocked too early at usage %', i; END IF;
    IF i = 21 AND usage_row.allowed IS DISTINCT FROM false THEN RAISE EXCEPTION 'Free quota did not block the 21st unit'; END IF;
  END LOOP;
END $$;

RESET ROLE;
SET ROLE service_role;
SELECT set_config('request.jwt.claim.role','service_role',false);
DO $$
DECLARE first_use record; retry_use record;
BEGIN
  SELECT * INTO first_use FROM public.consume_service_feature_usage(
    current_setting('qa.workspace_a')::uuid,'10000000-0000-4000-8000-000000000001','qa_campaign',1,'qa-recipient-001'
  );
  SELECT * INTO retry_use FROM public.consume_service_feature_usage(
    current_setting('qa.workspace_a')::uuid,'10000000-0000-4000-8000-000000000001','qa_campaign',1,'qa-recipient-001'
  );
  IF first_use.allowed IS DISTINCT FROM true OR retry_use.allowed IS DISTINCT FROM true OR first_use.used <> retry_use.used THEN
    RAISE EXCEPTION 'Idempotent usage retry was charged more than once';
  END IF;
END $$;

DO $$
DECLARE blocked boolean := false;
BEGIN
  BEGIN
    DELETE FROM public.workspace_members
    WHERE workspace_id=current_setting('qa.workspace_a')::uuid
      AND user_id='10000000-0000-4000-8000-000000000001';
  EXCEPTION WHEN raise_exception THEN blocked := true;
  END;
  IF NOT blocked THEN RAISE EXCEPTION 'Last owner removal unexpectedly succeeded'; END IF;
END $$;

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
  IF (metrics->>'workspaces')::integer < 2 THEN
    RAISE EXCEPTION 'Platform admin metrics returned an unexpected workspace count';
  END IF;
END $$;

ROLLBACK;
