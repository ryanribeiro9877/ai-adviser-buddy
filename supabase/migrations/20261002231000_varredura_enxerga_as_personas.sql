-- A varredura passa a ler as personas e a data dd/mm/aaaa, e devolve o que varreu.
-- As frases so mudam depois disso: o nome de pessoa sai do parametro, e o AG-02
-- deixa de atribuir a regra a uma empresa. As datas do AG-06 ficam: sao decisao
-- de arquitetura, nomeadas na excecao, e uma data nova no mesmo campo continua achado.

-- ---------------------------------------------------------------------------
-- Frases. A varredura ja tinha acusado estas duas antes deste update.
-- ---------------------------------------------------------------------------

update public.agent_ferramentas
   set parametros = jsonb_set(
         parametros,
         '{properties,veredito_por,description}',
         to_jsonb('Opcional: quem pediu o veredito. Registro informativo, NAO assinatura.'::text)
       ),
       atualizado_em = now()
 where chave = 'registrar_veredito_peca_em_revisao';

update public.agents
   set limites = array[
         $lim$CONVERSAO FINAL NAO EXISTE NESTE SISTEMA: proposta, contrato pago, receita, CAC por contrato e atribuicao ate a venda foram removidos e sao acompanhados no dashboard da propria empresa. Nao ha tabela, RPC nem integracao que alcance esse dado por outra via - get_funil_credito existe so por compatibilidade e devolve aviso de fora-de-escopo. Diga a exclusao em uma linha e siga com o funil de MIDIA: impressao, clique, formulario, conversa e custo por resultado de midia.$lim$
       ],
       updated_at = now()
 where codigo = 'AG-02';

update public.agent_knowledge
   set conteudo = conteudo || $conteudo$

## Conversao final fora do sistema — 28/07/2026
A conversao final (proposta, contrato pago, receita, CAC por contrato e atribuicao ate a venda) saiu deste sistema em 28/07/2026, por decisao da empresa. Passou a ser acompanhada no dashboard da propria empresa. Nao ha tabela, RPC nem integracao aqui. A persona do analista guarda so a regra: nao existe neste sistema.$conteudo$,
       updated_at = now()
 where tema = 'incidentes_datados'
   and conteudo not like '%Conversao final fora do sistema%';

-- ---------------------------------------------------------------------------
-- Varredura. Escopo declarado, excecao por codigo, data em dd/mm/aaaa.
-- ---------------------------------------------------------------------------

drop function if exists public.varredura_prompt_sem_fato_volatil();

