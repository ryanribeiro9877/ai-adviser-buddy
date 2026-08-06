-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260806204547
-- name: retrata_nota_de_rpc_de_teto_diario_desatualizada
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

-- DEFEITO ENCONTRADO PELA RODADA DE PERGUNTAS-OURO 2026-08-06-v67 (PO-11 falhou).
--
-- O QUE ACONTECEU: a migracao 20260806174610 corrigiu o fato do teto diario de 175% para 125% e,
-- porque a RPC ainda nao tinha sido corrigida naquele momento, gravou em agent_context a instrucao
-- "a RPC avaliar_orcamento_diario AINDA calcula com 1,75 ... diga que a RPC esta desatualizada".
-- Horas depois a migracao 20260806183031 corrigiu a RPC de verdade - e NINGUEM retratou a instrucao.
--
-- CONSEQUENCIA MEDIDA: em PO-11 o agente afirmou "a rotina calcula o pior dia como 175% do orcamento
-- diario, e isso superestima em ~40%" com ZERO tool calls na mensagem. Ele nao inventou: leu o fato e
-- repetiu. A pergunta PO-11 existe para pegar limitacao inventada, e pegou - a limitacao era falsa.
--
-- POR QUE O CONSERTO E AQUI E NAO NO AGENTE: o agente esta obedecendo a base de fatos, que e o
-- comportamento desejado. O fato e que estava errado. Consertar no prompt seria ensinar o agente a
-- desconfiar da base; consertar a base mantem a unica fonte de doutrina valendo.

do $$
declare
  v_def text;
  v_afetadas int;
  v_restantes int;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'avaliar_orcamento_diario';

  if v_def is null then
    raise exception 'avaliar_orcamento_diario nao existe - nao retrato a nota sem conferir a RPC';
  end if;

  -- Guarda: so retrato a nota se a RPC REALMENTE ja estiver corrigida. Se ela voltar a 175%, a nota
  -- volta a ser verdadeira e apagar a advertencia seria esconder um erro de dinheiro.
  if position('(175%)' in v_def) > 0 then
    raise exception 'avaliar_orcamento_diario ainda contem (175%%): a nota de desatualizada CONTINUA verdadeira, nao retrato';
  end if;

  if position('exposicao_observada_125' in v_def) = 0 then
    raise exception 'avaliar_orcamento_diario nao expoe exposicao_observada_125: nao confirmo a correcao, nao retrato';
  end if;

  update public.agent_context
     set fato = replace(
           fato,
           'ATENCAO AO USAR: a RPC avaliar_orcamento_diario AINDA calcula com 1,75 e portanto SUPERESTIMA o pior dia em 40% ate ser corrigida. Enquanto isso, ao citar pior dia, use 1,25x e diga que a RPC esta desatualizada. ',
           'ESTADO DA RPC, conferido em 06/08/2026: avaliar_orcamento_diario JA FOI CORRIGIDA (migracao 20260806183031) e calcula com o fator observado de 1,25. Ela NAO superestima mais e NAO deve ser descrita como desatualizada nem como calculando 1,75 - dizer isso hoje e afirmar limitacao que nao existe. Ela devolve exposicao_observada_125 (fator 1,25) e, em campo separado, cenario_seguranca_margem_interna_140 (fator 1,40), que e MARGEM INTERNA DE SEGURANCA e nao regra, garantia nem limite da Meta. Ao citar pior dia, use o numero que a propria RPC devolve. ')
   where fato like '%AINDA calcula com 1,75%';

  get diagnostics v_afetadas = row_count;

  if v_afetadas = 0 then
    raise exception 'nenhuma linha de agent_context casou com a nota antiga - texto mudou, revisar a mao';
  end if;

  select count(*) into v_restantes
    from public.agent_context
   where vigente and (fato like '%AINDA calcula com 1,75%' or fato like '%RPC esta desatualizada%');

  if v_restantes > 0 then
    raise exception 'ainda restam %s fatos vigentes dizendo que a RPC esta desatualizada', v_restantes;
  end if;

  raise notice 'nota retratada em % linha(s) de agent_context', v_afetadas;
end $$;