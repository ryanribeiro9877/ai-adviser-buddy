-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260905103455
-- name: quatro_acoes_saem_do_contrato_desconhecido_e_o_array_vazio_vira_valor_por_campo
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration

-- ONDE ESTAVA O VOLUME: 22 dos 29 cards que reprovavam nao reprovavam por campo, e sim por
-- contrato_desconhecido em quatro acoes que nunca foram declaradas — pausar_criativo (15),
-- pausar_campanha (4), renomear_criativo (2), ativar_criativo (1). Dezoito delas executaram.
--
-- ============================================================================================
-- A FONTE DE EVIDENCIA QUE USEI, E POR QUE NAO FOI A OUTRA
-- ============================================================================================
--
-- A tabela aceita duas fontes: (a) payload de card que executou, e (b) leitura declarada do codigo
-- do executor. A tentacao aqui era usar (a) sozinha: em pausar_criativo, ONZE campos aparecem em
-- 12/12 cards que executaram, e seria comodo declarar os onze obrigatorios.
--
-- Isso repetiria exatamente o erro corrigido horas antes nesta mesma tabela. special_ad_categories
-- tambem estava presente em cards que executaram, e NAO era obrigatorio: presenca em todo payload
-- e correlacao com o emissor que montou o card, nao exigencia de quem executa. Entao a lista
-- abaixo sai de (b), com (a) so corroborando, e cada linha diz QUEM exige.
--
-- O QUE O EXECUTOR REALMENTE PRECISA NESTAS QUATRO ACOES (meta-actions, caminho v1):
--   pausar_*  -> post = { status: "PAUSED" }   (hardcoded; nenhum campo do payload entra)
--   ativar_*  -> post = { status: "ACTIVE" }   (hardcoded; nenhum campo do payload entra)
--   renomear_* -> post = { name: novo_nome }, e recusa nomeada se vazio:
--                 if (!novoNome) { motivo: "novo_nome ausente/vazio" }
--   alvo      -> const alvoExt = String(r.payload?.target_external_id ?? "")
--
-- Ou seja: fora renomear, o executor precisa de UM campo — o identificador do alvo. Todo o resto
-- do payload e narrativa do card, e narrativa so entra como obrigatoria quando alguem a exige de
-- verdade (o emissor, em traffic-chat.t_propose_action) e o historico confirma.
--
-- ============================================================================================
-- O RISCO REAL DESTAS QUATRO ACOES E O ALVO ERRADO, E O CONTRATO NAO O PEGA. DECLARADO.
-- ============================================================================================
--
-- Pergunta certa: a evidencia sustenta exigencia sobre a IDENTIDADE do alvo? Resposta medida: NAO,
-- e nao vou inventar uma.
--
-- O que o codigo mostra: o executor le UM identificador, target_external_id, e faz
-- GET /{alvoExt}?fields=<campos do nivel da acao>. Como a Graph derruba a consulta inteira com
-- OAuthException #100 quando se pede campo que o objeto nao tem, um pausar_criativo apontado para
-- uma CAMPANHA falharia na leitura (campanha nao tem adset_id nem creative). Mas isso NAO e guarda:
-- falha de leitura nao bloqueia a escrita nesse caminho — o `antes` fica como envelope de erro e o
-- POST { status: "PAUSED" } segue para o id informado, pausando o objeto errado.
--
-- As guardas que existem de fato sao duas, e nenhuma mora aqui:
--   1) token de Ads POR EMPRESA (ativarTokenEmpresa), que barra alvo de outra empresa;
--   2) o EMISSOR, que resolve o alvo a partir das tabelas espelho da propria empresa.
--
-- Entao a unica exigencia de identidade que a evidencia sustenta e legibilidade, nao verificacao:
-- target_name obrigatorio junto de target_external_id faz o card DIZER no que vai mexer, e um id
-- trocado fica visivel para quem aprova. Isso nao confere nada — esta escrito assim na observacao
-- de cada linha para ninguem confundir as duas coisas depois.
--
-- CONFERENCIA DE IDENTIDADE DE VERDADE (alvo existe, e da empresa, e do nivel da acao) NAO ENTRA
-- NESTA MIGRATION: o lugar dela e o segundo eixo (avaliar_estado_destino_execucao), vale para as
-- doze acoes executaveis e nao para quatro, e precisa de evidencia propria. Fica declarado como
-- buraco conhecido, nao coberto por presenca de campo.

