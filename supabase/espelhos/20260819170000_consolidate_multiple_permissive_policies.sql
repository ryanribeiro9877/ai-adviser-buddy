-- Consolidate multiple permissive policies: admin FOR ALL + member SELECT
-- on the same role/action (advisor multiple_permissive_policies).
-- Pattern: one SELECT (member OR admin) TO authenticated; admin writes split
-- into INSERT/UPDATE/DELETE TO authenticated (no SELECT overlap).

-- ---------------------------------------------------------------------------
-- Helper: rewrite one (admin_all, select) pair for company-scoped tables
-- ---------------------------------------------------------------------------

-- ad_metric_snapshots
drop policy if exists ad_snap_admin_all on public.ad_metric_snapshots;
drop policy if exists ad_snap_select on public.ad_metric_snapshots;
create policy ad_snap_select on public.ad_metric_snapshots
  for select to authenticated
  using (
    is_company_member(company_id, (select auth.uid()))
    or has_role((select auth.uid()), 'admin'::app_role)
  );
create policy ad_snap_admin_insert on public.ad_metric_snapshots
  for insert to authenticated
  with check (has_role((select auth.uid()), 'admin'::app_role));
create policy ad_snap_admin_update on public.ad_metric_snapshots
  for update to authenticated
  using (has_role((select auth.uid()), 'admin'::app_role))
  with check (has_role((select auth.uid()), 'admin'::app_role));
create policy ad_snap_admin_delete on public.ad_metric_snapshots
  for delete to authenticated
  using (has_role((select auth.uid()), 'admin'::app_role));

-- ad_sets
drop policy if exists ad_sets_admin_all on public.ad_sets;
drop policy if exists ad_sets_select on public.ad_sets;
create policy ad_sets_select on public.ad_sets
  for select to authenticated
  using (
    is_company_member(company_id, (select auth.uid()))
    or has_role((select auth.uid()), 'admin'::app_role)
  );
create policy ad_sets_admin_insert on public.ad_sets
  for insert to authenticated
  with check (has_role((select auth.uid()), 'admin'::app_role));
create policy ad_sets_admin_update on public.ad_sets
  for update to authenticated
  using (has_role((select auth.uid()), 'admin'::app_role))
  with check (has_role((select auth.uid()), 'admin'::app_role));
create policy ad_sets_admin_delete on public.ad_sets
  for delete to authenticated
  using (has_role((select auth.uid()), 'admin'::app_role));

-- ads
drop policy if exists ads_admin_all on public.ads;
drop policy if exists ads_select on public.ads;
create policy ads_select on public.ads
  for select to authenticated
  using (
    is_company_member(company_id, (select auth.uid()))
    or has_role((select auth.uid()), 'admin'::app_role)
  );
create policy ads_admin_insert on public.ads
  for insert to authenticated
  with check (has_role((select auth.uid()), 'admin'::app_role));
create policy ads_admin_update on public.ads
  for update to authenticated
  using (has_role((select auth.uid()), 'admin'::app_role))
  with check (has_role((select auth.uid()), 'admin'::app_role));
create policy ads_admin_delete on public.ads
  for delete to authenticated
  using (has_role((select auth.uid()), 'admin'::app_role));

-- campaign_config_snapshots
drop policy if exists ccs_admin_all on public.campaign_config_snapshots;
drop policy if exists ccs_select_members on public.campaign_config_snapshots;
create policy ccs_select on public.campaign_config_snapshots
  for select to authenticated
  using (
    is_company_member(company_id, (select auth.uid()))
    or has_role((select auth.uid()), 'admin'::app_role)
  );
create policy ccs_admin_insert on public.campaign_config_snapshots
  for insert to authenticated
  with check (has_role((select auth.uid()), 'admin'::app_role));
create policy ccs_admin_update on public.campaign_config_snapshots
  for update to authenticated
  using (has_role((select auth.uid()), 'admin'::app_role))
  with check (has_role((select auth.uid()), 'admin'::app_role));
