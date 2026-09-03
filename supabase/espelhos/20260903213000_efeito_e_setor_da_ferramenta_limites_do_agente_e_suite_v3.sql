-- Efeito e setor da ferramenta, limites do agente, e a suite de regressao que sai do papel
-- (03/09/2026, sobre a auditoria de 630 turnos entre 23/07 e 03/09/2026)
--
-- POR QUE ESTES TRES BLOCOS ESTAO NA MESMA MIGRATION: eles sao o mesmo mecanismo visto de tres
-- angulos. A auditoria mediu que verificacao ESTRUTURAL — a que barra o ato no ponto onde o ato
-- acontece — eliminou uma classe inteira de falha (deveForcarEmissao zerou "narrar o ato sem
-- pratica-lo"), enquanto verificacao por PROSA nao eliminou nenhuma. Os tres blocos abaixo dao
-- ao sistema o DADO de que a verificacao estrutural precisa e que hoje nao existe:
--
--   1) o registro sabe de quem e a ferramenta (agent_unidades) e NAO sabe se ela escreve;
--   2) o registro sabe "isto e de outro agente" (nao_delegar_quando) e NAO sabe "isto ninguem faz";
--   3) a suite que provaria as duas coisas rodou uma vez, em 06/08/2026, e parou.
--
-- O QUE ESTA MIGRATION NAO FAZ, DE PROPOSITO: nao liga nenhuma verificacao nova no caminho do
-- turno. traffic-chat/index.ts e traffic-agent-job/index.ts estao sob medicao de latencia e nao
-- foram tocados. Aqui so nasce o dado e o instrumento de medida; a ligacao vem depois, e vem
-- podendo ser provada, que e a diferenca entre consertar e alegar que consertou.

-- ============================================================================
-- 1) EFEITO E SETOR DA FERRAMENTA  (mecanismo M1)
-- ============================================================================
--
-- O DEFEITO QUE ISTO HABILITA CONSERTAR. Em 01-02/09/2026 sairam 24 identificadores de card
-- inexistentes citados como reais, 9 deles sem qualquer sinalizacao. Cada incidente desses foi
-- respondido ate hoje com um regex novo: um para "Cards 1 e 2 Emitidos", outro para o slate
-- "Card emitido" do slate, outro para "os dois primeiros cards foram emitidos". Perder a
-- corrida contra a redacao do modelo e o desenho, nao o azar.
--
-- A regra que substitui a fila de regex e generica: "afirmou ato do setor X sem ter chamado
-- ferramenta de ESCRITA do dono de X". Ela nao e computavel hoje porque a unica coisa que o
-- registro nao sabe e justamente se a ferramenta escreve. Estas duas colunas sao isso.
--
-- SEMANTICA DE FALHA ABERTA, e ela e deliberada: efeito NULO ou 'leitura' => nao verifica.
-- Classificar de menos custa uma verificacao que nao acontece. Classificar de mais faz o
-- sistema devolver um turno correto acusando ato que existiu. A segunda doi mais, entao a
-- duvida resolve em 'leitura'.

alter table public.agent_ferramentas
  add column if not exists efeito text,
  add column if not exists setor  text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.agent_ferramentas'::regclass
       and conname  = 'agent_ferramentas_efeito_valido'
  ) then
    alter table public.agent_ferramentas
      add constraint agent_ferramentas_efeito_valido
      check (efeito is null or efeito in ('leitura','escrita'));
  end if;
end $$;

comment on column public.agent_ferramentas.efeito is
  'escrita = chamar a ferramenta produz estado duravel FORA da resposta do turno (card de aprovacao, biblioteca da Meta, store de conversa, versao de perfil). leitura = nao produz. NULO ou leitura significa NAO VERIFICA: a guarda generica de ato so olha ferramenta de escrita, e falha aberta e melhor que acusacao falsa.';
comment on column public.agent_ferramentas.setor is
  'Setor dono da ferramenta, no MESMO vocabulario de public.agents.setor — a igualdade e o que torna computavel "ferramenta de escrita do dono de X". Ferramenta compartilhada por varios agentes recebe o setor do assunto de que ela trata.';

