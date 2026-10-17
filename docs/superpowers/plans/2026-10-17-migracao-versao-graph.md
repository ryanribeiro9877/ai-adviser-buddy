# Migração da versão da Graph/Marketing API (levantamento de 17/10/2026)

Plano. Nenhuma edge foi alterada nem publicada. Cada onda abaixo só sobe para a Meta com pedido explícito do usuário.

## Resumo

- **27 literais de versão em 23 arquivos de `supabase/functions`**: 23 em v21.0, 3 em v22.0 e 1 em v25.0. Edges que não aparecem no grep (traffic-chat, traffic-agent-job, geo-preset-resolve, pipeboard-structure-sync) herdam a versão pelos módulos `_shared`.
- **O prazo que importa não é 21/01/2027.**
  - **Marketing API (anúncios, conjuntos, criativos, busca de segmentação, imagens, vídeos, pixels).** Na tabela da Meta, a v21.0 da Marketing API expirou em **09/09/2025**. O auto-upgrade da Marketing API foi liberado em 29/07/2026: chamadas a versão expirada sobem em silêncio para uma versão ativa, com o header `X-Ad-Api-Version-Warning`. Endpoints listados como afetados podem falhar em vez de subir.
  - **Graph básica (Página, `/me`, `debug_token`, Business, WhatsApp) e Conversions API.** A v21.0 vai até **21/01/2027**, data já publicada e não mais "TBD". Depois disso, a chamada cai na versão utilizável mais antiga (v22.0, que vai até 20/05/2027).
- **Indícios de que chamadas "v21" já respondem com regras novas.**
  - O pré-voo em v21 continua devolvendo "validado", inclusive para `POST /act_/adsets` em 15/10/2026. Então não é v21 que responde.
  - Em 21/08/2026, o `meta-campaign-status` quebrou em `GET /?ids=`, mudança da v26 (`meta-campaign-status/index.ts:17`).
  - No mesmo dia, uma criação pelo Pipeboard recebeu o erro 2490589 do Explore, com o texto "descontinuado para esta versão da API".
  - Sem o header de aviso não dá para saber qual versão está respondendo. O código hoje não registra esse header.
- **27/10/2026, daqui a 10 dias.** Várias mudanças da v26 passam a valer em todas as versões. Duas atingem o nosso código:
  - criação de conjunto da Legal é Viver por molde sem `advantage_audience` explícito: nenhum dos 28 conjuntos ativos da Legal tem a flag, e 6 deles usam interesse ou público;
  - posicionamentos de Messenger: `story` sai agora, e `messenger_home` já tinha saído em 11/11/2025.
- **Já quebrado hoje, em qualquer versão:**
  - `instagram_actor_id` para ids que não começam com 1784 (fora desde 09/09/2025);
  - opt-out de `standard_enhancements` no criativo de clique (bundle sem suporte desde a v22);
  - sonda com `metadata=1` (ignorado desde 19/05/2026).
- **Proposta.**
  - Versão alvo **v26.0**, numa constante única `_shared/meta_graph.ts`.
  - Seis ondas. A onda 0 corrige o que 27/10 quebra sem trocar versão. A onda 4 (executor, pré-voo e chat) sobe toda no mesmo dia.

## 1. Inventário: onde a versão está fixa

Grep: `(graph|graph-video)\.facebook\.com/v[0-9]+\.[0-9]` em `supabase/functions`. O grep da revisão de 17/10 (`graph\.facebook\.com/...`) dava 26 porque não pegava o host `graph-video`, usado no upload de vídeo.

Quase todo literal é uma constante (`GRAPH`, `GRAPH_SEARCH`...) usada por um helper local (`g()`, `graphGet()`). A tabela lista a constante e o que passa por ela.

Escrita direta na Graph é pouca:
- Nas três empresas, `meta_execution_config.driver_escrita = 'pipeboard'`.
- `resolver_driver` só força a Graph em `vincular_instagram_dos_anuncios` e `criar_criativo_carrossel`.
- Pausar, ativar, criar, mudar orçamento, público, idade, geo e posicionamento passam pelo Pipeboard, que escolhe a versão por conta própria. O `meta-ads-mcp` aberto está fixo em v24.0; o hospedado não informa.

