-- Dono da ferramenta orfa, conferencia do registro, e o alcance real do proxy Pipeboard
-- (03/09/2026, fechando tres buracos abertos por 20260903213000 e 20260903170000)
--
-- POR QUE OS TRES ESTAO JUNTOS: os tres sao a mesma pergunta — "o registro sabe o que diz que
-- sabe?". 20260903213000 criou efeito/setor para tornar computavel a regra "afirmou ato do setor
-- X sem ter chamado ferramenta de ESCRITA do dono de X". Essa regra le TRES coisas: o efeito da
-- ferramenta, o setor da ferramenta, e quem e o dono (agent_unidades). Buraco em qualquer uma
-- desliga a guarda em silencio, que e o modo de falhar que a coluna veio impedir.
--
-- O QUE ESTA MIGRATION NAO FAZ: nao liga verificacao nova no caminho do turno, e nao muda
-- comportamento de runtime de nenhuma superficie (ver o bloco 1, que explica por que). Ela
-- corrige o DADO e cria o instrumento que torna a proxima ocorrencia auto-revelavel.

-- ============================================================================
-- 1) A FERRAMENTA ORFA: get_waba_template_insights ganha dono
-- ============================================================================
--
-- O QUE ELA FAZ DE FATO, lido do handler (traffic-agent-job t_waba_template_insights) e nao do
-- nome: agrega public.waba_template_analytics_daily por TEMPLATE na janela (envios, entregues,
-- leituras, cliques, taxa de clique sobre envio), resolve o nome do template contra
-- public.waba_templates, e acrescenta o agregado de envios de ontem de waba_analytics_daily.
-- Nao chama edge nenhuma e nao toca a Graph: sao duas leituras de tabela e uma soma. Em
-- 03/09/2026 ha 1.512 linhas de analytics e 107 templates, entao a ferramenta tem dado real.
--
-- POR QUE AG-05 E NAO AG-02, e isto foi CONFERIDO no registro em vez de deduzido do nome. As
-- metricas que ela devolve sao de desempenho, e "desempenho" e AG-02 — a duvida era legitima.
-- Tres evidencias resolvem, e todas as tres apontam para AG-05:
--   a) o papel de AG-05 em public.agents ja reivindica o dado, textualmente: "...e os templates
--      utilitarios com seus INSIGHTS";
--   b) a fronteira negativa de AG-02 ja o exclui, textualmente: "Taxa de clique de TEMPLATE de
--      WhatsApp e Mensageiro";
--   c) a simetria inversa em AG-05 fecha o par: "Taxa de clique de CAMPANHA ou de anuncio e
--      Analista, mesmo quando o destino do anuncio e WhatsApp".
-- O criterio do registro nao e "que tipo de numero e", e sim "de que ASSUNTO o numero fala".
-- Template de WhatsApp e canal; anuncio e midia. O comentario que criou a tabela agents guardou
-- exatamente este caso como o exemplo de por que nao_delegar_quando existe: "foi assim que
-- 'taxa de clique de template' caia em desempenho_campanhas em vez de whatsapp_waba".
-- Consequencia: agent_ferramentas.setor='Canal WhatsApp' (posto em 20260903213000) estava certo,
-- e o que faltava era so o dono.
--
-- ELA ESTAVA INALCANCAVEL? NAO — e a hipotese merece ser corrigida por escrito, porque o
-- conserto seria outro se fosse verdade. A ferramenta e superficies=['job'], e o
-- traffic-agent-job NAO estreita pelo registro: ele monta o array com
-- montarFerramentas(cat, 'job', new Set(cfg.tools), cfg.tools), onde cfg vem do mapa SUBAGENTES
-- literal do proprio arquivo — e SUBAGENTES.whatsapp_waba.tools inclui
-- get_waba_template_insights, com maxPorTool 2. Ela chegou a mesa do modelo em todo job que
-- rodou aquele especialista: 11 dos 52 jobs gravados. Quem estreita por agent_unidades e o CHAT
-- (ferramentasDosAgentes em _shared/agentes.ts), e no chat ela nunca aparece por outro motivo,
-- que continua valendo depois deste INSERT: definicaoDaFerramenta() filtra por superficie, e
-- 'job' nao esta na mesa do chat.
--
-- ENTAO O QUE ESTE INSERT MUDA: nada em runtime, hoje. Ele conserta o registro que a GUARDA le.
-- A guarda generica pergunta "quem e o dono do setor X" a agent_unidades; sem esta linha, o
-- unico agente do setor 'Canal WhatsApp' aparecia possuindo duas das tres ferramentas do
-- proprio setor, e a terceira nao pertencia a ninguem. Registro incompleto que ninguem sente
-- hoje e exatamente o material da falha de amanha — e se um dia o job passar a estreitar pelo
-- registro (que e a direcao declarada em 20260903170000), a ausencia desta linha viraria perda
-- de capacidade silenciosa.