-- ============================================================================================
-- (1) pausar_criativo · 15 cards, 12 executaram com ok=true
-- ============================================================================================
-- Os 3 que nao executaram sao de 23/07 e trazem no execution_result "pedido de TESTE da Fase 3
-- encerrado administrativamente sem execucao" — nunca foram a Meta, entao nao sustentam evidencia
-- de que metrica_sucesso/reversa possam faltar. Os 12 que executaram tem os cinco obrigatorios.
insert into public.contrato_de_execucao (acao, campo, obrigatorio, tipo, observacao, fonte) values
('pausar_criativo','target_external_id',true,'text',
 'ID Meta do ANUNCIO. Unico identificador que o executor le: const alvoExt = String(r.payload?.target_external_id ?? ""). Vai no GET do estado anterior e no POST de status. NAO ha conferencia de que o id seja de anuncio nem de que pertenca a empresa: quem limita e o token por empresa e o emissor, que resolve o alvo em ads da propria empresa.',
 'meta-actions caminho v1 (alvoExt) + payload dos 12 cards que executaram ok=true'),
('pausar_criativo','target_name',true,'text',
 'Nome humano do anuncio. NAO e exigido pela Graph — o executor usa so como rotulo de auditoria (alvoNome, com fallback para r.summary). Obrigatorio por LEGIBILIDADE: com o nome ao lado do id, alvo trocado fica visivel para quem aprova. Nao confere identidade nenhuma.',
 'traffic-chat.t_propose_action + meta-actions (alvoNome no audit_log); presente em 12/12 executados'),
('pausar_criativo','justificativa',true,'text',
 'Evidencia e motivo visiveis no card (EVIDENCIA: metrica + nivel + janela + periodo).',
 'traffic-chat.t_propose_action; presente em 15/15 cards'),
('pausar_criativo','metrica_sucesso',true,'text',
 'Releitura Graph confirma status PAUSED no anuncio.',
 'traffic-chat.t_propose_action + reconciliarAposEscrita; presente em 12/12 executados'),
('pausar_criativo','reversa',true,'text',
 'Plano de reativar. Existe ativar_criativo (update_ad ACTIVE, meta-actions v5.25).',
 'traffic-chat.t_propose_action; presente em 12/12 executados'),
-- Presentes em 12/12 executados, mas SEM exigente declarado: nem o executor os le, nem ha politica
-- de emissao que os peca. Ficam registrados como opcionais para nao aparecerem como campo
-- desconhecido, e NAO como obrigatorios — obrigatoriedade sem lastro e o defeito desta tabela.
('pausar_criativo','risco',false,'text','Narrativa do card. O executor nao le.','payload dos 12 executados (correlacao, nao exigencia)'),
('pausar_criativo','mecanismo',false,'text','Narrativa do card. O executor nao le.','idem'),
('pausar_criativo','janela_leitura',false,'text','Janela da evidencia que motivou o pedido. O executor nao le.','idem'),
('pausar_criativo','aviso_guarda_conjunto',false,'text','Aviso de guarda mostrado no card. O executor nao le.','idem'),
('pausar_criativo','aviso_orcamento',false,'text','Aviso de orcamento mostrado no card. O executor nao le.','idem'),
('pausar_criativo','proposto_por',false,'text','Quem propos. Metadado de emissao; o executor usa reviewed_by/requested_by da linha, nao este campo.','idem')
on conflict do nothing;

-- ============================================================================================
-- (2) pausar_campanha · 4 cards, 3 executaram com ok=true
-- ============================================================================================
-- ATENCAO AO QUE A EVIDENCIA PROIBE AQUI: era tentador copiar a lista de pausar_conjunto, que tem
-- metrica_sucesso e reversa obrigatorios. Os 3 cards que EXECUTARAM nao tem nenhum dos dois. Copiar
-- a simetria criaria 3 falsos positivos imediatos sobre cards que a Meta executou — o mesmo erro
-- que acabou de ser desfeito em criar_campanha. Entao os dois entram como OPCIONAIS.
insert into public.contrato_de_execucao (acao, campo, obrigatorio, tipo, observacao, fonte) values
('pausar_campanha','target_external_id',true,'text',
 'ID Meta da CAMPANHA. Unico identificador que o executor le (alvoExt). Sem conferencia de nivel nem de empresa: o token por empresa e o emissor sao as guardas.',
 'meta-actions caminho v1 (alvoExt) + payload dos 3 cards que executaram ok=true'),
