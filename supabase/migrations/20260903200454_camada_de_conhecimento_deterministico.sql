-- Camada de conhecimento deterministico (03/09/2026)
--
-- A MEDICAO QUE JUSTIFICA ESTA CAMADA (chat_messages, 23/07 a 03/09/2026, 645 turnos do gestor):
--
-- As 13 perguntas_ouro foram executadas 40 vezes pelo caminho de geracao livre. Saiu 40
-- respostas DISTINTAS — nenhuma repeticao byte a byte. Em 12 dos 13 codigos o conjunto de
-- numeros citados mudou entre rodadas. O caso mais grave:
--
--   PO-01 "qual e a exposicao de orcamento diario da operacao hoje, e qual seria o pior dia
--   possivel?" rodou 3x no MESMO dia (06/08), contra a MESMA RPC. Duas rodadas citaram
--   R$ 1.512,00 como pior dia. A terceira NAO citou esse valor em nenhum lugar, e em vez
--   dele trouxe R$ 180,00 / 225,00 / 312,00 / 350,00 / 374,40 / 90,00 — seis valores que
--   nao aparecem nas outras duas.
--
--   PO-13 "quais contas de anuncio estao conectadas e trazendo dado?" rodou 3x. Duas rodadas
--   citaram R$ 1,07 e R$ 2,14 como custo. A terceira citou R$ 1.130,17 e R$ 24.396,27 e
--   nenhum dos dois custos.
--
-- Isto e exatamente o que o gestor descreveu: quando o certo as vezes sai errado e o errado
-- as vezes sai certo, o defeito fica indetectavel e nenhum teste de regressao significa nada.
--
-- POR QUE NAO RESOLVER NO PROMPT: regra escrita no system prompt continua sendo LIDA e
-- REEXPRESSA pelo modelo a cada turno — e a variancia acima ja acontece com o prompt atual,
-- que tem doutrina para todos esses casos. Escrever mais texto no prompt aumentaria o custo e
-- desfaria a compactacao de 35% do commit 0ed7a9f sem tocar na causa.
--
-- O QUE MUDA: a resposta passa a ter um caminho de EMISSAO que nao atravessa geracao livre.
-- Texto canonico sai literal da tabela; molde calculado sai com forma fixa e lacunas tipadas
-- preenchidas por valor de SQL. A classificacao do turno e por regex, antes de o modelo ver o
-- pedido (_shared/molde_pergunta.ts).
--
-- AS TRES TABELAS QUE JA EXISTIAM NAO RESOLVEM ISTO, e nao e defeito de conteudo, e de
-- consumo: agent_context entra no prompt como bloco `memoria`, agent_style como bloco
-- `estilo`, agent_knowledge como INDICE com conteudo sob demanda via get_conhecimento. Nos
-- tres casos o texto e recuperado e PARAFRASEADO. O determinismo se perde na emissao.
--
-- RISCO DE PRIMEIRA ORDEM: conhecimento fixo e ERRADO e pior que geracao variavel, porque e
-- consistentemente errado e soa autoritativo. Por isso `revalidar_ate` NAO e nota de rodape:
-- passou da data, o molde para de emitir e o turno volta para o LLM. Nao emite com aviso.

-- ============================================================================
-- REGISTRO DE MOLDES
-- ============================================================================

create table if not exists public.moldes_de_resposta (
  codigo text primary key,
  -- texto_canonico     = resposta armazenada, emitida LITERAL
  -- molde_calculado    = forma fixa, lacunas preenchidas por valor de SQL/codigo
  -- confirmacao_de_ato = forma fixa, lacunas vindas do registro do ato praticado
  classe text not null check (classe in ('texto_canonico', 'molde_calculado', 'confirmacao_de_ato')),
  titulo text not null,
  -- Texto com lacunas {campo}. Para texto_canonico, normalmente sem lacuna nenhuma.
  gabarito text not null,
  -- [{nome, tipo, origem, obrigatorio}]. `origem` e obrigatoria por decisao: campo sem origem
  -- declarada nao entra no molde, senao o numero volta a nascer de lugar nenhum.
  campos jsonb not null default '[]'::jsonb,
  -- Quando NAO usar este molde. Fica junto do gabarito para ser revisado junto com ele —
  -- fronteira em outro arquivo envelhece separada do texto que ela delimita.
  fronteira text,
  verificado_em date not null default current_date,
  -- NULL = nao envelhece (sonda, recusa de regra estrutural). Data = para de emitir depois dela.
  revalidar_ate date,
  vigente boolean not null default true,
  versao int not null default 1,
  updated_at timestamptz not null default now()
);

