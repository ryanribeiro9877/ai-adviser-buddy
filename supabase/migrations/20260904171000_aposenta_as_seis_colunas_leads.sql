-- AS SEIS COLUNAS `leads` SAEM (04/09/2026)
--
-- Fecha o que comecou em 20260903244000, quando `campaigns.leads` saiu e as demais ficaram
-- porque tinham escritor vivo. Depois de 20260904170000 nao tem mais: as oito funcoes que
-- gravavam pararam, e a unica leitura restante (a variavel morta do digest) foi removida.
--
-- POR QUE AS SEIS SAEM, E NENHUMA FICA
-- =========================================================================================
-- O criterio e o mesmo desde o comeco desta frente: nao existe numero de resultado sem
-- denominador declarado. `leads` era formulario somado com conversa, sem dizer qual. Antes de
-- dropar, conferi tabela por tabela se ela guardava algo que `form_leads`, `messaging_started`
-- e `link_clicks` nao guardassem. Em nenhuma das 4.137 linhas das seis tabelas `leads` e
-- MAIOR que form_leads + messaging_started. Onde diverge, diverge para menos: sao os zeros
-- falsos de 04/08 a 04/09/2026, 214 resultados reais gravados como zero.
--
-- Nao ha, portanto, coluna com conteudo sem equivalente. Se houvesse, ela ficaria e este
-- arquivo diria o que e — dropar por simetria com as vizinhas seria perder dado para manter
-- a tabela bonita.
--
-- O QUE NAO SE PERDE
-- =========================================================================================
-- Nada precisa ser copiado para lugar nenhum: `form_leads` e `messaging_started` ja existem
-- nas seis tabelas e ja carregam as duas parcelas separadas, com base no nome. `link_clicks`
-- cobre o terceiro evento. A soma continua disponivel a quem quiser — mas quem quiser tera de
-- escrever `form_leads + messaging_started` e assumir a mistura por escrito, em vez de herda-la
-- de uma coluna que nao avisa.
--
-- A CONFERENCIA ABORTA
-- =========================================================================================
-- Antes de dropar, o bloco abaixo varre funcoes e views atras de qualquer mencao a `leads`
-- que nao esteja na lista das quatro conhecidas — todas literais de texto, nenhuma tocando
-- coluna. Se aparecer nome novo, a migration levanta excecao e nao dropa nada, porque um
-- leitor sobrevivente e pior depois do drop do que antes: antes ele le numero velho, depois
-- ele quebra em producao. Terminado o drop, confere que as seis sumiram de fato.

-- ============================================================================
-- 1) Nenhum leitor pode sobrar
-- ============================================================================

do $antes$
declare
  v_intrusos text;
begin
  -- Funcoes. As quatro conhecidas citam a palavra em literal de texto, nunca como coluna:
  --   avaliar_pacing        -> mensagem 'nao ha meta de leads por dia decidida por ninguem'
  --   base_de_resultado     -> valor de CATEGORIA de campanha ('leadgen','lead','leads',...)
  --   get_estrutura_conjuntos -> rotulo de pegada quando optimization_goal e LEAD_GENERATION
  --   panorama_utm_anuncios -> nota sobre 'quantos leads por rotulo UTM'
  select string_agg(p.proname, ', ' order by p.proname) into v_intrusos
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prokind in ('f','p')
     and p.prosrc ~* '\mleads\M'
     and p.proname not in ('avaliar_pacing','base_de_resultado','get_estrutura_conjuntos','panorama_utm_anuncios');

  if v_intrusos is not null then
    raise exception 'ainda ha funcao citando leads fora da lista conhecida: %. Nao dropo coluna com leitor vivo.', v_intrusos;
  end if;

  -- Views e materialized views.
  select string_agg(n.nspname || '.' || c.relname, ', ' order by c.relname) into v_intrusos
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where c.relkind in ('v','m')
     and n.nspname not in ('pg_catalog','information_schema')
     and pg_get_viewdef(c.oid, true) ~* '\mleads\M';

  if v_intrusos is not null then
    raise exception 'ainda ha view lendo leads: %', v_intrusos;
  end if;

  -- Indices, constraints e defaults presos a coluna.
  select string_agg(distinct c.relname, ', ') into v_intrusos
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attname = 'leads' and a.attnum > 0 and not a.attisdropped
   where n.nspname = 'public'
     and (exists (select 1 from pg_index x where x.indrelid = c.oid and a.attnum = any(x.indkey::smallint[]))
       or exists (select 1 from pg_constraint k where k.conrelid = c.oid and a.attnum = any(k.conkey)));

  if v_intrusos is not null then
    raise exception 'ha indice ou constraint sobre leads em: %', v_intrusos;
  end if;

  raise notice 'nenhum leitor de leads sobrou; pode dropar';
end $antes$;

-- ============================================================================
-- 2) As seis saem
-- ============================================================================

alter table public.ad_metric_snapshots           drop column if exists leads;
alter table public.ad_metric_snapshots_paralelo  drop column if exists leads;
alter table public.ads                           drop column if exists leads;
alter table public.ad_sets                       drop column if exists leads;
alter table public.metric_breakdown_daily        drop column if exists leads;
alter table public.metric_snapshots              drop column if exists leads;

comment on column public.metric_snapshots.form_leads is
'Formularios entregues. Base declarada. Substituiu metade da antiga coluna `leads`, removida em 04/09/2026 por somar isto com conversa sem dizer qual das duas.';
comment on column public.metric_snapshots.messaging_started is
'Conversas iniciadas. Base declarada. Substituiu a outra metade da antiga coluna `leads`.';

-- ============================================================================
-- 3) E tem de ter sumido mesmo
-- ============================================================================

do $depois$
declare
  v_restam text;
begin
  select string_agg(table_name, ', ' order by table_name) into v_restam
    from information_schema.columns
   where table_schema = 'public' and column_name = 'leads';

  if v_restam is not null then
    raise exception 'a coluna leads persiste em: %', v_restam;
  end if;

  raise notice 'seis colunas leads removidas; nenhuma coluna leads restante no schema public';
end $depois$;
