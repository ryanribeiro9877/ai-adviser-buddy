-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260812180308
-- name: esp40_nomenclatura_por_campos
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao
-- ESP-40: nomenclatura por campos estruturados (opcao 2).
-- Nome Meta = [MARCA][CANAL][OBJETIVO][PRODUTO?][ROTULO?][PERIODO]
-- Colunas nome_partes + marca_tag na config; RPC montar_nome_meta; doutrina + contrato.

alter table public.meta_execution_config
  add column if not exists marca_tag text;

update public.meta_execution_config
   set marca_tag = coalesce(nullif(btrim(marca_tag), ''), 'LEV')
 where company_id = 'ded20b38-f42e-4c71-800c-31b97ea48bcf';

alter table public.campaigns
  add column if not exists nome_partes jsonb;

alter table public.ad_sets
  add column if not exists nome_partes jsonb;

alter table public.ads
  add column if not exists nome_partes jsonb;

create or replace function public.montar_nome_meta(p_partes jsonb)
returns jsonb
language plpgsql
immutable
as $$
declare
  v_marca text; v_canal text; v_obj text; v_prod text; v_rot text; v_per text;
  v_tokens text[] := '{}';
  v_tok text;
  v_faltando text[] := '{}';
begin
  if p_partes is null or jsonb_typeof(p_partes) <> 'object' then
    return jsonb_build_object(
      'ok', false, 'erro', 'campos_de_nomenclatura_obrigatorios',
      'detalhe', 'Informe marca, canal, objetivo_tag e periodo.');
  end if;

  v_marca := upper(nullif(btrim(p_partes->>'marca'), ''));
  v_canal := upper(nullif(btrim(p_partes->>'canal'), ''));
  v_obj   := upper(nullif(btrim(p_partes->>'objetivo_tag'), ''));
  v_prod  := upper(nullif(btrim(coalesce(p_partes->>'produto','')), ''));
  v_rot   := upper(nullif(btrim(coalesce(p_partes->>'rotulo','')), ''));
  v_per   := upper(nullif(btrim(p_partes->>'periodo'), ''));

  if v_marca is null then v_faltando := v_faltando || array['marca']; end if;
  if v_canal is null then v_faltando := v_faltando || array['canal']; end if;
  if v_obj   is null then v_faltando := v_faltando || array['objetivo_tag']; end if;
  if v_per   is null then v_faltando := v_faltando || array['periodo']; end if;
  if array_length(v_faltando, 1) is not null then
    return jsonb_build_object(
      'ok', false, 'erro', 'campos_de_nomenclatura_obrigatorios',
      'faltando', to_jsonb(v_faltando),
      'detalhe', 'Informe marca, canal, objetivo_tag e periodo. Opcional: produto, rotulo.');
  end if;

  foreach v_tok in array array[v_marca, v_canal, v_obj, v_prod, v_rot, v_per]
  loop
    if v_tok is null then continue; end if;
    v_tok := replace(replace(v_tok, ' ', '-'), '[', '');
    v_tok := replace(v_tok, ']', '');
    if v_tok !~ '^[A-Z0-9][A-Z0-9._+-]*$' then
      return jsonb_build_object('ok', false, 'erro', 'token_invalido', 'detalhe', v_tok);
    end if;
    v_tokens := v_tokens || array[v_tok];
  end loop;

  return jsonb_build_object(
    'ok', true,
    'nome', (select string_agg('[' || t || ']', '' order by ord)
               from unnest(v_tokens) with ordinality as u(t, ord)),
    'partes', jsonb_build_object(
      'marca', v_marca, 'canal', v_canal, 'objetivo_tag', v_obj,
      'produto', v_prod, 'rotulo', v_rot, 'periodo', v_per));
end;
$$;

delete from public.contrato_de_execucao
 where acao in ('criar_campanha','criar_conjunto_a_partir_de','criar_anuncio_a_partir_de','renomear_campanha')
   and campo in ('nome_partes','marca','canal','objetivo_tag','produto','rotulo','periodo');

insert into public.contrato_de_execucao
  (acao,campo,obrigatorio,tipo,observacao,fonte,vigente,suportado,valores_aceitos)
values
  ('criar_campanha','nome_partes',true,'jsonb',
   'ESP-40: marca/canal/objetivo_tag/periodo obrigatorios; produto/rotulo opcionais. nome_novo e derivado.',
   'traffic-chat + meta-actions + montar_nome_meta',true,true,null),
  ('criar_conjunto_a_partir_de','nome_partes',true,'jsonb',
   'ESP-40: mesmas regras da campanha para o nome do conjunto novo.',
   'traffic-chat + meta-actions + montar_nome_meta',true,true,null),
  ('criar_anuncio_a_partir_de','nome_partes',true,'jsonb',
   'ESP-40: mesmas regras para o nome do anuncio novo.',
   'traffic-chat + meta-actions + montar_nome_meta',true,true,null),
  ('renomear_campanha','nome_partes',true,'jsonb',
   'ESP-40: novo_nome livre aposentado; nome composto das partes.',
   'traffic-chat.t_renomear_campanha + meta-actions',true,true,null);

insert into public.agent_context (categoria,fato,vigente,desde)
values (
  'doutrina',
  'NOMENCLATURA COMPOSTA (ESP-40, 12/08/2026, opcao 2). Objetos NOVOS criados/renomeados pelo '
  || 'sistema NAO aceitam nome livre. Campos: marca (default LEV na config.marca_tag), canal '
  || '(LP|WPP|â€¦), objetivo_tag (LEADS|â€¦; pode derivar do objective ODAX), periodo (AGO26|01.05.26), '
  || 'opcionais produto e rotulo. O sistema MONTA [MARCA][CANAL][OBJ][PROD?][ROT?][PER]. '
  || 'Vale para criar_campanha, criar_conjunto_a_partir_de, criar_anuncio_a_partir_de e '
  || 'renomear_campanha. nome_partes fica no payload e no espelho (campaigns/ad_sets/ads). '
  || 'escalar_duplicar mantem nome derivado do molde (+ESC). Objetos antigos fora do padrao '
  || 'nao sao renomeados em massa.',
  true,
  date '2026-08-12'
);
