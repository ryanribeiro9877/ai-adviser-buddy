-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260807124614
-- name: carrossel_e_foto_recusam_por_nome_nos_dois_lados
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

-- CARROSSEL E FOTO: DE FALHA SILENCIOSA A RECUSA NOMEADA, NOS DOIS LADOS.
--
-- O QUE ACONTECIA (07/08/2026). montarCriacao nao le child_attachments nem meta_image_hash em
-- ramo nenhum: o pedido atravessava intacto e terminava na REPLICACAO PURA. A Meta publicava o
-- criativo do MOLDE. O card voltava "CRIADO", o espelho gravava, e no ar estava a peca ANTIGA,
-- gastando. Acerto aparente e pior que erro: nao ha sintoma para ninguem investigar.
--
-- Do lado do contrato o buraco era simetrico: validar_pedido_contra_contrato so sabia perguntar
-- "faltou campo obrigatorio?". Campo presente e nao previsto caia em nao_previstos_no_contrato,
-- com a nota "campo extra NAO invalida o pedido" - correta para narrativa (justificativa, risco),
-- desastrosa para um campo que muda O QUE VAI AO AR. O pedido de carrossel saia valido=true.
--
-- O QUE MUDA. O contrato ganha um terceiro eixo, alem de existe/obrigatorio: SUPORTADO. Campo
-- declarado suportado=false PRESENTE no pedido invalida - fail-closed, com nome proprio, e o nome
-- e o MESMO que o executor usa (carrossel_nao_suportado / foto_nao_suportada). A lista nao esta
-- escrita em codigo: mora na tabela, e as duas RPCs leem de la.
--
-- INVARIANTE DA PO-17 v2 (nunca completo=true com o executor recusando): so fecha se os dois
-- lados considerarem presente exatamente o mesmo conjunto de valores. Por isso a nocao de
-- "presente" vira funcao unica, campo_presente_no_pedido, espelhada em TypeScript por
-- campoPresente() no meta-actions. Vazio nao e pedido: '', [] e {} contam como ausentes nos dois.
--
-- POR QUE ISSO NAO E "SO ADICIONAR SUPORTE A CARROSSEL": montar carrossel exige child_attachments
-- com peca, link e CTA por cartao; publicar foto exige trocar video_data por image_hash, o que
-- muda o FORMATO do anuncio, nao a peca. Sao trabalho declarado, nao ajuste - e ate existirem, a
-- recusa que custa um card e infinitamente mais barata que a peca errada no ar.

alter table public.contrato_de_execucao
  add column if not exists suportado boolean not null default true,
  add column if not exists recusa_nomeada text,
  add column if not exists mensagem_de_recusa text;

comment on column public.contrato_de_execucao.suportado is
  'false = campo que o executor NAO tem caminho para atender. Presente no pedido, INVALIDA (fail-closed), em vez de virar "campo extra". Existe porque carrossel e foto atravessavam o validador como extras inofensivos e o executor publicava o criativo do molde no lugar.';

comment on column public.contrato_de_execucao.recusa_nomeada is
  'nome da recusa, identico ao que montarCriacao devolve em erro. Mesmo nome nos dois lados para que o motivo do card e o motivo da execucao sejam rastreaveis como a mesma coisa.';

comment on column public.contrato_de_execucao.mensagem_de_recusa is
  'explicacao para o GESTOR quando o campo nao suportado aparece: o que ele pediu, por que nao ha caminho e o que fazer no lugar.';