| # | Arquivo:linha | Versão | Edges que rodam o código | Endpoints e campos | Escreve? |
|---|---|---|---|---|---|
| 1 | `_shared/geo_targeting.ts:38` | v21.0 | meta-actions, traffic-chat, geo-preset-resolve | `GET /search?type=adgeolocation` (`q`, `location_types`, `country_code`, `limit`) | não |
| 2 | `_shared/interesse_targeting.ts:6` | v21.0 | meta-actions, traffic-chat, traffic-agent-job | `GET /search?type=adinterest` e `type=adTargetingCategory&class=…` (`q`, `limit`, `locale`) | não |
| 3 | `_shared/ler_objeto.ts:4` | v21.0 | traffic-chat, traffic-agent-job, meta-actions (via `releitura_pos_escrita`) | `GET /{id}?fields=`: conjunto (`targeting`, `promoted_object`, `destination_type`, `optimization_goal`, `billing_event`, `bid_strategy`, `bid_amount`, orçamentos, datas), anúncio (`creative{object_story_spec,degrees_of_freedom_spec,asset_feed_spec,body,title,call_to_action_type,thumbnail_url}`) e campanha | não |
| 4 | `_shared/prevoo_meta.ts:3` | v21.0 | traffic-chat (`:3040` updates, `:3751` `POST /act_/adsets`, `:3788` `POST /act_/adcreatives`), traffic-agent-job (`:2745` updates) | `POST` com `execution_options=["validate_only"]`. Campos: `status`, `daily_budget`, `targeting` (só `flexible_spec`), `creative` e corpo inteiro de conjunto e de criativo | não (valida) |
| 5 | `_shared/instagram_anuncios.ts:42` | v21.0 | meta-actions (`vincular_instagram_dos_anuncios`, sondas), traffic-chat; via `whatsapp_pagina`: meta-actions, traffic-chat, traffic-agent-job | **Instagram:** `GET /act_/instagram_accounts`; `GET /{page}?fields=instagram_business_account{…},connected_instagram_account{…}`; `GET /{campaign}/ads?fields=…creative{object_story_spec,instagram_user_id,effective_object_story_id}`; `GET /{creative}?fields=object_story_spec,url_tags,effective_object_story_id,object_story_id`; `POST /act_/adcreatives` (`object_story_id` + `instagram_user_id`\|`instagram_actor_id`, ou `object_story_spec` + `url_tags`); `POST /{ad}` (`creative`). **WhatsApp da Página:** `GET /{page}?fields=whatsapp_number,has_whatsapp_number`, `/{page}/whatsapp_business_accounts?fields=…phone_numbers{…}`, `connected_whatsapp_business_account{…}`, `/{business}/owned\|client_whatsapp_business_accounts` | sim |
| 6 | `_shared/miniatura_criativo.ts:9` | v21.0 | pipeboard-structure-sync | `GET /{ad}?fields=id,status,effective_status,creative{id,thumbnail_url,image_url,image_hash,object_story_spec,video_id,object_type}`, `GET /act_/adimages?fields=hash,url` | não |
| 7 | `ad-preview/index.ts:11` | v21.0 | ad-preview | `GET /{ad}/previews?ad_format=MOBILE_FEED_STANDARD\|INSTAGRAM_STORY\|INSTAGRAM_REELS` | não |
| 8 | `bm-monitor/index.ts:34` | v21.0 | bm-monitor | `GET /act_?fields=name,account_status,disable_reason,balance,currency,spend_cap,amount_spent[,funding_source_details]`, `/act_/ads?fields=name,effective_status,ad_review_feedback`, `/act_/campaigns?fields=name,effective_status,issues_info` | não |
| 9 | `listar-ativos-orfaos/index.ts:24` | v21.0 | listar-ativos-orfaos | `GET /act_/advideos?fields=id,title,created_time`, `/act_/adimages?fields=hash,name,created_time`, `/act_/ads?fields=…creative{video_id,image_hash,object_story_spec,asset_feed_spec}`, `/act_/campaigns?fields=id,name,created_time` | não |
| 10 | `meta-actions/index.ts:576` | v21.0 | meta-actions | Helper `g()`. **Escrita:** `escreverCriacao/Creative/Ad/Update` quando o driver é graph (hoje `criar_criativo_carrossel` → `POST /act_/adcreatives`); patch CTWA no fluxo principal (`:4618`, `POST /{adset}` `promoted_object{page_id,whatsapp_phone_number}`); modos de manutenção `provar_releitura` (`targeting`), `corrigir_orcamento_adsets` (`daily_budget`), `definir_whatsapp_conjunto` (`promoted_object`, `status`, clone `POST /act_/adsets` e `/act_/ads`) e `reparar_criativos_ctwa` (`POST /act_/adcreatives`, `POST /{ad}`). **Leitura:** releitura pós-escrita (`CAMPOS_DE_RECONCILIACAO`); molde de conjunto (`optimization_goal,billing_event,bid_strategy,targeting,promoted_object,destination_type,attribution_spec,bid_amount,dsa_beneficiary,dsa_payor`); molde de criativo (`object_story_spec,asset_feed_spec,url_tags,name,degrees_of_freedom_spec`); campanha (`daily_budget,lifetime_budget,objective,name`); `/{video}/thumbnails`; `is_dynamic_creative`; sondas de Página/WhatsApp/Instagram (`/me/instagram_accounts`, `/act_/instagram_accounts`, `/{business}/owned\|client_instagram_accounts`, `/{page}/page_backed_instagram_accounts`, `?metadata=1`) | sim |
| 11 | `meta-actions/index.ts:4112` | v21.0 | meta-actions (modo `ler_contas_instagram`) | `GET /{page}?fields=instagram_business_account{id,username,name},connected_instagram_account{id,username,name}` com token de Página | não |
| 12 | `meta-campaign-status/index.ts:168` | v21.0 | meta-campaign-status | `GET /act_/campaigns?fields=name,status,effective_status,special_ad_categories,bid_strategy,daily_budget,lifetime_budget,is_adset_budget_sharing_enabled,buying_type`, `/act_/adsets?fields=id,status,effective_status`, `/act_/ads?fields=…creative{id}`, `GET /{id}?fields=` (`is_dynamic_creative`, `object_story_spec`, `asset_feed_spec`…) | não |
| 13 | `meta-campaign-status/index.ts:170` | v22.0 | meta-campaign-status | `GET /act_/recommendations` (`recommendation_signature,…,opportunity_score_lift,url`) e `GET /act_?fields=opportunity_score` | não |
| 14 | `meta-campaign-status/index.ts:867` | v25.0 | meta-campaign-status | O mesmo `recommendations`, segunda tentativa da lista `[v22, v25, v21]` | não |
| 15 | `meta-capi/index.ts:21` | v21.0 | meta-capi | `GET /act_/adspixels?fields=id,name,last_fired_time,is_unavailable,enable_automatic_matching`, `POST /{dataset}/events` (Conversions API) | sim (evento) |
| 16 | `meta-health/index.ts:37` | v21.0 | meta-health | `GET /me`, `/me/permissions`, `/debug_token`, `/{app}`, `/act_?fields=…funding_source_details`, `/act_/assigned_users`, `/act_/ads`, `/act_/adsets`; `DELETE /{creative}` (limpa criativo de prova) | sim (DELETE) |
| 17 | `meta-identity-probe/index.ts:23` | v21.0 | meta-identity-probe | `/me`, `/debug_token`, `/{page}?fields=instagram_business_account,connected_instagram_account,instagram_accounts,page_backed_instagram_accounts`, `/{page}/instagram_accounts`, `/{page}/page_backed_instagram_accounts`, `/act_/instagram_accounts`, `/{business}/owned_instagram_accounts`, `/{business}/instagram_accounts` | não |
| 18 | `meta-test-campaign/index.ts:18` | v21.0 | meta-test-campaign (arquivada pela ESP-47; segue no ar e responde `edge_arquivada`) | `POST /act_/campaigns` e `POST`/`DELETE /{campaign}`, inalcançáveis com `ARQUIVADA` | não (bloqueada) |
| 19 | `meta-token-crosscheck/index.ts:19` | v21.0 | meta-token-crosscheck | `/me`, `/debug_token`, `/act_?fields=…business{id,name},disable_reason`, `/act_/campaigns`, `/act_/recommendations`, `/{waba}/phone_numbers?fields=…quality_rating,messaging_limit_tier,platform_type`, `/me/assigned_whatsapp_business_accounts`, `/{bm}/owned\|client_whatsapp_business_accounts`, `/me/businesses` | não |
| 20 | `meta-token-monitor/index.ts:25` | v21.0 | meta-token-monitor | `/me`, `/debug_token`, `/me/businesses?fields=id,name,verification_status,primary_page`, `/{business}/owned_ad_accounts?fields=account_id,name,account_status,currency` | não |
| 21 | `upload-midia/index.ts:83` | v21.0 | upload-midia | `POST /act_/adimages`, `GET /{creative}?fields=…degrees_of_freedom_spec`, `/{video}/thumbnails`, `/{video}?fields=id,status` | sim (upload) |
| 22 | `upload-midia/index.ts:84` | v21.0 | upload-midia | `POST graph-video…/act_/advideos` (multipart) | sim (upload) |
| 23 | `waba-phone-connect/index.ts:24` | v22.0 | waba-phone-connect | `GET /{phone}?fields=…code_verification_status,quality_rating,messaging_limit_tier,name_status,throughput`, `GET /{waba}?fields=…account_review_status,owner_business_info`, `/{page}/whatsapp_business_accounts`; `POST /{phone}/request_code`, `/verify_code`, `/register` (`pin`, `data_localization_region` opcional) | sim |
| 24 | `waba-probe/index.ts:16` | v21.0 | waba-probe | `/{waba}?fields=name,account_review_status,message_template_namespace,ownership_type,on_behalf_of_business_info,owner_business_info`, `/{waba}/phone_numbers?fields=…quality_rating,throughput,is_official_business_account` | não |
| 25 | `waba-sync/index.ts:42` | v22.0 | waba-sync | `/{waba}/phone_numbers?fields=…messaging_limit_tier,whatsapp_business_manager_messaging_limit,name_status`, `/{waba}/message_templates?fields=…quality_score,rejected_reason`, `/{waba}?fields=analytics.start().end().granularity(DAY)[.phone_numbers([…])]`, `/{waba}/template_analytics` (`granularity=DAILY`, `metric_types`, `template_ids` em lotes de 10) | não |
| 26 | `waba-template-create/index.ts:27` | v21.0 | waba-template-create | `GET`/`POST /{waba}/message_templates` (`name`, `language`, `category`, `components`) | sim |
| 27 | `waba-template-replicate/index.ts:27` | v21.0 | waba-template-replicate | idem | sim |

