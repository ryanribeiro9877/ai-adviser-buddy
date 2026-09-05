-- RECUSA DE ALVO DE OUTRO NIVEL, PELO SEGUNDO EIXO, PARA AS DOZE ACOES EXECUTAVEIS.
--
-- O BURACO. O executor le o alvo por nivel (`GET /{alvoExt}?fields=<campos do nivel>`) e nao
-- conferia a falha dessa leitura. A Graph nao ignora campo inexistente: derruba a consulta INTEIRA
-- com OAuthException #100. Com o `antes` virando envelope de erro, o `POST { status: "PAUSED" }`
-- seguia igual para o id informado — um `pausar_criativo` apontado a uma campanha PAUSAVA A
-- CAMPANHA. Token de Ads por empresa e emissor resolvendo no espelho da propria empresa contem o
-- dano ao perimetro da empresa certa, mas nao ao objeto certo dentro dela.
--
-- POR QUE AQUI E NAO NO CONTRATO DE CAMPOS. O primeiro eixo confere PRESENCA de campo, e um id de
-- outro objeto passa em qualquer conferencia de presenca. `target_name` obrigatorio da
-- LEGIBILIDADE a quem aprova, de proposito, e nao substitui recusa mecanica. Semear exigencia nas
-- quatro acoes recem-contratadas seria remendo: o defeito vale para as doze executaveis.
--
-- O QUE A REGRA OBSERVA, E POR QUE NAO E "O ALVO EXISTE NESTE NIVEL".
-- A propriedade e "o alvo e conhecido em OUTRO nivel", e nao "o alvo existe neste nivel". A
-- diferenca decide falso positivo:
--   * id conhecido em outro nivel  = EVIDENCIA POSITIVA de alvo errado -> recusa.
--   * id ausente do espelho        = AUSENCIA DE INFORMACAO -> nao recusa. Objeto recem-criado e
--     ainda nao espelhado cairia exatamente ai, e recusa-lo seria trocar um risco por outro.
-- O inverso sustenta a escolha: alvo de nivel errado quase sempre ESTA no espelho, porque e de la
-- que o emissor tira o id que confundiu. A fonte deterministica pega justamente o caso que importa.
--
-- EVIDENCIA (medida em 05/09/2026, antes de aplicar):
--   * 27 cards das doze acoes executaveis, 22 executados na Meta: 27 resolvem no nivel CERTO,
--     0 no nivel errado, 0 fora do espelho. Nenhum card historico passa a reprovar.
--   * 568 ids distintos nos tres espelhos, 0 presente em mais de um nivel — a regra nao pode
--     acusar card bom por colisao de id entre tabelas.
--
-- A OUTRA METADE, QUE NAO CABE AQUI. Este eixo roda na EMISSAO e so ve o espelho. O sinal #100 da
-- Graph existe apenas na EXECUCAO, e por isso a recusa antes do POST vive em
-- `supabase/functions/meta-actions/index.ts`, com o classificador em `_shared/nivel_do_alvo.ts` e
-- prova em `_shared/_prova_nivel_do_alvo.ts`. Nao sao duas copias da mesma conferencia: cada
-- momento tem informacao diferente disponivel. A parte comum — qual espelho e de qual nivel — esta
-- amarrada nos dois lados pela prova, para nao derivar.

-- ============================================================================
-- 1) O eixo aprende a olhar identidade, alem de estado.
-- ============================================================================
create or replace function public.avaliar_estado_destino_execucao(
  p_acao text, p_pedido jsonb, p_company_id uuid default null::uuid
) returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  v_regra public.contrato_de_estado_execucao%rowtype;
  v_destino text; v_conta text; v_estado boolean; v_encontrado boolean;
  v_avaliacoes jsonb := '[]'::jsonb; v_uma jsonb; v_recusa jsonb := null; v_alguma boolean := false;