comment on table public.moldes_de_resposta is
  'Registro de moldes de resposta deterministica. Consumido por _shared/resposta_canonica.ts. Texto canonico sai literal; molde calculado sai preenchido por valor de SQL.';
comment on column public.moldes_de_resposta.revalidar_ate is
  'Passou desta data, o molde PARA de emitir e o turno cai para o LLM. Nao emite com aviso: conhecimento fixo e errado e pior que geracao variavel.';
comment on column public.moldes_de_resposta.campos is
  'Cada campo declara origem. Campo obrigatorio sem valor derruba a emissao inteira para o LLM, em vez de escrever lacuna dentro da forma fixa.';
comment on column public.moldes_de_resposta.fronteira is
  'Quando NAO usar. Errar para o lado do molde produz resposta confiantemente errada; errar para o lado do LLM so custa um turno caro.';

-- ============================================================================
-- TELEMETRIA — a base da governanca
-- ============================================================================
--
-- Grava-se nos DOIS caminhos. So o canonico nao serve: o dado que revela molde mal desenhado
-- e o `motivo` recorrente do caminho LLM. "campo obrigatorio sem valor: pior" repetido 200
-- vezes diz que a fonte daquele campo esta quebrada, e sem esta tabela ninguem saberia.

create table if not exists public.resolucoes_de_molde (
  id bigint generated always as identity primary key,
  company_id uuid,
  conversation_id uuid,
  molde text,
  caminho text not null check (caminho in ('canonico', 'llm')),
  -- Preenchido so no caminho llm. E o motivo da RECUSA de emitir.
  motivo text,
  confianca text not null check (confianca in ('exata', 'fraca', 'nenhuma')),
  versao int,
  parametros jsonb not null default '{}'::jsonb,
  criado_em timestamptz not null default now()
);

comment on table public.resolucoes_de_molde is
  'Telemetria da fronteira deterministico/LLM. Motivo recorrente no caminho llm aponta molde mal desenhado ou fonte de campo quebrada.';

create index if not exists resolucoes_de_molde_por_molde
  on public.resolucoes_de_molde (molde, caminho, criado_em desc);
create index if not exists resolucoes_de_molde_recentes
  on public.resolucoes_de_molde (criado_em desc);

-- Mesma postura de agent_knowledge e agents: registro de comportamento do agente nao e dado
-- de cliente. Sem policy, so service_role (edges) le e escreve. RLS ligada para o linter nao
-- apontar tabela exposta.
alter table public.moldes_de_resposta enable row level security;
alter table public.resolucoes_de_molde enable row level security;

revoke all on public.moldes_de_resposta from anon, authenticated;
revoke all on public.resolucoes_de_molde from anon, authenticated;

-- ============================================================================
-- GOVERNANCA: quem envelheceu
-- ============================================================================
--
-- A pergunta "qual molde esta a ponto de afirmar com conviccao algo que deixou de ser
-- verdade" precisa ter resposta sem ninguem lembrar de perguntar. Por isso e funcao no banco,
-- consumivel por cron e pelo Bibliotecario (AG-08), que ja e o dono da rotina de revalidacao
-- de agent_knowledge.

create or replace function public.moldes_a_revalidar(p_dias_de_antecedencia int default 30)
returns table (
  codigo text,
  titulo text,
  classe text,
  revalidar_ate date,
  dias_restantes int,
  situacao text,
  emissoes_ultimos_30d bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    m.codigo,
    m.titulo,
    m.classe,
    m.revalidar_ate,
    (m.revalidar_ate - current_date)::int as dias_restantes,
    case
      when m.revalidar_ate < current_date then 'vencido'
      else 'a_vencer'
    end as situacao,
    (
      select count(*)
      from public.resolucoes_de_molde r
      where r.molde = m.codigo
        and r.caminho = 'canonico'
        and r.criado_em >= now() - interval '30 days'
    ) as emissoes_ultimos_30d
  from public.moldes_de_resposta m
  where m.vigente
    and m.revalidar_ate is not null
    and m.revalidar_ate <= current_date + p_dias_de_antecedencia
  order by m.revalidar_ate, m.codigo;
$$;

comment on function public.moldes_a_revalidar(int) is
  'Moldes vencidos ou a vencer. emissoes_ultimos_30d prioriza: molde vencido que emitiu 400 vezes e mais urgente que um que nunca emitiu.';

revoke all on function public.moldes_a_revalidar(int) from anon, public;
