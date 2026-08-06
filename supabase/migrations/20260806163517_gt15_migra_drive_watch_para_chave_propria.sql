-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260806163517
-- name: gt15_migra_drive_watch_para_chave_propria
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

-- GT-15 · primeiro cron migrado para chave por chamador: drive-watch-0845.
--
-- ESCOLHIDO POR SER O DE MENOR CONSEQUENCIA: se a autenticacao falhar, o drive-watch nao coleta
-- peca nova naquele dia - e hoje ele acusou "0 pecas novas" mesmo. Nao mexe em dinheiro, nao
-- mexe em metrica, nao mexe em alerta.
--
-- METODO: SUBSTITUICAO no comando existente, nunca reescrita. Eu so tenho os primeiros 200
-- caracteres de cada comando na leitura; reescrever a partir disso seria escrever por deducao,
-- que e o erro que neste projeto ja quebrou onConflict e produziu espelho infiel. O replace
-- transforma o comando sem que eu precise conhecer o resto dele.
--
-- GUARDA: se o padrao nao for encontrado, o job NAO e alterado e o bloco levanta aviso. Alterar
-- comando de cron as cegas e como deixar um coletor escuro sem ninguem saber.
--
-- CHAVE NOVA para o pipeboard-metrics-daily, que nasceu hoje e nao tinha. E registro que o
-- bm-monitor-0920 NAO usa get_mcp_api_key() - criei chave para ele por suposicao minha; fica
-- inativa e sem uso, o que a propria prontidao mostra.

insert into public.mcp_api_keys (chamador, api_key, observacao)
select 'cron:pipeboard-metrics-daily',
       encode(sha256((gen_random_uuid()::text || clock_timestamp()::text || 'pipeboard-metrics-daily')::bytea), 'hex'),
       'Gerada em 06/08/2026: cron nasceu depois da criacao das chaves originais.'
on conflict (chamador) do nothing;

do $$
declare
  v_cmd text; v_novo text; v_jobid bigint;
  v_alvo text := 'drive-watch-0845';
begin
  select jobid, command into v_jobid, v_cmd from cron.job where jobname = v_alvo;

  if v_jobid is null then
    raise exception 'cron % nao existe - nada alterado', v_alvo;
  end if;

  if position('public.get_mcp_api_key()' in v_cmd) = 0 then
    raise exception 'cron % NAO contem public.get_mcp_api_key() - nada alterado, para nao deixar o coletor escuro', v_alvo;
  end if;

  v_novo := replace(v_cmd, 'public.get_mcp_api_key()',
                    'public.get_mcp_api_key(' || quote_literal('cron:' || v_alvo) || ')');

  if v_novo = v_cmd then
    raise exception 'substituicao nao produziu mudanca em % - abortado', v_alvo;
  end if;

  perform cron.alter_job(v_jobid, command := v_novo);
  raise notice 'cron % migrado para chave propria', v_alvo;
end $$;