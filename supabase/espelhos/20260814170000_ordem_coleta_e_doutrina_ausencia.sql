-- Auditoria COHAPM de 14/08/2026 expos dois problemas de infraestrutura e um de doutrina.
--
-- 1) ORDEM DA COLETA. rollup_metric_snapshots_from_ads promove o nivel de anuncio para o nivel
--    de campanha fazendo join com public.ads. A cron de metricas rodava as 09:00, ANTES das crons
--    de estrutura (09:12/09:17/09:22) que populam ads — entao anuncio novo nao existia em ads no
--    momento do rollup e sua linha de campanha nao era promovida. Efeito observado: nivel de
--    anuncio com 14/08 e nivel de campanha parado em 13/08, com as linhas de 11-13/08 ainda
--    rotuladas windsor:facebook em vez de pipeboard:meta. Estrutura passa a rodar antes.
--    Os nomes das crons preservam o horario antigo no sufixo; o agendamento real e o abaixo.
do $$
declare
  v record;
  v_novo text;
begin
  for v in
    select jobid, jobname from cron.job
     where jobname in ('pipeboard-structure-campaigns-0912',
                       'pipeboard-structure-adsets-0917',
                       'pipeboard-structure-ads-0922')
  loop
    v_novo := case v.jobname
      when 'pipeboard-structure-campaigns-0912' then '40 8 * * *'
      when 'pipeboard-structure-adsets-0917'    then '45 8 * * *'
      when 'pipeboard-structure-ads-0922'       then '50 8 * * *'
    end;
    perform cron.alter_job(v.jobid, schedule => v_novo);
  end loop;
end $$;

-- 2) CORRECAO DO ESTADO ATUAL. Agora que ads esta populado, promove a serie das ultimas duas
--    semanas: preenche o dia que faltava no nivel de campanha e corrige o rotulo de fonte.
select public.rollup_metric_snapshots_from_ads(current_date - 14, current_date);

-- 3) DOUTRINA. O agente tratou "COHAPM sem WABA" como pipeline quebrado e recomendou destravar
--    telemetria e escalar reconexao manual. As tabelas WABA tem centenas de linhas — nenhuma da
--    COHAPM, porque a empresa nao tem WhatsApp Business neste sistema (os destinos sao links
--    wa.me para numeros comuns). Ausencia escopada a uma empresa nao e falha de coleta.
insert into public.agent_context(categoria, fato, vigente, desde, company_id)
select
  'execucao',
  'AUSENCIA ESCOPADA NAO E FALHA DE COLETA (14/08/2026). Antes de chamar algo de "lacuna de coleta", "telemetria vazia" ou "pipeline quebrado", verifique se a tabela esta vazia NO SISTEMA ou apenas PARA ESTA EMPRESA: se ha dado de outras empresas e zero da empresa da conversa, isso e ausencia estrutural (o recurso nao existe nessa empresa) e deve ser dito assim. Vale em especial para WABA e meta_tokens: empresa sem WhatsApp Business cadastrado tem secao WABA vazia por natureza, e anuncio que aponta para link wa.me de numero comum NAO gera analitica WABA nem evento de conversa. Nesse caso e PROIBIDO recomendar "destravar telemetria", "reconectar token" ou tratar a ausencia como pre-requisito para decidir objetivo de campanha. Conversa contabilizada exige conjunto otimizando CONVERSATIONS com destination_type=WHATSAPP — a falta dela e consequencia da configuracao, nao de coleta.',
  true,
  current_date,
  null
where not exists (
  select 1 from public.agent_context
  where vigente is true and company_id is null
    and fato ilike 'AUSENCIA ESCOPADA NAO E FALHA DE COLETA%'
);

-- 4) DOUTRINA. Custo por resultado nao se recalcula dividindo gasto total pelo evento.
insert into public.agent_context(categoria, fato, vigente, desde, company_id)
select
  'metricas',
  'CUSTO POR RESULTADO TEM BASE DECLARADA (14/08/2026). get_funnel devolve por_formulario e por_conversa ja escopados ao gasto das campanhas que registraram aquele evento, e expoe esse gasto em gasto_base_do_por_formulario / gasto_base_do_por_conversa. E PROIBIDO recalcular dividindo o `gasto` total do periodo pelo numero de eventos: campanha que nem persegue o evento entra no numerador e infla a regua (na COHAPM isso transformou R$ 21,13 por conversa em R$ 31,89, uma regua 51% mais frouxa). Se get_funnel foi chamado sem data, a janela e a serie INTEIRA da empresa — nao a chame de "7 dias" nem atribua a uma campanha. Antes de usar qualquer custo por resultado como benchmark, diga QUAL campanha e QUAL periodo o sustentam.',
  true,
  current_date,
  null
where not exists (
  select 1 from public.agent_context
  where vigente is true and company_id is null
    and fato ilike 'CUSTO POR RESULTADO TEM BASE DECLARADA%'
);
