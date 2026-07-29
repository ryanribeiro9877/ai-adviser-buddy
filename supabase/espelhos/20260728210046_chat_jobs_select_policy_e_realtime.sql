-- [SUBAGENTES - pre-requisito do front] Leitura de chat_jobs pelo usuario logado, no MESMO
-- padrao do chat_messages: SELECT por is_company_member. Escrita continua exclusiva do
-- service_role (nenhuma policy de INSERT/UPDATE/DELETE - o front nao cria nem edita job).
-- Tambem adiciona chat_jobs a publicacao Realtime para o front assinar o progresso ao vivo.

create policy chat_jobs_select on public.chat_jobs
  for select using (is_company_member(company_id, auth.uid()));

alter publication supabase_realtime add table public.chat_jobs;