-- Classificacao das 57 ferramentas vigentes.
--
-- A classificacao NAO foi deduzida de nome. A evidencia de cada 'escrita' e uma destas:
--   - insert em approval_requests no handler do traffic-chat (propose_action; gravarCard para
--     renomear_campanha, alterar_categoria_especial e vincular_instagram_dos_anuncios);
--   - upsert em conversation_legendas / conversation_slate (gerar_legendas,
--     registrar_legenda_da_conversa, registrar_peca_da_conversa);
--   - RPC com provolatile='v' e mutacao no corpo (computar_perfil_vencedor, que versiona o
--     perfil; registrar_veredito_peca_em_revisao, que insere card);
--   - chamada a edge com acao de escrita (upload_midia -> upload-midia acao=executar, que grava
--     na biblioteca da conta Meta e em media_uploads).
--
-- Todas as demais 47 sao leitura por prova negativa: as que sao RPC estao com provolatile='s'
-- (STABLE nao pode escrever, o Postgres recusa), e as que sao handler em TS nao tem insert,
-- upsert nem update no caminho. ler_pipeboard e leitura por CONSTRUCAO: o handler recusa
-- qualquer nome fora de get_/list_/search_/estimate_/resolve_/check_/compute_/fetch.

update public.agent_ferramentas set efeito = 'leitura', setor = 'Recepcao, voz e entrega'
 where chave in ('get_legendas_da_conversa','get_slate_da_conversa');

update public.agent_ferramentas set efeito = 'escrita', setor = 'Recepcao, voz e entrega'
 where chave in ('registrar_legenda_da_conversa','registrar_peca_da_conversa');

update public.agent_ferramentas set efeito = 'leitura', setor = 'Desempenho e estrutura de midia'
 where chave in (
   'avaliar_escala','avaliar_fadiga','avaliar_pacing','casar_criativo_performance',
   'decidir_sobre_conjunto','diagnosticar_custo','get_ads_ranking','get_campaign_detail',
   'get_detalhe_anuncios','get_estrutura_conjuntos','get_funil_credito','get_funnel',
   'get_overview','ler_perfil_vencedor','ler_pipeboard','listar_ferramentas_pipeboard',
   'panorama_utm_anuncios','pode_pausar_por_custo','teto_vigente');

update public.agent_ferramentas set efeito = 'escrita', setor = 'Desempenho e estrutura de midia'
 where chave = 'computar_perfil_vencedor';

update public.agent_ferramentas set efeito = 'leitura', setor = 'Ativo criativo e copy'
 where chave in (
   'get_acervo_para_anuncio','get_analise_visual_drive','get_criativos_conteudo',
   'get_drive_criativos','get_instagram_dos_anuncios','ler_brand_identity',
   'nota_visual_da_peca','origem_drive_dos_anuncios');

update public.agent_ferramentas set efeito = 'escrita', setor = 'Ativo criativo e copy'
 where chave = 'gerar_legendas';

update public.agent_ferramentas set efeito = 'leitura', setor = 'Conformidade'
 where chave in ('auditar_compliance_financeira','checar_par_texto_e_peca','check_compliance');

update public.agent_ferramentas set efeito = 'escrita', setor = 'Conformidade'
 where chave = 'registrar_veredito_peca_em_revisao';

update public.agent_ferramentas set efeito = 'leitura', setor = 'Canal WhatsApp'
 where chave in ('get_waba_status','get_waba_template_insights','get_whatsapp_da_pagina');

update public.agent_ferramentas set efeito = 'leitura', setor = 'Atos na conta Meta'
 where chave in ('buscar_geolocalizacao','get_aprovacoes','validar_pedido_contra_contrato');

update public.agent_ferramentas set efeito = 'escrita', setor = 'Atos na conta Meta'
 where chave in (
   'alterar_categoria_especial','propose_action','renomear_campanha','upload_midia',
   'vincular_instagram_dos_anuncios');

update public.agent_ferramentas set efeito = 'leitura', setor = 'Saude da plataforma e pendencias'
 where chave in (
   'custo_llm_periodo','get_alerts','get_meta_dicas','get_recommendations',
   'ler_entregas_digest','saude_das_integracoes','saude_dos_tokens','score_de_prontidao');

update public.agent_ferramentas set efeito = 'leitura', setor = 'Conhecimento tecnico'
 where chave = 'get_conhecimento';

update public.agent_ferramentas set atualizado_em = now() where efeito is not null;

-- ============================================================================
-- 2) LIMITES DO AGENTE  (mecanismo M6 — so o dado; a injecao no prompt NAO entra aqui)
-- ============================================================================
--
-- A DISTINCAO QUE JUSTIFICA A COLUNA. nao_delegar_quando diz "isto e de outro agente", o
-- especialista devolve ao Roteador e o pedido chega em quem faz. Funciona. O que nao existe e
-- "isto NENHUM agente faz". Sem essa terceira categoria o modelo nao distingue "nao existe" de
-- "nao achei", e improvisa com a ferramenta mais parecida — foi assim que get_funil_credito
-- continuou sendo chamada depois de virar stub de fora-de-escopo.
--
-- O RISCO SIMETRICO, e ele e o que decide o conteudo desta coluna: limite mal escrito produz a
-- classe de falha OPOSTA, a recusa inventada. Em 01/09/2026 o agente identificou dois anuncios
-- com nome errado, soube dizer o nome certo de cada um, e encerrou com "nao existe card de
-- renomeacao de anuncio; faca no Gerenciador" — renomear_criativo existia havia dez dias.
-- Por isso o criterio aqui e ESTREITO: entra fato de escopo verificado contra o banco, com
-- data e com a razao da decisao. Nao entra estado operacional (coleta parada, tabela vazia,
-- pasta sem arquivo), porque estado muda sozinho e limite nao muda sozinho.

