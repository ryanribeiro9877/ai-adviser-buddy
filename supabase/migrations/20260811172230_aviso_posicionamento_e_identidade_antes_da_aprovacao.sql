-- AVISO DE POSICIONAMENTO E IDENTIDADE ANTES DA APROVACAO.
--
-- EVIDENCIA (UI da Meta "Editando 1 posicionamento", 11/08/2026):
--   "Este formato de midia nao e compativel com o posicionamento Facebook Coluna da direita."
--   Para veicular na Coluna da direita e OBRIGATORIO trocar a midia daquele posicionamento por
--   IMAGEM. A midia atual e 18. Video - Jun.mp4 (1080x1920, 0:25, 9:16 vertical).
--
-- DOIS AVISOS, DE NATUREZAS DIFERENTES:
--   1) COLUNA DA DIREITA (Facebook): e de FORMATO. Video nao veicula la, de NENHUMA proporcao
--      ou tamanho. Escolher "video no mesmo padrao" NUNCA resolve. So imagem naquele
--      posicionamento resolveria (placement asset customization), que a executora nao monta.
--   2) THREADS/INSTAGRAM: e de IDENTIDADE, nao de midia. Os 8 criativos de video da conta tem
--      chaves_do_spec = ["page_id","video_data"] - NENHUM carrega instagram_user_id/
--      instagram_actor_id (inclusive o criativo do video 18 = 1401862435158611 e o do video
--      24 = 1357548172621119). Anuncio criado pelo sistema nasce sem identidade Instagram e
--      por isso perde Instagram/Threads.
--
-- PADRAO DEFINIDO (Deliverable 1):
--   O sistema, para anuncio de VIDEO, ACEITA que a Coluna da direita nao veicule e DECLARA isso
--   no card antes da aprovacao. NAO tenta placement asset customization (opcao b), porque a
--   executora (Pipeboard/meta-actions montarCriacao) monta um UNICO object_story_spec.video_data,
--   nao asset por posicionamento. Pedido que peca asset por posicionamento RECUSA por nome
--   (personalizacao_por_posicionamento_nao_suportada, em meta-actions v5.8), no mesmo espirito de
--   carrossel_nao_suportado / foto_nao_suportada.
--
-- O QUE ESTA MIGRACAO FAZ (Deliverable 2):
--   1) expoe_instagram_actor: coluna DERIVADA de instagram_actor_id em creative_estado_graph,
--      para o aviso de identidade ser dado por DADO, nao por texto fixo.
--   2) pedido_de_anuncio_completo passa a anexar a mensagem_para_o_gestor, ANTES da aprovacao,
--      os avisos de veiculacao derivados do molde escolhido (video -> Coluna da direita fora;
--      molde sem identidade -> Instagram/Threads fora). Preserva a nota DESTINO LP ja existente.
--   3) Fato de procedencia em agent_context.

-- ============================================================================
-- 1 - expoe_instagram_actor DERIVADO (dado, nao texto)
-- ============================================================================
alter table public.creative_estado_graph
  add column if not exists expoe_instagram_actor boolean
  generated always as (instagram_actor_id is not null) stored;

comment on column public.creative_estado_graph.expoe_instagram_actor is
  'Derivado: true quando o object_story_spec do molde carrega identidade Instagram (instagram_user_id/instagram_actor_id). false = molde sem identidade -> anuncio nasce sem Instagram/Threads. null = criativo nunca verificado. Alimenta o aviso de veiculacao em pedido_de_anuncio_completo.';

-- ============================================================================
-- 2 - AVISO DE VEICULACAO ANTES DA APROVACAO (preserva DESTINO LP do fe69b47)
-- ============================================================================
create or replace function public.pedido_de_anuncio_completo(p_company_id uuid, p_pedido jsonb)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  v_base jsonb;
  v_estado jsonb;
  v_molde text;
  v_dest jsonb;
  v_msg text;
  v_serve boolean;
  v_ig boolean;
