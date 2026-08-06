-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260806163702
-- name: gt15_migra_demais_crons_e_veredito_derivado
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

-- GT-15 · migra os crons restantes e conserta o veredito da prontidao.
--
-- DEFEITO MEU: o veredito do estado 'legado_em_uso' era TEXTO FIXO dizendo "nenhum cron foi
-- migrado ainda". Com o drive-watch migrado e 2 usos registrados na chave propria, a frase virou
-- falsa ao lado do numero que a desmente. Agora ela e DERIVADA da contagem.
--
-- MIGRACAO dos 6 restantes pelo mesmo metodo provado no drive-watch: substituicao no comando
-- existente, nunca reescrita, com guarda que aborta se o padrao nao aparecer.
--
-- waba-sync-daily ENTRA na migracao mesmo estando desativado pelo congelamento do pos-clique.
-- Motivo: deixar uma referencia legada solta faria alguem depois ler como esquecimento. A
-- contrapartida esta declarada - enquanto o cron estiver congelado a migracao dele NAO pode ser
-- provada, porque ele nao roda.
--
-- bm-monitor-0920 NAO entra: ele nao usa get_mcp_api_key(). A chave que eu criei para ele em
-- 05/08 foi suposicao minha e fica sem uso - a propria prontidao mostra isso.

do $$
declare
  r record; v_novo text; v_migrados text[] := '{}'; v_pulados text[] := '{}';
begin
  for r in
    select jobid, jobname, command from cron.job
     where jobname in ('meta-campaign-status-0910','pipeboard-metrics-daily','windsor-sync-daily',
                       'windsor-wide-ads-weekly','windsor-wide-adsets-weekly','waba-sync-daily')
     order by jobname
  loop
    if position('public.get_mcp_api_key()' in r.command) = 0 then
      v_pulados := array_append(v_pulados, r.jobname);
      continue;
    end if;

    if not exists (select 1 from public.mcp_api_keys k
                    where k.chamador = 'cron:' || r.jobname and k.ativa and k.revogada_em is null) then
      v_pulados := array_append(v_pulados, r.jobname || ' (sem chave propria ativa)');
      continue;
    end if;

    v_novo := replace(r.command, 'public.get_mcp_api_key()',
                      'public.get_mcp_api_key(' || quote_literal('cron:' || r.jobname) || ')');

    if v_novo = r.command then
      v_pulados := array_append(v_pulados, r.jobname || ' (substituicao sem efeito)');
      continue;
    end if;

    perform cron.alter_job(r.jobid, command := v_novo);
    v_migrados := array_append(v_migrados, r.jobname);
  end loop;

  raise notice 'migrados: %', v_migrados;
  raise notice 'pulados: %', v_pulados;
end $$;

create or replace function public.mcp_keys_prontidao()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_qualquer_uso boolean; v_legado_usos bigint; v_por_chamador_usos bigint;
  v_chamadores_com_uso int; v_crons_na_legada int; v_estado text;
begin
  select exists (select 1 from public.mcp_api_keys where utilizacoes > 0) into v_qualquer_uso;
  select coalesce((select utilizacoes from public.mcp_api_keys where chamador like 'legado:%' limit 1), 0)
    into v_legado_usos;
  select coalesce(sum(utilizacoes),0), count(*) filter (where utilizacoes > 0)
    into v_por_chamador_usos, v_chamadores_com_uso
    from public.mcp_api_keys where chamador not like 'legado:%';
  select count(*) into v_crons_na_legada from cron.job where command ilike '%get_mcp_api_key()%';

  v_estado := case
    when not v_qualquer_uso then 'nao_medido'
    when v_crons_na_legada > 0 then 'migracao_em_andamento'
    when v_legado_usos > 0 then 'legado_em_uso'
    else 'legado_ocioso' end;

  return jsonb_build_object(
    'estado', v_estado,
    'validador_comprovadamente_no_caminho', v_qualquer_uso,
    'pode_revogar_legado', (v_estado = 'legado_ocioso'),
    'usos_da_legada', v_legado_usos,
    'usos_por_chamador', v_por_chamador_usos,
    'chamadores_com_uso_proprio', v_chamadores_com_uso,
    'crons_ainda_na_legada', v_crons_na_legada,
    'chaves', (select jsonb_agg(jsonb_build_object(
        'chamador', chamador, 'ativa', ativa, 'usos', utilizacoes,
        'ultimo_uso', ultima_utilizacao_em, 'revogada_em', revogada_em) order by chamador)
      from public.mcp_api_keys),
    'veredito', case v_estado
      when 'nao_medido' then
        'NAO MEDIDO. Nenhuma chave registrou uso, entao nao ha prova de que as edges passem pelo mcp_key_valida(). Zero uso na legada aqui e ignorancia, nao desuso.'
      when 'migracao_em_andamento' then
        'Migracao EM ANDAMENTO: ' || v_chamadores_com_uso || ' chamador(es) ja autenticam com chave propria (' ||
        v_por_chamador_usos || ' uso(s)), e ainda restam ' || v_crons_na_legada ||
        ' cron(s) apontando para a chave legada. Nao revogar enquanto restar um. O contador da legada em ' ||
        v_legado_usos || ' inclui uso HISTORICO, anterior a migracao - ele nao zera sozinho.'
      when 'legado_em_uso' then
        'Nenhum cron aponta mais para a legada, mas ela ainda registrou uso (' || v_legado_usos ||
        '). Pode haver chamador fora dos crons - edge chamada a mao, gatilho, ou frontend. Identificar antes de revogar.'
      else
        'Nenhum cron na legada e nenhum uso dela. Revogar e seguro - e a revogacao e por medicao, nao por crenca.'
      end,
    'nota_de_higiene', 'Contadores zerados em 05/08/2026 apos os testes de implantacao. Uso registrado depois disso e real. O contador da legada acumula historico e nao volta a zero por si.'
  );
end;
$$;