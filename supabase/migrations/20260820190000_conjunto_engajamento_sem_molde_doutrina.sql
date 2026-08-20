-- name: conjunto_engajamento_sem_molde_doutrina
-- data: 2026-08-20
-- efeito:
--   (1) contrato criar_conjunto: sem_molde + molde_external_id aceita literal 'sem_molde'
--   (2) agent_context: caminho POST_ENGAGEMENT liberado; proibido bloquear com Ads Manager/Ryan
--   (3) atualiza fato IMPULSAO com fluxo de conjunto
--   (4) limpa valores_aceitos de plataformas_publicacao (array vs compare scalar)

update public.contrato_de_execucao
   set observacao =
         'Id do conjunto molde (empresta targeting) OU literal sem_molde quando familia engajamento/reconhecimento. '
      || 'Molde OFFSITE_CONVERSIONS e ACEITO em engajamento: executor sobrescreve optimization/pixel por POST_ENGAGEMENT|REACH + page_id.',
       fonte = 'meta-actions v5.29 / traffic-chat v28.41'
 where acao = 'criar_conjunto_a_partir_de'
   and campo = 'molde_external_id'
   and vigente;

insert into public.contrato_de_execucao
  (acao, campo, obrigatorio, tipo, observacao, fonte, vigente, suportado)
values
  ('criar_conjunto_a_partir_de', 'sem_molde', false, 'boolean',
   'true + familia engajamento/reconhecimento: targeting BR Advantage+ minimo sem ler molde Graph. Alternativa: target_name/molde_external_id=sem_molde.',
   'meta-actions v5.29 / traffic-chat v28.41', true, true)
on conflict do nothing;

-- Array: p_pedido->>campo vira JSON inteiro; lista scalar quebrava validar_pedido (todo criar_conjunto).
update public.contrato_de_execucao
   set valores_aceitos = null,
       observacao = 'Lista de redes (facebook|instagram|audience_network|messenger). Threads NUNCA. Validacao de itens no emissor/executor, nao em valores_aceitos scalar.',
       fonte = 'meta-actions v5.29 / traffic-chat v28.41'
 where acao = 'criar_conjunto_a_partir_de'
   and campo = 'plataformas_publicacao'
   and vigente;

-- Doutrina operativa: pare de bloquear IMPULSAO por falta de molde POST_ENGAGEMENT.
insert into public.agent_context (company_id, categoria, fato, vigente, desde)
values (
  'ded20b38-f42e-4c71-800c-31b97ea48bcf',
  'doutrina',
  $fato$
CONJUNTO DE ENGAJAMENTO / IMPULSAO — CAMINHO ABERTO (20/08/2026 v28.41).

Campanha ja existente: [LEV][SOCIAL][ENGAJAMENTO][TESTE][IMPULSAO][AGO26] id 120254615135350191 (OUTCOME_ENGAGEMENT ACTIVE).

PROIBIDO dizer ao gestor: "nao ha molde POST_ENGAGEMENT", "so no Ads Manager", "aguardar Ryan",
"configuracao de conjunto nao pode ser inventada" para bloquear este passo.

EMITIR criar_conjunto_a_partir_de com uma das rotas:
(A) target_name=sem_molde + objetivo_tag=ENGAJAMENTO + page_id da config (1095196357012756)
(B) target_name = nome EXATO de QUALQUER conjunto da conta (mesmo OFFSITE_CONVERSIONS) — molde so
    empresta targeting; executor grava optimization_goal=POST_ENGAGEMENT, billing_event=IMPRESSIONS,
    promoted_object={page_id} (pixel LEAD descartado)

Nome sugerido: [LEV][SOCIAL][ENGAJAMENTO][TESTE][CONJUNTO-IMPULSAO][AGO26]
Orcamento: R$ 60/dia ABO. Plataformas: facebook+instagram (padrao). Instagram actor: config.
Doutrina "so LP" NAO se aplica a esta excecao IMPULSAO (canal SOCIAL / Page).
Anuncio de boost ainda e lacuna — campanha+conjunto bastam agora; EMITA o card do conjunto.
$fato$,
  true,
  '2026-08-20'
);

-- Atualiza o fato IMPULSAO anterior com o degrau de conjunto.
update public.agent_context
   set fato = fato || E'\n\nATUALIZACAO 20/08/2026 v28.41: conjunto pode nascer com sem_molde OU molde LEADS (override). Nao bloquear; emitir card.'
 where company_id = 'ded20b38-f42e-4c71-800c-31b97ea48bcf'
   and categoria = 'doutrina'
   and vigente
   and fato like '%EXCECAO AUTORIZADA PELO GESTOR - 20/08/2026 - CAMPANHA DE IMPULSAO%'
   and fato not like '%v28.41%';