-- NOCAO UNICA DE "CAMPO PRESENTE". Espelhada em campoPresente() no meta-actions; divergir aqui
-- reabre a assimetria que a PO-17 v2 proibe.
CREATE OR REPLACE FUNCTION public.campo_presente_no_pedido(p_pedido jsonb, p_campo text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN p_pedido IS NULL OR NOT (p_pedido ? p_campo) THEN false
    ELSE CASE jsonb_typeof(p_pedido -> p_campo)
      WHEN 'null'   THEN false
      WHEN 'string' THEN nullif(btrim(p_pedido ->> p_campo), '') IS NOT NULL
      WHEN 'array'  THEN jsonb_array_length(p_pedido -> p_campo) > 0
      WHEN 'object' THEN (p_pedido -> p_campo) <> '{}'::jsonb
      ELSE true
    END
  END;
$function$;

comment on function public.campo_presente_no_pedido(jsonb, text) is
  'Um pedido tem este campo? Vazio nao conta: string em branco, array vazio e objeto vazio sao ausentes. Fonte unica usada por validar_pedido_contra_contrato e pedido_de_anuncio_completo, espelhada por campoPresente() em supabase/functions/meta-actions/index.ts. Se as duas nocoes divergirem, volta a ser possivel um pedido completo=true que o executor recusa.';

insert into public.contrato_de_execucao
  (acao, campo, obrigatorio, tipo, observacao, fonte, suportado, recusa_nomeada, mensagem_de_recusa)
select v.acao, v.campo, v.obrigatorio, v.tipo, v.observacao, v.fonte,
       v.suportado, v.recusa_nomeada, v.mensagem_de_recusa
  from (values
    (
      'criar_anuncio_a_partir_de', 'child_attachments', false, 'jsonb',
      'CARROSSEL. NAO SUPORTADO: montarCriacao so replica o criativo do molde ou troca a midia de um video_data. Antes de 07/08/2026 o campo era ignorado em silencio e ia ao ar o criativo do MOLDE.',
      'supabase/functions/meta-actions/index.ts montarCriacao (recusa carrossel_nao_suportado)',
      false, 'carrossel_nao_suportado',
      'Voce pediu um CARROSSEL, e eu nao tenho caminho para publicar carrossel: eu sei replicar um anuncio que ja roda ou trocar o VIDEO de um anuncio de video. Nao emito o card porque, ate hoje, um pedido assim nao dava erro - ele publicava o criativo do anuncio molde, a peca ANTIGA, e o gasto comecava com todo mundo achando que o carrossel novo estava no ar. Monte o carrossel no Gerenciador, ou peca o suporte a carrossel como trabalho.'
    ),
    (
      'criar_anuncio_a_partir_de', 'meta_image_hash', false, 'text',
      'FOTO (imagem ja na biblioteca da conta). NAO SUPORTADO: a rota de peca nova copia o object_story_spec do molde e troca video_id; molde de video nao vira anuncio de imagem trocando um campo - muda o formato. Antes de 07/08/2026 o campo era ignorado em silencio.',
      'supabase/functions/meta-actions/index.ts montarCriacao (recusa foto_nao_suportada)',
      false, 'foto_nao_suportada',
      'Voce pediu para publicar uma FOTO, e eu so publico peca nova em VIDEO. Trocar video por imagem nao e trocar a peca: muda o formato do anuncio, e o molde de onde eu herdo pagina, link e botao e de video. Nao emito o card porque, ate hoje, um pedido assim nao dava erro - ele publicava o criativo do anuncio molde e o gasto comecava com a peca errada no ar. Publique a foto pelo Gerenciador, ou peca o suporte a imagem como trabalho.'
    )
  ) as v(acao, campo, obrigatorio, tipo, observacao, fonte, suportado, recusa_nomeada, mensagem_de_recusa)
 where not exists (
   select 1 from public.contrato_de_execucao c
    where c.acao = v.acao and c.campo = v.campo
 );

-- VALIDADOR: passa a ter tres respostas, nao duas. Faltou obrigatorio -> invalido. Presente e
-- declarado nao suportado -> invalido, com nome. Presente e desconhecido -> continua sendo so
-- informacao para quem mantem o contrato, como sempre foi.
CREATE OR REPLACE FUNCTION public.validar_pedido_contra_contrato(p_acao text, p_pedido jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
AS $function$
declare
  v_n int;
  v_faltando text[];
  v_extras text[];
  v_nao_suportados text[];
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

  -- Presenca pela nocao unica: '' , [] e {} sao ausentes aqui como sao em
  -- pedido_de_anuncio_completo e em montarCriacao. Antes era `p_pedido ? campo`, que dava
  -- valido=true para "nome_novo": "" enquanto os outros dois recusavam.
  select array_agg(c.campo order by c.campo) into v_faltando
    from public.contrato_de_execucao c
   where c.acao = p_acao and c.vigente and c.obrigatorio
     and not public.campo_presente_no_pedido(p_pedido, c.campo);

  select array_agg(c.campo order by c.campo) into v_nao_suportados
    from public.contrato_de_execucao c
   where c.acao = p_acao and c.vigente and not c.suportado
     and public.campo_presente_no_pedido(p_pedido, c.campo);

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
    'valido', (v_faltando is null and v_nao_suportados is null),
    'acao', p_acao,
    'campos_exigidos', v_n,
    'faltando', coalesce(to_jsonb(v_faltando), '[]'::jsonb),
    'nao_suportados', coalesce(to_jsonb(v_nao_suportados), '[]'::jsonb),
    'recusa', v_recusa,
    'nao_previstos_no_contrato', coalesce(to_jsonb(v_extras), '[]'::jsonb),
    'nota_sobre_os_extras','Campo DESCONHECIDO do contrato nao invalida o pedido: pode ser narrativa (justificativa, risco, reversa) ou campo que o executor aceita e ninguem registrou. Ele e listado para quem mantiver o contrato decidir. Isso NAO vale para campo declarado suportado=false: esse invalida, porque o executor nao tem caminho para ele e ignora-lo em silencio publica outra coisa no lugar.',
    'mensagem', case
      when v_nao_suportados is not null then
        coalesce(v_msg_recusa, 'Pedido usa campo que o executor nao suporta: ' || array_to_string(v_nao_suportados, ', ') || '.')
        || ' O card NAO deve ser emitido.'
      when v_faltando is not null then
        'Faltam campos obrigatorios: ' || array_to_string(v_faltando, ', ') || '. O card NAO deve ser emitido - ele falharia na execucao depois de gastar uma aprovacao.'
      else 'Pedido tem todos os campos obrigatorios declarados para esta acao e nenhum campo nao suportado.' end);
end;
$function$;

comment on function public.validar_pedido_contra_contrato(text, jsonb) is
  'Confere um pedido contra contrato_de_execucao em tres eixos: campo obrigatorio ausente invalida; campo declarado suportado=false PRESENTE invalida com nome (carrossel_nao_suportado, foto_nao_suportada), porque o executor nao tem caminho para ele; campo desconhecido nao invalida, so e listado. Presenca segue campo_presente_no_pedido - vazio nao conta. A equivalencia com pedido_de_anuncio_completo e medida pela PO-17 v2.';
