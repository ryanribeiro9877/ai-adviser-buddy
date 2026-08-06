-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260806185926
-- name: reconcilia_r5_com_a_arvore_de_decisao
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

-- RECONCILIACAO · a R5 para de prescrever pausa por conta propria.
--
-- O PROBLEMA, criado pelo ESP-17 e vivo agora: existem DUAS VOZES CONTRADITORIAS no sistema.
-- A arvore (decidir_sobre_conjunto) diz "manter e trocar o criativo" para os tres conjuntos que
-- entregam. A R5 diz "recomendacao: PAUSAR" para os tres criativos que estao dentro deles - e sao
-- 3 alertas CRITICAL vivos na tela do gestor desde 09:15 de hoje.
--
-- O gestor le o alerta primeiro. Enquanto as duas coexistirem, o sistema da conselhos opostos
-- sobre a mesma coisa, e o conselho errado e o que aparece com selo de CRITICAL.
--
-- O CONSERTO: a R5 continua DETECTANDO o sinal de nivel de criativo (3 dias acima da regua) - isso
-- ela faz bem e no lugar certo. O que ela deixa de fazer e PRESCREVER. A prescricao passa a vir da
-- arvore, que e a fonte unica: ela conhece volume, tendencia de reversao, maturacao e a guarda do
-- unico conjunto entregando. Deteccao no criativo, decisao no conjunto.
--
-- METODO: substituicao do trecho de texto no corpo existente, via pg_get_functiondef, com guarda
-- que aborta se o padrao nao aparecer. Reescrever dez mil caracteres pela terceira vez hoje para
-- mudar uma frase seria trocar risco pequeno por risco grande.
--
-- FALLBACK DECLARADO: se o anuncio nao tiver conjunto identificado no espelho, o alerta NAO volta
-- a prescrever pausa - ele diz que nao ha como decidir sem verificar alternativa ativa. Ausencia
-- de dado nao vira permissao.

do $$
declare
  v_def text; v_novo text;
  v_antigo text := ''' — recomendação: PAUSAR (sem tendência de queda). Campanha '' || agg.camp_name';
  v_sub text := ''' — '' || coalesce((select ''DECISÃO DO CONJUNTO: '' || (t->>''decisao'') || ''. '' || (t->>''acao'') from public.ads a2, lateral (select public.decidir_sobre_conjunto(agg.company_id, a2.adset_external_id) t) z where a2.external_id = agg.ad_external_id limit 1), ''conjunto não identificado no espelho - NÃO prescrever pausa sem verificar alternativa ativa'') || '' Campanha '' || agg.camp_name';
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname='public' and p.proname='evaluate_alerts' limit 1;

  if v_def is null then
    raise exception 'evaluate_alerts nao encontrada - nada alterado';
  end if;

  if position(v_antigo in v_def) = 0 then
    raise exception 'o trecho da R5 nao esta no corpo como esperado - nada alterado, para nao quebrar o motor de alertas';
  end if;

  v_novo := replace(v_def, v_antigo, v_sub);

  if v_novo = v_def then
    raise exception 'substituicao sem efeito - abortado';
  end if;

  if v_novo !~* '^\s*CREATE OR REPLACE FUNCTION' then
    raise exception 'definicao inesperada - nao vou executar as cegas';
  end if;

  execute v_novo;
  raise notice 'R5 reconciliada: prescricao passa a vir de decidir_sobre_conjunto';
end $$;