insert into public.agent_unidades (agent_codigo, tipo, chave, observacao) values
  ('AG-05', 'ferramenta', 'get_waba_template_insights',
   'Insights por template: envios, entregues, leituras e cliques. Job-only. Setor do ASSUNTO (canal), nao do tipo de numero — a fronteira de AG-02 exclui este caso por escrito.')
on conflict (agent_codigo, tipo, chave) do update set
  observacao = coalesce(excluded.observacao, public.agent_unidades.observacao),
  vigente = true;

-- ============================================================================
-- 2) A "REFERENCIA PENDURADA" whatsapp_waba: nao existe, e o registro precisa dizer isso
-- ============================================================================
--
-- CONFERIDO CONTRA O BANCO, e o achado contraria a suspeita. Nao ha nenhuma referencia
-- pendurada. public.agent_unidades tem UMA linha com chave='whatsapp_waba' (id 13) e o tipo
-- dela e 'subagente', nao 'ferramenta'. Subagente nao pertence a agent_ferramentas por
-- construcao: agent_ferramentas e o catalogo de FERRAMENTAS de tool calling, e a tabela
-- agent_unidades guarda quatro especies distintas na mesma coluna `chave` — hoje 9 subagentes,
-- 10 edges, 2 pipelines e 65 ferramentas. Procurar um subagente no catalogo de ferramentas e
-- comparar especies diferentes; a ausencia dele la e o comportamento correto.
--
-- E whatsapp_waba EXISTE de verdade, em tres lugares independentes: e uma chave do mapa
-- SUBAGENTES do traffic-agent-job (com missao e teto de ferramentas), esta no FALLBACK_UNIDADES
-- de _shared/agentes.ts, e o front-end traduz o nome tecnico para o rotulo "WhatsApp" em
-- job-progress-card.tsx. Rodou em 11 dos 52 jobs gravados. Nao ha o que renomear e nao ha o que
-- remover: remover a linha tiraria de AG-05 o unico subagente dele e quebraria
-- agenteDoSubagente(), que e quem poe a identidade e a fronteira negativa no prompt do
-- especialista em execucao.
--
-- POR QUE ISSO VIRA CODIGO E NAO SO UM COMENTARIO: a pergunta "esta chave esta pendurada?" foi
-- respondida a mao, com quatro consultas. Ela vai ser feita de novo — a cada ferramenta nova, a
-- cada renomeacao — e a mao ela erra nos dois sentidos: acusa um subagente de ser ferramenta
-- fantasma (o caso de hoje) ou deixa passar uma orfa de verdade (o caso do bloco 1). A funcao
-- abaixo responde as duas em um select, comparando especie com especie.