('pausar_campanha','target_name',true,'text',
 'Nome humano da campanha. Rotulo de auditoria (alvoNome), nao exigencia da Graph. Obrigatorio por legibilidade do alvo; nao confere identidade.',
 'traffic-chat.t_propose_action + meta-actions (alvoNome); presente em 3/3 executados'),
('pausar_campanha','justificativa',true,'text',
 'Evidencia e motivo visiveis no card.',
 'traffic-chat.t_propose_action; presente em 4/4 cards'),
('pausar_campanha','metrica_sucesso',false,'text',
 'OPCIONAL POR EVIDENCIA: os 3 cards que executaram ok=true NAO tem este campo. pausar_conjunto o exige; a simetria nao se confirmou aqui e nao foi forcada.',
 'ausencia nos 3 cards executados (31/07 em diante)'),
('pausar_campanha','reversa',false,'text',
 'OPCIONAL POR EVIDENCIA: ausente nos 3 cards que executaram ok=true. Reativar campanha existe (ativar_campanha, v5.26), mas o campo nao foi exigido em nenhuma execucao.',
 'ausencia nos 3 cards executados'),
('pausar_campanha','risco',false,'text','Narrativa do card. O executor nao le.','payload do card de 22/08 (nao executado)'),
('pausar_campanha','mecanismo',false,'text','Narrativa do card. O executor nao le.','idem'),
('pausar_campanha','janela_leitura',false,'text','Janela da evidencia. O executor nao le.','idem'),
('pausar_campanha','aviso_guarda_conjunto',false,'text','Aviso mostrado no card. O executor nao le.','idem'),
('pausar_campanha','aviso_orcamento',false,'text','Aviso mostrado no card. O executor nao le.','idem'),
('pausar_campanha','proposto_por',false,'text','Quem propos. Metadado de emissao.','presente em 4/4 cards')
on conflict do nothing;

-- ============================================================================================
-- (3) renomear_criativo · 2 cards, 2 executaram com ok=true
-- ============================================================================================
-- Dois cards e evidencia fina para lista de campos, mas a obrigatoriedade aqui nao vem da contagem:
-- vem do codigo. RENOMEACOES inclui renomear_criativo e o executor RECUSA por nome:
--   const novoNome = String(r.payload?.novo_nome ?? "").trim();
--   if (!novoNome) { motivo: "novo_nome ausente/vazio" }
-- Isso e exigencia declarada, nao correlacao. Alinhado com renomear_campanha, que ja exige novo_nome.
insert into public.contrato_de_execucao (acao, campo, obrigatorio, tipo, observacao, fonte) values
('renomear_criativo','novo_nome',true,'text',
 'Nome livre desejado. O executor RECUSA com motivo "novo_nome ausente/vazio" quando falta ou e string vazia. Renomear e a mesma escrita nos tres niveis: POST /{id} com name (meta-actions v5.60).',
 'meta-actions RENOMEACOES + recusa nomeada novo_nome ausente/vazio'),
('renomear_criativo','target_external_id',true,'text',
 'ID Meta do ANUNCIO a renomear. Unico identificador que o executor le (alvoExt). Sem conferencia de nivel nem de empresa.',
 'meta-actions caminho v1 (alvoExt) + payload dos 2 cards que executaram ok=true'),
('renomear_criativo','target_name',true,'text',
 'Nome ATUAL do anuncio. Rotulo de auditoria (alvoNome) e legibilidade do alvo no card: renomear sem mostrar o nome de partida esconde justamente o erro de alvo. Nao confere identidade.',
 'traffic-chat + meta-actions (alvoNome); presente em 2/2 executados'),
('renomear_criativo','alvo_external_id',false,'text',
 'ALIAS DECORATIVO: aparece em 2/2 cards executados e o executor NAO o le — ele le target_external_id. Registrado como opcional so para que a duplicidade nao seja confundida com exigencia por quem ler os payloads.',
 'medicao 05/09/2026: presente nos 2 payloads, ausente no codigo do executor'),
('renomear_criativo','justificativa',false,'text',
 'OPCIONAL: presente em 2/2, mas a acao irma renomear_campanha nunca a exigiu, e 2 cards nao bastam para criar obrigatoriedade que o executor nao pede.',
 'payload dos 2 executados (correlacao); contraste com renomear_campanha'),
