-- Composicao hibrida: o bloco canonico e concatenado, a analise em volta segue gerada (03/09/2026)
--
-- DECISAO DO GESTOR, depois de ler a medicao: 90% nao e alcancavel, e o caminho e HIBRIDO.
-- A confirmacao do ato e os numeros saem travados no molde; a analise em volta continua livre.
-- Aproveita os ~48% de respostas que tem um segmento determinizavel sem encurtar a resposta.
--
-- A ARMADILHA QUE ESTA MIGRATION EXISTE PARA FECHAR. A tentacao obvia e entregar o bloco
-- canonico ao modelo pedindo que ele o reproduza literalmente. O modelo PARAFRASEIA — e o
-- determinismo morre exatamente no ponto que justifica a camada, de forma invisivel, porque o
-- texto sai parecido o bastante para ninguem notar. Pior ainda: se o modelo tambem escrever os
-- dados que o codigo vai anexar, a mesma informacao aparece duas vezes, uma travada e uma
-- variavel, expondo a divergencia ao gestor DENTRO da mesma mensagem. Isso e pior que o estado
-- de hoje. Por isso a composicao e feita por CODIGO (_shared/composicao_hibrida.ts) e o modelo
-- recebe uma instrucao curta para NAO escrever o trecho que sera anexado.
--
-- OS TRES GRUPOS, e por que a classificacao vira COLUNA e nao fica so no codigo: corrigir a
-- classificacao de um molde e trabalho de governanca, nao de deploy. Mesmo motivo que levou a
-- definicao de ferramenta para `agent_unidades` no 0ed7a9f.
--
--   turno_inteiro        (1)  o molde responde tudo; nao ha analise a acrescentar.
--   segmento_componivel  (7)  o molde trava um pedaco e a analise entra em volta.
--   nao_componivel       (6)  texto livre em volta FALSIFICA ou DILUI o canonico.
--
-- O CRITERIO, unico e aplicavel: um molde e componivel quando texto livre depois dele nao
-- consegue tornar o canonico FALSO nem repeti-lo. As 5 recusas falham no primeiro teste — a
-- forca de uma recusa vem de ser incondicional, e uma ressalva anexada depois ("mas se voce
-- insistir...") reabre o que ela fechou, com o agravante de o gestor ler a ressalva como
-- permissao. EST_ROTULO_RASTREIO falha pelo mesmo motivo, de forma mais direta: o gabarito
-- afirma "sem rotulo eu NAO aponto vencedor" e a pergunta que o dispara e literalmente "qual
-- variante esta performando melhor?" — analise livre nomearia um vencedor e contradiria o
-- canonico na mesma mensagem. Uma instrucao GENERICA (que e o que o orcamento de prompt
-- permite) nao consegue carregar essa proibicao especifica.

-- ============================================================================
-- GRUPO DE COMPOSICAO NO REGISTRO
-- ============================================================================

alter table public.moldes_de_resposta
  add column if not exists composicao text not null default 'nao_componivel'
    check (composicao in ('turno_inteiro', 'segmento_componivel', 'nao_componivel'));

comment on column public.moldes_de_resposta.composicao is
  'Como o molde convive com analise livre. nao_componivel e o DEFAULT de proposito: molde novo nasce emitindo sozinho, e liberar composicao e decisao explicita. O default seguro e o restritivo.';

-- O default proposital e o restritivo, entao so os componiveis e o turno inteiro sao marcados.
update public.moldes_de_resposta set composicao = 'turno_inteiro'
  where codigo in ('SIS_SONDA_OK');

update public.moldes_de_resposta set composicao = 'segmento_componivel'
  where codigo in (
    'NUM_EXPOSICAO_ORCAMENTO',
    'NUM_CUSTO_LLM_PERIODO',
    'EST_SAUDE_INTEGRACOES',
    'EST_ALERTAS_ABERTOS',
    'EST_CAMPANHAS_ATIVAS',
    'ATO_CONFIRMACAO_CARD',
    'ATO_CARD_NAO_EMITIDO'
  );

-- ============================================================================
-- O TERCEIRO ESTADO NA TELEMETRIA
-- ============================================================================
--
-- Sem isto a auditoria futura nao consegue MEDIR se os ~48% se confirmaram em producao, so
-- estimar de novo — e estimativa foi exatamente o que produziu o numero errado da primeira
-- rodada desta camada.

alter table public.resolucoes_de_molde drop constraint if exists resolucoes_de_molde_caminho_check;
alter table public.resolucoes_de_molde
  add constraint resolucoes_de_molde_caminho_check
  check (caminho in ('canonico', 'hibrido', 'llm'));

-- Guardar os dois tamanhos, e nao a proporcao ja calculada: proporcao e derivada, e derivada
-- gravada envelhece quando a formula muda. Com os dois numeros a auditoria recalcula sozinha.
alter table public.resolucoes_de_molde
  add column if not exists chars_canonicos int,
  add column if not exists chars_gerados int;

comment on column public.resolucoes_de_molde.chars_canonicos is
  'Tamanho do bloco travado por codigo. Em caminho llm e NULL, nao zero: ausencia de bloco e diferente de bloco vazio.';
comment on column public.resolucoes_de_molde.chars_gerados is
  'Tamanho do trecho que o modelo escreveu. Em caminho canonico e NULL. A razao entre os dois e a proporcao real, e ela se calcula na leitura.';

-- ============================================================================
-- A MEDICAO QUE SUBSTITUI A ESTIMATIVA
-- ============================================================================

create or replace function public.proporcao_canonica_medida(p_dias int default 30)
returns table (
  caminho text,
  molde text,
  composicao text,
  turnos bigint,
  pct_dos_turnos numeric,
  media_chars_canonicos numeric,
  media_chars_gerados numeric,
  pct_canonico_no_texto numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  with r as (
    select x.caminho, x.molde, m.composicao, x.chars_canonicos, x.chars_gerados
    from public.resolucoes_de_molde x
    left join public.moldes_de_resposta m on m.codigo = x.molde
    where x.criado_em >= now() - make_interval(days => p_dias)
  )
  select
    r.caminho,
    r.molde,
    r.composicao,
    count(*) as turnos,
    round(100.0 * count(*) / nullif(sum(count(*)) over (), 0), 1) as pct_dos_turnos,
    round(avg(r.chars_canonicos), 0) as media_chars_canonicos,
    round(avg(r.chars_gerados), 0) as media_chars_gerados,
    -- Proporcao do texto final que saiu travada. E a resposta empirica para "os 48% eram reais?".
    round(
      100.0 * sum(coalesce(r.chars_canonicos, 0))
      / nullif(sum(coalesce(r.chars_canonicos, 0) + coalesce(r.chars_gerados, 0)), 0)
    , 1) as pct_canonico_no_texto
  from r
  group by r.caminho, r.molde, r.composicao
  order by count(*) desc, r.molde;
$$;

comment on function public.proporcao_canonica_medida(int) is
  'Proporcao REAL de texto travado por molde e por caminho. Existe para a auditoria medir em vez de estimar: a estimativa de 48% por segmento precisa ser confirmada ou desmentida com dado de producao.';

revoke all on function public.proporcao_canonica_medida(int) from anon, public;

-- ============================================================================
-- MEMORIA INSTITUCIONAL
-- ============================================================================
-- Sem este fato o agente contradiz a propria arquitetura quando o gestor perguntar por que
-- parte da resposta e sempre igual e parte muda.

insert into public.agent_context (categoria, fato, vigente, desde, company_id)
select 'sistema',
  'COMPOSICAO HIBRIDA (03/09/2026): a resposta pode ter DUAS naturezas no mesmo turno. O bloco canonico (confirmacao de card, numeros de estado) e concatenado por CODIGO em _shared/composicao_hibrida.ts e nunca passa por geracao; a analise em volta segue gerada. O bloco vai SEMPRE no inicio da mensagem, antes da analise, porque ele e a resposta e a analise e comentario — e porque o gestor as vezes le por voz, e enterrar o fato depois de 1.900 chars de analise faz ele esperar minutos pelo dado. O modelo recebe uma instrucao curta para NAO escrever o trecho anexado: se ele escrever tambem, a mesma informacao aparece duas vezes, uma travada e uma variavel, e a divergencia fica visivel na mesma mensagem. public.moldes_de_resposta.composicao diz por molde se ele aceita analise em volta (segmento_componivel), responde sozinho (turno_inteiro) ou proibe texto livre em volta (nao_componivel, o default). As 5 recusas e EST_ROTULO_RASTREIO sao nao_componiveis porque texto livre depois delas as torna FALSAS: ressalva anexada a uma recusa e lida como permissao, e apontar vencedor contradiz o gabarito que diz que sem rotulo de rastreio nao se aponta vencedor. Telemetria em public.resolucoes_de_molde grava caminho canonico/hibrido/llm com chars_canonicos e chars_gerados, e public.proporcao_canonica_medida() calcula a proporcao real em vez de estimar.',
  true, current_date, null
where not exists (
  select 1 from public.agent_context
  where categoria = 'sistema' and fato like 'COMPOSICAO HIBRIDA (03/09/2026):%'
);