create or replace function public.conferir_registro_de_ferramentas()
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
  with orfas as (
    -- Ferramenta no catalogo que agente nenhum possui. Consequencia: o estreitamento por
    -- agente nunca a entrega, e a guarda de ato nao acha o dono do setor dela.
    select f.chave, f.efeito, f.setor, f.superficies
      from public.agent_ferramentas f
     where f.vigente
       and not exists (
         select 1 from public.agent_unidades u
          where u.tipo = 'ferramenta' and u.vigente and u.chave = f.chave)
  ),
  penduradas as (
    -- Unidade do tipo FERRAMENTA apontando para chave que o catalogo nao tem. O recorte por
    -- tipo e o ponto: sem ele, todo subagente, edge e pipeline apareceria aqui como pendurado.
    select u.agent_codigo, u.chave
      from public.agent_unidades u
     where u.tipo = 'ferramenta' and u.vigente
       and not exists (
         select 1 from public.agent_ferramentas f where f.vigente and f.chave = u.chave)
  ),
  setor_sem_agente as (
    -- Setor grafado de um jeito que public.agents nao reconhece. A regra casa setor por
    -- IGUALDADE literal: grafia propria nunca encontra dono e a guarda desliga sem reclamar.
    select distinct f.chave, f.setor
      from public.agent_ferramentas f
     where f.vigente and f.setor is not null
       and not exists (select 1 from public.agents a where a.vigente and a.setor = f.setor)
  ),
  escrita_com_dono_de_outro_setor as (
    -- O caso mais caro: a ferramenta escreve, tem dono, e o dono e de OUTRO setor. A guarda
    -- procuraria a ferramenta de escrita do setor X e nao acharia a que existe.
    select f.chave, f.setor as setor_da_ferramenta, u.agent_codigo, a.setor as setor_do_dono
      from public.agent_ferramentas f
      join public.agent_unidades u on u.tipo = 'ferramenta' and u.vigente and u.chave = f.chave
      join public.agents a on a.codigo = u.agent_codigo and a.vigente
     where f.vigente and f.efeito = 'escrita' and a.setor <> f.setor
  ),
  sem_classificacao as (
    select f.chave from public.agent_ferramentas f
     where f.vigente and (f.efeito is null or f.setor is null)
  )
  select jsonb_build_object(
    'em', now(),
    'ferramentas_vigentes', (select count(*) from public.agent_ferramentas where vigente),
    'ok', (select count(*) from orfas) = 0
      and (select count(*) from penduradas) = 0
      and (select count(*) from setor_sem_agente) = 0
      and (select count(*) from escrita_com_dono_de_outro_setor) = 0
      and (select count(*) from sem_classificacao) = 0,
    'orfas', coalesce((select jsonb_agg(to_jsonb(o)) from orfas o), '[]'::jsonb),
    'referencias_penduradas', coalesce((select jsonb_agg(to_jsonb(p)) from penduradas p), '[]'::jsonb),
    'setor_sem_agente', coalesce((select jsonb_agg(to_jsonb(s)) from setor_sem_agente s), '[]'::jsonb),
    'escrita_com_dono_de_outro_setor',
      coalesce((select jsonb_agg(to_jsonb(e)) from escrita_com_dono_de_outro_setor e), '[]'::jsonb),
    'sem_classificacao', coalesce((select jsonb_agg(c.chave) from sem_classificacao c), '[]'::jsonb),
    'nota', 'Compara especie com especie: so agent_unidades.tipo=''ferramenta'' e cobrado contra agent_ferramentas. Subagente, edge e pipeline vivem na mesma coluna chave e NAO pertencem ao catalogo de ferramentas — em 03/09/2026 whatsapp_waba foi suspeitado de referencia pendurada por essa confusao, e e um subagente de AG-05 que roda de verdade.'
  );
$function$;

comment on function public.conferir_registro_de_ferramentas() is
  'Conferencia de integridade do registro de ferramentas: orfas (catalogo sem dono), referencias penduradas (dono sem catalogo, so tipo=ferramenta), setor que nao existe em agents, ferramenta de escrita cujo dono e de outro setor, e classificacao ausente. Existe porque a guarda generica de ato confia nas tres pontas (efeito, setor, dono) e um buraco em qualquer uma a desliga em silencio.';

