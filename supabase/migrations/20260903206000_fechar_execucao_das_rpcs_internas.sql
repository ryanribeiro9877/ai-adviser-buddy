-- ============================================================================
-- Fechar quem pode executar as rotinas internas
-- ============================================================================
-- Falha encontrada ao conferir os privilegios depois de criar as funcoes: o papel `anon`
-- (a chave publicavel do frontend, que qualquer visitante carrega) tinha EXECUTE em TODAS
-- as funcoes novas. O motivo e o padrao do Postgres: funcao nasce com EXECUTE concedido a
-- PUBLIC, e o `revoke ... from anon, authenticated` das migrations anteriores nao remove a
-- concessao a PUBLIC — anon continua herdando por ela.
--
-- Consequencia concreta, se ficasse assim: com apenas a chave anonima daria para
--   - disparar_tarefa_http(...)  -> chamar edges a vontade, gastando cota de API da Meta;
--   - rodar_tarefa_sql(...)      -> rodar rotina de producao fora de hora;
--   - emitir_alerta(...)         -> inventar alerta falso na tela do gestor.
-- E o cheque de admin de reexecutar_tarefa era contornavel: bastava chamar
-- disparar_tarefa_http direto, sem passar por ele.
--
-- Regra aplicada aqui: tudo que EXECUTA ou ESCREVE fica so no service_role. Ao frontend
-- sobram exatamente duas: o painel (leitura) e a reexecucao manual (que ja valida admin
-- por dentro). pg_cron nao e afetado — os jobs rodam como dono do banco, nao como anon.
-- ============================================================================

-- Revogacao ampla: inclui PUBLIC, que era justamente o furo.
do $mig$
declare
  v_f record;
begin
  for v_f in
    select p.oid::regprocedure as assinatura, p.proname
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in (
         -- registro de execucao
         'abrir_execucao', 'fechar_execucao', 'rodar_tarefa_sql', 'disparar_tarefa_http',
         'conferir_execucoes_http', 'vigiar_tarefas_agendadas',
         -- emissao e resolucao de alerta
         'emitir_alerta', 'resolver_alertas_da_tarefa',
         -- auxiliares internos
         'contar_destino', 'janela_de_frescor', 'url_functions', 'empresa_principal',
         'linha_de_produto_do_nome', 'rotulo_severidade',
         'contar_no_corpo', 'itens_no_corpo', 'achados_no_corpo',
         'reais', 'numero_br',
         -- superficie do frontend
         'painel_tarefas_agendadas', 'reexecutar_tarefa'
       )
  loop
    execute format('revoke all on function %s from public, anon, authenticated', v_f.assinatura);
    execute format('grant execute on function %s to service_role', v_f.assinatura);
  end loop;
end
$mig$;

-- As duas unicas que o frontend precisa chamar.
-- painel: leitura da saude das tarefas. Nao escreve nada.
-- reexecutar_tarefa: valida has_role(admin) na primeira linha do corpo, e agora e o UNICO
-- caminho pelo qual um usuario logado consegue provocar uma rodada.
grant execute on function public.painel_tarefas_agendadas() to authenticated;
grant execute on function public.reexecutar_tarefa(text)    to authenticated;

-- evaluate_alerts ja era chamada pelo frontend (botao de reavaliar em /metas), entao
-- authenticated continua podendo. Anon e PUBLIC, nao.
revoke all on function public.evaluate_alerts() from public, anon;
grant execute on function public.evaluate_alerts() to authenticated, service_role;