('renomear_criativo','metrica_sucesso',false,'text','Narrativa do card. O executor nao le.','payload dos 2 executados'),
('renomear_criativo','reversa',false,'text','Narrativa do card (renomear de volta). O executor nao le.','idem'),
('renomear_criativo','risco',false,'text','Narrativa do card. O executor nao le.','idem'),
('renomear_criativo','mecanismo',false,'text','Narrativa do card. O executor nao le.','idem'),
('renomear_criativo','janela_leitura',false,'text','Janela da evidencia. O executor nao le.','idem'),
('renomear_criativo','aviso_guarda_conjunto',false,'text','Aviso mostrado no card. O executor nao le.','idem'),
('renomear_criativo','aviso_orcamento',false,'text','Aviso mostrado no card. O executor nao le.','idem'),
('renomear_criativo','proposto_por',false,'text','Quem propos. Metadado de emissao.','idem')
on conflict do nothing;

-- ============================================================================================
-- (4) ativar_criativo · 1 card, 1 executou com ok=true
-- ============================================================================================
-- UM card nao sustenta lista de campos, e por isso a lista e MINIMA. O que sustenta a
-- obrigatoriedade dos dois campos abaixo nao e a contagem: e o codigo, fonte (b) da regra da tabela.
-- ativar_criativo esta em EXECUTAVEIS, o status e hardcoded ACTIVE (nenhum campo do payload entra
-- na escrita) e o alvo sai de target_external_id. Os quatro campos de narrativa do unico card ficam
-- opcionais — declarar obrigatorio a partir de uma amostra de um e adivinhar com passo extra.
insert into public.contrato_de_execucao (acao, campo, obrigatorio, tipo, observacao, fonte) values
('ativar_criativo','target_external_id',true,'text',
 'ID Meta do ANUNCIO a ativar. Unico identificador que o executor le (alvoExt). O status nao vem do payload: post = { status: "ACTIVE" } e hardcoded (meta-actions v5.25). Sem conferencia de nivel nem de empresa.',
 'meta-actions EXECUTAVEIS + caminho v1 (alvoExt) + payload do card que executou ok=true'),
('ativar_criativo','target_name',true,'text',
 'Nome humano do anuncio. Rotulo de auditoria (alvoNome) e legibilidade do alvo. Ativar o anuncio errado gasta dinheiro sem aviso, e o nome no card e o unico sinal disponivel para quem aprova. Nao confere identidade.',
 'traffic-chat.t_propose_action + meta-actions (alvoNome); presente no card executado'),
('ativar_criativo','justificativa',false,'text',
 'OPCIONAL: presente no unico card executado. Amostra de 1 nao sustenta obrigatoriedade, e o executor nao le.',
 'payload do card unico (correlacao, nao exigencia)'),
('ativar_criativo','metrica_sucesso',false,'text','Narrativa do card. O executor nao le. Amostra de 1.','idem'),
('ativar_criativo','reversa',false,'text','Narrativa do card (pausar de volta: pausar_criativo). O executor nao le. Amostra de 1.','idem'),
('ativar_criativo','proposto_por',false,'text','Quem propos. Metadado de emissao.','idem')
on conflict do nothing;

-- ============================================================================================
-- (5) O ARRAY VAZIO, RESOLVIDO POR CAMPO — porque a evidencia separou
-- ============================================================================================
--
-- campo_presente_no_pedido trata array vazio como AUSENTE (WHEN 'array' THEN
-- jsonb_array_length(...) > 0). Isso e certo para quase tudo e errado para um caso, e a duvida era
-- se dava para separar por campo em vez de mexer globalmente. A medicao separou:
--
--   [] SO APARECEU EM special_ad_categories, em 4 cards, e TODOS OS 4 EXECUTARAM ok=true:
--     3 em criar_campanha (ja resolvido: o campo virou opcional) e 1 em
--     alterar_categoria_especial_campanha (card 1ed16789, 22/08, special_ad_categories = []).
--   [] NUNCA APARECEU em plataformas_publicacao: 0 casos em 47 cards de conjunto.
--
-- E o codigo confirma os dois lados, em direcoes opostas:
--   alterar_categoria_especial_campanha ACEITA []: o executor so recusa NAO-array
--     (if (!Array.isArray(rawCats))), e depois manda JSON.stringify(cats) — [] remove a categoria.
--     E "array vazio = remove categoria especial" ja estava escrito na observacao da propria linha.
--   plataformas_publicacao NAO aceita []: o executor testa (plataformasPedidas != null), e [] passa
--     esse teste e cai em aplicarPosicionamentoPorPlataformas com lista vazia — conjunto sem rede.
--     Para esse campo, [] e ausencia disfarcada mesmo.
--
-- Entao a correcao e por campo, com uma coluna, e NAO uma mudanca em campo_presente_no_pedido
-- (que e compartilhada por todas as acoes e por meta-actions/meta-campaign-status).

