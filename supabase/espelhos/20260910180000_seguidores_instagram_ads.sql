-- SEGUIDORES DE INSTAGRAM ATRIBUIDOS A ANUNCIO (10/09/2026)
--
-- O DEFEITO. O gestor perguntou quantos seguidores as turbinagens (Post do Instagram)
-- trouxeram na janela 03-09/09. O Analista ja tinha ler_pipeboard e o catalogo de 59
-- leituras. Chamou get_insights com object_id = id numerico da conta (Graph:
-- "Tried accessing nonexisting field (insights)") e get_instagram_account_insights
-- (saldo do perfil; token sem instagram_manage_insights). Funil/ranking desta casa
-- nao coletam follow. Conclusao falsa de ausencia.
--
-- O QUE EXISTE NA META. Campo Ads Insights `instagram_profile_follow` (referencia
-- developers.facebook.com/docs/graph-api/reference/adaccount/insights/, dado desde
-- 07/07/2025). Atribuicao da Meta por campanha/conjunto/anuncio. NAO e o saldo do @.
-- get_insights do Pipeboard NAO aceita `fields`; quem aceita e bulk_get_insights.
--
-- POR QUE TOOL DEDICADA. Mesma razao de alterar_geo_do_conjunto: o proxy generico
-- existia e o modelo usou o endpoint errado. A tool monta bulk_get_insights com o
-- campo certo e casa o recorte no espelho (name_like / campaign_id).

insert into public.agent_ferramentas
  (chave, descricao, parametros, doutrina, superficies, parametros_omitidos)
values
  ($ft$get_seguidores_instagram_ads$ft$,
   $ft$Seguidores de Instagram ATRIBUIDOS pela Meta aos anuncios (campo instagram_profile_follow). Use quando o gestor perguntar seguidores ganhos por campanha, post turbinado/impulsionado ou anuncio. Passe date_from/date_to e name_like (ex. Post do Instagram). NAO esta no funil nem no ranking. Clique no perfil NAO e follow. NAO e o saldo do @.$ft$,
   $ft${"type":"object","properties":{"date_from":{"type":"string","description":"YYYY-MM-DD"},"date_to":{"type":"string","description":"YYYY-MM-DD"},"name_like":{"type":"string","description":"Trecho do nome (ex. Post do Instagram)."},"campaign_id":{"type":"string","description":"ID Meta da campanha quando o recorte e uma so."}},"required":["date_from","date_to"]}$ft$::jsonb,
   $ft$O numero e atribuicao da Meta (janela padrao da conta), nao incrementalidade e nao o delta do perfil. Zero no campo e resposta; campo ausente e lacuna — nao invente a partir de CTR. get_insights no objeto da conta falha; o caminho e bulk_get_insights com fields. Insight do perfil (get_instagram_account_insights) mistura organico+pago e hoje recusa sem reconectar o Pipeboard com instagram_manage_insights. Funil desta casa continua sem follow.$ft$,
   array['chat','job']::text[],
   $ft${}$ft$::jsonb)
on conflict (chave) do update set
  descricao = excluded.descricao,
  parametros = excluded.parametros,
  doutrina = excluded.doutrina,
  superficies = excluded.superficies,
  vigente = true,
  atualizado_em = now();

update public.agent_ferramentas
   set efeito = 'leitura', setor = 'Desempenho e estrutura de midia'
 where chave = 'get_seguidores_instagram_ads';

update public.agent_ferramentas
   set descricao = $d$Leitura AO VIVO do Pipeboard na conta Meta desta empresa. Use quando faltar dado que o banco nao cobre: config fresca do dia, breakdown, activities, pages, pixels, audiences, insight pontual. Seguidores atribuidos a anuncio: get_seguidores_instagram_ads (nao get_insights no id da conta).$d$,
       doutrina = $d$Prefira as tools de DB (get_overview, get_campaign_detail, get_estrutura_conjuntos, get_criativos_conteudo, funil e ranking) quando bastarem. SO leitura: create, update, delete e upload sao recusados, e contas fora da empresa tambem. A resposta pode vir truncada (aviso_corte). Seguidores de Instagram por anuncio: NAO use get_insights com object_id da conta (a Graph recusa) nem CTR como proxy. Use get_seguidores_instagram_ads. Insight do perfil e get_instagram_account_insights e mistura organico; exige instagram_manage_insights (reconectar Pipeboard se o token for anterior a 04/05/2026).$d$,
       atualizado_em = now()
 where chave = 'ler_pipeboard';