create policy ccs_admin_delete on public.campaign_config_snapshots
  for delete to authenticated
  using (has_role((select auth.uid()), 'admin'::app_role));

-- chat_conversations
drop policy if exists chat_conv_admin_all on public.chat_conversations;
drop policy if exists chat_conv_select on public.chat_conversations;
create policy chat_conv_select on public.chat_conversations
  for select to authenticated
  using (
    is_company_member(company_id, (select auth.uid()))
    or has_role((select auth.uid()), 'admin'::app_role)
  );
create policy chat_conv_admin_insert on public.chat_conversations
  for insert to authenticated
  with check (has_role((select auth.uid()), 'admin'::app_role));
create policy chat_conv_admin_update on public.chat_conversations
  for update to authenticated
  using (has_role((select auth.uid()), 'admin'::app_role))
  with check (has_role((select auth.uid()), 'admin'::app_role));
create policy chat_conv_admin_delete on public.chat_conversations
  for delete to authenticated
  using (has_role((select auth.uid()), 'admin'::app_role));

-- chat_messages
drop policy if exists chat_msg_admin_all on public.chat_messages;
drop policy if exists chat_msg_select on public.chat_messages;
create policy chat_msg_select on public.chat_messages
  for select to authenticated
  using (
    is_company_member(company_id, (select auth.uid()))
    or has_role((select auth.uid()), 'admin'::app_role)
  );
create policy chat_msg_admin_insert on public.chat_messages
  for insert to authenticated
  with check (has_role((select auth.uid()), 'admin'::app_role));
create policy chat_msg_admin_update on public.chat_messages
  for update to authenticated
  using (has_role((select auth.uid()), 'admin'::app_role))
  with check (has_role((select auth.uid()), 'admin'::app_role));
create policy chat_msg_admin_delete on public.chat_messages
  for delete to authenticated
  using (has_role((select auth.uid()), 'admin'::app_role));

-- infobip_dispatches
drop policy if exists infobip_admin_all on public.infobip_dispatches;
drop policy if exists infobip_select on public.infobip_dispatches;
create policy infobip_select on public.infobip_dispatches
  for select to authenticated
  using (
    is_company_member(company_id, (select auth.uid()))
    or has_role((select auth.uid()), 'admin'::app_role)
  );
create policy infobip_admin_insert on public.infobip_dispatches
  for insert to authenticated
  with check (has_role((select auth.uid()), 'admin'::app_role));
create policy infobip_admin_update on public.infobip_dispatches
  for update to authenticated
  using (has_role((select auth.uid()), 'admin'::app_role))
  with check (has_role((select auth.uid()), 'admin'::app_role));
create policy infobip_admin_delete on public.infobip_dispatches
  for delete to authenticated
  using (has_role((select auth.uid()), 'admin'::app_role));

-- proposals
drop policy if exists proposals_admin_all on public.proposals;
drop policy if exists proposals_select on public.proposals;
create policy proposals_select on public.proposals
  for select to authenticated
  using (
    is_company_member(company_id, (select auth.uid()))
    or has_role((select auth.uid()), 'admin'::app_role)
  );
create policy proposals_admin_insert on public.proposals
  for insert to authenticated
  with check (has_role((select auth.uid()), 'admin'::app_role));
create policy proposals_admin_update on public.proposals
  for update to authenticated
  using (has_role((select auth.uid()), 'admin'::app_role))
  with check (has_role((select auth.uid()), 'admin'::app_role));
create policy proposals_admin_delete on public.proposals
  for delete to authenticated
  using (has_role((select auth.uid()), 'admin'::app_role));

-- targets
drop policy if exists targets_admin_all on public.targets;
drop policy if exists targets_select on public.targets;
create policy targets_select on public.targets
  for select to authenticated
  using (
    is_company_member(company_id, (select auth.uid()))
    or has_role((select auth.uid()), 'admin'::app_role)
  );
create policy targets_admin_insert on public.targets
  for insert to authenticated
  with check (has_role((select auth.uid()), 'admin'::app_role));