## 2. Datas e política de versões

Conferido em 17/10/2026 em `developers.facebook.com/docs/graph-api/changelog/versions` (`?locale=en_US`). A página tem uma tabela para a Graph API e outra para a Marketing API.

| Versão | Lançamento | Graph API expira | Marketing API expira |
|---|---|---|---|
| v21.0 | 02/10/2024 | **21/01/2027** | **09/09/2025** |
| v22.0 | 21/01/2025 | 20/05/2027 | 19/02/2026 |
| v23.0 | 29/05/2025 | 08/10/2027 | 09/06/2026 |
| v24.0 | 08/10/2025 | 18/02/2028 | 06/10/2026 (o changelog da Marketing diz 10/11/2026) |
| v25.0 | 18/02/2026 | 29/07/2028 | TBD (o changelog da Marketing diz 23/02/2027) |
| v26.0 | 29/07/2026 | TBD | TBD |

- **Graph API.** A versão vale até 2 anos após a seguinte. Chamada a versão expirada "will be defaulted to the next oldest, usable version" (guia de versionamento). O post da v26 confirma: "January 21, 2027: Graph API v21.0 is deprecated and removed". A v20.0 saiu em 24/09/2026.
- **Marketing API.** A versão anterior é suportada por pelo menos 90 dias após a seguinte; na prática, cada versão durou de 11 a 13 meses.
  - Versão expirada "may fail or be upgraded to the next available version". O upgrade vem com o header `X-Ad-Api-Version-Warning` e não acontece em endpoint listado como afetado no changelog.
  - O auto-upgrade pode ser desligado nas configurações do app.
  - Nota acima da tabela: "Marketing API version auto-upgrade will release on July 29, 2026". A Meta não detalha o que mudou nessa data.