begin
  for v_regra in
    select * from public.contrato_de_estado_execucao
     where acao = p_acao and vigente
     order by coalesce(ordem, 1000), campo_destino, propriedade
  loop
    if v_regra.condicao_campo_pedido is not null
       and not exists (
         select 1 from unnest(string_to_array(v_regra.condicao_campo_pedido, ',')) c
          where public.campo_presente_no_pedido(p_pedido, btrim(c))
       ) then
      v_avaliacoes := v_avaliacoes || jsonb_build_object('propriedade', v_regra.propriedade,
        'avaliado', false, 'motivo', 'condicao_do_pedido_ausente', 'condicao', v_regra.condicao_campo_pedido);
      continue;
    end if;

    v_destino := coalesce(
      nullif(btrim(coalesce(p_pedido->>v_regra.campo_destino,'')),''),
      case when v_regra.campo_destino = 'creative_id'
           then coalesce(nullif(btrim(coalesce(p_pedido->>'molde','')),''),
                         nullif(btrim(coalesce(p_pedido->>'molde_creative_id','')),''))
      end,
      nullif(btrim(coalesce(p_pedido->>'conjunto_destino','')),''));
    if v_destino is null then
      v_avaliacoes := v_avaliacoes || jsonb_build_object('propriedade', v_regra.propriedade,
        'avaliado', false, 'motivo', 'destino_ausente');
      continue;
    end if;
    v_conta := regexp_replace(nullif(btrim(coalesce(p_pedido->>'conta_destino','')),''), '^act_', '');

    v_estado := null; v_encontrado := false;
    if v_regra.propriedade = 'is_dynamic_creative' then
      select a.is_dynamic_creative, true into v_estado, v_encontrado from public.ad_sets a
       where a.external_id = v_destino and (p_company_id is null or a.company_id = p_company_id)
         and (v_conta is null or a.account_id = v_conta)
       order by a.estado_graph_observado_em desc nulls last limit 1;
    elsif v_regra.propriedade = 'campanha_tem_orcamento_proprio' then
      select case when c.config_coletada_em is null then null
                  else (coalesce(c.daily_budget,0) > 0 or coalesce(c.lifetime_budget,0) > 0) end,
             true
        into v_estado, v_encontrado
        from public.campaigns c
       where c.external_id = v_destino and c.provider = 'meta_ads'
         and (p_company_id is null or c.company_id = p_company_id)
         and (v_conta is null or c.external_account_id = v_conta)
       order by c.config_coletada_em desc nulls last limit 1;
    elsif v_regra.propriedade in (
      'molde_expoe_video_data', 'molde_serve_de_imagem',
      'molde_expoe_page_id', 'molde_expoe_link_destino'
    ) then
      select case v_regra.propriedade
               when 'molde_expoe_video_data'   then coalesce(k.serve_de_molde_video, k.expoe_video_data)
               when 'molde_serve_de_imagem'    then coalesce(k.serve_de_molde_imagem, k.expoe_link_data)
               when 'molde_expoe_page_id'      then k.expoe_page_id
               else                                 k.expoe_link_destino
             end,
             true
        into v_estado, v_encontrado
        from public.creative_estado_graph k
       where k.creative_id = v_destino
         and (v_conta is null or k.account_id is null or k.account_id = v_conta)
       limit 1;
    elsif v_regra.propriedade in (
      'alvo_conhecido_em_outro_nivel_que_campanha',
      'alvo_conhecido_em_outro_nivel_que_conjunto',
      'alvo_conhecido_em_outro_nivel_que_anuncio'
    ) then
      -- IDENTIDADE, NAO ESTADO. O nome da propriedade carrega o nivel que a acao declara; a
      -- consulta pergunta pelos OUTROS DOIS. `v_encontrado` e sempre true porque a pergunta sempre
      -- tem resposta: o que varia e o que ela responde. Por isso `recusa_estado_desconhecido` nao
      -- se aplica aqui — ausencia do espelho devolve false (nao recusa), de proposito.
      select
        (case when v_regra.propriedade <> 'alvo_conhecido_em_outro_nivel_que_campanha'
              then exists (select 1 from public.campaigns c
                            where c.external_id = v_destino and c.provider = 'meta_ads'
                              and (p_company_id is null or c.company_id = p_company_id))
              else false end)
        or (case when v_regra.propriedade <> 'alvo_conhecido_em_outro_nivel_que_conjunto'
                 then exists (select 1 from public.ad_sets s
                               where s.external_id = v_destino and s.provider = 'meta_ads'
                                 and (p_company_id is null or s.company_id = p_company_id))
                 else false end)
        or (case when v_regra.propriedade <> 'alvo_conhecido_em_outro_nivel_que_anuncio'
                 then exists (select 1 from public.ads a
                               where a.external_id = v_destino and a.provider = 'meta_ads'
                                 and (p_company_id is null or a.company_id = p_company_id))
                 else false end),
        true
      into v_estado, v_encontrado;
    end if;

    if not coalesce(v_encontrado,false) or v_estado is null then
      v_uma := jsonb_build_object('propriedade', v_regra.propriedade, 'avaliado', true,
        'estado_observado', null, 'valido', false,
        'recusa', v_regra.recusa_estado_desconhecido, 'mensagem', v_regra.mensagem_estado_desconhecido);
    elsif v_estado = v_regra.valor_recusado then
      v_uma := jsonb_build_object('propriedade', v_regra.propriedade, 'avaliado', true,
        'estado_observado', v_estado, 'valido', false,
        'recusa', v_regra.recusa_nomeada, 'mensagem', v_regra.mensagem_de_recusa);
    else
      v_uma := jsonb_build_object('propriedade', v_regra.propriedade, 'avaliado', true,
        'estado_observado', v_estado, 'valido', true,
        'mensagem', 'Estado do destino verificado e compativel com o pedido.');
    end if;

    v_alguma := true;
    v_avaliacoes := v_avaliacoes || v_uma;
    if (v_uma->>'valido')::boolean is not true and v_recusa is null then v_recusa := v_uma; end if;
  end loop;

  if v_recusa is not null then
    return v_recusa || jsonb_build_object('avaliacoes', v_avaliacoes);
  end if;
  if not v_alguma then
    return jsonb_build_object('valido', true, 'avaliado', false,
      'motivo', case when exists (select 1 from public.contrato_de_estado_execucao where acao=p_acao and vigente)
                     then 'nenhuma_regra_aplicavel_ao_pedido' else 'acao_sem_regra_de_estado' end,
      'avaliacoes', v_avaliacoes);
  end if;
  return jsonb_build_object('valido', true, 'avaliado', true, 'avaliacoes', v_avaliacoes,
    'mensagem', 'Todos os estados de destino declarados para esta acao foram verificados e aceitam o pedido.');
