-- [FIX] Bug meu, achado pelo Claude Code na revisao do front (30/07/2026).
--
-- O QUE ESTAVA ERRADO: a versao anterior comparava status::text = 'pendente'. Os rotulos
-- reais do enum approval_status sao {pending, approved, rejected} (ingles, e o default da
-- coluna e 'pending'). Resultado: aprovacoes_pendentes era ESTRUTURALMENTE zero - nenhum
-- pedido entrava no sino, no badge ou no aviso. Nao apareceu na validacao porque os 7
-- pedidos existentes estavam todos approved/rejected: nao havia pendente para revelar.
--
-- COMO EU DEVERIA TER PEGADO: a consulta que fiz ANTES de escrever a funcao devolveu
-- {approved: 6, rejected: 1} - os rotulos em ingles estavam na minha frente. Inferi
-- 'pendente' por analogia com o resto do schema em portugues, em vez de ler o que o dado
-- mostrava.
--
-- CORRECAO ESTRUTURAL, nao so a palavra: comparo agora contra o ENUM, nao contra texto.
-- Com ::text, rotulo errado devolve ZERO EM SILENCIO. Com o tipo, rotulo errado levanta
-- "invalid input value for enum" na hora de criar a funcao. A comparacao passa a falhar
-- ruidosamente, que e o unico jeito de essa classe de erro nao se repetir.
--
-- VERIFICADO NA MESMA RODADA (para nao deixar o mesmo erro em outro lugar):
--   decide_approval e expire_stale_approvals usam 'pending' CORRETO.
--   post_daily_report contem a palavra 'pendente', mas como TEXTO DE EXIBICAO
--   ("nada pendente de decisao"), nao como comparacao de enum - falso positivo do grep.

create or replace function public.get_notificacoes_pendentes(p_company_id uuid)
returns jsonb
language sql
stable
security invoker
as $$
  with ap as (
    select id, 'aprovacao' as tipo, action as titulo, summary as descricao,
           case
             when expires_at is not null and expires_at <= now() + interval '2 hours' then 'critical'
             when expires_at is not null and expires_at <= now() + interval '6 hours' then 'high'
             else 'medium'
           end as urgencia,
           created_at, expires_at,
           case when expires_at is null then null
                else greatest(0, floor(extract(epoch from (expires_at - now())) / 60)::int) end as minutos_para_expirar,
           conversation_id
    from approval_requests
    where company_id = p_company_id
      and status = 'pending'::approval_status   -- comparacao TIPADA: rotulo errado = erro, nao zero
  ),
  al as (
    select id, 'alerta' as tipo, title as titulo, description as descricao,
           severity::text as urgencia, created_at,
           null::timestamptz as expires_at, null::int as minutos_para_expirar,
           null::uuid as conversation_id
    from alerts
    where company_id = p_company_id and resolved = false
  ),
  tudo as (select * from ap union all select * from al)
  select jsonb_build_object(
    'total', (select count(*) from tudo),
    'aprovacoes_pendentes', (select count(*) from ap),
    'alertas_abertos', (select count(*) from al),
    'criticos', (select count(*) from tudo where urgencia in ('critical','high')),
    'expirando_em_2h', (select count(*) from ap where minutos_para_expirar is not null and minutos_para_expirar <= 120),
    'itens', (select coalesce(jsonb_agg(to_jsonb(t) order by
                 case t.urgencia when 'critical' then 1 when 'high' then 2 when 'medium' then 3 else 4 end,
                 t.created_at desc), '[]'::jsonb)
              from (select * from tudo limit 50) t)
  );
$$;

revoke all on function public.get_notificacoes_pendentes(uuid) from public, anon;
grant execute on function public.get_notificacoes_pendentes(uuid) to authenticated, service_role;

comment on function public.get_notificacoes_pendentes(uuid) is
  'Pendencias da empresa para o sino: aprovacoes com status pending + alertas nao resolvidos, com urgencia derivada (aprovacao perto de expirar sobe para high/critical) e minutos restantes. Fonte unica do badge e da lista. security invoker: RLS vale. Comparacao de status TIPADA contra approval_status de proposito - rotulo errado deve falhar alto, nao devolver zero.';