create policy targets_admin_update on public.targets
  for update to authenticated
  using (has_role((select auth.uid()), 'admin'::app_role))
  with check (has_role((select auth.uid()), 'admin'::app_role));
create policy targets_admin_delete on public.targets
  for delete to authenticated
  using (has_role((select auth.uid()), 'admin'::app_role));

-- waba_analytics_daily
drop policy if exists waba_analytics_admin_all on public.waba_analytics_daily;
drop policy if exists waba_analytics_select on public.waba_analytics_daily;
create policy waba_analytics_select on public.waba_analytics_daily
  for select to authenticated
  using (
    is_company_member(company_id, (select auth.uid()))
    or has_role((select auth.uid()), 'admin'::app_role)
  );
create policy waba_analytics_admin_insert on public.waba_analytics_daily
  for insert to authenticated
  with check (has_role((select auth.uid()), 'admin'::app_role));
create policy waba_analytics_admin_update on public.waba_analytics_daily
  for update to authenticated
  using (has_role((select auth.uid()), 'admin'::app_role))
  with check (has_role((select auth.uid()), 'admin'::app_role));
create policy waba_analytics_admin_delete on public.waba_analytics_daily
  for delete to authenticated
  using (has_role((select auth.uid()), 'admin'::app_role));

-- waba_phone_numbers
drop policy if exists waba_phones_admin_all on public.waba_phone_numbers;
drop policy if exists waba_phones_select on public.waba_phone_numbers;
create policy waba_phones_select on public.waba_phone_numbers
  for select to authenticated
  using (
    is_company_member(company_id, (select auth.uid()))
    or has_role((select auth.uid()), 'admin'::app_role)
  );
create policy waba_phones_admin_insert on public.waba_phone_numbers
  for insert to authenticated
  with check (has_role((select auth.uid()), 'admin'::app_role));
create policy waba_phones_admin_update on public.waba_phone_numbers
  for update to authenticated
  using (has_role((select auth.uid()), 'admin'::app_role))
  with check (has_role((select auth.uid()), 'admin'::app_role));
create policy waba_phones_admin_delete on public.waba_phone_numbers
  for delete to authenticated
  using (has_role((select auth.uid()), 'admin'::app_role));

-- waba_phone_snapshots
drop policy if exists waba_phone_snaps_admin_all on public.waba_phone_snapshots;
drop policy if exists waba_phone_snaps_select on public.waba_phone_snapshots;
create policy waba_phone_snaps_select on public.waba_phone_snapshots
  for select to authenticated
  using (
    is_company_member(company_id, (select auth.uid()))
    or has_role((select auth.uid()), 'admin'::app_role)
  );
create policy waba_phone_snaps_admin_insert on public.waba_phone_snapshots
  for insert to authenticated
  with check (has_role((select auth.uid()), 'admin'::app_role));
create policy waba_phone_snaps_admin_update on public.waba_phone_snapshots
  for update to authenticated
  using (has_role((select auth.uid()), 'admin'::app_role))
  with check (has_role((select auth.uid()), 'admin'::app_role));
create policy waba_phone_snaps_admin_delete on public.waba_phone_snapshots
  for delete to authenticated
  using (has_role((select auth.uid()), 'admin'::app_role));

-- waba_template_analytics_daily
drop policy if exists waba_tpl_analytics_admin_all on public.waba_template_analytics_daily;
drop policy if exists waba_tpl_analytics_select on public.waba_template_analytics_daily;
create policy waba_tpl_analytics_select on public.waba_template_analytics_daily
  for select to authenticated
  using (
    is_company_member(company_id, (select auth.uid()))
    or has_role((select auth.uid()), 'admin'::app_role)
  );
create policy waba_tpl_analytics_admin_insert on public.waba_template_analytics_daily
  for insert to authenticated
  with check (has_role((select auth.uid()), 'admin'::app_role));
create policy waba_tpl_analytics_admin_update on public.waba_template_analytics_daily
  for update to authenticated
  using (has_role((select auth.uid()), 'admin'::app_role))
  with check (has_role((select auth.uid()), 'admin'::app_role));