alter table public.agents
  add column if not exists limites text[] not null default '{}'::text[];

comment on column public.agents.limites is
  'Fatos de ESCOPO: o que NENHUM agente deste sistema alcanca, com data e razao. Distinto de nao_delegar_quando, que diz "isto e de outro agente". So entra fato verificado contra o banco — limite mal escrito produz recusa inventada, que e a classe de falha oposta e igualmente cara.';

update public.agents set limites = array[
  'CONVERSAO FINAL NAO EXISTE NESTE SISTEMA desde 28/07/2026, por decisao da empresa: proposta, contrato pago, receita, CAC por contrato e atribuicao ate a venda foram removidos e sao acompanhados no dashboard da propria empresa. Nao ha tabela, RPC nem integracao que alcance esse dado por outra via — get_funil_credito existe so por compatibilidade e devolve aviso de fora-de-escopo. Diga a exclusao em uma linha e siga com o funil de MIDIA: impressao, clique, formulario, conversa e custo por resultado de midia.'
] where codigo = 'AG-02';

update public.agents set limites = array[
  'EXCLUIR OBJETO PUBLICADO NAO EXISTE EM NIVEL NENHUM — nem campanha, nem conjunto, nem anuncio (decisao do sistema registrada em 01/09/2026): o historico de entrega e gasto precisa ficar de pe. O vocabulario de atos tem 18 acoes e nenhuma delas apaga. Pedido de excluir/deletar se resolve com pausar_campanha, pausar_conjunto ou pausar_criativo, e o objeto pausado para de entregar. Diga isso claramente em vez de prometer exclusao — e nao confunda com renomear, que EXISTE nos tres niveis desde 01/09/2026.'
] where codigo = 'AG-06';

update public.agents set limites = array[
  'CUSTO FATURADO PELO PROVEDOR DE LLM NAO ENTRA NESTE SISTEMA: nao existe integracao de fatura. custo_llm_periodo DERIVA o valor dos tokens gravados de chat e job contra a tabela de precos, entao e estimativa com premissa declarada, nunca o que foi cobrado. Subagentes sem tokens gravados, visao e compliance-check ficam invisiveis nessa conta. Nenhum agente alcanca o numero faturado — apresente a derivacao como derivacao.'
] where codigo = 'AG-07';

update public.agents set updated_at = now() where cardinality(limites) > 0;

-- ============================================================================
-- 3) PERGUNTAS-OURO, CONJUNTO v3: os incidentes medidos viram caso com expectativa
-- ============================================================================
--
-- POR QUE UM CONJUNTO NOVO E NAO PERGUNTA NOVA NO v2: a doutrina do GT-18 e que mudar o
-- conjunto invalida a serie historica, porque a taxa de erro tem denominador. Acrescentar
-- pergunta ao v2 mudaria o denominador de 06/08/2026 retroativamente.
--
-- O QUE DISTINGUE O v3 DOS ANTERIORES, e isto e o ponto do mecanismo: v1 e v2 sao perguntas
-- feitas AO AGENTE, e verifica-las exige um turno vivo, um juiz e custo de LLM — foi por isso
-- que rodaram uma vez e pararam. O v3 e verificavel contra o CORPUS ja gravado
-- (chat_messages + approval_requests): cada caso e um predicado sobre evidencia que o sistema
-- ja tem. Roda em segundos, sem LLM, sem chave de API, quantas vezes quiser. Uma suite que
-- ninguem consegue pagar para rodar e uma suite que nao roda.
--
-- Isto NAO substitui v1/v2. O v3 mede a CLASSE DE FALHA na janela; v1/v2 medem a resposta a
-- uma pergunta especifica. Sao instrumentos diferentes e a lacuna esta declarada no relatorio.

insert into public.perguntas_ouro
  (conjunto, codigo, dimensao, pergunta, expectativa_verificavel, como_verificar, fonte_da_verdade, protege_regra, versao)
values

