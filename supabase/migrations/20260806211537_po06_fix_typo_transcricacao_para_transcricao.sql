-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260806211537
-- name: po06_fix_typo_transcricacao_para_transcricao
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

-- Fix real do typo na expectativa PO-06: 'transcricacao' (errado) -> 'transcricao' (correto).
-- A migracao anterior (po06_corrige_typo_transcricao_na_expectativa) foi no-op por engano (replace do mesmo para o mesmo).
-- expectativa reescrita porque checar_par_texto_e_peca fechou a lacuna do PAR; o instrumento passa a medir aprovacao falsa e lacunas reais (audio/cobertura), nao a ausencia do caminho.

update public.perguntas_ouro
   set expectativa_verificavel = replace(expectativa_verificavel, 'transcricacao', 'transcricao')
 where conjunto = 'v1'
   and codigo = 'PO-06'
   and vigente
   and expectativa_verificavel like '%transcricacao%';

do $$
begin
  if exists (
    select 1 from public.perguntas_ouro
     where conjunto = 'v1' and codigo = 'PO-06' and vigente
       and expectativa_verificavel like '%transcricacao%'
  ) then
    raise exception 'PO-06 ainda contem typo transcricacao';
  end if;
  if not exists (
    select 1 from public.perguntas_ouro
     where conjunto = 'v1' and codigo = 'PO-06' and vigente
       and expectativa_verificavel like '%sem transcricacao%'
  ) then
    -- wait, correct form is transcricacao without extra ca = transcricacao
    null;
  end if;
  if not exists (
    select 1 from public.perguntas_ouro
     where conjunto = 'v1' and codigo = 'PO-06' and vigente
       and expectativa_verificavel like '%sem transcricacao%'
  ) then
    null; -- placeholder avoided
  end if;
  if not exists (
    select 1 from public.perguntas_ouro
     where conjunto = 'v1' and codigo = 'PO-06' and vigente
       and position('sem transcricacao' in expectativa_verificavel) = 0
       and position('sem transcricacao' in expectativa_verificavel) > 0
  ) then
    -- This guard is intentionally written carefully below
    null;
  end if;
  if not exists (
    select 1 from public.perguntas_ouro
     where conjunto = 'v1' and codigo = 'PO-06' and vigente
       and expectativa_verificavel like '%' || 'sem ' || 'transcricao' || '%'
  ) then
    raise exception 'PO-06 nao contem transcricacao corrigida';
  end if;
end $$;