-- ============================================================================
-- 3) O ALCANCE REAL DO PROXY PIPEBOARD  (o buraco que era hipotese, medido)
-- ============================================================================
--
-- A DUVIDA REGISTRADA: ler_pipeboard e listar_ferramentas_pipeboard sao proxies GENERICOS para
-- o MCP do Pipeboard. Foram classificadas 'leitura' em 20260903213000 pela semantica de falha
-- aberta, e o comentario de la afirmou que ler_pipeboard e "leitura por CONSTRUCAO". A afirmacao
-- estava certa e nao estava PROVADA: o catalogo do outro lado nunca havia sido enumerado, e uma
-- classificacao de proxy sem o catalogo do destino e uma classificacao sobre um alcance
-- desconhecido. Um ato praticado via proxy nao contaria como ato.
--
-- A ENUMERACAO (03/09/2026, tools/list pelo modo auditoria de pipeboard-read; tools/list le
-- schemas e nao executa ferramenta nenhuma). O conector expoe 121 ferramentas, e todas as 121
-- declaram a anotacao readOnlyHint do protocolo MCP. O cruzamento entre a allowlist de NOME de
-- isReadOnlyTool e o que o SERVIDOR declara tem quatro quadrantes, e o resultado e o seguinte:
--
--   nome passa | readOnlyHint | n  | o que significa
--   -----------+--------------+----+--------------------------------------------------------
--   nao        | false        | 61 | acordo: sao escritas e sao recusadas
--   sim        | true         | 58 | acordo: sao leituras e sao liberadas
--   nao        | true         |  2 | a allowlist de nome era ESTREITA demais (ver adiante)
--   sim        | false        |  0 | O QUADRANTE DO FURO, e ele esta VAZIO
--
-- ENTAO O PIPEBOARD NAO EXPOE SO LEITURA — 61 das 121 escrevem, e a lista e pesada:
-- create_campaign, create_adset, create_ad, create_ad_creative, create_custom_audience,
-- create_lookalike_audience, create_lead_gen_form, create_catalog, create_ad_rule,
-- update_campaign, update_adset, update_ad, update_ad_creative, update_ad_url_tags,
-- delete_ad_creative, delete_ad_image, delete_custom_audience, delete_catalog_products,
-- duplicate_campaign, duplicate_adset, duplicate_ad, duplicate_creative,
-- upload_ad_image, upload_ad_video, upload_conversion_events, bulk_create_ads,
-- bulk_update_campaigns, bulk_upload_ad_videos, add_users_to_audience,
-- remove_users_from_audience, publish_instagram_media, publish_lead_gen_draft_form,
-- manage_account_slots, manage_partnership_ad_permission, submit_feedback, entre outras.
-- Ha ate um create_creatives_from_drive_folder, que cria criativo em lote a partir de pasta do
-- Drive — exatamente o ato que neste sistema exige card de aprovacao.
--
-- MAS O QUADRANTE DO FURO ESTA VAZIO, e e isso que decide o controle. Nenhuma ferramenta cujo
-- nome atravessa a allowlist e declarada escrita pelo servidor. A classificacao 'leitura' das
-- duas ferramentas de proxy fica como esta, e agora por EVIDENCIA e nao por falha aberta:
-- callReadTool recusa antes de sair da nossa rede, e o conector confirma item a item que o que
-- passa e leitura. Nao ha ato praticavel via proxy hoje.
--
-- O CONTROLE ESCOLHIDO: allowlist de nome (mantida como guarda primaria) MAIS a anotacao do
-- servidor como segundo portao, e nao um dos dois sozinho. A razao de nao trocar um pelo outro:
--   - so nome (o que existia) e a unica camada que vale SEM REDE, e por isso ela nao pode sair:
--     trocar allowlist por confianca na anotacao remota transformaria uma indisponibilidade do
--     conector em permissao de escrita. Mas nome nao distingue get_campaigns de um futuro
--     get_or_create_campaign, e o catalogo do conector CRESCE sem aviso — ele ja ganhou
--     ferramentas entre 08 e 09/2026. Hoje o quadrante esta vazio por coincidencia de
--     nomenclatura do fornecedor, nao por garantia nossa.
--   - so anotacao (classificacao dinamica pura) herdaria o efeito da operacao alvo, que era a
--     outra opcao em cima da mesa. Ela e mais precisa e depende de uma leitura de rede para
--     autorizar cada chamada; e depende da honestidade do fornecedor num campo que o protocolo
--     nao obriga.
-- As duas camadas juntas, com a anotacao podendo apenas ESTREITAR, dao a propriedade que
-- nenhuma das duas da sozinha: o alcance do proxy nao aumenta quando a rede cai, e nao aumenta
-- quando o fornecedor acrescenta ferramenta de escrita com nome de leitura.
--
-- A ASSIMETRIA AQUI E O OPOSTO DA DE agent_ferramentas.efeito, e as duas estao certas. No campo
-- efeito, duvida resolve em 'leitura' (falha aberta): o custo do erro e uma verificacao que nao
-- acontece. No portao do proxy, duvida resolve em RECUSA (falha fechada): o custo do erro e uma
-- escrita na conta do cliente por um caminho que ninguem classificou. Mesmo sistema, dois
-- campos, dois custos de erro opostos.
--
-- TERCEIRO PORTAO, que nao existia: existencia no catalogo. Antes, qualquer string comecando
-- com get_ era repassada ao conector sem que ninguem soubesse se aquilo existia. Agora o nome
-- tem de estar no catalogo enumerado; se tools/list nao responder, a decisao cai de volta no
-- nome — indisponibilidade do conector nao vira bloqueio de leitura nem permissao de escrita.
--
-- OS 2 DO TERCEIRO QUADRANTE, e o tratamento deles e diferente porque a causa e diferente:
--   bulk_search_interests: leitura (readOnlyHint=true), tem account_id no schema, so consulta a
--     taxonomia de interesses. Estava recusada por ACIDENTE DE GRAFIA — bulk_get_ estava na
--     allowlist e bulk_search_ nao. Perda de capacidade, nao de seguranca: era a unica forma de
--     resolver varias palavras-chave numa chamada. Prefixo acrescentado.
--   search: leitura pelo readOnlyHint, e CONTINUA RECUSADA de proposito. O schema dela e
--     (query, access_token) — sem account_id — e a descricao diz que ela varre "ad accounts,
--     campaigns, ads, pages, and businesses". scopeArgsToCompany nao tem por onde prende-la as
--     contas da empresa da conversa, e leitura que atravessa contas e vazamento entre clientes
--     do mesmo conector: dano diferente do de escrita e igualmente inaceitavel. A recusa passou
--     a ser explicita (NAO_ESCOPAVEIS_POR_EMPRESA) para nao ser "consertada" adiante como se
--     fosse o mesmo esquecimento de grafia do bulk_search_.
--
-- PENDENCIA DECLARADA, para decisao do gestor e nao minha: `fetch` esta LIBERADA na allowlist
-- (READ_EXACT) e tambem nao e escopavel por empresa — o schema dela e so (id). Hoje ela e
-- inofensiva por acidente de dependencia: a descricao diz que ela devolve apenas registros que
-- um `search` anterior cacheou NA MESMA SESSAO, e como `search` esta recusado, nunca ha cache
-- para ela devolver. Nao a removi porque a remocao e uma decisao de escopo (mexeria numa
-- capacidade declarada) e porque nao ha dano demonstravel hoje. Se a recusa de `search` mudar,
-- `fetch` deixa de ser inerte e passa a ser a mesma travessia de contas.