begin
  v_base := public.pedido_de_anuncio_completo_sem_estado_destino(p_company_id, p_pedido);
  if coalesce((v_base->>'completo')::boolean, false) is not true then
    return v_base;
  end if;

  v_estado := public.avaliar_estado_destino_execucao(
    'criar_anuncio_a_partir_de', p_pedido, p_company_id);
  if coalesce((v_estado->>'valido')::boolean, true) is not true then
    return v_base || jsonb_build_object(
      'completo', false,
      'recusa', v_estado->>'recusa',
      'estado_destino', v_estado,
      'faltando', '[]'::jsonb,
      'mensagem_para_o_gestor', v_estado->>'mensagem');
  end if;

  v_molde := coalesce(
    nullif(btrim(coalesce(p_pedido->>'creative_id', '')), ''),
    nullif(btrim(coalesce(p_pedido->>'molde', '')), ''),
    nullif(btrim(coalesce(p_pedido->>'molde_creative_id', '')), ''));
  v_dest := public.destino_url_lp_do_molde(p_company_id, v_molde);

  v_msg := coalesce(v_base->>'mensagem_para_o_gestor', '');
  if coalesce((v_dest->>'aplicavel')::boolean, false)
     and coalesce((v_dest->>'corrigiu')::boolean, false) then
    v_msg := v_msg
      || ' DESTINO LP: o molde traz '
      || coalesce(v_dest->>'url_original', v_dest->>'url_do_molde', '(raiz)')
      || '; na publicacao usarei o canonico '
      || coalesce(v_dest->>'url_final', 'https://legaleviver.com.br/simulacao-clt')
      || ' (simulacao CLT). Nao e recusa — e correcao automatica do path.';
  elsif coalesce((v_dest->>'aplicavel')::boolean, false) then
    v_msg := v_msg
      || ' DESTINO LP: '
      || coalesce(v_dest->>'url_final', 'https://legaleviver.com.br/simulacao-clt')
      || '.';
  end if;

  -- VEICULACAO / IDENTIDADE, derivados do estado Graph do molde (dado, nao palpite).
  select serve_de_molde_video, expoe_instagram_actor
    into v_serve, v_ig
    from public.creative_estado_graph
   where creative_id = v_molde
   limit 1;

  if coalesce(v_serve, false) then
    v_msg := v_msg
      || ' VEICULACAO: este anuncio e de VIDEO. A Coluna da direita do Facebook nao veicula'
      || ' video (exige imagem, de qualquer proporcao ou tamanho), entao esse posicionamento'
      || ' NAO sera entregue - nao adianta trocar por um video menor ou mais estreito, e regra'
      || ' do posicionamento. Os demais posicionamentos seguem normalmente.';
  end if;

  if v_ig is not null and v_ig is false then
    v_msg := v_msg
      || ' IDENTIDADE: o molde escolhido nao carrega identidade Instagram (instagram_user_id'
      || ' no object_story_spec), entao o anuncio nascera SEM identidade Instagram/Threads e'
      || ' esses posicionamentos (Instagram e Threads) nao veiculam. Para veicular neles,'
      || ' escolha um molde que exponha a identidade ou configure a identidade no Gerenciador.';
  end if;

  return v_base || jsonb_build_object(
    'estado_destino', v_estado,
    'destino_url_lp', v_dest,
    'avisos_de_veiculacao_derivados', jsonb_build_object(
      'video_coluna_direita_fora', coalesce(v_serve, false),
      'sem_identidade_instagram_threads', (v_ig is not null and v_ig is false)),
    'mensagem_para_o_gestor', v_msg);
end;
$function$;

-- ============================================================================
-- 3 - FATO DE PROCEDENCIA PARA O AGENTE
-- ============================================================================
insert into public.agent_context (company_id, categoria, fato, vigente)
select 'ded20b38-f42e-4c71-800c-31b97ea48bcf'::uuid,
       'criacao',
       'POSICIONAMENTO E IDENTIDADE (11/08/2026): (1) A Coluna da direita do Facebook NAO veicula video, de nenhuma proporcao ou tamanho - so imagem. "Escolher video no mesmo padrao" NUNCA resolve esse aviso; e formato do posicionamento, nao tamanho do video. O padrao do sistema e ACEITAR a exclusao desse posicionamento e AVISAR no card antes da aprovacao. Personalizacao por posicionamento (imagem so na Coluna da direita) NAO e suportada - meta-actions recusa por nome personalizacao_por_posicionamento_nao_suportada. (2) O aviso de Threads/Instagram e de IDENTIDADE, nao de midia: os criativos de video da conta tem chaves_do_spec=["page_id","video_data"] e nenhum carrega instagram_user_id, entao o anuncio criado pelo sistema nasce sem identidade Instagram/Threads e perde esses posicionamentos. Fonte do aviso: creative_estado_graph.serve_de_molde_video e .expoe_instagram_actor, anexados a mensagem_para_o_gestor por pedido_de_anuncio_completo.',
       true
where not exists (
  select 1 from public.agent_context
   where company_id = 'ded20b38-f42e-4c71-800c-31b97ea48bcf'
     and fato like 'POSICIONAMENTO E IDENTIDADE (11/08/2026):%'
     and vigente
);

do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema='public' and table_name='creative_estado_graph' and column_name='expoe_instagram_actor'
  ) then
    raise exception 'coluna expoe_instagram_actor deveria existir apos esta migracao';
  end if;
end $$;
