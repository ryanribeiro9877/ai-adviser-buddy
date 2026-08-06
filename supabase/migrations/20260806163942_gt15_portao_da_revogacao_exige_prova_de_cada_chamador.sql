-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260806163942
-- name: gt15_portao_da_revogacao_exige_prova_de_cada_chamador
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

-- GT-15 · o portao da revogacao passa a exigir PROVA de cada chamador, nao ausencia de uso.
--
-- DOIS DEFEITOS NO DESENHO ANTERIOR:
--
-- 1. Os 45 usos da legada sao HISTORICOS - incluem as minhas sondas manuais e as corridas antes
--    da migracao. O contador nao zera sozinho, entao 'legado_ocioso' nunca aconteceria e o portao
--    nunca abriria. Zerado agora, ao concluir a migracao de TODOS os chamadores, e declarado -
--    mesma higiene aplicada em 05/08. Qualquer incremento a partir de agora e evidencia de
--    chamador nao migrado, e nao ruido do passado.
--
-- 2. Ausencia de uso da legada NAO basta para revogar. Os 7 crons foram migrados mas so o
--    drive-watch efetivamente RODOU com chave propria; os outros seis rodam nos horarios deles.
--    Revogar antes disso removeria o fallback justamente se um comando tiver ficado torto.
--    Agora o portao exige que CADA cron ativo migrado tenha uso comprovado na sua propria chave.
--
-- O gatilho de aprovacao nao entra nessa exigencia: ele so dispara quando um card e aprovado, e
-- forcar uma aprovacao para provar chave seria gastar dinheiro para testar autenticacao. Ele fica
-- listado como pendente de prova natural.

update public.mcp_api_keys
   set utilizacoes = 0, ultima_utilizacao_em = null,
       observacao = coalesce(observacao,'') ||
         ' Contador zerado em 06/08/2026 ao concluir a migracao de todos os chamadores (7 crons + gatilho). Uso a partir daqui indica chamador NAO migrado.'
 where chamador like 'legado:%';

create or replace function public.mcp_keys_prontidao()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_legado_usos bigint; v_crons_na_legada int;
  v_crons_migrados int; v_crons_migrados_provados int;
  v_pendentes_de_prova jsonb; v_estado text;
begin
  select coalesce((select utilizacoes from public.mcp_api_keys where chamador like 'legado:%' limit 1), 0)
    into v_legado_usos;

  select count(*) into v_crons_na_legada from cron.job where command ilike '%get_mcp_api_key()%';

  with migrados as (
    select j.jobname,
           substring(j.command from 'get_mcp_api_key\(''([^'']+)''\)') as chamador
    from cron.job j
    where j.active and j.command ilike '%get_mcp_api_key(''%'
  )
  select count(*), count(*) filter (where coalesce(k.utilizacoes,0) > 0),
         coalesce(jsonb_agg(jsonb_build_object('cron', m.jobname, 'chave', m.chamador)
                  order by m.jobname) filter (where coalesce(k.utilizacoes,0) = 0), '[]'::jsonb)
    into v_crons_migrados, v_crons_migrados_provados, v_pendentes_de_prova
  from migrados m
  left join public.mcp_api_keys k on k.chamador = m.chamador;

  v_estado := case
    when v_crons_na_legada > 0 then 'migracao_incompleta'
    when v_legado_usos > 0 then 'legado_ainda_usado_apos_a_migracao'
    when v_crons_migrados_provados < v_crons_migrados then 'aguardando_prova_de_cada_chamador'
    else 'pronto_para_revogar' end;

  return jsonb_build_object(
    'estado', v_estado,
    'pode_revogar_legado', (v_estado = 'pronto_para_revogar'),
    'crons_ainda_na_legada', v_crons_na_legada,
    'crons_ativos_migrados', v_crons_migrados,
    'crons_com_uso_comprovado', v_crons_migrados_provados,
    'pendentes_de_prova', v_pendentes_de_prova,
    'usos_da_legada_desde_a_migracao', v_legado_usos,
    'chaves', (select jsonb_agg(jsonb_build_object(
        'chamador', chamador, 'ativa', ativa, 'usos', utilizacoes,
        'ultimo_uso', ultima_utilizacao_em) order by chamador)
      from public.mcp_api_keys),
    'veredito', case v_estado
      when 'migracao_incompleta' then
        'Restam ' || v_crons_na_legada || ' cron(s) apontando para a chave legada. Migrar antes de qualquer revogacao.'
      when 'legado_ainda_usado_apos_a_migracao' then
        'A legada registrou ' || v_legado_usos || ' uso(s) DEPOIS da migracao de 06/08. Isso e prova de que existe chamador nao migrado - identificar pelo horario do ultimo uso antes de revogar.'
      when 'aguardando_prova_de_cada_chamador' then
        'Todos os crons ativos foram migrados, mas ' || (v_crons_migrados - v_crons_migrados_provados) ||
        ' ainda NAO rodaram com a chave propria. Migrar nao e provar: cada um precisa autenticar uma vez. Revogar agora removeria o fallback justamente se algum comando tiver ficado torto. Ver pendentes_de_prova.'
      else
        'Todos os crons ativos migrados E com uso comprovado, e zero uso da legada desde a migracao. Revogar e seguro. O gatilho de aprovacao nao entra nesta conta: ele so autentica quando um card e aprovado, e forcar uma aprovacao para testar chave seria gastar dinheiro para provar autenticacao.'
      end
  );
end;
$$;