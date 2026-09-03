-- Regra que nao tem como disparar passa a se denunciar em vez de parecer "nada a relatar".
--
-- Achado do diagnostico, e o mais grave dos que sobraram: as seis campanhas ativas do
-- sistema estao TODAS com `category` nula. As regras de custo por resultado exigem
-- `coalesce(c.category,'') in ('leadgen','mensagem')`, entao para essas seis elas nao
-- avaliam nada -- nunca. Nao por falta de gasto ruim, por falta do dado que classifica a
-- campanha.
--
-- O efeito e pior que um alerta errado. `evaluate_alerts` roda, conclui sem erro e grava
-- 'sucesso_vazio', que na tela le-se "rodou, nada a fazer". Mas "nada a fazer" e "nao
-- tenho como olhar" sao coisas diferentes, e a segunda estava se disfarcando da primeira.
-- E exatamente a queixa do gestor num nivel mais fundo: nao e a cron que esta parada, e a
-- REGRA que esta estruturalmente morta, e ninguem tinha como saber.
--
-- Um vigia de tarefa nao pega isso, porque a tarefa esta saudavel. Quem pega e um vigia
-- de COBERTURA: em vez de perguntar "a rotina rodou?", pergunta "a rotina tinha como
-- responder?". Se a resposta e nao, isso vira alerta com nome, numero e acao.
--
-- Severidade alta e nao critica de proposito: nao ha dinheiro sendo perdido por causa
-- disto neste instante, mas o sistema esta cego para o principal indicador que ele
-- promete vigiar, e cegueira silenciosa e o que esta entrega existe para acabar.

create or replace function public.vigiar_cobertura_das_regras()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_c        record;
  v_lacunas  int := 0;
  v_alertas  int := 0;
  v_exemplos text;
  v_linhas   text;
begin
  for v_c in
    select c.company_id,
           count(*)::int as sem_categoria,
           (select count(*)::int from public.campaigns x
             where x.company_id = c.company_id and x.status = 'active') as ativas
      from public.campaigns c
     where c.status = 'active'
       and coalesce(c.category, '') not in ('leadgen', 'mensagem')
     group by c.company_id
  loop
    v_lacunas := v_lacunas + 1;

    -- Nome legivel, nao id: o gestor precisa saber QUAL campanha abrir.
    select string_agg(nome, '; ' order by nome) into v_exemplos
      from (select c2.name as nome
              from public.campaigns c2
             where c2.company_id = v_c.company_id
               and c2.status = 'active'
               and coalesce(c2.category, '') not in ('leadgen', 'mensagem')
             order by c2.name
             limit 5) amostra;

    -- As marcas dividem company_id, entao a linha sai do nome da campanha.
    select string_agg(distinct linha, ', ') into v_linhas
      from (select public.linha_de_produto_do_nome(c3.name) as linha
              from public.campaigns c3
             where c3.company_id = v_c.company_id
               and c3.status = 'active'
               and coalesce(c3.category, '') not in ('leadgen', 'mensagem')) l
     where linha is not null;

    perform public.emitir_alerta(
      p_company_id    => v_c.company_id,
      p_severidade    => 'high'::alert_severity,
      p_titulo        => 'O sistema nao consegue avaliar o custo por resultado',
      p_o_que         => format('%s de %s campanhas ativas estao sem a classificacao de objetivo (formulario ou mensagem). Sem ela o sistema nao sabe o que contar como resultado, entao as regras de custo por lead e de custo por conversa nao avaliam essas campanhas -- e o silencio delas parece "nada a relatar" quando na verdade e "nao tenho como olhar".',
                                v_c.sem_categoria, v_c.ativas),
      p_onde          => case when v_c.sem_categoria <= 5 then v_exemplos
                              else v_exemplos || ' (e outras ' || (v_c.sem_categoria - 5) || ')' end,
      p_quanto        => v_c.sem_categoria || ' de ' || v_c.ativas || ' campanhas ativas sem classificacao',
      p_acao          => 'Classificar cada campanha como formulario (leadgen) ou mensagem. Enquanto isso nao for feito, nao confie na ausencia de alerta de custo: ela nao significa que o custo esta bom.',
      p_janela        => 'estado atual das campanhas ativas',
      p_tarefa        => 'cobertura-das-regras',
      p_linha_produto => coalesce(v_linhas, 'linha nao identificada pelo nome da campanha'),
      p_chave_dedupe  => 'cobertura_categoria:' || v_c.company_id,
      p_valor         => v_c.sem_categoria);

    v_alertas := v_alertas + 1;
  end loop;

  -- Empresa que resolveu a lacuna tem o alerta encerrado, nao apagado.
  update public.alerts a
     set resolved = true
   where a.resolved = false
     and a.tarefa = 'cobertura-das-regras'
     and not exists (
       select 1 from public.campaigns c
        where c.company_id = a.company_id
          and c.status = 'active'
          and coalesce(c.category, '') not in ('leadgen', 'mensagem'));

  return jsonb_build_object(
    'verificado_em', now(),
    'empresas_com_lacuna', v_lacunas,
    'alertas_emitidos', v_alertas);
end
$function$;

revoke all on function public.vigiar_cobertura_das_regras() from public, anon, authenticated;
grant execute on function public.vigiar_cobertura_das_regras() to service_role;

insert into public.tarefas_agendadas
  (tarefa, titulo, pergunta, tipo, funcao_sql, periodicidade, tolerancia_horas,
   tabela_destino, coluna_carimbo)
values
  ('cobertura-das-regras',
   'Cobertura das regras de alerta',
   'Existe regra de alerta que nao tem como disparar porque falta o dado de entrada?',
   'sql', 'vigiar_cobertura_das_regras', 'diaria', 30, 'alerts', 'created_at')
on conflict (tarefa) do update
   set titulo           = excluded.titulo,
       pergunta         = excluded.pergunta,
       funcao_sql       = excluded.funcao_sql,
       periodicidade    = excluded.periodicidade,
       tolerancia_horas = excluded.tolerancia_horas,
       tabela_destino   = excluded.tabela_destino,
       coluna_carimbo   = excluded.coluna_carimbo,
       ativa            = true;

-- Roda antes da avaliacao de midia das 9:15: se a cobertura estiver furada, o alerta de
-- cobertura chega junto com o silencio que ele explica, e nao depois dele.
select cron.schedule('cobertura-regras-0905', '5 9 * * *',
  $cmd$ select public.rodar_tarefa_sql('cobertura-das-regras'); $cmd$);
