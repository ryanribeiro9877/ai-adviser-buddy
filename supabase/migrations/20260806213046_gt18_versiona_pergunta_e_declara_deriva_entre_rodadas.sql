-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260806213046
-- name: gt18_versiona_pergunta_e_declara_deriva_entre_rodadas
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

-- GT-18 · a pergunta passa a ter versao, e a taxa passa a declarar deriva.
--
-- O QUE ACONTECEU: o PO-06 foi reescrito em 06/08 (commit c3bc4d4) porque a expectativa antiga
-- pedia que o agente NEGASSE um caminho que passou a existir - ou seja, ela premiava a resposta
-- errada. A reescrita esta certa. O problema e outro: ela foi feita NO LUGAR, e
-- taxa_de_erro_perguntas_ouro continua devolvendo 0% com cobertura 100% para a rodada v67b, que
-- foi julgada contra a definicao ANTIGA. A funcao nao tem como saber.
--
-- "Nao se compara mais" e verdade e esta na mensagem do commit. Nao esta no instrumento. Daqui a
-- duas semanas alguem compara o 0% com uma rodada nova e conclui errado, sem nada avisar. Foi
-- exatamente essa forma de defeito - convencao no lugar de guarda - que este projeto passou o dia
-- consertando.
--
-- PERDA JA CONSUMADA, registrada para nao se repetir: a edicao no lugar APAGOU o texto anterior do
-- PO-06. Nao da para mostrar o que mudou nem reconstituir contra o que as cinco rodadas foram
-- julgadas. Daqui pra frente, mudar pergunta e INSERIR linha nova com versao maior e marcar a
-- antiga como nao vigente - nunca sobrescrever.
--
-- A TAXA NAO PASSA A RECUSAR: o numero de uma rodada antiga continua valido PARA A DEFINICAO DA
-- EPOCA. O que e invalido e COMPARAR. Entao a funcao devolve a taxa e declara a deriva ao lado.

alter table public.perguntas_ouro
  add column if not exists versao int not null default 1;

alter table public.perguntas_ouro_execucoes
  add column if not exists versao_da_pergunta int;

comment on column public.perguntas_ouro.versao is
  'Versao da PERGUNTA. Mudar expectativa ou criterio exige versao nova. A partir de 06/08 o padrao e INSERIR linha nova e marcar a antiga como nao vigente - a edicao no lugar do PO-06 apagou a definicao anterior e nao ha como reconstitui-la.';
comment on column public.perguntas_ouro_execucoes.versao_da_pergunta is
  'Contra qual versao da pergunta este veredito foi julgado. NULO em execucoes anteriores a 06/08 significa versao 1 (unica que existia).';

update public.perguntas_ouro set versao = 2 where codigo = 'PO-06';
update public.perguntas_ouro_execucoes set versao_da_pergunta = 1 where versao_da_pergunta is null;

create or replace function public.taxa_de_erro_perguntas_ouro(p_conjunto text, p_rodada text)
returns jsonb
language plpgsql
stable
as $$
declare
  v_den int; v_exec int; v_passou int; v_parcial int; v_falhou int;
  v_tokens bigint; v_custo numeric; v_deriva jsonb; v_n_deriva int;
begin
  select count(*) into v_den from public.perguntas_ouro where conjunto=p_conjunto and vigente;

  select count(*), count(*) filter (where veredito='passou'),
         count(*) filter (where veredito='parcial'), count(*) filter (where veredito='falhou'),
         coalesce(sum(coalesce(tokens_in,0)+coalesce(tokens_out,0)),0), sum(custo_usd)
    into v_exec, v_passou, v_parcial, v_falhou, v_tokens, v_custo
    from public.perguntas_ouro_execucoes
   where conjunto=p_conjunto and rodada=p_rodada;

  -- deriva: execucao julgada contra versao diferente da vigente
  select coalesce(jsonb_agg(jsonb_build_object(
           'codigo', e.codigo,
           'julgada_na_versao', coalesce(e.versao_da_pergunta,1),
           'versao_vigente_hoje', q.versao) order by e.codigo), '[]'::jsonb), count(*)
    into v_deriva, v_n_deriva
    from public.perguntas_ouro_execucoes e
    join public.perguntas_ouro q on q.conjunto=e.conjunto and q.codigo=e.codigo and q.vigente
   where e.conjunto=p_conjunto and e.rodada=p_rodada
     and coalesce(e.versao_da_pergunta,1) <> q.versao;

  if v_exec < v_den then
    return jsonb_build_object('conjunto',p_conjunto,'rodada',p_rodada,
      'denominador',v_den,'executadas',v_exec,'cobertura_pct',round(100.0*v_exec/nullif(v_den,0),1),
      'passou',v_passou,'parcial',v_parcial,'falhou',v_falhou,'taxa_de_erro',null,
      'motivo','Rodada INCOMPLETA: ' || v_exec || ' de ' || v_den || ' perguntas executadas. Taxa sobre rodada parcial nao e taxa - e a origem do "25% para 3%" sem denominador que gerou este card. Complete a rodada ou compare so cobertura.');
  end if;

  return jsonb_build_object(
    'conjunto',p_conjunto,'rodada',p_rodada,
    'denominador',v_den,'executadas',v_exec,'cobertura_pct',100,
    'passou',v_passou,'parcial',v_parcial,'falhou',v_falhou,
    'taxa_de_erro', round((v_falhou + 0.5*v_parcial)*100.0/nullif(v_den,0),1),
    'tokens_da_rodada', v_tokens, 'custo_usd_da_rodada', v_custo,
    'perguntas_com_definicao_superada', v_deriva,
    'COMPARAVEL', (v_n_deriva = 0),
    'aviso_de_deriva', case when v_n_deriva = 0 then null else
      'ATENCAO: ' || v_n_deriva || ' pergunta(s) desta rodada foram julgadas contra uma versao que NAO e mais a vigente. '
      || 'A taxa acima continua valida PARA A DEFINICAO DA EPOCA - o que nao vale e comparar este numero com rodada posterior. '
      || 'Comparar aqui mediria mudanca de regua, nao mudanca de agente.' end,
    'nota','Taxa = (falhou + metade de parcial) / denominador. Parcial vale meio erro de proposito: colapsar parcial em passou infla o resultado, e em falhou o desmerece.');
end;
$$;