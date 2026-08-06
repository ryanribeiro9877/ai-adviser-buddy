-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260805230012
-- name: gt15_prontidao_uso_da_legada_prova_o_validador
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

-- GT-15 correcao 2 · defeito meu, exposto pelo primeiro uso real do validador.
--
-- O SINTOMA: com usos_da_legada = 1, a funcao ainda dizia "Nenhuma chave por chamador registrou
-- uso, o que significa que as edges ainda NAO validam por mcp_key_valida()". Duas afirmacoes
-- contraditorias na mesma resposta.
--
-- A CAUSA: eu defini "validador comprovadamente no caminho" como "existe chave NAO-legada com
-- uso". Errado. O contador de QUALQUER chave, legada inclusive, so incrementa DENTRO do
-- mcp_key_valida - portanto um uso da legada e prova direta de que o validador rodou. Eu
-- confundi "quem esta sendo usado" com "por onde passa".
--
-- Sao TRES fatos distintos e eu havia colapsado dois:
--   validador no caminho -> qualquer chave com uso > 0
--   legada ainda em uso  -> legada com uso > 0
--   pode revogar legada  -> validador no caminho E legada com uso = 0
-- O estado 'legado_em_uso' passa a ser o esperado nesta fase: o validador ja funciona e a
-- legada e quem esta autenticando, porque nenhum cron foi migrado ainda.

create or replace function public.mcp_keys_prontidao()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_qualquer_uso boolean;
  v_legado_usos bigint;
  v_por_chamador_usos bigint;
  v_estado text;
begin
  select exists (select 1 from public.mcp_api_keys where utilizacoes > 0) into v_qualquer_uso;

  select coalesce((select utilizacoes from public.mcp_api_keys
                    where chamador like 'legado:%' limit 1), 0) into v_legado_usos;

  select coalesce(sum(utilizacoes),0) into v_por_chamador_usos
    from public.mcp_api_keys where chamador not like 'legado:%';

  v_estado := case
    when not v_qualquer_uso   then 'nao_medido'
    when v_legado_usos > 0    then 'legado_em_uso'
    else                           'legado_ocioso'
  end;

  return jsonb_build_object(
    'estado', v_estado,
    'validador_comprovadamente_no_caminho', v_qualquer_uso,
    'pode_revogar_legado', (v_estado = 'legado_ocioso'),
    'usos_da_legada', v_legado_usos,
    'usos_por_chamador', v_por_chamador_usos,
    'chaves', (select jsonb_agg(jsonb_build_object(
        'chamador', chamador, 'ativa', ativa, 'usos', utilizacoes,
        'ultimo_uso', ultima_utilizacao_em, 'revogada_em', revogada_em) order by chamador)
      from public.mcp_api_keys),
    'veredito', case v_estado
      when 'nao_medido' then
        'NAO MEDIDO. Nenhuma chave registrou uso, entao nao ha prova de que as edges passem pelo mcp_key_valida(). Zero uso na legada aqui e ignorancia, nao desuso - revogar derruba os 7 crons e o gatilho de aprovacao.'
      when 'legado_em_uso' then
        'O validador ESTA comprovadamente no caminho (houve uso registrado, e o contador so incrementa dentro dele). A legada continua sendo quem autentica, o que e o ESPERADO nesta fase: nenhum cron foi migrado ainda. Nao revogar. Proximo passo e migrar um cron por vez para get_mcp_api_key(chamador) e ver o uso migrar de coluna.'
      else
        'Validador no caminho e legada ociosa. Revogar e seguro - e a revogacao e por medicao, nao por crenca.'
      end,
    'nota_de_higiene', 'Contadores zerados em 05/08/2026 apos os testes de implantacao. O uso registrado depois disso e real.'
  );
end;
$$;