-- Doutrina: leitura hibrida Pipeboard (DB primeiro, live quando faltar).
insert into public.agent_context(categoria, fato, vigente, desde, company_id)
select
  'execucao',
  'LEITURA HIBRIDA PIPEBOARD (14/08/2026). Sync diario (pipeboard-structure-sync + pipeboard-metrics-sync) e a fonte oficial historica no banco: use get_overview, get_campaign_detail, get_estrutura_conjuntos, get_criativos_conteudo, funil e ranking quando bastarem. Para QUALQUER dado Meta que o Pipeboard expoe e o DB ainda nao tem (breakdown, activities, pages, pixels, audiences, insights pontuais, config fresca do dia, lead forms, catalogs, Instagram, etc.), chame listar_ferramentas_pipeboard e ler_pipeboard — NUNCA diga que saiu de escopo ou que falta tool se existir get_/list_/search_ no catalogo. ler_pipeboard e SOMENTE leitura e fica preso as contas meta_ads da empresa da conversa. Escrita continua so via propose_action / meta-actions com card de aprovacao.',
  true,
  current_date,
  null
where not exists (
  select 1 from public.agent_context
  where vigente is true and company_id is null
    and fato ilike 'LEITURA HIBRIDA PIPEBOARD%'
);
