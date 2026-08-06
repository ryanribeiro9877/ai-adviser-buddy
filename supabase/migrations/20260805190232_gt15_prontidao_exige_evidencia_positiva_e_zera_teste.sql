-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260805190232
-- name: gt15_prontidao_exige_evidencia_positiva_e_zera_teste
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

-- GT-15 correcao · DOIS defeitos meus na mcp_keys_prontidao(), achados minutos depois.
--
-- DEFEITO 1 - o booleano mentia por omissao. pode_revogar_legado era calculado como
-- "legada com zero usos". Zero usos e verdade em DUAS situacoes opostas:
--   (a) ninguem mais usa a legada  -> pode revogar
--   (b) nada foi medido ainda      -> revogar derruba 7 crons
-- Colapsar (a) e (b) num booleano ao lado de um texto que dizia o contrario e exatamente o
-- padrao que este dia inteiro consertou. Agora a revogacao exige EVIDENCIA POSITIVA de que o
-- validador esta no caminho: alguma chave NAO-legada com uso registrado. Sem isso o estado e
-- 'nao_medido', e nao_medido nao autoriza nada.
--
-- DEFEITO 2 - eu contaminei a propria evidencia. Ao provar o validador eu chamei
-- mcp_key_valida() duas vezes, e os contadores da legada e de um cron subiram para 1 por
-- TESTE MEU, nao por edge real. A medicao tem de comecar limpa, porque ela e o portao de uma
-- revogacao que quebra coleta. Zerando aqui e declarando o motivo.

update public.mcp_api_keys
   set utilizacoes = 0, ultima_utilizacao_em = null
 where utilizacoes > 0;

create or replace function public.mcp_keys_prontidao()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_validador_em_uso boolean;
  v_legado_usos bigint;
  v_estado text;
begin
  select exists (select 1 from public.mcp_api_keys
                  where chamador not like 'legado:%' and utilizacoes > 0)
    into v_validador_em_uso;

  select coalesce((select utilizacoes from public.mcp_api_keys
                    where chamador like 'legado:%' limit 1), 0)
    into v_legado_usos;

  v_estado := case
    when not v_validador_em_uso then 'nao_medido'
    when v_legado_usos > 0      then 'legado_em_uso'
    else                             'legado_ocioso'
  end;

  return jsonb_build_object(
    'estado', v_estado,
    'pode_revogar_legado', (v_estado = 'legado_ocioso'),
    'validador_comprovadamente_no_caminho', v_validador_em_uso,
    'usos_da_legada', v_legado_usos,
    'chaves', (select jsonb_agg(jsonb_build_object(
        'chamador', chamador, 'ativa', ativa, 'usos', utilizacoes,
        'ultimo_uso', ultima_utilizacao_em, 'revogada_em', revogada_em) order by chamador)
      from public.mcp_api_keys),
    'veredito', case v_estado
      when 'nao_medido' then
        'NAO MEDIDO. Nenhuma chave por chamador registrou uso, o que significa que as edges ainda NAO validam por mcp_key_valida(). Zero uso na legada aqui e ignorancia, nao desuso - revogar agora derruba os 7 crons e o gatilho de aprovacao.'
      when 'legado_em_uso' then
        'A legada AINDA e usada por algum chamador. Nao revogar: identificar quem, migrar, e so entao reavaliar.'
      else
        'O validador esta comprovadamente no caminho e a legada esta ociosa. Revogar e seguro - e a revogacao e por medicao, nao por crenca.'
      end,
    'nota_de_higiene', 'Contadores zerados em 05/08/2026 apos os testes de implantacao: a evidencia que autoriza revogar nao pode ter uso sintetico dentro.'
  );
end;
$$;