create policy waba_tpl_analytics_admin_delete on public.waba_template_analytics_daily
  for delete to authenticated
  using (has_role((select auth.uid()), 'admin'::app_role));

-- waba_template_creations
drop policy if exists wtc_admin_all on public.waba_template_creations;
drop policy if exists wtc_select_members on public.waba_template_creations;
create policy wtc_select on public.waba_template_creations
  for select to authenticated
  using (
    is_company_member(company_id, (select auth.uid()))
    or has_role((select auth.uid()), 'admin'::app_role)
  );
create policy wtc_admin_insert on public.waba_template_creations
  for insert to authenticated
  with check (has_role((select auth.uid()), 'admin'::app_role));
create policy wtc_admin_update on public.waba_template_creations
  for update to authenticated
  using (has_role((select auth.uid()), 'admin'::app_role))
  with check (has_role((select auth.uid()), 'admin'::app_role));
create policy wtc_admin_delete on public.waba_template_creations
  for delete to authenticated
  using (has_role((select auth.uid()), 'admin'::app_role));

-- waba_templates
drop policy if exists waba_templates_admin_all on public.waba_templates;
drop policy if exists waba_templates_select on public.waba_templates;
create policy waba_templates_select on public.waba_templates
  for select to authenticated
  using (
    is_company_member(company_id, (select auth.uid()))
    or has_role((select auth.uid()), 'admin'::app_role)
  );
create policy waba_templates_admin_insert on public.waba_templates
  for insert to authenticated
  with check (has_role((select auth.uid()), 'admin'::app_role));
create policy waba_templates_admin_update on public.waba_templates
  for update to authenticated
  using (has_role((select auth.uid()), 'admin'::app_role))
  with check (has_role((select auth.uid()), 'admin'::app_role));
create policy waba_templates_admin_delete on public.waba_templates
  for delete to authenticated
  using (has_role((select auth.uid()), 'admin'::app_role));

-- wabas
drop policy if exists wabas_admin_all on public.wabas;
drop policy if exists wabas_select on public.wabas;
create policy wabas_select on public.wabas
  for select to authenticated
  using (
    is_company_member(company_id, (select auth.uid()))
    or has_role((select auth.uid()), 'admin'::app_role)
  );
create policy wabas_admin_insert on public.wabas
  for insert to authenticated
  with check (has_role((select auth.uid()), 'admin'::app_role));
create policy wabas_admin_update on public.wabas
  for update to authenticated
  using (has_role((select auth.uid()), 'admin'::app_role))
  with check (has_role((select auth.uid()), 'admin'::app_role));
create policy wabas_admin_delete on public.wabas
  for delete to authenticated
  using (has_role((select auth.uid()), 'admin'::app_role));

-- waba_template_replications (already authenticated roles)
drop policy if exists repl_admin_all on public.waba_template_replications;
drop policy if exists repl_select_members on public.waba_template_replications;
create policy repl_select on public.waba_template_replications
  for select to authenticated
  using (
    is_company_member(company_id, (select auth.uid()))
    or has_role((select auth.uid()), 'admin'::app_role)
  );
create policy repl_admin_insert on public.waba_template_replications
  for insert to authenticated
  with check (has_role((select auth.uid()), 'admin'::app_role));
create policy repl_admin_update on public.waba_template_replications
  for update to authenticated
  using (has_role((select auth.uid()), 'admin'::app_role))
  with check (has_role((select auth.uid()), 'admin'::app_role));
create policy repl_admin_delete on public.waba_template_replications
  for delete to authenticated
  using (has_role((select auth.uid()), 'admin'::app_role));

-- profiles: duplicate identical SELECT policies
drop policy if exists "users read own profile" on public.profiles;

-- user_roles: merge two SELECT policies into one
drop policy if exists "admins read all roles" on public.user_roles;
drop policy if exists "read own roles" on public.user_roles;
create policy "read own or admin roles" on public.user_roles
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or has_role((select auth.uid()), 'admin'::app_role)
  );
