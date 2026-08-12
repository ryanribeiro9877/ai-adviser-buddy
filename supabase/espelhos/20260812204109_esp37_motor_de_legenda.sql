-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260812204109
-- name: esp37_motor_de_legenda
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

-- ESP-37: motor de legenda (framework Hook→Beneficio→CTA+CET, N=3).

insert into public.agent_knowledge
  (tema, descricao, conteudo, fonte, verificado_em, revalidar_ate, vigente)
values (
  'legenda_framework_lev',
  'Framework operacional ESP-37 para gerar legendas Meta Ads (LEV credito).',
  E'=== LEGENDA FRAMEWORK LEV (ESP-37, 12/08/2026) ===\n'
  || E'N fixo = 3. NAO publicar sozinho: so rascunhos com veredito.\n\n'
  || E'Estrutura de CADA variante (ordem obrigatoria):\n'
  || E'1) HOOK — primeira linha que para o scroll (tatica distinta por variante).\n'
  || E'2) BENEFICIO/PROVA — o que o produto entrega, sem promessa ilegal.\n'
  || E'3) CTA — acao clara (simular, falar com especialista).\n'
  || E'4) CET — mora na LEGENDA DA PUBLICACAO (FIN-04 v3). Nao invente taxa; se sem numero, '
  || E'"consulte o CET da oferta na simulacao".\n\n'
  || E'Fonte de taticas: temas criativo_hooks, criativo_mecanicas, criativo_voz.\n'
  || E'Promessas: tabela promessas_proibidas + check_compliance.\n'
  || E'Ferramenta: gerar_legendas. So apto_para_card=true entra em criar_anuncio_a_partir_de '
  || E'com legenda_fonte=agente e legenda_referencias.\n',
  'ESP-37 / doutrina operacional LEV',
  date '2026-08-12',
  date '2027-02-12',
  true
)
on conflict (tema) do update set
  descricao = excluded.descricao,
  conteudo = excluded.conteudo,
  fonte = excluded.fonte,
  verificado_em = excluded.verificado_em,
  revalidar_ate = excluded.revalidar_ate,
  vigente = true,
  updated_at = now();

update public.agent_context
   set vigente = false
 where categoria = 'doutrina'
   and vigente = true
   and fato ilike 'MOTOR DE LEGENDA%';

insert into public.agent_context (categoria, fato, vigente, desde)
values (
  'doutrina',
  'MOTOR DE LEGENDA (ESP-37, 12/08/2026). Framework A: Hook → Beneficio/prova → CTA + CET '
  || 'na legenda (FIN-04). N=3 fixo. Tool gerar_legendas (edge gerar-legendas): redator '
  || 'OpenRouter + compliance-check por variante (+ checar_par_texto_e_peca se drive_file_id). '
  || 'NAO emite card e NAO escreve na Meta. Pedido de legendas no chat CHAMA a ferramenta — '
  || 'nao improvisar texto solto. So apto_para_card=true segue para criar_anuncio_a_partir_de '
  || 'com legenda_fonte=agente e legenda_referencias. Tema agent_knowledge: legenda_framework_lev.',
  true,
  date '2026-08-12'
);
