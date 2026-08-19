-- Exhaustive validation follow-up: covering indexes for FKs flagged by
-- get_advisors(performance) unindexed_foreign_keys (34 items).

create index if not exists ad_sets_campaign_id_idx on public.ad_sets (campaign_id);
create index if not exists ad_sets_criado_por_approval_id_idx on public.ad_sets (criado_por_approval_id);
create index if not exists ads_campaign_id_idx on public.ads (campaign_id);
create index if not exists ads_criado_por_approval_id_idx on public.ads (criado_por_approval_id);
create index if not exists alert_rules_created_by_idx on public.alert_rules (created_by);
create index if not exists alerts_campaign_id_idx on public.alerts (campaign_id);
create index if not exists alerts_company_id_idx on public.alerts (company_id);
create index if not exists alerts_rule_id_idx on public.alerts (rule_id);
create index if not exists approval_requests_requested_by_idx on public.approval_requests (requested_by);
create index if not exists approval_requests_reviewed_by_idx on public.approval_requests (reviewed_by);
create index if not exists audit_log_company_id_idx on public.audit_log (company_id);
create index if not exists audit_log_user_id_idx on public.audit_log (user_id);
create index if not exists campaigns_criado_por_approval_id_idx on public.campaigns (criado_por_approval_id);
create index if not exists chat_conversations_company_id_idx on public.chat_conversations (company_id);
create index if not exists chat_jobs_company_id_idx on public.chat_jobs (company_id);
create index if not exists chat_messages_company_id_idx on public.chat_messages (company_id);
create index if not exists companies_created_by_idx on public.companies (created_by);
create index if not exists company_members_user_id_idx on public.company_members (user_id);
create index if not exists drive_midia_analises_company_id_idx on public.drive_midia_analises (company_id);
create index if not exists integrations_company_id_idx on public.integrations (company_id);
create index if not exists media_uploads_company_id_idx on public.media_uploads (company_id);
create index if not exists meta_ad_accounts_company_id_idx on public.meta_ad_accounts (company_id);
create index if not exists meta_business_managers_company_id_idx on public.meta_business_managers (company_id);
create index if not exists meta_tokens_company_id_idx on public.meta_tokens (company_id);
create index if not exists proposals_import_company_id_idx on public.proposals_import (company_id);
create index if not exists targets_campaign_id_idx on public.targets (campaign_id);
create index if not exists waba_analytics_daily_company_id_idx on public.waba_analytics_daily (company_id);
create index if not exists waba_phone_numbers_company_id_idx on public.waba_phone_numbers (company_id);
create index if not exists waba_phone_snapshots_company_id_idx on public.waba_phone_snapshots (company_id);
create index if not exists waba_template_analytics_daily_company_id_idx on public.waba_template_analytics_daily (company_id);
create index if not exists waba_template_replications_company_id_idx on public.waba_template_replications (company_id);
create index if not exists waba_templates_company_id_idx on public.waba_templates (company_id);
create index if not exists wabas_company_id_idx on public.wabas (company_id);