- **Conversions API** (`POST /{dataset}/events`): segue o calendário da Graph, "every version is supported for at least two years". `GET /act_/adspixels` é Marketing API.
- **WhatsApp Cloud/Business Management.** Não há texto explícito, mas o changelog amarra mudanças a versões da Graph ("version 24.0 and newer"). Trato como calendário da Graph.
- **Em aberto:**
  - Quais edges de Business e conta de anúncio seguem a Marketing e quais seguem a Graph: `owned_ad_accounts`, `assigned_users`, `act_/instagram_accounts`.
  - Qual versão responde hoje às nossas chamadas "v21" da Marketing: só o header de aviso diz.

## 3. Mudanças de v21 a v26 × chamadas afetadas

Siglas das fontes: MC = changelog da Marketing API por versão; GC = changelog da Graph; BLOG26 = post da v26 (29/07/2026); OCC = mudanças fora de ciclo de 2025/2026; WA = changelog e documentação do WhatsApp.

| Mudança | Entra em | Vale p/ todas as versões | Chamadas (# do inventário) | Efeito aqui | Ação |
|---|---|---|---|---|---|
| Marketing API v21 expirada; auto-upgrade | — | 09/09/2025; auto-upgrade desde 29/07/2026 | #2–#4, #6–#14; parte de Marketing de #5, #10, #15, #16; #21, #22 | A versão que responde não é a do código. Endpoint "afetado" pode falhar | Ondas 1–4: fixar v26 |
| Graph v21 expira | — | 21/01/2027 | Página, `/me`, `debug_token`, Business e WhatsApp de #5, #10, #11, #16, #17, #19, #20, #23–#27; CAPI de #15 | Cai em v22 (até 20/05/2027) sem aviso | Ondas 1–3 |
| HEC-F: `targeting_automation.advantage_audience` explícito (0/1) ao **criar** conjunto de HOUSING/EMPLOYMENT/FINANCIAL com segmentação ajustável não ampla. Erro `ADS_TARGETING__REQUIRE_EXPLICIT_ADVANTAGE_AUDIENCE_FLAG` | v26 (MC26, GC26, BLOG26) | **27/10/2026** pelo MC26; "TBD" pelo GC26 | Criação de conjunto pelo Pipeboard; clone de `definir_whatsapp_conjunto` (#10); pré-voo `POST /act_/adsets` (#4) | Legal é Viver (FINANCIAL_PRODUCTS_SERVICES) com interesses ou público. `criar_conjunto` já manda a flag (`_shared/conjunto_spec.ts`, `targetingPadraoSocialTopo`). **`criar_conjunto_a_partir_de` e `escalar_duplicar` herdam o `targeting` do molde (`meta-actions/index.ts:2076`)** e só gravam a flag quando a idade muda. Nenhum dos 28 conjuntos ativos da Legal tem a flag no espelho, e 6 deles têm interesse ou público | **Onda 0a.** Update de conjunto existente não é afetado (BLOG26) |
| `messenger_positions: story` descartado | v26 | 27/10/2026 (GC26, BLOG26); "fim de agosto" (MC26) | `_shared/posicionamento.ts:59` (`MESSENGER_POSITIONS_PADRAO = ["messenger_home", "story"]`), aplicado na criação e no ajuste de posicionamento | Somado à linha de baixo, Messenger fica sem posição válida e dá erro de validação. Um conjunto pausado da Legal tem só `["story"]` e quebra se servir de molde | **Onda 0b** |
| `messenger_positions: messenger_home` removido da criação | v23 (OCC de 09/10/2025) | 11/11/2025 | idem | Já hoje: escolher Messenger manda posição inexistente | **Onda 0b** |
| Explore do Instagram removido (`explore`/`explore_home`) | v26 | sem data; já recebido via Pipeboard em 21/08 (2490589) | `_shared/posicionamento.ts` | Já tratado: o sistema remove os dois | nada |
| `instagram_actor_id` descontinuado; usar `instagram_user_id` | v22 (MC22) | 09/09/2025 | `_shared/identidade_instagram.ts:51` escolhe o campo pelo formato do id → `POST /act_/adcreatives` de #5, `criativo_whatsapp.ts:280` e criativos pelo Pipeboard | Id que não começa com 1784 vai num campo morto | **Onda 0c** |
| Bundle `standard_enhancements` sem suporte (também em `/previews`); usar as sub-features | v22 (MC22) | sem data | `_shared/criativo_whatsapp.ts:289` manda `standard_enhancements: OPT_OUT` por padrão; chega ao pré-voo de criativo (#4) e à criação | O opt-out pode ser recusado ou ignorado. Ler `degrees_of_freedom_spec` (#3, #10, #21) não é afetado | **Onda 0d** |
| Protocolo: `GET /?ids=` e `date_format` dão erro; `pretty`, `debug` e ETag ignorados | v26 (GC26) | 27/10/2026 | todas | `?ids=` já trocado (`meta-campaign-status` v18); grep sem outros usos | nada |
| `metadata=1` ignorado | v25 (GC25) | 19/05/2026 | #10, modo `sonda_whatsapp_pagina` (`:3895`) | A sonda devolve vazio | Retirar na onda 4 |
| Edges de contas do Instagram passam do objeto legado para IG User; refs de Página dão 404 | v22 | 20/05/2025 | #5, #10 (`ler_contas_instagram`), #11, #17 | Já vale; subir de versão não muda | Onda 1: rodar o meta-identity-probe e retirar a edge que der erro |
| `delivery_estimate` perde `daily_outcomes_curve`, `budget_guardrail` e `estimate_dau` | v26 | 27/10/2026 | nenhuma (grep zero) | — | nada |
| `poll_spec` rejeitado; `applink_treatment=web_only` barrado | v26 | 27/10/2026 | nenhuma | — | nada |
| Consolidação de interesses (afeta `/search`, `flexible_spec`, `reachestimate`) | v24 | 06/01/2026 | #2; público na criação e em `alterar_publico` | Já vale | nada novo |
| `is_adset_budget_sharing_enabled` obrigatório em ABO | v24 | sem data | `criar_campanha` (`meta-actions/index.ts:1795` manda `"false"`), #18 | Já enviado | nada |
| Público de lista de clientes inelegível em HEC; novas exclusões de detailed targeting dão erro | v22 | 03/2025 e 21/04/2025 | público da Legal | Já vale | nada |
| ASC/AAC sem criação nem edição | v24/v25 | 19/05/2026 | nenhuma (`smart_promotion_type` não é usado) | — | nada |
| Insights sem `7d_view`/`28d_view`; retenção de 13 meses | OCC | 12/01/2026 | nenhuma chamada direta (insights vêm do Pipeboard) | — | nada |
| `messaging_limit_tier` passa a devolver o limite do portfólio; substituto `whatsapp_business_manager_messaging_limit` | v24 (WA, 08/10/2025) | — | #19, #23, #25 | `waba-sync` já prefere o novo (`limStr`); crosscheck e phone-connect só leem o antigo | Onda 3 |
| `account_review_status` e `owner_business_info` fora da tabela de campos do WABA v26 | v26 (doc) | — | #23, #24 | Podem voltar sem o campo | Onda 3: conferir a resposta |
| `register` sem `data_localization_region` (armazenamento local vai em `POST /{phone}/settings`) | v21 (WA, 02/10/2024) | — | #23 (`waba-phone-connect/index.ts:269`) | Já afetado se alguém mandar a região | Onda 3: tirar o parâmetro |
| `analytics` com janela de 1 ano; `template_analytics` só `DAILY`, até 10 ids, 90 dias | WA | 01/12/2025 | #25 | `waba-sync` já manda até 10 ids por chamada | nada |
| Pipeboard escreve na versão dele (v24.0 no código aberto; Marketing v24 expirou em 06/10/2026) | — | — | toda escrita pelo Pipeboard | Fora do nosso controle | O pré-voo em v26 passa a ser a guarda (onda 4) |

## 4. Versão alvo: v26.0

- **A v25 da Marketing API já tem data no changelog: 23/02/2027.** Migrar para ela daria quatro meses de folga.
- **A v26 é a versão que a Meta chama de atual**, e é a versão em que as regras de 27/10 nascem. Subir para ela deixa o pré-voo enxergando o que a Meta vai cobrar de qualquer jeito.
- **Pelo histórico, a v26 da Marketing dura até meados de 2027.** Cada versão viveu de 11 a 13 meses. Portanto a troca vira rotina anual: a cada versão nova da Marketing API, rever o changelog, trocar a constante e publicar as importadoras.

## 5. Centralizar a versão

Faz sentido, por três motivos:

1. **Pré-voo e executor precisam falar a mesma versão.** Hoje `prevoo_meta.ts` valida em "v21.0" (promovida para não se sabe qual) e o Pipeboard escreve na versão dele. Com uma constante em v26, o pré-voo valida pelas regras mais novas, que valem também para o Pipeboard quando ele subir.
2. **Hoje são 23 lugares e três versões**, mais a lista de tentativas `[v22, v25, v21]` do `meta-campaign-status`.
3. **Uma prova barra regressão.** `_shared/_prova_graph_versao.ts` falha se aparecer `graph.facebook.com/v` ou `graph-video.facebook.com/v` fora do módulo.

Forma proposta, `_shared/meta_graph.ts`:

```ts
// Versao unica da Graph/Marketing API. Trocar aqui = migrar TODAS as edges que importam.
// Antes de mudar: docs/superpowers/plans/2026-10-17-migracao-versao-graph.md.
export const GRAPH_VERSAO = "v26.0";
export const GRAPH = `https://graph.facebook.com/${GRAPH_VERSAO}`;
export const GRAPH_VIDEO = `https://graph-video.facebook.com/${GRAPH_VERSAO}`;

/** Versao que de fato respondeu e o aviso de auto-upgrade, para log. */
export function versaoQueRespondeu(r: Response): { versao: string | null; aviso: string | null } {
  return { versao: r.headers.get("facebook-api-version"), aviso: r.headers.get("x-ad-api-version-warning") };
}
```

O risco da centralização: uma edge que importa a constante muda de versão no próximo deploy, mesmo que o deploy seja por outro motivo. O traffic-chat está na v277. Para não migrar ninguém sem querer:

- **Cada edge passa a importar a constante na onda em que é migrada e publicada.** Até lá, mantém o literal antigo.
- **Os módulos `_shared` das linhas 1 a 6 entram todos na onda 4**, junto com as edges que os importam e com deploy no mesmo dia. Commitar a troca neles antes disso faz o próximo deploy do traffic-chat levar a versão nova sem querer.
- **Troca futura da constante é um commit próprio**, seguido do deploy de todas as importadoras (`grep -rl meta_graph.ts supabase/functions`).

## 6. Plano de troca

Validação comum a toda onda:
- bateria Deno (`--no-code-cache --allow-read --allow-env`);
- conferir com `list_edge_functions` que a versão da edge subiu;
- olhar `facebook-api-version` nas primeiras respostas.

Deploy só com pedido explícito.

### Onda 0, antes de 27/10/2026. Sem trocar versão

Correções que valem em qualquer versão. Publicação: meta-actions, traffic-chat e traffic-agent-job.

- **0a. `advantage_audience` explícito em toda criação de conjunto.**
  - O que muda: em `criar_conjunto_a_partir_de`, `escalar_duplicar` e no clone de `definir_whatsapp_conjunto`, depois de montar o `targeting`, garantir `targeting_automation.advantage_audience` 0 ou 1, com a mesma guarda de `conjunto_spec.ts:174-192`.
  - **Medido em 17/10 no espelho `ad_sets`:**
    - Legal é Viver: nenhum dos 28 conjuntos ativos tem `targeting_automation`, e 6 deles têm interesse ou público. Entre os 50 pausados, 47 têm a flag.
    - COHAPM: os 38 conjuntos ativos ou pausados têm a flag.
  - Regra proposta: se o molde não tiver a flag e tiver `flexible_spec` ou `custom_audiences` (segmentação restrita), perguntar ao gestor 0 ou 1 antes do card. Não adivinhar: 1 transforma os interesses em sugestão. Se o molde for amplo, a regra da Meta não se aplica e nada muda.
  - Risco: baixo. Só acrescenta um campo que a Meta já aceita.
  - Prova: molde restrito sem flag recusa com pergunta; molde amplo sem flag passa.
- **0b. Messenger sem posição válida.**
  - Hoje `messenger_home` está fora desde 11/11/2025 e `story` sai em 27/10.
  - **Medido:** 3 conjuntos ativos da COHAPM têm `messenger` em `publisher_platforms` sem `messenger_positions` (posição automática, a Meta resolve). Um conjunto pausado da Legal tem só `messenger_positions: ["story"]`. É o caso que, segundo o BLOG26, vira erro de validação, e ele quebra a criação se for usado como molde.
  - O que muda:
    - (1) Tirar `messenger` de `PLATAFORMAS_PUBLICACAO_SUPORTADAS` (`posicionamento.ts:17`) e do conjunto `permitidas` (`traffic-chat/index.ts:3989`), com recusa nomeada como a do Threads.
    - (2) Estender a limpeza do Explore (`posicionamento.ts:202`) a `messenger_home` e `story` em `messenger_positions`. Se Messenger ficar sem posição, sai de `publisher_platforms`. A limpeza vale para todo targeting reenviado: molde e alterações de público, idade e geo.
  - A referência de posicionamentos da Meta está desatualizada (ainda lista `messenger_home` e `story`). Confirmar com `validate_only` se resta alguma posição de Messenger além da automática.
  - Risco: baixo.
- **0c. `instagram_user_id` para todo id.**
  - `campoIdentidadeInstagramPorFormato` passa a devolver sempre `instagram_user_id`.
  - Confirmar com `validate_only` que um id de conta vinculada à Página (que não começa com 1784) é aceito no campo novo. Se não for, recusar a identidade, em vez de mandar o campo morto.
  - Risco: médio. Mexe na identidade de todo criativo.
- **0d. Opt-out das melhorias sem o bundle.**
  - Em `criativo_whatsapp.ts:289`, trocar `standard_enhancements` pelas sub-features: `image_touchups`, `text_optimizations`, `image_template`, `inline_comment`, `video_auto_crop`, todas com `OPT_OUT`.
  - Validar com o pré-voo de criativo.
  - Risco: médio. Se a Meta ignorava o bundle em silêncio, os criativos recentes podem ter saído com melhorias ligadas; conferir um no Gerenciador.
- **0e (opcional). Registrar qual versão está respondendo.** Logar `versaoQueRespondeu` no `bm-monitor`, que roda todo dia às 09:20 e só lê. Isso mostra se as chamadas "v21" de Marketing sobem para a v25 ou para a v26, e define a urgência real das ondas 1 a 4.

### Onda 1: leitura isolada. Risco baixo

Cria `_shared/meta_graph.ts` e a prova do grep, que nesta onda só conta os literais restantes.

| Edge | O que escreve | Risco | Atenção | Verificação |
|---|---|---|---|---|
| bm-monitor | nada | baixo | campos da conta e `issues_info` sem mudança | alertas `[BM]` do dia seguinte iguais |
| meta-token-monitor | nada | baixo | `debug_token` declarado não afetado | `meta_tokens.is_valid` igual |
| meta-token-crosscheck | nada | baixo | trocar `messaging_limit_tier` por `whatsapp_business_manager_messaging_limit` | comparar o JSON antes e depois |
| meta-identity-probe | nada | baixo | edges de Página (`instagram_accounts`, `page_backed_instagram_accounts`) podem dar erro | anotar quais respondem; elas alimentam a decisão sobre as sondas do meta-actions |
| meta-health | `DELETE` de criativo de prova | baixo | — | rodar só o diagnóstico |
| listar-ativos-orfaos | nada | baixo | — | mesma contagem de órfãos |
| ad-preview | nada | baixo | os três `ad_format` usados seguem na referência | abrir uma prévia de cada formato |
| meta-campaign-status | nada | baixo | trocar a lista `[v22, v25, v21]` por uma versão só | espelho de campanhas e `opportunity_score` iguais |

### Onda 2: mídia e eventos. Risco baixo a médio

| Edge | O que escreve | Risco | Atenção | Verificação |
|---|---|---|---|---|
| upload-midia | imagem e vídeo na conta | médio (é o começo de todo anúncio novo) | os dois hosts, `GRAPH` e `GRAPH_VIDEO`; nada de quebra no changelog | subir um vídeo real, esperar `status=ready` e as miniaturas |
| meta-capi | evento | baixo | CAPI tem calendário de 2 anos | evento de teste com `test_event_code` no Gerenciador de Eventos |

### Onda 3: WhatsApp. Risco médio. Limite duro em 21/01/2027

| Edge | O que escreve | Risco | Atenção | Verificação |
|---|---|---|---|---|
| waba-probe | nada | baixo | `account_review_status`, `owner_business_info` e `is_official_business_account` podem sumir | comparar o JSON |
| waba-sync | nada | baixo | já lê o limite novo | `waba_phone_snapshots` e `waba_template_analytics_daily` do dia seguinte |
| waba-template-create / -replicate | template na WABA | médio | regras de `parameter_format`, recategorização automática | criar um template de teste e conferir o status |
| waba-phone-connect | registro de número | médio (raro, mas irreversível em parte) | tirar `data_localization_region` do `register` | só na próxima conexão real de número, acompanhada |

### Onda 4: núcleo, tudo no mesmo dia. Risco alto

O que entra:
- `_shared/geo_targeting.ts`, `interesse_targeting.ts`, `ler_objeto.ts`, `prevoo_meta.ts`, `instagram_anuncios.ts` e `miniatura_criativo.ts` passam a importar `meta_graph.ts`;
- no `meta-actions`, o `GRAPH` (`:576`) e o literal de `:4112`;
- sai a sonda com `metadata=1`.

Deploys em sequência: meta-actions, traffic-chat, traffic-agent-job, geo-preset-resolve, pipeboard-structure-sync. O risco é alto porque executor, pré-voo, releitura e busca de segmentação mudam juntos. A onda 0 é pré-requisito.

Verificação:
- bateria de provas inteira;
- um card de cada tipo frequente em dry-run (pausar, orçamento, público, criar conjunto e criar anúncio);
- pré-voo de criar conjunto da Legal com interesses: deve passar com a flag e, sem ela, recusar com `ADS_TARGETING__REQUIRE_EXPLICIT_ADVANTAGE_AUDIENCE_FLAG`;
- releitura pós-escrita "conferido";
- header `facebook-api-version: v26.0`.

### Onda 5: limpeza

- **meta-test-campaign:** está arquivada e não chama a Meta. Trocar o literal só para zerar o grep, ou desativar a edge (decisão do usuário).
- **Prova do grep:** passa a exigir zero literais fora de `meta_graph.ts`.
- **Lembrete de rotina:** a cada versão nova da Marketing API, rever o changelog deste plano e trocar a constante.

## 7. Pontos em aberto

1. Qual versão responde hoje às chamadas "v21" de Marketing. A onda 0e resolve.
2. A data em que a regra HEC-F vale para todas as versões diverge: 27/10/2026 pelo MC26, TBD pelo GC26. O plano assume 27/10.
3. Expiração da Marketing v24 e v25: a página de versões e o changelog da Marketing divergem.
4. Versão do Pipeboard hospedado: perguntar ao suporte ou observar o header numa resposta que ele repasse.
5. Se as edges de Página `instagram_accounts` e `page_backed_instagram_accounts` ainda respondem. A onda 1 (meta-identity-probe) resolve.