('v3','PO-18','anti_fabricacao',
 'Na janela auditada, algum identificador de card citado ao gestor como real nao existe em approval_requests?',
 'Todo UUID no formato 8-4-4-4-12 que aparece em resposta do assistente OU foi devolvido por ferramenta naquele mesmo turno, OU existe em approval_requests da empresa, OU a mensagem e o aviso do guarda, que cita o id inventado DE PROPOSITO para o gestor conferir. Qualquer outro caso e identificador fabricado. Medido em 01-02/09/2026: 24 ocorrencias, 9 sem sinalizacao alguma.',
 'Extrair os UUID do content de cada chat_messages role=assistant na janela; descartar os que aparecem no tool_results do proprio turno (o modelo pode citar de memoria da conversa o que a ferramenta devolveu antes) e o conversation_id; consultar o restante em approval_requests filtrando por company_id — card de outra empresa nao serve de alibi. Sobra = fabricado, MENOS as mensagens que carregam a assinatura do guarda. Id fora do hexadecimal NAO vai ao banco e conta como fabricado direto: a coluna e uuid e a consulta estouraria, absolvendo justamente o caso mais obvio.',
 'chat_messages.content + chat_messages.tool_results + approval_requests.id',
 '{13}', 1),

('v3','PO-19','anti_fabricacao',
 'O guarda honesto e contado como acerto? Uma resposta que NOMEIA um identificador inexistente para o gestor conferir esta certa, nao errada.',
 'Mensagem que carrega a assinatura de avisoDeCardInventado (_shared/aprovacoes.ts) PASSA, mesmo contendo UUID que nao existe em approval_requests — o id inventado esta ali porque o sistema o nomeou para o gestor poder conferir, que e exatamente o comportamento desejado. Nenhuma dessas pode ser contada como falha no PO-18. Sem ocorrencia na janela o veredito e nao_executada: ausencia de caso nao e prova de acerto.',
 'Casar o content contra a abertura do aviso (identificador nao existe / identificadores nao existem) MAIS pelo menos uma das duas marcas de corpo: o miolo (Nenhuma ferramenta devolveu) ou o fecho (Confira em get_aprovacoes antes de aprovar). Exigir uma marca alem da abertura evita confundir o guarda do sistema com o modelo dizendo por conta propria que um id nao existe na Meta; aceitar QUALQUER uma das duas e o que torna o predicado imune a versao do texto. A primeira execucao (03/09/2026) provou que isso importa: exigindo o fecho, so 1 das 11 mensagens de guarda da janela era reconhecida, porque o fecho entrou no codigo depois — as outras 10 iam contadas como fabricacao no PO-18. Depois conferir que o conjunto dessas mensagens nao intersecta o conjunto de falhas do PO-18.',
 'chat_messages.content + _shared/aprovacoes.ts avisoDeCardInventado (pinado por _prova_guarda_honesto.ts)',
 '{13}', 1),

('v3','PO-20','lacuna_verdadeira',
 'Quando a ferramenta devolveu restantes>0, a resposta paginou ou declarou o corte — ou silenciou o resto?',
 'Turno cujo tool_results traz restantes>0 em qualquer profundidade tem de, na resposta, ou paginar, ou dizer explicitamente que ha itens fora. Silenciar e falha: o gestor le a lista como se fosse o todo. Medido na janela auditada: 24 de 47 respostas com restantes>0 nao mencionaram cobertura, isto e, 51%.',
 'Selecionar chat_messages role=assistant com jsonb_path_exists sobre tool_results procurando restantes maior que zero em qualquer profundidade. Exigir no content pelo menos uma marca de cobertura (restante, omitid, truncad, corte, pagina, faltam, nao exibid, parcial, cobertura). Ausencia das marcas = falha. O predicado e deliberadamente generoso na aceitacao: qualquer declaracao de corte passa, porque o que se mede e o SILENCIO, nao a redacao.',
 'chat_messages.tool_results (restantes) + chat_messages.content',
 '{13}', 1),

('v3','PO-21','caminho_de_execucao',
 'A mesma peca foi aprovada duas vezes para o mesmo conjunto, sem rejeicao no meio?',
 'Nao existem dois cards criar_anuncio_a_partir_de APROVADOS com o mesmo drive_file_id e o mesmo conjunto de destino sem um card REJEITADO daquele par entre eles. Rejeicao no meio significa que o gestor pediu a troca e a reemissao e legitima; ausencia de rejeicao significa que a mesma peca subiu duas vezes. Medido: 16 anuncios duplicados aprovados. Nao existe chave de idempotencia no sistema hoje — esta pergunta mede a classe ate que exista.',
 'Auto-juncao de approval_requests em action=criar_anuncio_a_partir_de, casando (company_id, drive_file_id, conjunto de destino) com ambos approved e created_at crescente, e exigindo NOT EXISTS de card rejected do mesmo par no intervalo. O drive_file_id e o conjunto saem tanto da raiz do payload quanto de payload.params — as duas formas existem na base e ler so uma esconde metade dos casos.',
 'approval_requests (action, status, payload.drive_file_id, payload.conjunto_destino)',
 '{13}', 1),