alter table public.contrato_de_execucao
  add column if not exists vazio_conta_como_valor boolean not null default false;

comment on column public.contrato_de_execucao.vazio_conta_como_valor is
  'true = array vazio ([]) e VALOR legitimo deste campo, nao ausencia. So entra por evidencia: card que executou com [] mais caminho no executor que aceita lista vazia. Default false porque para quase todo campo de array [] e ausencia disfarcada (ex.: plataformas_publicacao = [] produziria conjunto sem rede).';

update public.contrato_de_execucao
   set vazio_conta_como_valor = true,
       observacao = observacao
         || ' | 05/09/2026: [] e VALOR aqui, nao ausencia. O executor so recusa nao-array '
         || '(if (!Array.isArray(rawCats))) e [] remove a categoria. O card 1ed16789 executou '
         || 'ok=true em 22/08 mandando [] e reprovava no contrato porque campo_presente_no_pedido '
         || 'conta array vazio como ausente.'
 where acao = 'alterar_categoria_especial_campanha'
   and campo = 'special_ad_categories'
   and vigente;

-- A funcao passa a honrar a coluna, e SO na conferencia de obrigatoriedade (`faltando`). Os outros
-- dois eixos (nao_suportados, valores_invalidos) continuam usando campo_presente_no_pedido sem
-- desvio: la o sentido "presente e nao vazio" e o correto, e mudar por simetria seria alargar sem
-- evidencia. campo_presente_no_pedido NAO e alterada.
create or replace function public.validar_pedido_contra_contrato_sem_estado_destino(p_acao text, p_pedido jsonb)
 returns jsonb
 language plpgsql
 stable
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_n int;
  v_faltando text[];
  v_extras text[];
  v_nao_suportados text[];
  v_valores_invalidos text[];
  v_recusa text;
  v_msg_recusa text;
