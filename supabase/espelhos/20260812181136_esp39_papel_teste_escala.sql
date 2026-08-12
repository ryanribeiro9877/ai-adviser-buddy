-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260812181136
-- name: esp39_papel_teste_escala
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

-- ESP-39: vencedores x teste em campanhas SEPARADAS.

create or replace function public.montar_nome_meta(p_partes jsonb)
returns jsonb
language plpgsql
immutable
as $$
declare
  v_marca text; v_canal text; v_obj text; v_prod text; v_papel text; v_rot text; v_per text;
  v_tokens text[] := '{}';
  v_tok text;
  v_faltando text[] := '{}';
  v_exigir_papel boolean := coalesce((p_partes->>'exigir_papel')::boolean, false)
    or lower(coalesce(p_partes->>'nivel','')) = 'campanha';
begin
  if p_partes is null or jsonb_typeof(p_partes) <> 'object' then
    return jsonb_build_object(
      'ok', false, 'erro', 'campos_de_nomenclatura_obrigatorios',
      'detalhe', 'Informe marca, canal, objetivo_tag e periodo');
  end if;

  v_marca := upper(nullif(btrim(p_partes->>'marca'), ''));
  v_canal := upper(nullif(btrim(p_partes->>'canal'), ''));
  v_obj   := upper(nullif(btrim(p_partes->>'objetivo_tag'), ''));
  v_prod  := upper(nullif(btrim(coalesce(p_partes->>'produto','')), ''));
  v_papel := upper(nullif(btrim(coalesce(p_partes->>'papel','')), ''));
  v_rot   := upper(nullif(btrim(coalesce(p_partes->>'rotulo','')), ''));
  v_per   := upper(nullif(btrim(p_partes->>'periodo'), ''));

  if v_marca is null then v_faltando := v_faltando || array['marca']; end if;
  if v_canal is null then v_faltando := v_faltando || array['canal']; end if;
  if v_obj   is null then v_faltando := v_faltando || array['objetivo_tag']; end if;
  if v_per   is null then v_faltando := v_faltando || array['periodo']; end if;
  if v_exigir_papel and v_papel is null then v_faltando := v_faltando || array['papel']; end if;
  if array_length(v_faltando, 1) is not null then
    return jsonb_build_object(
      'ok', false, 'erro', 'campos_de_nomenclatura_obrigatorios',
      'faltando', to_jsonb(v_faltando),
      'detalhe', case when v_exigir_papel
        then 'Informe marca, canal, objetivo_tag, papel (TESTE|ESCALA) e periodo. Opcional: produto, rotulo.'
        else 'Informe marca, canal, objetivo_tag e periodo. Opcional: produto, papel, rotulo.'
      end);
  end if;

  if v_papel is not null and v_papel not in ('TESTE', 'ESCALA') then
    return jsonb_build_object(
      'ok', false, 'erro', 'papel_invalido',
      'detalhe', 'papel deve ser TESTE ou ESCALA (ESP-39).');
  end if;

  foreach v_tok in array array[v_marca, v_canal, v_obj, v_prod, v_papel, v_rot, v_per]
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
      'produto', v_prod, 'papel', v_papel, 'rotulo', v_rot, 'periodo', v_per));
end;
$$;

delete from public.contrato_de_execucao
 where acao in ('criar_campanha','renomear_campanha','escalar_duplicar')
   and campo in ('papel','campanha_destino','nome_partes');

insert into public.contrato_de_execucao
  (acao,campo,obrigatorio,tipo,observacao,fonte,vigente,suportado,valores_aceitos)
values
  ('criar_campanha','papel',true,'text',
   'ESP-39: TESTE|ESCALA. Vencedores e testes em campanhas SEPARADAS. Entra em nome_partes.',
   'traffic-chat + meta-actions + montar_nome_meta',true,true,
   array['TESTE','ESCALA']),
  ('criar_campanha','nome_partes',true,'jsonb',
   'ESP-40/39: marca/canal/objetivo_tag/papel/periodo obrigatorios; produto/rotulo opcionais.',
   'traffic-chat + meta-actions + montar_nome_meta',true,true,null),
  ('renomear_campanha','papel',true,'text',
   'ESP-39: renomear campanha exige papel TESTE|ESCALA no composto.',
   'traffic-chat.t_renomear_campanha + meta-actions',true,true,
   array['TESTE','ESCALA']),
  ('renomear_campanha','nome_partes',true,'jsonb',
   'ESP-40/39: novo_nome livre aposentado; composto com papel.',
   'traffic-chat.t_renomear_campanha + meta-actions',true,true,null),
  ('escalar_duplicar','campanha_destino',false,'text',
   'ESP-39: obrigatorio na pratica quando origem e TESTE — destino deve ser campanha ESCALA (nome ou external_id).',
   'traffic-chat propose + meta-actions',true,true,null);

update public.agent_context
   set vigente = false
 where categoria = 'doutrina'
   and fato like 'NOMENCLATURA COMPOSTA (ESP-40%'
   and vigente = true;

insert into public.agent_context (categoria,fato,vigente,desde)
values (
  'doutrina',
  'NOMENCLATURA + PAPEL (ESP-40/39, 12/08/2026). Objetos NOVOS: marca (default LEV), canal, '
  || 'objetivo_tag, periodo; opcionais produto e rotulo. CAMPANHA exige papel TESTE|ESCALA. '
  || 'Padrao [MARCA][CANAL][OBJ][PROD?][PAPEL][ROT?][PER]. ESP-39: testes e vencedores/escala '
  || 'vivem em campanhas SEPARADAS. escalar_duplicar NAO cria copia em campanha TESTE — se o '
  || 'molde esta em TESTE, informe campanha_destino ESCALA. Conjunto/anuncio nao exigem papel. '
  || 'escalar_duplicar mantem nome derivado do molde (+ESC). Objetos legados sem [TESTE]/[ESCALA] '
  || 'nao sao renomeados em massa; escala neles gera aviso.',
  true,
  date '2026-08-12'
);