end; $function$;

-- ============================================================================
-- 2) Uma regra por acao executavel. Doze, nao quatro.
-- ============================================================================
insert into public.contrato_de_estado_execucao (
  acao, campo_destino, propriedade, valor_recusado,
  recusa_nomeada, mensagem_de_recusa,
  recusa_estado_desconhecido, mensagem_estado_desconhecido,
  fonte, vigente, ordem
)
select v.acao, 'target_external_id', v.propriedade, true,
  'alvo_de_outro_nivel_no_espelho',
  'O identificador do alvo pertence a outro nivel da conta: a acao escreve em ' || v.nivel ||
    ', e o espelho conhece este id como outro objeto. Executar assim escreveria no objeto errado ' ||
    '(uma pausa de criativo apontada a uma campanha pausa a campanha). Confira o alvo do card.',
  'alvo_de_nivel_nao_conferido',
  'Nao foi possivel decidir o nivel do alvo pelo espelho. Ausencia do espelho nao e recusa: ' ||
    'objeto recem-criado ainda nao espelhado cai aqui, e a conferencia mecanica antes da escrita ' ||
    'ocorre de novo no executor, com o sinal da Graph.',
  'evidencia 05/09/2026: 27 cards das doze acoes executaveis (22 executados na Meta) resolvem ' ||
    '27/27 no nivel certo, 0 no nivel errado e 0 fora do espelho; 568 ids distintos nos tres ' ||
    'espelhos, 0 em mais de um nivel. Buraco medido: o executor lia o alvo por nivel, a Graph ' ||
    'derrubava a leitura com #100 quando o id era de outro nivel, e o POST seguia igual.',
  true, 1
from (values
  ('pausar_campanha', 'campanha', 'alvo_conhecido_em_outro_nivel_que_campanha'),
  ('ativar_campanha', 'campanha', 'alvo_conhecido_em_outro_nivel_que_campanha'),
  ('renomear_campanha', 'campanha', 'alvo_conhecido_em_outro_nivel_que_campanha'),
  ('alterar_categoria_especial_campanha', 'campanha', 'alvo_conhecido_em_outro_nivel_que_campanha'),
  ('pausar_conjunto', 'conjunto', 'alvo_conhecido_em_outro_nivel_que_conjunto'),
  ('ativar_conjunto', 'conjunto', 'alvo_conhecido_em_outro_nivel_que_conjunto'),
  ('renomear_conjunto', 'conjunto', 'alvo_conhecido_em_outro_nivel_que_conjunto'),
  ('alterar_orcamento', 'conjunto', 'alvo_conhecido_em_outro_nivel_que_conjunto'),
  ('ajustar_posicionamentos_do_conjunto', 'conjunto', 'alvo_conhecido_em_outro_nivel_que_conjunto'),
  ('pausar_criativo', 'anuncio', 'alvo_conhecido_em_outro_nivel_que_anuncio'),
  ('ativar_criativo', 'anuncio', 'alvo_conhecido_em_outro_nivel_que_anuncio'),
  ('renomear_criativo', 'anuncio', 'alvo_conhecido_em_outro_nivel_que_anuncio')
) as v(acao, nivel, propriedade)
where not exists (
  select 1 from public.contrato_de_estado_execucao e
   where e.acao = v.acao and e.campo_destino = 'target_external_id' and e.propriedade = v.propriedade
);