insert into public.agent_context(categoria, fato, vigente, desde, company_id)
select
  'execucao',
  'ALCANCE DO PROXY PIPEBOARD, ENUMERADO (03/09/2026). O conector expoe 121 ferramentas: 58 de '
  || 'leitura, que ler_pipeboard alcanca, e 61 de ESCRITA, que ele recusa antes de sair da nossa '
  || 'rede (create_/update_/delete_/duplicate_/upload_/publish_/manage_/add_/remove_/bulk_create/'
  || 'bulk_update/bulk_upload/submit_, incluindo create_campaign, create_adset, create_ad, '
  || 'update_adset e create_creatives_from_drive_folder). NUNCA prometa ao gestor um ato pelo '
  || 'ler_pipeboard, e nunca diga que "da para criar direto no Pipeboard": a chamada volta com '
  || 'ferramenta_de_escrita_recusada e nenhum objeto e tocado. Todo ato na conta Meta continua '
  || 'sendo propose_action, com card de aprovacao e execucao por meta-actions. Duas leituras do '
  || 'catalogo tambem sao recusadas e por motivo DISTINTO de efeito: `search` e `fetch` nao '
  || 'aceitam account_id e varreriam contas de outras empresas do mesmo conector, entao '
  || 'isolamento as barra mesmo sendo leitura. Para descobrir o que EXISTE do lado de la use '
  || 'listar_ferramentas_pipeboard, que devolve so o lado alcancavel.',
  true,
  current_date,
  null
