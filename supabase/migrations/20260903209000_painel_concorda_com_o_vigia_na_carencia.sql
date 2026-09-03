-- O painel para de chamar de atrasada a tarefa que ainda nao teve a primeira rodada.
--
-- Sintoma: a tela abriu com 19 tarefas em vermelho como "atrasadas" enquanto o vigia,
-- rodando sobre os mesmos dados, emitiu ZERO alerta e devolveu sucesso_vazio.
--
-- Causa: `vigiar_tarefas_agendadas` ja tinha carencia -- tarefa sem nenhuma rodada boa
-- cujo cadastro e mais novo que a propria tolerancia e pulada, porque ainda nao deu tempo
-- de ela dever ter rodado. `painel_tarefas_agendadas` nao tinha essa regra e marcava
-- `atrasada` sempre que `ultimo_ok is null`. As 19 sao as tarefas diarias de manha, e o
-- registro entrou no ar de tarde: elas nao estao atrasadas, estao esperando a vez.
--
-- Por que isso importa mais do que parece: as duas superficies discordarem e pior que
-- qualquer uma das duas estar errada. O gestor abriria a tela com 19 alarmes vermelhos,
-- nao encontraria alerta nenhum correspondente, e a partir dai nao acreditaria em
-- nenhuma das duas. Painel de saude que grita no primeiro dia sem motivo ensina o
-- usuario a ignorar o painel -- que e exatamente a doenca que esta entrega existe para
-- curar.
--
-- Conserto: o painel passa a usar a MESMA regra do vigia e ganha um terceiro estado
-- explicito, `aguardando_primeira`. "Nunca rodou e ja passou da hora" e problema;
-- "nunca rodou e a hora nao chegou" e informacao. Continuam sendo estados diferentes,
-- e agora a tela consegue dizer qual e qual em vez de pintar os dois de vermelho.
--
-- A funcao e derrubada e recriada porque o RETURNS TABLE muda: create or replace nao
-- aceita alteracao na lista de colunas de retorno.

drop function if exists public.painel_tarefas_agendadas();

create or replace function public.painel_tarefas_agendadas()
returns table(
  tarefa text, titulo text, pergunta text, periodicidade text, tolerancia_horas integer,
  tipo text, empresa text, ultima_em timestamp with time zone, desfecho text,
  duracao_ms integer, itens_processados integer, achados integer, mensagem_erro text,
  horas_desde_ok numeric, atrasada boolean, aguardando_primeira boolean,
  rodadas_7d integer, falhas_7d integer, agendada_no_cron boolean)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select t.tarefa,
         t.titulo,
         t.pergunta,
         t.periodicidade,
         t.tolerancia_horas,
         t.tipo,
         co.name as empresa,
         u.iniciado_em as ultima_em,
         u.desfecho,
         u.duracao_ms,
         u.itens_processados,
         u.achados,
         u.mensagem_erro,
         round(extract(epoch from (now() - ok.ultimo_ok)) / 3600.0, 1) as horas_desde_ok,
         -- Mesma regra do vigia: sem rodada boa, o relogio conta do cadastro, nao do
         -- inicio dos tempos.
         (case
            when ok.ultimo_ok is null
              then t.criado_em < now() - (t.tolerancia_horas * interval '1 hour')
            else ok.ultimo_ok < now() - (t.tolerancia_horas * interval '1 hour')
          end) as atrasada,
         (ok.ultimo_ok is null
            and t.criado_em >= now() - (t.tolerancia_horas * interval '1 hour')) as aguardando_primeira,
         coalesce(j.rodadas_7d, 0)::integer as rodadas_7d,
         coalesce(j.falhas_7d, 0)::integer as falhas_7d,
         exists (select 1 from cron.job c
                  where c.active and c.command like '%' || t.tarefa || '%') as agendada_no_cron
    from public.tarefas_agendadas t
    left join public.companies co on co.id = t.company_id
    left join lateral (
      select e.iniciado_em, e.desfecho, e.duracao_ms, e.itens_processados, e.achados, e.mensagem_erro
        from public.execucoes_agendadas e
       where e.tarefa = t.tarefa
       order by e.iniciado_em desc
       limit 1
    ) u on true
    left join lateral (
      select max(e.iniciado_em) as ultimo_ok
        from public.execucoes_agendadas e
       where e.tarefa = t.tarefa and e.desfecho in ('sucesso','sucesso_vazio')
    ) ok on true
    left join lateral (
      select count(*)::int as rodadas_7d,
             count(*) filter (where e.desfecho = 'falha')::int as falhas_7d
        from public.execucoes_agendadas e
       where e.tarefa = t.tarefa and e.iniciado_em > now() - interval '7 days'
    ) j on true
   where t.ativa
   order by
     (case
        when ok.ultimo_ok is null
          then t.criado_em < now() - (t.tolerancia_horas * interval '1 hour')
        else ok.ultimo_ok < now() - (t.tolerancia_horas * interval '1 hour')
      end) desc,
     u.desfecho = 'falha' desc nulls last,
     t.titulo
$function$;

revoke all on function public.painel_tarefas_agendadas() from public, anon;
grant execute on function public.painel_tarefas_agendadas() to authenticated, service_role;
