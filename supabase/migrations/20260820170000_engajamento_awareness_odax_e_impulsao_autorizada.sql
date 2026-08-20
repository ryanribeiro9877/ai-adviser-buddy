-- name: engajamento_awareness_odax_e_impulsao_autorizada
-- data: 2026-08-20
-- efeito:
--   (1) contrato criar_campanha.objetivo documenta ODAX social + sinonimos
--   (2) contrato criar_conjunto: campos opcionais familia_objetivo / page_id / optimization_goal
--   (3) agent_context: excecao IMPULSAO brand boost autorizada pelo gestor (Legal e Viver)

update public.contrato_de_execucao
   set observacao =
         'ODAX Meta: OUTCOME_LEADS|SALES|TRAFFIC|ENGAGEMENT|AWARENESS|APP_PROMOTION. '
      || 'Sinonimos: ENGAJAMENTO/ENGAGEMENT/POST_ENGAGEMENT -> OUTCOME_ENGAGEMENT; '
      || 'RECONHECIMENTO/AWARENESS/REACH -> OUTCOME_AWARENESS; LEADS -> OUTCOME_LEADS. '
      || 'Se omitir objetivo, o emissor deriva de objetivo_tag. Brand boost = ENGAGEMENT + canal SOCIAL (Page/IG), nao LP.',
       valores_aceitos = array[
         'OUTCOME_LEADS','OUTCOME_SALES','OUTCOME_TRAFFIC',
         'OUTCOME_ENGAGEMENT','OUTCOME_AWARENESS','OUTCOME_APP_PROMOTION'
       ]
 where acao = 'criar_campanha'
   and campo = 'objetivo'
   and vigente;

insert into public.contrato_de_execucao
  (acao, campo, obrigatorio, tipo, observacao, fonte, vigente, suportado)
values
  ('criar_conjunto_a_partir_de', 'familia_objetivo', false, 'text',
   'engajamento|reconhecimento|conversao|trafego|app. Quando engajamento/reconhecimento, executor sobrescreve molde OFFSITE_CONVERSIONS+pixel por POST_ENGAGEMENT|REACH + page_id.',
   'meta-actions v5.28 / traffic-chat v28.39', true, true),
  ('criar_conjunto_a_partir_de', 'page_id', false, 'text',
   'Obrigatorio na pratica para familia engajamento/reconhecimento (Page da marca). Fallback: meta_execution_config.page_id.',
   'meta-actions v5.28 / traffic-chat v28.39', true, true),
  ('criar_conjunto_a_partir_de', 'optimization_goal', false, 'text',
   'Opcional. Engajamento: POST_ENGAGEMENT|PAGE_LIKES|PROFILE_VISIT. Reconhecimento: REACH|IMPRESSIONS|AD_RECALL_LIFT. Default POST_ENGAGEMENT / REACH.',
   'meta-actions v5.28 / traffic-chat v28.39', true, true),
  ('criar_campanha', 'familia_objetivo', false, 'text',
   'Derivado do ODAX na emissao; informativo no payload.',
   'traffic-chat v28.39', true, true),
  ('criar_campanha', 'page_id', false, 'text',
   'Page da marca para brand boost (familia social).',
   'traffic-chat v28.39', true, true)
on conflict do nothing;

-- Excecao autorizada: nao remove doutrina CLT+LP default; registra permissao IMPULSAO.
insert into public.agent_context (company_id, categoria, fato, vigente, desde)
values (
  'ded20b38-f42e-4c71-800c-31b97ea48bcf',
  'doutrina',
  $fato$
EXCECAO AUTORIZADA PELO GESTOR - 20/08/2026 - CAMPANHA DE IMPULSAO / BRAND BOOST (Legal e Viver).
Padrao da casa continua CLT + LP + OUTCOME_LEADS. Esta excecao NAO revoga esse padrao.

Autorizado criar campanha/conjunto de ENGAJAMENTO (e reconhecimento se pedido) para impulsionar
audiencias sociais da Page / Instagram @legaleviver_:
- Nome proposto: [LEV][SOCIAL][ENGAJAMENTO][TESTE][IMPULSAO][AGO26]
- objetivo ODAX: OUTCOME_ENGAGEMENT (sinonimos ENGAJAMENTO / POST_ENGAGEMENT aceitos)
- canal: SOCIAL (destino Page/IG - NAO forcar LP /simulacao-clt)
- orcamento: R$ 60/dia no conjunto (ABO)
- page_id: 1095196357012756 | IG actor cadastrado na meta_execution_config
- special_ad_categories: FINANCIAL_PRODUCTS_SERVICES (sempre nas criacoes do sistema)
- papel: TESTE; rotulo: IMPULSAO

Fluxo: emitir criar_campanha primeiro; apos aprovacao, criar_conjunto_a_partir_de com
objetivo_tag=ENGAJAMENTO, orcamento 60, molde so para targeting (executor troca pixel por page).
Anuncio de perfil/boost ainda e lacuna - nao inventar criativo; campanha+conjunto bastam neste passo.
$fato$,
  true,
  '2026-08-20'
);