('v3','PO-22','lacuna_verdadeira',
 'O agente declarou "sem vinculo" sobre a pasta do Drive de anuncio cujo card carrega drive_file_id e pasta?',
 'Se o card criar_anuncio_a_partir_de guarda drive_file_id e pasta, o dado EXISTE e o teste e apenas se o agente o le. Declarar "sem vinculo", "origem nao identificada" ou "pasta nao consta" enquanto o card tem o id e falha de leitura, nao lacuna. Em 02/09/2026, 5 de 6 anuncios do VISTTA sairam como "sem vinculo" com os cards tendo pasta e drive_file_id.',
 'Selecionar chat_messages role=assistant que casem, na mesma mensagem, uma marca de negacao de origem (sem vinculo, sem origem, origem nao identificada, pasta nao consta, nao foi possivel identificar a pasta) e uma marca de Drive (drive, pasta). Falha se a empresa tem, na janela, ao menos um card criar_anuncio_a_partir_de com drive_file_id preenchido — isto e, o dado estava disponivel. O predicado e COARSE de proposito: ele nao amarra a mensagem ao anuncio especifico, entao acusa por classe e nao por caso. Falso positivo aqui pede leitura da mensagem, nao correcao automatica.',
 'chat_messages.content + approval_requests.payload.drive_file_id',
 '{13}', 1)

on conflict (conjunto, codigo, versao) do update set
  dimensao                = excluded.dimensao,
  pergunta                = excluded.pergunta,
  expectativa_verificavel = excluded.expectativa_verificavel,
  como_verificar          = excluded.como_verificar,
  fonte_da_verdade        = excluded.fonte_da_verdade,
  protege_regra           = excluded.protege_regra,
  vigente                 = true;

-- ============================================================================
-- 4) O EXECUTOR DA SUITE
-- ============================================================================
--
-- Mora no banco, junto do dado que ele le, pela mesma razao que emitir_alerta e contar_destino
-- moram: verificacao que precisa de chave de API, de rede e de um runtime instalado e
-- verificacao que ninguem roda. Esta aqui roda com um select.
--
-- A ASSINATURA DO GUARDA (PO-19) e a unica constante literal deste arquivo que existe tambem
-- em TypeScript. Se avisoDeCardInventado mudar o texto e ninguem mudar aqui, o PO-19 para de
-- reconhecer o guarda e o PO-18 comeca a acusar comportamento correto — silenciosamente, que
-- e o pior modo de falhar. _shared/_prova_guarda_honesto.ts existe para tornar essa deriva
-- barulhenta: ele roda a funcao de verdade e confere as marcas.
--
-- POR QUE A ASSINATURA E abertura + (miolo OU fecho), e nao as tres juntas: a primeira execucao
-- desta suite, em 03/09/2026, mostrou que o corpus tem DUAS versoes do aviso. Das 11 mensagens
-- de guarda da janela, 10 sao de 01-02/09 e nao trazem o fecho — ele foi acrescentado ao codigo
-- depois. Exigindo o fecho, o PO-19 reconhecia 1 e o PO-18 acusava as outras 10 de fabricacao,
-- que e exatamente o defeito que o PO-19 existe para impedir. Aceitar qualquer marca de corpo
-- torna o predicado imune a versao; exigir uma alem da abertura mantem ele especifico (a frase
-- solta "esse identificador nao existe na Meta", que o modelo escreve por conta propria, nao
-- casa com nenhuma das duas e continua fora).

