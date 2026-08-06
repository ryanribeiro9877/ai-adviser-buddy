-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260805190120
-- name: gt15_chave_por_chamador_com_legado_vivo
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

-- GT-15 · chave por CHAMADOR, com a chave atual viva como legado.
--
-- O PROBLEMA, reenquadrado: mcp_config.api_key id=1 e uma chave unica de 64 caracteres usada
-- por get_mcp_api_key, por disparar_execucao_aprovacao (o gatilho que gasta dinheiro) e por
-- 7 crons. Ela autentica o CHAMADOR, nao a empresa - logo nao e vicio de isolamento entre
-- empresas: e RAIO DE EXPLOSAO. Uma chave vazada abre todas as edges de todas as empresas,
-- inclusive a que executa gasto. O conserto e contencao: uma chave por chamador, revogavel
-- isoladamente.
--
-- CORRECAO DA MINHA PROPRIA ORDEM: eu havia proposto "migrar os crons um a um e depois
-- revogar a legada". Errado na sequencia. As edges validam contra mcp_config.api_key; um cron
-- apontado para chave nova receberia 401 ANTES de a edge saber da tabela nova, e a falha seria
-- silenciosa (o cron marca succeeded so por enfileirar). Portanto:
--   1. esta migracao: tabela, legado vivo, chaves por chamador, validador e prontidao;
--   2. Code: as edges passam a validar por mcp_key_valida(), que JA aceita a legada;
--   3. so entao cada cron troca de chave, um por vez, com prova;
--   4. revogar a legada SO quando a prontidao mostrar que ninguem mais a usa.
-- Nenhum cron foi trocado aqui. Nada muda de comportamento hoje.

create table if not exists public.mcp_api_keys (
  id uuid primary key default gen_random_uuid(),
  chamador text not null unique,
  api_key text not null unique,
  ativa boolean not null default true,
  observacao text,
  criada_em timestamptz not null default now(),
  ultima_utilizacao_em timestamptz,
  utilizacoes bigint not null default 0,
  revogada_em timestamptz
);

comment on table public.mcp_api_keys is
  'GT-15: uma chave por chamador, revogavel isoladamente. A linha "legado" carrega a chave historica de mcp_config id=1 e continua valida enquanto os chamadores migram. Revogar a legada exige evidencia de desuso - ver mcp_keys_prontidao().';
comment on column public.mcp_api_keys.ultima_utilizacao_em is
  'Preenchido pelo validador. E a EVIDENCIA que autoriza revogar a legada: revoga-se por medicao, nunca por crenca.';

alter table public.mcp_api_keys enable row level security;
-- Sem policy nenhuma de proposito: so service_role le. Tabela de segredo nao se expoe a
-- authenticated, e por isso o validador e SECURITY DEFINER.

-- 1) o legado, com a chave que esta em uso hoje
insert into public.mcp_api_keys (chamador, api_key, observacao)
select 'legado:mcp_config-id1', m.api_key,
       'Chave historica unica. Aceita durante a transicao. Revogar somente quando mcp_keys_prontidao() mostrar zero uso.'
from public.mcp_config m where m.id = 1
on conflict (chamador) do nothing;

-- 2) uma chave por chamador conhecido (7 crons + o gatilho de aprovacao)
insert into public.mcp_api_keys (chamador, api_key, observacao)
select v.chamador,
       encode(sha256((gen_random_uuid()::text || clock_timestamp()::text || v.chamador)::bytea), 'hex'),
       'Gerada em 05/08/2026 pelo GT-15. NAO em uso ainda: aguarda as edges validarem por mcp_key_valida().'
from (values
  ('cron:windsor-sync-daily'),
  ('cron:windsor-wide-adsets-weekly'),
  ('cron:windsor-wide-ads-weekly'),
  ('cron:meta-campaign-status-0910'),
  ('cron:waba-sync-daily'),
  ('cron:bm-monitor-0920'),
  ('cron:drive-watch-0845'),
  ('trigger:disparar_execucao_aprovacao')
) as v(chamador)
on conflict (chamador) do nothing;

-- 3) o validador que as edges vao chamar. VOLATILE de proposito: ele grava a evidencia de uso,
--    e e essa evidencia que decide quando a legada pode morrer.
create or replace function public.mcp_key_valida(p_chave text)
returns jsonb
language plpgsql
volatile
security definer
set search_path to 'public'
as $$
declare
  r record;
begin
  if p_chave is null or length(p_chave) < 16 then
    return jsonb_build_object('valida', false, 'motivo', 'chave_ausente_ou_curta');
  end if;

  select * into r from public.mcp_api_keys
   where api_key = p_chave and ativa and revogada_em is null;

  if r is null then
    return jsonb_build_object('valida', false, 'motivo', 'chave_desconhecida_ou_revogada');
  end if;

  update public.mcp_api_keys
     set ultima_utilizacao_em = now(), utilizacoes = utilizacoes + 1
   where id = r.id;

  return jsonb_build_object(
    'valida', true,
    'chamador', r.chamador,
    'legado', (r.chamador like 'legado:%'),
    'aviso', case when r.chamador like 'legado:%'
      then 'Autenticado pela chave LEGADA, compartilhada por todos os chamadores. Vale enquanto a transicao do GT-15 nao terminar.' end
  );
end;
$$;

revoke all on function public.mcp_key_valida(text) from public;
revoke all on function public.mcp_key_valida(text) from anon;
revoke all on function public.mcp_key_valida(text) from authenticated;

comment on function public.mcp_key_valida(text) is
  'GT-15: valida chave de chamador e REGISTRA o uso. Aceita a legada. Execucao restrita a service_role - nao e exposta a authenticated para nao permitir sondagem de chave.';

-- 4) getter por chamador. Assinatura NOVA, sem default: nao cria ambiguidade com
--    get_mcp_api_key() de zero argumentos, que segue intacta para nao mexer nos crons.
create or replace function public.get_mcp_api_key(p_chamador text)
returns text
language sql
stable
security definer
set search_path to 'public'
as $$
  select api_key from public.mcp_api_keys
   where chamador = p_chamador and ativa and revogada_em is null;
$$;

revoke all on function public.get_mcp_api_key(text) from public;
revoke all on function public.get_mcp_api_key(text) from anon;
revoke all on function public.get_mcp_api_key(text) from authenticated;

-- 5) o portao da revogacao: quem ainda depende da legada
create or replace function public.mcp_keys_prontidao()
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  select jsonb_build_object(
    'chaves', (select jsonb_agg(jsonb_build_object(
        'chamador', chamador, 'ativa', ativa,
        'usos', utilizacoes, 'ultimo_uso', ultima_utilizacao_em,
        'revogada_em', revogada_em) order by chamador)
      from public.mcp_api_keys),
    'legado_ainda_usado', (select coalesce(bool_or(utilizacoes > 0), false)
      from public.mcp_api_keys where chamador like 'legado:%'),
    'pode_revogar_legado', (select coalesce(
      (select utilizacoes = 0 from public.mcp_api_keys where chamador like 'legado:%' limit 1), false)),
    'veredito', case
      when (select coalesce((select utilizacoes from public.mcp_api_keys where chamador like 'legado:%' limit 1), 0)) > 0
        then 'A legada AINDA e usada. Nao revogar. A contagem so comeca quando as edges passarem a validar por mcp_key_valida() - antes disso zero uso significa NAO MEDIDO, nao desuso.'
      else 'Zero uso registrado na legada. Antes de revogar, confirmar que as edges JA validam por mcp_key_valida(); senao este zero e ignorancia, nao evidencia.' end
  );
$$;