create function public.varredura_prompt_sem_fato_volatil()
returns table (
  tipo text,
  origem text,
  chave text,
  campo text,
  classe text,
  detalhe text
)
language sql
stable
as $fn$
with ferramenta as (
  select f.chave, v.campo, v.texto
  from public.agent_ferramentas f
  cross join lateral (values
    ('descricao', coalesce(f.descricao, '')),
    ('doutrina', coalesce(f.doutrina, '')),
    ('parametros', coalesce(f.parametros::text, ''))
  ) as v(campo, texto)
  where f.vigente
),
agente_bruto as (
  select a.codigo as chave, v.campo, v.texto
  from public.agents a
  cross join lateral (values
    ('papel', coalesce(a.papel, '')),
    ('delegar_quando', coalesce(a.delegar_quando, '')),
    ('nao_delegar_quando', coalesce(a.nao_delegar_quando, '')),
    ('exemplos', coalesce(a.exemplos::text, '')),
    ('limites', coalesce(a.limites::text, ''))
  ) as v(campo, texto)
  where a.vigente
),
agente as (
  select
    chave,
    campo,
    case
      when chave = 'AG-04' and campo = 'exemplos' then regexp_replace(
        texto,
        'essa peca da La Felicita pode entrar na campanha do juridico',
        '',
        'i'
      )
      when chave = 'AG-06' and campo = 'limites' then regexp_replace(
        regexp_replace(texto, '01/09/2026', '', 'g'),
        '10/09/2026',
        '',
        'g'
      )
      else texto
    end as texto
  from agente_bruto
),
escopo as (
  select
    'escopo'::text as tipo,
    'agent_ferramentas'::text as origem,
    count(distinct chave)::text as chave,
    'descricao, doutrina, parametros'::text as campo,
    'vigente'::text as classe,
    'linhas vigentes'::text as detalhe
  from ferramenta
  union all
  select
    'escopo',
    'agents',
    count(distinct chave)::text,
    'papel, delegar_quando, nao_delegar_quando, exemplos, limites',
    'vigente',
    'personas vigentes'
  from agente
),
excecao as (
  select
    'excecao'::text,
    'agents'::text,
    'AG-04'::text,
    'exemplos'::text,
    'nome'::text,
    'exemplo de cruzamento de linha; a frase precisa de dois nomes'::text
  from agente_bruto
  where chave = 'AG-04'
    and campo = 'exemplos'
    and texto ~* 'essa peca da La Felicita pode entrar na campanha do juridico'
  union all
  select
    'excecao',
    'agents',
    'AG-06',
    'limites',
    'data',
    '01/09/2026: nao excluir objeto publicado; decisao de arquitetura do produto'
  from agente_bruto
  where chave = 'AG-06'
    and campo = 'limites'
    and texto ~ '01/09/2026'
  union all
  select
    'excecao',
    'agents',
    'AG-06',
    'limites',
    'data',
    '10/09/2026: comentario de post nao e ato de anuncio; decisao de arquitetura do produto'
  from agente_bruto
  where chave = 'AG-06'
    and campo = 'limites'
    and texto ~ '10/09/2026'
),
achado as (
  select 'achado'::text, 'agent_ferramentas'::text, f.chave, f.campo, 'nome'::text, m[1]
  from ferramenta f
  cross join lateral regexp_matches(f.texto, 'cohapm|felicita|vistta|_laf_', 'gi') as m
  union all
  select 'achado', 'agent_ferramentas', f.chave, f.campo, 'nome_pessoa', m[1]
  from ferramenta f
  cross join lateral regexp_matches(f.texto, '\mRoberto\M', 'gi') as m
  union all
  select 'achado', 'agent_ferramentas', f.chave, f.campo, 'cifra', m[1]
  from ferramenta f
  cross join lateral regexp_matches(f.texto, 'R[$]', 'g') as m
  union all
  select 'achado', 'agent_ferramentas', f.chave, f.campo, 'data', m[1]
  from ferramenta f
  cross join lateral regexp_matches(f.texto, '[0-9]{2}/[0-9]{2}/[0-9]{4}', 'g') as m
  union all
  select 'achado', 'agent_ferramentas', f.chave, f.campo, 'identificador', m[1]
  from ferramenta f
  cross join lateral regexp_matches(f.texto, '[0-9]{10,}|wa\.me/[0-9]+', 'g') as m
  union all
  select 'achado', 'agents', a.chave, a.campo, 'nome', m[1]
  from agente a
  cross join lateral regexp_matches(a.texto, 'cohapm|felicita|vistta|_laf_', 'gi') as m
  union all
  select 'achado', 'agents', a.chave, a.campo, 'nome_pessoa', m[1]
  from agente a
  cross join lateral regexp_matches(a.texto, '\mRoberto\M', 'gi') as m
  union all
  select 'achado', 'agents', a.chave, a.campo, 'cifra', m[1]
  from agente a
  cross join lateral regexp_matches(a.texto, 'R[$]', 'g') as m
  union all
  select 'achado', 'agents', a.chave, a.campo, 'data', m[1]
  from agente a
  cross join lateral regexp_matches(a.texto, '[0-9]{2}/[0-9]{2}/[0-9]{4}', 'g') as m
  union all
  select 'achado', 'agents', a.chave, a.campo, 'identificador', m[1]
  from agente a
  cross join lateral regexp_matches(a.texto, '[0-9]{10,}|wa\.me/[0-9]+', 'g') as m
)
select * from escopo
union all
select * from excecao
union all
select * from achado
$fn$;

comment on function public.varredura_prompt_sem_fato_volatil() is
  'Varre o prompt que entra no turno: agent_ferramentas (descricao, doutrina, parametros) e agents (papel, delegar_quando, nao_delegar_quando, exemplos, limites). Devolve escopo, excecoes nomeadas e achados. Escopo zero nao e aprovacao. Excecoes: AG-04 exemplos (cruzamento de linha) e AG-06 limites nas datas 01/09/2026 e 10/09/2026 (arquitetura).';

revoke all on function public.varredura_prompt_sem_fato_volatil() from public;
grant execute on function public.varredura_prompt_sem_fato_volatil() to service_role;

do $$
declare
  ferramentas int;
  personas int;
  achados int;
  amostra text;
begin
  select chave::int into ferramentas
    from public.varredura_prompt_sem_fato_volatil()
   where tipo = 'escopo' and origem = 'agent_ferramentas';
  select chave::int into personas
    from public.varredura_prompt_sem_fato_volatil()
   where tipo = 'escopo' and origem = 'agents';
  if coalesce(ferramentas, 0) = 0 or coalesce(personas, 0) = 0 then
    raise exception 'escopo da varredura veio zero (ferramentas=%, personas=%). Zero achados nesse estado nao e limpeza.',
      ferramentas, personas;
  end if;
  select count(*) into achados
    from public.varredura_prompt_sem_fato_volatil()
   where tipo = 'achado';
  if achados > 0 then
    select string_agg(origem || ':' || chave || ':' || campo || ':' || classe || ':' || detalhe, ', ' order by origem, chave)
      into amostra
      from public.varredura_prompt_sem_fato_volatil()
     where tipo = 'achado';
    raise exception 'prompt ainda tem fato volatil (%): %', achados, amostra;
  end if;
end $$;