where not exists (
  select 1 from public.agent_context
   where vigente is true and company_id is null
     and fato ilike 'ALCANCE DO PROXY PIPEBOARD%'
);

-- ============================================================================
-- 4) A MIGRATION SE PROVA
-- ============================================================================
-- Registro errado e pior que registro incompleto, porque a guarda confia nele. Entao esta
-- migration nao termina alegando que consertou: ela roda a conferencia e ABORTA se sobrar
-- buraco. Falhar aqui e barato; descobrir em producao que a guarda estava desligada nao e.
do $$
declare
  v jsonb := public.conferir_registro_de_ferramentas();
begin
  if not (v->>'ok')::boolean then
    raise exception 'registro de ferramentas inconsistente apos a correcao: %', v::text;
  end if;
  -- A orfa do bloco 1 tem de estar com dono, e o dono tem de ser AG-05.
  if not exists (
    select 1 from public.agent_unidades
     where tipo = 'ferramenta' and chave = 'get_waba_template_insights'
       and agent_codigo = 'AG-05' and vigente
  ) then
    raise exception 'get_waba_template_insights continua sem o dono AG-05';
  end if;
  -- E o subagente do bloco 2 tem de continuar de pe: a "correcao" errada aqui seria remove-lo.
  if not exists (
    select 1 from public.agent_unidades
     where tipo = 'subagente' and chave = 'whatsapp_waba' and agent_codigo = 'AG-05' and vigente
  ) then
    raise exception 'o subagente whatsapp_waba de AG-05 desapareceu — ele nao era referencia pendurada';
  end if;
  raise notice 'conferir_registro_de_ferramentas: %', v::text;
end $$;

-- ============================================================================
-- 5) RLS E GRANTS
-- ============================================================================
-- Nenhuma tabela nova. A funcao e SECURITY DEFINER e le o registro inteiro, entao segue a
-- postura recente: fora do alcance de anon e authenticated, chamada pelo service_role.
--
-- O REVOKE E DE PUBLIC, NAO SO DOS DOIS PAPEIS. Funcao nasce com EXECUTE concedido a PUBLIC;
-- revogar de anon e authenticated deixa o grant de PUBLIC de pe e os dois continuam executando
-- por heranca — o ACL fica com "=X/", que le como aberto. Mesmo conserto que
-- 20260813161344_fecha_anon_revogando_de_public_correcao.sql ja fez neste banco.
revoke all on function public.conferir_registro_de_ferramentas() from public, anon, authenticated;
grant execute on function public.conferir_registro_de_ferramentas() to service_role;

-- COMO RODAR, sob demanda (service_role):
--   select public.conferir_registro_de_ferramentas();
-- 'ok' true significa: nenhuma orfa, nenhuma referencia pendurada de ferramenta, todo setor
-- reconhecido por public.agents, e toda ferramenta de escrita com dono do mesmo setor.
