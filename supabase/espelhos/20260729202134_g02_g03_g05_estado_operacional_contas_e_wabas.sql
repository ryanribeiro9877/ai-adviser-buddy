-- [G-02 / G-03 / G-05] Estado operacional por CONTA e por WABA.
--
-- MOTIVO (auditoria de 29/07/2026, verificada no banco):
--  (a) Das 20 integracoes meta_ads, 17 NUNCA tiveram campanha, gasto ou sincronizacao -
--      15 delas nomeadas "(Read-Only)" espelhando nomes de WABAs e atendentes. Tratar as 20
--      como contas operaveis infla o mapa sobre o qual as travas e a doutrina operam.
--      Apenas 3 tem historico e apenas 1 (3302001729967572) tem gasto recente.
--  (b) Nao existia estado POR CONTA, so por empresa. Conta com historico de restricao seria
--      tratada como igual as outras da mesma empresa quando a flag da empresa ligasse.
--      'quarentena' resolve isso: e um gate ADICIONAL, avaliado antes e independente da flag
--      de empresa - por construcao, quarentena vence flag ligada.
--  (c) As 7 WABAs "sem acesso" sao cascas legadas pos-migracao de numero (esclarecido 29/07).
--      Elas ainda carregam 9 templates e 7 linhas de numero obsoletas, que inflavam inventario
--      e consumiam cota de template por WABA.
--
-- NAO reutilizei a coluna integrations.status (usada como saude de conexao por outros
-- consumidores): estado operacional e uma dimensao distinta e ganha coluna propria.

alter table public.integrations
  add column if not exists estado_operacional text not null default 'ativa',
  add column if not exists estado_motivo text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'chk_integrations_estado_operacional') then
    alter table public.integrations
      add constraint chk_integrations_estado_operacional
      check (estado_operacional in ('ativa','nao_operacional','quarentena'));
  end if;
end $$;

comment on column public.integrations.estado_operacional is
  'ativa = conta operavel. nao_operacional = existe no cadastro mas nunca operou (sem campanha, gasto ou sync) - invisivel para analise e inelegivel a acao. quarentena = conta com historico de restricao ou risco: SOMENTE LEITURA, vence flag de empresa ligada.';

update public.integrations i
   set estado_operacional = 'nao_operacional',
       estado_motivo = 'Auditoria 29/07/2026: nenhuma campanha, nenhum gasto e nenhuma sincronizacao registrada. Muitas sao contas de acesso somente leitura espelhando nomes de ativos de WhatsApp. Reclassificar para ativa somente com atribuicao declarada por humano.'
 where i.provider = 'meta_ads'
   and i.estado_operacional = 'ativa'
   and not exists (select 1 from public.campaigns k where k.external_account_id = i.external_id);

alter table public.wabas
  add column if not exists estado_local text not null default 'ativa';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'chk_wabas_estado_local') then
    alter table public.wabas
      add constraint chk_wabas_estado_local
      check (estado_local in ('ativa','legada'));
  end if;
end $$;

comment on column public.wabas.estado_local is
  'ativa = conta de WhatsApp vigente no portfolio. legada = casca remanescente de antes da migracao de numero: nao e listada pela API, nao tem numero legivel, e seu conteudo (templates e linhas de numero) NAO deve contar em inventario, cota ou analise.';

update public.wabas w
   set estado_local = 'legada'
 where w.estado_local = 'ativa'
   and w.name ~* 'Atendimento1|Lily Atendente|Mary Atendente|Rafa Atendente|Rosa Atendente|Blip3|Atendente Lucy'
   and not exists (
     select 1 from public.waba_phone_numbers p
      where p.waba_external_id = w.external_id and p.platform_type = 'CLOUD_API');

create or replace function public.conta_elegivel_para_acao(p_external_account_id text)
returns jsonb
language sql
stable
security invoker
as $$
  select coalesce(
    (select jsonb_build_object(
       'elegivel', i.estado_operacional = 'ativa',
       'estado', i.estado_operacional,
       'empresa', c.name,
       'conta', i.account_name,
       'motivo', case
         when i.estado_operacional = 'quarentena'
           then 'Conta em QUARENTENA: somente leitura. A quarentena da conta vence a flag de execucao da empresa - nenhuma acao de escrita e proposta aqui. ' || coalesce(i.estado_motivo,'')
         when i.estado_operacional = 'nao_operacional'
           then 'Conta NAO OPERACIONAL: nunca teve campanha, gasto ou sync. ' || coalesce(i.estado_motivo,'')
         else null end)
     from public.integrations i
     join public.companies c on c.id = i.company_id
     where i.external_id = p_external_account_id and i.provider = 'meta_ads'
     limit 1),
    jsonb_build_object('elegivel', false, 'estado', 'desconhecida',
      'motivo', 'Conta nao cadastrada em nenhuma empresa. Conta sem dono declarado nao existe para o agente e nao recebe acao.'));
$$;

revoke all on function public.conta_elegivel_para_acao(text) from public, anon;
grant execute on function public.conta_elegivel_para_acao(text) to authenticated, service_role;

comment on function public.conta_elegivel_para_acao(text) is
  'Gate por CONTA, independente e anterior a flag de execucao por empresa. Responde se a conta pode receber acao de escrita e por que nao, quando for o caso. Conta desconhecida = inelegivel (deny por padrao).';