insert into public.agent_unidades (agent_codigo, tipo, chave, observacao)
values
  ('AG-02', 'ferramenta', 'get_seguidores_instagram_ads',
   'Follows de Instagram atribuidos a anuncio; nao e o saldo do perfil')
on conflict (agent_codigo, tipo, chave) do update set
  observacao = excluded.observacao,
  vigente = true;

update public.agents
   set delegar_quando = $ag$Metrica, valor, periodo, comparacao entre campanhas ou anuncios, ranking por gasto/alcance/conversas, "esta caro", "caiu", "subiu", "vale escalar", "posso pausar", teto, meta, pacing, orcamento, CBO, ABO, lance, segmentacao, detalhamento ou serie diaria, seguidores de Instagram atribuidos a anuncio ou post turbinado.$ag$,
       exemplos = array[
         'qual o custo por formulario dos ultimos 7 dias',
         'detalhe o desempenho dos anuncios do CONJ.2 na janela de 14 dias',
         'esse conjunto esta apto a escalar',
         'quanto cada conjunto esta gastando e com que orcamento',
         'quantos seguidores as turbinagens trouxeram nesta semana'
       ],
       updated_at = now()
 where codigo = 'AG-02';

update public.agent_knowledge
   set conteudo = conteudo || $md$

## Seguidores de Instagram (anúncio vs perfil)

Campo da API `instagram_profile_follow` (Ads Insights). Nome no Gerenciador: Instagram follows / seguidores. Mede follows do perfil **atribuídos pela Meta ao anúncio** na janela padrão da conta, em campanha, conjunto e anúncio. Disponível como dado desde 07/07/2025. Verificado aqui em 10/09/2026 contra a lista de campos de Ad Account Insights; o tema `metricas` no todo permanece [VENCIDO] até reverificação ampla.

O que isto NÃO é:
- Saldo líquido do @ no período (orgânico + Explore + outros posts + pago).
- Incrementalidade.
- Clique no perfil, `clicks` ou CTR como proxy.

Nesta casa:
- Funil e ranking **não coletam** o campo. Não declare ausência de follow só porque `get_funnel` não trouxe.
- Tool: `get_seguidores_instagram_ads` (monta `bulk_get_insights` com `fields`). `get_insights` do Pipeboard não aceita `fields`; chamado no id da conta a Graph recusa.
- Insight do perfil (`get_instagram_account_insights` / `follower_count`): mistura origens e exige `instagram_manage_insights` no token Pipeboard. Reconectar em pipeboard.co/connections se o token for anterior a 04/05/2026.
$md$,
       updated_at = now()
 where tema = 'metricas'
   and conteudo not like '%instagram_profile_follow%';

insert into public.agent_context (categoria, fato, vigente, desde, atualizado)
select
  'metricas',
  'SEGUIDORES DE INSTAGRAM (10/09/2026). Funil e ranking NAO tem follow. Atribuicao a anuncio: get_seguidores_instagram_ads (campo instagram_profile_follow, desde 07/07/2025). Saldo do perfil NAO e exclusivo dos anuncios. Clique no perfil nao e follow. get_insights no id da conta falha; nao use CTR como proxy.',
  true,
  date '2026-09-10',
  now()
where not exists (
  select 1 from public.agent_context
   where categoria = 'metricas'
     and fato like 'SEGUIDORES DE INSTAGRAM (10/09/2026)%'
     and vigente is true
);