begin
  select count(*) into v_n from public.contrato_de_execucao where acao = p_acao and vigente;

  if v_n = 0 then
    return jsonb_build_object(
      'valido', false,
      'motivo','contrato_desconhecido',
      'acao', p_acao,
      'mensagem','NAO existe contrato declarado para a acao "' || p_acao || '". Isso significa que ninguem registrou quais campos o executor exige - e nao que o pedido esta errado. '
        || 'Montar o card assim seria adivinhar, e adivinhar esta lista ja falhou tres vezes neste projeto. '
        || 'Quem resolve: quem le o codigo do meta-actions declara os campos, ou um card desta acao executa com sucesso e o payload dele vira a evidencia.',
      'como_registrar','insert into contrato_de_execucao (acao, campo, obrigatorio, tipo, fonte) values (...)');
  end if;

  -- vazio_conta_como_valor: [] deixa de contar como ausencia SO nos campos onde a evidencia mostrou
  -- que lista vazia e valor (hoje: alterar_categoria_especial_campanha.special_ad_categories).
  select array_agg(c.campo order by c.campo) into v_faltando
    from public.contrato_de_execucao c
   where c.acao = p_acao and c.vigente and c.obrigatorio
     and not public.campo_presente_no_pedido(p_pedido, c.campo)
     and not (
       c.vazio_conta_como_valor
       and p_pedido is not null
       and (p_pedido ? c.campo)
       and jsonb_typeof(p_pedido -> c.campo) = 'array'
       and jsonb_array_length(p_pedido -> c.campo) = 0
     );

  select array_agg(c.campo order by c.campo) into v_nao_suportados
    from public.contrato_de_execucao c
   where c.acao = p_acao and c.vigente and not c.suportado
     and public.campo_presente_no_pedido(p_pedido, c.campo);

  -- v5.5: valor fora da lista aceita. So conta com o campo PRESENTE (ausencia e obrigatoriedade,
  -- nao valor) e com valores_aceitos declarado. Espelha montarCriacao, que so aceita regime abo.
  select array_agg(c.campo order by c.campo) into v_valores_invalidos
    from public.contrato_de_execucao c
   where c.acao = p_acao and c.vigente and c.valores_aceitos is not null
     and public.campo_presente_no_pedido(p_pedido, c.campo)
     and not (lower(p_pedido->>c.campo) = any (select lower(x) from unnest(c.valores_aceitos) as x));

  select c.recusa_nomeada, c.mensagem_de_recusa into v_recusa, v_msg_recusa
    from public.contrato_de_execucao c
   where c.acao = p_acao and c.vigente and not c.suportado
     and public.campo_presente_no_pedido(p_pedido, c.campo)
   order by c.campo
   limit 1;

  select array_agg(k order by k) into v_extras
    from jsonb_object_keys(coalesce(p_pedido,'{}'::jsonb)) k
   where not exists (select 1 from public.contrato_de_execucao c
                      where c.acao = p_acao and c.vigente and c.campo = k);

  return jsonb_build_object(
    'valido', (v_faltando is null and v_nao_suportados is null and v_valores_invalidos is null),
    'acao', p_acao,
    'campos_exigidos', v_n,
    'faltando', coalesce(to_jsonb(v_faltando), '[]'::jsonb),
    'nao_suportados', coalesce(to_jsonb(v_nao_suportados), '[]'::jsonb),
    'valores_invalidos', coalesce(to_jsonb(v_valores_invalidos), '[]'::jsonb),
    'recusa', coalesce(v_recusa, case when v_valores_invalidos is not null then 'valor_de_campo_nao_aceito' end),
    'nao_previstos_no_contrato', coalesce(to_jsonb(v_extras), '[]'::jsonb),
    'nota_sobre_os_extras','Campo DESCONHECIDO do contrato nao invalida o pedido: pode ser narrativa (justificativa, risco, reversa) ou campo que o executor aceita e ninguem registrou. Isso NAO vale para campo suportado=false nem para valor fora de valores_aceitos: esses invalidam, porque o executor nao tem caminho para eles e segui-los publicaria/criaria outra coisa.',
    'mensagem', case
      when v_nao_suportados is not null then
        coalesce(v_msg_recusa, 'Pedido usa campo que o executor nao suporta: ' || array_to_string(v_nao_suportados, ', ') || '.')
        || ' O card NAO deve ser emitido.'
      when v_valores_invalidos is not null then
        'Pedido traz valor nao aceito em: ' || array_to_string(v_valores_invalidos, ', ')
        || '. O card NAO deve ser emitido - o executor recusaria depois de gastar uma aprovacao.'
      when v_faltando is not null then
        'Faltam campos obrigatorios: ' || array_to_string(v_faltando, ', ') || '. O card NAO deve ser emitido - ele falharia na execucao depois de gastar uma aprovacao.'
      else 'Pedido tem todos os campos obrigatorios declarados para esta acao e nenhum campo nao suportado.' end);
end;
$function$;

-- PERMISSAO NAO E TOCADA AQUI, DE PROPOSITO. `create or replace function` preserva a ACL
-- existente, entao nao ha nada a recolocar. Escrevi um revoke/grant primeiro e medi antes de
-- aplicar: esta funcao hoje tem execute para public, anon, authenticated e service_role, ao
-- contrario da irma validar_pedido_contra_contrato (postgres, authenticated, service_role). O
-- revoke teria APERTADO permissao que ninguem pediu, podendo derrubar chamador vivo. A assimetria
-- entre as duas fica como observacao para o gestor, nao como mudanca de carona nesta migration.

-- ============================================================================================
-- O QUE CONTINUA FORA, E POR QUE
-- ============================================================================================
--
-- (A) ativar_campanha, ativar_conjunto, renomear_conjunto, alterar_orcamento: estao em EXECUTAVEIS
--     do meta-actions e NAO tem contrato. Nao entram aqui porque nao ha card executado de nenhuma
--     delas nos 269, e semear as quatro so pela leitura do codigo, sem uma unica execucao, e o
--     movimento que a regra da tabela evita. Seguem em contrato_desconhecido, que e recusa honesta.
--
-- (B) Conferencia de identidade do alvo (existe / e da empresa / e do nivel da acao): buraco real,
--     declarado acima, nao coberto por presenca de campo. Lugar dela e avaliar_estado_destino_execucao.