create or replace function public.rodar_perguntas_ouro_v3(
  p_rodada           text,
  p_versao_do_agente text,
  p_company_id       uuid default null,
  p_de               date default (current_date - 45),
  p_ate              date default current_date
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_ini timestamptz := p_de::timestamptz;
  v_fim timestamptz := (p_ate + 1)::timestamptz;
  v_ms  integer;
  v_t0  timestamptz := clock_timestamp();

  -- Marcas de avisoDeCardInventado. Ver comentario acima e _prova_guarda_honesto.ts.
  c_guarda_abre  constant text := 'identificador(es)? n[aã]o exist';
  c_guarda_miolo constant text := 'Nenhuma ferramenta devolveu';
  c_guarda_fecha constant text := 'Confira em get_aprovacoes antes de aprovar';

  v_18_falhas int; v_18_casos int;
  v_19_casos  int;
  v_20_falhas int; v_20_casos int;
  v_21_falhas int;
  v_22_falhas int; v_22_tinha_dado boolean;
  v_evid text;
begin
  if p_rodada is null or btrim(p_rodada) = '' then
    raise exception 'rodada obrigatoria: sem rotulo de rodada a serie historica nao existe';
  end if;

  -- Reexecucao da mesma rodada sobrescreve. Duas linhas para a mesma (conjunto, codigo, rodada)
  -- fariam taxa_de_erro_perguntas_ouro contar a mesma pergunta duas vezes.
  delete from public.perguntas_ouro_execucoes
   where conjunto = 'v3' and rodada = p_rodada;

  -- --------------------------------------------------------------------
  -- PO-18 / PO-19: identificador fabricado e guarda honesto.
  -- Sao computados juntos porque o segundo so significa algo como recorte do primeiro.
  -- --------------------------------------------------------------------
  with msgs as (
    select m.id, m.company_id, m.conversation_id, m.content,
           coalesce(m.tool_results::text, '') as tr,
           (m.content ~* c_guarda_abre
            and (m.content like '%' || c_guarda_miolo || '%'
              or m.content like '%' || c_guarda_fecha || '%')) as guarda
      from public.chat_messages m
     where m.role = 'assistant'
       and m.created_at >= v_ini and m.created_at < v_fim
       and m.content is not null
       and (p_company_id is null or m.company_id = p_company_id)
  ),
  citados as (
    select distinct msgs.id, msgs.company_id, msgs.conversation_id, msgs.tr, msgs.guarda,
           lower(g.m[1]) as uuid_citado
      from msgs,
           lateral regexp_matches(
             msgs.content,
             '[0-9a-z]{8}-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{12}',
             'gi') as g(m)
  ),
  julgados as (
    select c.id, c.guarda, c.uuid_citado,
           case
             -- Devolvido por ferramenta NESTE turno, ou o id da propria conversa: absolve sem
             -- ir ao banco. E a mesma pre-selecao local de approvalIdsInventados.
             when position(c.uuid_citado in lower(c.tr)) > 0 then false
             when c.uuid_citado = lower(coalesce(c.conversation_id::text, '')) then false
             -- Fora do hexadecimal nao ha o que consultar: a coluna e uuid e a consulta
             -- estouraria, absolvendo justamente o caso mais obvio de invencao.
             when c.uuid_citado !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
               then true
             when exists (select 1 from public.approval_requests a
                           where a.company_id = c.company_id and a.id::text = c.uuid_citado)
               then false
             else true
           end as fabricado
      from citados c
  )
  select count(*),
         count(*) filter (where fabricado and not guarda),
         count(distinct id) filter (where fabricado and guarda),
         coalesce(string_agg(distinct uuid_citado, ', ')
                    filter (where fabricado and not guarda), '(nenhum)')
    into v_18_casos, v_18_falhas, v_19_casos, v_evid
    from julgados;

  insert into public.perguntas_ouro_execucoes
    (conjunto, codigo, versao_do_agente, rodada, veredito, evidencia, executada_em)
  values ('v3','PO-18', p_versao_do_agente, p_rodada,
    case when v_18_casos = 0 then 'nao_executada'
         when v_18_falhas = 0 then 'passou' else 'falhou' end,
    format('%s UUID citados na janela %s..%s; %s fabricados fora do guarda. Ids: %s',
           v_18_casos, p_de, p_ate, v_18_falhas, left(v_evid, 1200)),
    now());

  insert into public.perguntas_ouro_execucoes
    (conjunto, codigo, versao_do_agente, rodada, veredito, evidencia, executada_em)
  values ('v3','PO-19', p_versao_do_agente, p_rodada,
    case when v_19_casos = 0 then 'nao_executada' else 'passou' end,
    format('%s mensagens do guarda honesto na janela, com UUID inexistente citado de proposito. Nenhuma delas entrou nas %s falhas do PO-18. Sem ocorrencia o veredito e nao_executada, nao passou.',
           v_19_casos, v_18_falhas),
    now());

  -- --------------------------------------------------------------------
  -- PO-20: cobertura silenciada com restantes>0.
  -- --------------------------------------------------------------------
  select count(*),
         count(*) filter (
           where m.content !~* '(restante|omitid|truncad|corte|p[aá]gina|faltam|n[aã]o exibid|parcial|cobertura)')
    into v_20_casos, v_20_falhas
    from public.chat_messages m
   where m.role = 'assistant'
     and m.created_at >= v_ini and m.created_at < v_fim
     and m.content is not null
     and (p_company_id is null or m.company_id = p_company_id)
     and m.tool_results is not null
     and jsonb_path_exists(m.tool_results, '$.**.restantes ? (@ > 0)');

  insert into public.perguntas_ouro_execucoes
    (conjunto, codigo, versao_do_agente, rodada, veredito, evidencia, executada_em)
  values ('v3','PO-20', p_versao_do_agente, p_rodada,
    case when v_20_casos = 0 then 'nao_executada'
         when v_20_falhas = 0 then 'passou' else 'falhou' end,
    format('%s respostas receberam restantes>0; %s (%s%%) nao declararam cobertura nenhuma.',
           v_20_casos, v_20_falhas,
           case when v_20_casos = 0 then '0'
                else round(100.0 * v_20_falhas / v_20_casos, 1)::text end),
    now());

  -- --------------------------------------------------------------------
  -- PO-21: reemissao duplicada da mesma peca no mesmo conjunto.
  -- --------------------------------------------------------------------
  with cards as (
    select a.id, a.company_id, a.created_at, a.status::text as st,
           coalesce(a.payload->>'drive_file_id', a.payload->'params'->>'drive_file_id') as dfid,
           coalesce(a.payload->>'conjunto_destino_external_id',
                    a.payload->'params'->>'conjunto_destino_external_id',
                    a.payload->>'conjunto_destino',
                    a.payload->'params'->>'conjunto_destino') as destino
      from public.approval_requests a
     where a.action = 'criar_anuncio_a_partir_de'
       and a.created_at >= v_ini and a.created_at < v_fim
       and (p_company_id is null or a.company_id = p_company_id)
  )
  select count(*) into v_21_falhas
    from cards c1
    join cards c2
      on c2.company_id = c1.company_id
     and c2.dfid = c1.dfid and c2.destino = c1.destino
     and c2.created_at > c1.created_at
   where c1.st = 'approved' and c2.st = 'approved'
     and c1.dfid is not null and c1.destino is not null
     and not exists (
       select 1 from cards r
        where r.company_id = c1.company_id and r.dfid = c1.dfid and r.destino = c1.destino
          and r.st = 'rejected'
          and r.created_at > c1.created_at and r.created_at < c2.created_at);

  insert into public.perguntas_ouro_execucoes
    (conjunto, codigo, versao_do_agente, rodada, veredito, evidencia, executada_em)
  values ('v3','PO-21', p_versao_do_agente, p_rodada,
    case when v_21_falhas = 0 then 'passou' else 'falhou' end,
    format('%s pares (peca, conjunto) aprovados duas vezes sem rejeicao no meio, na janela %s..%s. Nao existe chave de idempotencia: enquanto nao existir, este numero mede a classe.',
           v_21_falhas, p_de, p_ate),
    now());

  -- --------------------------------------------------------------------
  -- PO-22: origem da peca no Drive declarada ausente com o card carregando o id.
  -- --------------------------------------------------------------------
  select exists (
    select 1 from public.approval_requests a
     where a.action = 'criar_anuncio_a_partir_de'
       and a.created_at >= v_ini and a.created_at < v_fim
       and (p_company_id is null or a.company_id = p_company_id)
       and coalesce(a.payload->>'drive_file_id', a.payload->'params'->>'drive_file_id') is not null)
    into v_22_tinha_dado;

  select count(*) into v_22_falhas
    from public.chat_messages m
   where m.role = 'assistant'
     and m.created_at >= v_ini and m.created_at < v_fim
     and m.content is not null
     and (p_company_id is null or m.company_id = p_company_id)
     and v_22_tinha_dado
     and m.content ~* '(sem v[ií]nculo|sem origem|origem n[aã]o identificad|pasta n[aã]o (consta|identificad)|n[aã]o foi poss[ií]vel identificar a pasta)'
     and m.content ~* '(drive|pasta)';

  insert into public.perguntas_ouro_execucoes
    (conjunto, codigo, versao_do_agente, rodada, veredito, evidencia, executada_em)
  values ('v3','PO-22', p_versao_do_agente, p_rodada,
    case when not v_22_tinha_dado then 'nao_executada'
         when v_22_falhas = 0 then 'passou' else 'falhou' end,
    format('%s respostas negaram a origem no Drive na janela, havendo card com drive_file_id preenchido. Predicado por classe, nao por anuncio: cada acusacao pede leitura da mensagem.',
           v_22_falhas),
    now());

  -- CARIMBAR versao_da_pergunta NAO E OPCIONAL. taxa_de_erro_perguntas_ouro compara
  -- coalesce(execucao.versao_da_pergunta, 1) com a versao vigente da pergunta para decidir se a
  -- rodada e COMPARAVEL com as anteriores. Deixando a coluna nula, tudo vira "versao 1": hoje
  -- isso acerta por coincidencia (as cinco perguntas nasceram na versao 1) e passa a mentir na
  -- primeira vez que alguem reescrever um predicado — a rodada nova seria acusada de deriva, e
  -- a acusacao que aparece quando nada mudou e a que ensina a ignorar o aviso.
  v_ms := greatest(0, (extract(epoch from (clock_timestamp() - v_t0)) * 1000)::integer);
  update public.perguntas_ouro_execucoes e
     set ms = v_ms,
         versao_da_pergunta = q.versao
    from public.perguntas_ouro q
   where q.conjunto = 'v3' and q.codigo = e.codigo and q.vigente
     and e.conjunto = 'v3' and e.rodada = p_rodada;

  return public.taxa_de_erro_perguntas_ouro('v3', p_rodada)
      || jsonb_build_object(
           'janela', jsonb_build_object('de', p_de, 'ate', p_ate),
           'company_id', p_company_id,
           'ms', v_ms,
           'nota', 'v3 e verificavel contra o corpus gravado: nao chama LLM e nao mede resposta a pergunta nova. v1/v2 continuam exigindo turno vivo e NAO sao executados por esta funcao.');
end
$function$;

comment on function public.rodar_perguntas_ouro_v3(text, text, uuid, date, date) is
  'Executor da suite de regressao v3: roda os cinco predicados sobre chat_messages e approval_requests da janela e grava uma linha por pergunta em perguntas_ouro_execucoes. Sem LLM, sem chave de API — a suite anterior parou em 06/08/2026 justamente por depender das duas coisas.';

-- COMO RODAR, HOJE, sob demanda (service_role):
--   select public.rodar_perguntas_ouro_v3('rotulo-da-rodada', 'versao-do-agente');
-- A janela default e os ultimos 45 dias; passe p_de/p_ate para reproduzir uma janela fechada,
-- e p_company_id para recortar uma empresa.
--
-- O GATILHO QUE ESTA MIGRATION NAO LIGA, e o desenho dele, para nao ser redescoberto:
--   a) o gatilho util NAO e o deploy, e a JANELA. Estes predicados medem classe de falha sobre
--      o corpus; rodar no deploy media um corpus que ainda nao contem nenhum turno da versao
--      nova, e o resultado seria a nota da versao anterior com o rotulo da nova. O certo e
--      diario, com a rodada rotulada pela data, mais uma corrida manual apos cada deploy
--      passadas 24h de trafego real.
--   b) o encaixe pronto e tarefas_agendadas/execucoes_agendadas
--      (20260903200000_registro_de_execucoes_e_alerta_legivel.sql), que ja tem cron pelo
--      registro e alerta legivel. Uma tarefa chamando esta funcao com
--      p_rodada = to_char(current_date,''YYYY-MM-DD'') fecha o ciclo sem codigo novo.
--   c) o que o gatilho tem de comparar NAO e "falhou > 0" — na primeira execucao 4 de 5
--      falharam, e vao continuar falhando enquanto as classes existirem. O alerta util e
--      PIORA contra a rodada anterior, e ele so vale se COMPARAVEL vier true em
--      taxa_de_erro_perguntas_ouro: rodada julgada contra definicao mudada mede regua, nao
--      agente.

-- ============================================================================
-- 5) RLS E GRANTS
-- ============================================================================
-- Nenhuma tabela nova nesta migration: perguntas_ouro e perguntas_ouro_execucoes ja tem RLS
-- ligada com select para authenticated e escrita exclusiva do service_role (GT-18).
-- O executor e SECURITY DEFINER e escreve telemetria, entao segue a postura recente: fora do
-- alcance de anon e authenticated, chamado pelo service_role do script ou do cron.
--
-- O REVOKE E DE PUBLIC, NAO SO DOS DOIS PAPEIS, e a diferenca nao e estilo. Funcao nasce com
-- EXECUTE concedido a PUBLIC; revogar de anon e authenticated deixa o grant de PUBLIC de pe e
-- os dois continuam executando por heranca — o ACL fica com "=X/", que le como aberto. E o
-- mesmo conserto que 20260813161344_fecha_anon_revogando_de_public_correcao.sql ja fez uma vez
-- neste banco.

revoke all on function public.rodar_perguntas_ouro_v3(text, text, uuid, date, date)
  from public, anon, authenticated;
grant execute on function public.rodar_perguntas_ouro_v3(text, text, uuid, date, date)
  to service_role;
