-- ALTERAR ORCAMENTO DE CONJUNTO PUBLICADO (12/09/2026)
--
-- O DEFEITO. O gestor pediu: "altere o orçamento desse conjunto
-- JUR_WA_CONJ.04_9331-6245 para 20,00". A ferramenta existia
-- (propose_action action_type=alterar_orcamento). Duas recusas em
-- sequencia e o agente pediu confirmacao em vez de emitir o card:
--   1) params.orcamento_diario_reais (campo de CRIAR) →
--      "informe params.novo_orcamento_diario_reais"
--   2) params.novo_orcamento_diario_reais=20 →
--      orcamento_diferente_do_contrato, porque o extrator leu CONJ.04
--      no NOME como contrato de R$ 4,00/dia.
--
-- POR QUE TOOL DEDICADA. Mesma razao de alterar_geo_do_conjunto: o
-- proxy generico existia e o modelo usou o campo errado, depois o
-- gate de criacao travou o pedido de ALTERAR. A tool expoe conjunto +
-- orcamento_diario_reais no schema. O extrator passa a ignorar CONJ.N
-- e telefone no nome; alterar usa o contrato da ULTIMA fala, nao o
-- de criacao da conversa.

insert into public.agent_ferramentas
  (chave, descricao, parametros, doutrina, superficies, parametros_omitidos)
values
  ($ft$alterar_orcamento$ft$,
   $ft$Emite CARD DE APROVACAO para alterar o ORCAMENTO DIARIO de UM conjunto JA PUBLICADO. Passe conjunto (nome atual) e orcamento_diario_reais em REAIS por dia (20 = R$ 20,00 — NUNCA 2000). CONJ.04 no nome NAO e dinheiro. Pedido 'altere o orçamento do CONJ.X para 20' E a ordem desta mensagem: emita o card. Orcamento de criacao anterior nesta conversa NAO trava. NAO peca confirmacao de que o valor novo substitui o antigo.$ft$,
   $ft${"type":"object","properties":{"conjunto":{"type":"string","description":"Nome atual do conjunto (ex. JUR_WA_CONJ.04_9331-6245)."},"alvo_external_id":{"type":"string","description":"Id Meta do conjunto quando o nome nao for unico."},"orcamento_diario_reais":{"type":"number","description":"Novo valor em REAIS por dia (ex. 20). Alias: novo_orcamento_diario_reais."},"novo_orcamento_diario_reais":{"type":"number","description":"Alias de orcamento_diario_reais."},"justificativa":{"type":"string"},"reversa":{"type":"string"},"metrica_sucesso":{"type":"string"}},"required":["conjunto","orcamento_diario_reais"]}$ft$::jsonb,
   $ft$Aprovar altera daily_budget DESTE conjunto (centavos na Graph; o pedido e em REAIS). CONJ.N / telefone no nome nao sao diaria. Orcamento definido na criacao de outros conjuntos nesta conversa nao e trava deste ato. Alias aceito: params.orcamento_diario_reais. Sem approval_id o card nao existe. Teto de sanidade continua na RPC avaliar_orcamento_diario.$ft$,
   array['chat']::text[],
   $ft${}$ft$::jsonb)
on conflict (chave) do update set
  descricao = excluded.descricao,
  parametros = excluded.parametros,
  doutrina = excluded.doutrina,
  superficies = excluded.superficies,
  vigente = true,
  atualizado_em = now();

update public.agent_ferramentas set efeito = 'escrita', setor = 'Atos na conta Meta'
 where chave = 'alterar_orcamento';

update public.agent_ferramentas
   set parametros = jsonb_set(
         parametros,
         '{properties,params,description}',
         to_jsonb(
           'Campos da acao. alvo_external_id: id da Meta do objeto alvo, quando o nome nao for unico. Nome livre em nome / nome_novo / novo_nome. GEO no criar_conjunto E no alterar_geo_do_conjunto: params.cidades, params.bairros ou params.geo_locations, com as keys de buscar_geolocalizacao. alterar_orcamento: params.novo_orcamento_diario_reais em REAIS/dia (alias: orcamento_diario_reais). CONJ.N no nome nao e dinheiro. Preferir a tool dedicada alterar_orcamento.'::text
         )
       ),
       doutrina = coalesce(doutrina, '')
         || case when doutrina like '%ALTERAR ORCAMENTO DE CONJUNTO PUBLICADO%' then ''
            else E'\nALTERAR ORCAMENTO DE CONJUNTO PUBLICADO (12/09/2026): preferir a tool dedicada alterar_orcamento. Campo canonico params.novo_orcamento_diario_reais; alias params.orcamento_diario_reais. CONJ.04 no nome nao e R$ 4. Pedido desta mensagem e a ordem — nao peca ao gestor para confirmar substituicao do contrato de criacao.' end,
       atualizado_em = now()
 where chave = 'propose_action';

insert into public.agent_unidades (agent_codigo, tipo, chave, observacao)
values
  ('AG-06', 'ferramenta', 'alterar_orcamento',
   'Edita orcamento do conjunto publicado; nao cria conjunto novo')
on conflict (agent_codigo, tipo, chave) do update set
  observacao = excluded.observacao,
  vigente = true;

insert into public.agent_context (categoria, fato, vigente, desde, atualizado)
select
  'doutrina',
  'ALTERAR ORCAMENTO DE CONJUNTO PUBLICADO (12/09/2026). Existe a acao sancionada '
  || 'alterar_orcamento (tool dedicada no AG-06 e action_type em propose_action). '
  || 'Pedido "altere o orçamento do CONJ.X para 20" E a ordem desta mensagem: emita o card. '
  || 'CONJ.04 / CONJ.N no NOME do conjunto NAO e dinheiro. O campo e orcamento_diario_reais '
  || 'em REAIS por dia (20 = R$ 20,00 — nunca 2000). Alias: novo_orcamento_diario_reais. '
  || 'Orcamento usado na criacao de outros conjuntos nesta conversa NAO trava este ato. '
  || 'PROIBIDO pedir ao gestor que confirme que o valor novo substitui o antigo.',
  true,
  date '2026-09-12',
  now()
where not exists (
  select 1 from public.agent_context
   where categoria = 'doutrina'
     and fato like 'ALTERAR ORCAMENTO DE CONJUNTO PUBLICADO (12/09/2026)%'
     and vigente is true
);
