-- Validacao da 2a auditoria COHAPM (14/08): tres imprecisoes de interpretacao.
-- (a) alcance somado por dia apresentado como "total do periodo reportado pela plataforma";
-- (b) media de gasto/dia diluida pelo dia corrente parcial (R$ 61 aparente vs R$ 80 real);
-- (c) veredito de compliance mudou entre rodadas sem o texto mudar, sem citar regra, e o agente
--     declarou "sync veio sem corpo" quando as 14 legendas estavam em ads.body.
-- As pecas (a) e (b) foram corrigidas na propria ferramenta (get_campaign_detail v30: campo
-- alcance_soma_diaria_nao_deduplicada + gasto_medio_por_dia_fechado). Doutrina abaixo cobre o
-- comportamento transversal.

insert into public.agent_context(categoria, fato, vigente, desde, company_id)
select
  'metricas',
  'ALCANCE E MEDIA DIARIA TEM ROTULO OBRIGATORIO (14/08/2026). Alcance somado de serie diaria NUNCA e "alcance do periodo reportado pela plataforma" nem pessoas unicas: mesma pessoa em dois dias conta duas vezes. get_campaign_detail expoe isso como alcance_soma_diaria_nao_deduplicada - reporte com esse sentido; alcance unico do periodo so existe lendo ao vivo (ler_pipeboard, insights com time_range do periodo inteiro, sem quebra por dia), citando a fonte. MEDIA DIARIA DE GASTO para pacing/comparacao com orcamento usa APENAS dias fechados (gasto_medio_por_dia_fechado): o dia corrente e parcial e inclui-lo dilui a media e esconde estouro de verba - se citar media com o dia parcial dentro, declare isso e traga tambem a media de dias fechados.',
  true,
  current_date,
  null
where not exists (
  select 1 from public.agent_context
  where vigente is true and company_id is null
    and fato ilike 'ALCANCE E MEDIA DIARIA TEM ROTULO OBRIGATORIO%'
);

insert into public.agent_context(categoria, fato, vigente, desde, company_id)
select
  'compliance',
  'VEREDITO DE COMPLIANCE CITA REGRA E MANTEM CONSISTENCIA (14/08/2026). Todo veredito sobre legenda/peca cita o CODIGO da regra avaliada (FIN-01..FIN-04, CRI-01 - via check_compliance): "sem promessa sensivel" e impressao, nao veredito. Anuncio que cita INSS, Governo ou orgao publico DEVE ser julgado explicitamente contra a FIN-03 e o veredito deve dizer POR QUE viola ou nao viola (alegar vinculo/parceria/representacao viola; descrever o publico-alvo, como "aposentado do INSS", nao viola por si). Mudar o veredito de uma peca entre rodadas SEM o texto ter mudado exige declarar o que mudou na avaliacao - flip silencioso destroi a confianca no sistema. E NUNCA declare "corpo/legenda nao coletado" sem antes chamar get_criativos_conteudo: legendas_unicas traz o texto INTEGRAL de todos os criativos coletados.',
  true,
  current_date,
  null
where not exists (
  select 1 from public.agent_context
  where vigente is true and company_id is null
    and fato ilike 'VEREDITO DE COMPLIANCE CITA REGRA E MANTEM CONSISTENCIA%'
);
