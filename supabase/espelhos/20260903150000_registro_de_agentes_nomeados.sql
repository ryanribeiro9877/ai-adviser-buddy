-- Registro de agentes nomeados (03/09/2026)
--
-- POR QUE: ate aqui "agente" era um conceito implicito. O que existia era um chat monolitico
-- com 54 ferramentas, uma whitelist de 9 subagentes dentro do traffic-agent-job e quatro edges
-- especializadas que ninguem chamava de agente. Nao havia catalogo: para saber quem faz o que
-- era preciso ler codigo em tres arquivos. Sem catalogo nao existe delegacao — o planner atual
-- so conhece os 9 subagentes e nao sabe que compliance-check, gerar-legendas e waba-template-*
-- fazem o mesmo tipo de trabalho.
--
-- O QUE MUDA: os agentes passam a ser DADO, nao codigo. Cada um tem setor, papel e — o campo
-- que faz o roteamento funcionar — delegar_quando / nao_delegar_quando. O prompt do Roteador
-- e GERADO a partir daqui, entao catalogo e prompt nao podem divergir: mudar o registro muda
-- a delegacao sem redeploy de prompt.
--
-- AGRUPAMENTO: os 9 subagentes foram redistribuidos por PREMISSA (a pergunta de fundo que cada
-- um responde), nao por ferramenta. criativos + criativos_drive + analise_visual_drive olham o
-- mesmo ativo em fases diferentes do ciclo, entao viram um agente so. desempenho + estrutura
-- respondem a mesma pergunta ("por que a conta entrega assim"). compliance existia duplicado
-- como subagente E como edge.

create table if not exists public.agents (
  codigo text primary key,
  nome text not null unique,
  setor text not null,
  papel text not null,
  -- Texto que vai LITERAL para o prompt do Roteador. Escrever no imperativo e com exemplos
  -- concretos: e isto que decide a delegacao.
  delegar_quando text not null,
  -- Fronteira negativa. Sem ela o roteador escolhe pelo termo mais parecido e erra: foi assim
  -- que "taxa de clique de template" caia em desempenho_campanhas em vez de whatsapp_waba.
  nao_delegar_quando text,
  exemplos text[] not null default '{}',
  -- Gestor e Roteador nao sao destino de delegacao: um recebe, o outro distribui.
  roteavel boolean not null default true,
  ordem int not null default 100,
  vigente boolean not null default true,
  updated_at timestamptz not null default now()
);

comment on table public.agents is
  'Catalogo de agentes nomeados. Fonte unica do prompt de delegacao do Roteador (AG-01).';
comment on column public.agents.delegar_quando is
  'Vai literal para o prompt do Roteador. Mudar aqui muda a delegacao sem redeploy.';
comment on column public.agents.roteavel is
  'false = nao e destino de delegacao (Gestor recebe, Roteador distribui).';

-- Unidades de execucao sob cada agente: o subagente, a edge ou o pipeline que faz o trabalho.
-- Um agente pode ter varias — e exatamente isso que permite fundir criativos + criativos_drive
-- + analise_visual_drive sob o Estudio sem reescrever a execucao.
create table if not exists public.agent_unidades (
  id bigint generated always as identity primary key,
  agent_codigo text not null references public.agents(codigo) on delete cascade,
  tipo text not null check (tipo in ('subagente', 'edge', 'pipeline', 'ferramenta')),
  chave text not null,
  observacao text,
  vigente boolean not null default true,
  unique (agent_codigo, tipo, chave)
);

comment on table public.agent_unidades is
  'Mapa agente -> unidade de execucao real (subagente do job, edge function, pipeline ou ferramenta).';

create index if not exists agent_unidades_por_agente on public.agent_unidades (agent_codigo) where vigente;

-- Mesma postura de agent_knowledge: catalogo de agente nao e dado de cliente. Sem policy,
-- so service_role (edges) le. RLS ligada para o linter nao apontar tabela exposta.
alter table public.agents enable row level security;
alter table public.agent_unidades enable row level security;

revoke all on public.agents from anon, authenticated;
revoke all on public.agent_unidades from anon, authenticated;

-- ============================================================================
-- SEED: os 9 agentes
-- ============================================================================

insert into public.agents (codigo, nome, setor, papel, delegar_quando, nao_delegar_quando, exemplos, roteavel, ordem) values

('AG-00', 'Gestor', 'Recepcao, voz e entrega',
 'Porta de entrada e voz do sistema. Recebe a mensagem do gestor, resolve empresa e permissao, carrega memoria da conversa e a persona, entrega a resposta final costurada. NAO interpreta a tarefa e NAO executa: encaminha ao Roteador e escreve o retorno.',
 'Nunca. O Gestor nao e destino de delegacao — ele e quem delega.',
 'Qualquer tarefa de dominio. O Gestor nao le numero, nao julga peca e nao emite card.',
 '{}', false, 0),

('AG-01', 'Roteador', 'Triagem e despacho',
 'Le e interpreta a mensagem, classifica a intencao e escolhe o MENOR conjunto de agentes que cobre o pedido. Devolve um plano de delegacao, nunca uma resposta ao gestor. E o unico que conhece o catalogo inteiro.',
 'Nunca. O Roteador e quem distribui.',
 'Responder ao gestor. Se o Roteador redigir resposta, o especialista foi pulado.',
 '{}', false, 1),

('AG-02', 'Analista', 'Desempenho e estrutura de midia',
 'Responde POR QUE a conta entrega o que entrega. Numeros de midia (gasto, impressoes, cliques, CTR, formularios, conversas), serie diaria por anuncio e por conjunto, custo contra teto_vigente, diagnostico de custo e fadiga, maturacao para pausa, avaliacao de escala e pacing. Cobre tambem a CONFIGURACAO que produz esse resultado: CBO vs ABO, orcamento por conjunto, estrategia de lance, targeting e optimization_goal.',
 'Delegue quando o pedido cita metrica, valor, periodo, comparacao entre campanhas ou anuncios, ranking por gasto/alcance/conversas, "esta caro", "caiu", "subiu", "vale escalar", "posso pausar", teto, meta, pacing, orcamento, CBO, ABO, lance ou segmentacao. Delegue tambem quando pedirem detalhamento ou serie diaria de campanha, conjunto ou anuncio.',
 'NAO delegue conteudo da peca (o que a legenda diz, hook, CTA) — isso e Estudio. NAO delegue taxa de clique de TEMPLATE de WhatsApp — isso e Mensageiro. NAO delegue alerta ou recomendacao pendente — isso e Sentinela. NAO delegue o ato de pausar ou escalar: o Analista julga, o Executor emite.',
 array[
   'qual o custo por formulario dos ultimos 7 dias',
   'detalhe o desempenho dos anuncios do CONJ.2 na janela de 14 dias',
   'esse conjunto esta apto a escalar',
   'quanto cada conjunto esta gastando e com que orcamento'
 ], true, 2),

('AG-03', 'Estudio', 'Ativo criativo e copy',
 'Dono do ativo criativo no ciclo inteiro: a peca no acervo do Drive (inventario por pasta, formato e linha de produto), a leitura dos pixels (produto detectado, texto visivel, veredito aproveitavel), a peca ja no ar (legenda, titulo, CTA, destino) e a redacao da copy que acompanha a peca.',
 'Delegue quando o pedido cita pasta do Drive, acervo, peca nova, video, reel, imagem, criativo, miniatura, "o que essa peca mostra", "classifique as pecas", "o que o anuncio diz", legenda, copy, texto, hook, headline, angulo ou CTA. Delegue tambem quando pedirem escrever ou reescrever legenda.',
 'NAO delegue se a pergunta e sobre o RESULTADO da peca em numeros (custo, CTR, ranking) — isso e Analista. NAO delegue o veredito de conformidade: o Estudio escreve, o Guardiao aprova. NAO delegue upload para a biblioteca da Meta nem criacao de anuncio — isso e Executor.',
 array[
   'quais videos novos tem na pasta do juridico',
   'classifique as pecas do Drive e diga quais dao para usar',
   'escreva 3 legendas para esse reel',
   'o que a legenda do anuncio LPV2_A2 esta dizendo'
 ], true, 3),

('AG-04', 'Guardiao', 'Conformidade',
 'Unica autoridade sobre o que pode ir ao ar. Valida legenda e peca contra as regras versionadas (FIN, CRI, LGL), aplica as promessas proibidas com substituicao segura e bloqueia cruzamento de marca entre linhas de produto. O veredito e DETERMINISTICO pela severidade da regra, nunca pela opiniao do modelo.',
 'Delegue quando o pedido cita compliance, conformidade, "pode anunciar isso", violacao, politica da Meta aplicada a um texto concreto, categoria especial, CET, credito, reprovacao, apelacao, ou quando pedirem auditar as legendas que estao no ar. Delegue SEMPRE em cascata depois de o Estudio escrever copy nova.',
 'NAO delegue duvida conceitual sobre politica sem texto para validar — isso e Bibliotecario. NAO delegue a correcao da copy: o Guardiao reprova e sugere, o Estudio reescreve.',
 array[
   'essa legenda pode ir ao ar',
   'audite o compliance das pecas de maior gasto',
   'essa peca da La Felicita pode entrar na campanha do juridico'
 ], true, 4),

('AG-05', 'Mensageiro', 'Canal WhatsApp',
 'Responde pelo destino da conversa. Inventario WhatsApp da empresa separando WABA Cloud e ON_PREMISE (de pe = CONNECTED) do inventario Click-to-WhatsApp (de pe so IN_ACTIVE_ADS), qualidade e tier dos numeros, checagem do numero antes de emitir conjunto CTWA, e os templates utilitarios com seus insights de envio, entrega, leitura e clique.',
 'Delegue quando o pedido cita WhatsApp, WABA, numero de pe, qual numero linkar, wa.me, CTWA, Click-to-WhatsApp, tier, qualidade do numero, template, ou taxa de clique DE TEMPLATE.',
 'NAO delegue taxa de clique de CAMPANHA ou de anuncio — isso e Analista, mesmo quando o destino do anuncio e WhatsApp. NAO delegue a emissao do conjunto CTWA: o Mensageiro confere o numero, o Executor emite.',
 array[
   'quais numeros de WhatsApp estao de pe',
   'esse numero da para usar no conjunto novo',
   'como estao os templates do WhatsApp esse mes'
 ], true, 5),

('AG-06', 'Executor', 'Atos na conta Meta',
 'Unico agente com direito de provocar escrita. Emite card de aprovacao (propose_action), valida o pedido contra o contrato de execucao declarado, sobe midia para a biblioteca da Meta e acompanha o card ate a Meta confirmar. Nao decide MERITO — decide se o ato e formalmente possivel e o coloca na fila para decisao humana.',
 'Delegue quando o pedido tem VERBO DE ATO: criar, crie, suba, subir, lance, proponha, duplique, escale, pause, ative, altere, aumente, reduza, emita, replique, renomeie, vincule. Delegue tambem quando perguntarem o estado de um card, o que esta pendente de aprovacao, ou se algo ja foi criado.',
 'NAO delegue pergunta que so parece ato: "esse conjunto deveria ser pausado?" e julgamento do Analista. NAO delegue "crie as legendas" — o verbo e de ato mas o ato e escrever copy, e isso e Estudio. O Executor nunca decide se o ato e uma boa ideia: quem julga e o especialista do setor.',
 array[
   'emita os cards de pausa desses 3 anuncios',
   'suba os videos restantes para a biblioteca',
   'crie o conjunto CONJ.3 a partir do CONJ.1',
   'o card que aprovei ontem ja executou'
 ], true, 6),

('AG-07', 'Sentinela', 'Saude da plataforma e pendencias',
 'Observa a operacao em vez do resultado de midia. Alertas ativos, fila interna de recomendacoes, dicas da Meta com julgamento proprio, saude das integracoes por evidencia de coleta, validade e escopo dos tokens, entregas de digest e custo de LLM no periodo.',
 'Delegue quando o pedido cita alerta, recomendacao pendente, dica da Meta, Opportunity Score, boost, integracao, coleta parada, sincronizacao, token, permissao, escopo, digest, relatorio por e-mail, prontidao, ou custo de IA e de LLM.',
 'NAO delegue diagnostico de custo de MIDIA — "por que o CPL subiu" e Analista. NAO delegue a acao sugerida por um alerta: a Sentinela reporta, o Executor emite.',
 array[
   'tem algum alerta aberto',
   'as integracoes estao coletando normalmente',
   'algum token vai vencer',
   'quanto gastamos de LLM esse mes'
 ], true, 7),

('AG-08', 'Bibliotecario', 'Conhecimento tecnico',
 'Serve fundamento a quem pedir e responde pela validade da base. Politicas da Meta, definicao e leitura de metricas, metodo de otimizacao (Breakdown Effect, fase de aprendizado, gates de escala), operacao da Marketing API, unidade economica e biblioteca de criativo. Declara [VENCIDO] quando o tema passou do revalidar_ate, e e o dono da rotina de revalidacao.',
 'Delegue quando a pergunta e CONCEITUAL e independe da conta: o que e, como funciona, qual a definicao, qual a boa pratica, o que a Meta permite em tese, por que a metrica se comporta assim. Delegue tambem quando perguntarem sobre a propria base de conhecimento ou sua validade.',
 'NAO delegue pergunta que precisa de dado da conta — se a resposta exige olhar campanha, peca ou numero, o dono e o especialista do setor. O Bibliotecario fundamenta; ele nao consulta a conta.',
 array[
   'o que e o Breakdown Effect',
   'a Meta permite segmentar por bairro em credito',
   'qual a diferenca entre clique no link e clique total',
   'a base de conhecimento esta atualizada'
 ], true, 8)

on conflict (codigo) do update set
  nome = excluded.nome,
  setor = excluded.setor,
  papel = excluded.papel,
  delegar_quando = excluded.delegar_quando,
  nao_delegar_quando = excluded.nao_delegar_quando,
  exemplos = excluded.exemplos,
  roteavel = excluded.roteavel,
  ordem = excluded.ordem,
  vigente = true,
  updated_at = now();

-- ============================================================================
-- SEED: unidades de execucao sob cada agente
-- ============================================================================

insert into public.agent_unidades (agent_codigo, tipo, chave, observacao) values
  ('AG-00', 'edge', 'traffic-chat', 'Recepcao, persona, memoria de conversa e entrega'),
  ('AG-00', 'edge', 'transcribe-audio', 'Ditado por voz na entrada'),

  ('AG-01', 'pipeline', 'guardas_de_rota', 'Continuacao, anexo, pedido de ato e pergunta no meio do fio'),
  ('AG-01', 'pipeline', 'planner', 'Delegacao por prompt gerado a partir da tabela agents'),

  ('AG-02', 'subagente', 'desempenho_campanhas', 'Numeros, serie diaria, diagnostico, escala e pacing'),
  ('AG-02', 'subagente', 'estrutura_conta', 'Fundido: estrutura e a causa da entrega, nao assunto paralelo'),

  ('AG-03', 'subagente', 'criativos_drive', 'Acervo novo no Drive'),
  ('AG-03', 'subagente', 'analise_visual_drive', 'Pipeline de visao, sem laco de ferramentas'),
  ('AG-03', 'subagente', 'criativos', 'Pecas ja no ar'),
  ('AG-03', 'edge', 'gerar-legendas', 'Redacao Hook-Beneficio-CTA, cascata obrigatoria para AG-04'),

  ('AG-04', 'subagente', 'compliance', 'Auditoria das legendas em operacao'),
  ('AG-04', 'edge', 'compliance-check', 'Mesma premissa que o subagente: a duplicacao vira uma porta a mais'),

  ('AG-05', 'subagente', 'whatsapp_waba', 'Inventario WABA e CTWA'),
  ('AG-05', 'edge', 'waba-template-create', 'Templates utilitarios: ganham dono'),
  ('AG-05', 'edge', 'waba-template-replicate', 'Replicacao de template entre numeros'),

  ('AG-06', 'ferramenta', 'propose_action', 'Emissao de card — onde ocorreram os 19 atos alegados sem emissao'),
  ('AG-06', 'ferramenta', 'validar_pedido_contra_contrato', 'Gate formal antes do card'),
  ('AG-06', 'ferramenta', 'upload_midia', 'Biblioteca da Meta'),
  ('AG-06', 'edge', 'meta-actions', 'Executor pos-aprovacao, disparado por trigger'),

  ('AG-07', 'subagente', 'alertas_recomendacoes', 'Absorve a metade de saude de plataforma que estava misturada'),
  ('AG-07', 'edge', 'traffic-reco-job', 'Redacao dos cards de recomendacao no cron diario'),
  ('AG-07', 'edge', 'bm-monitor', 'Sonda de status e cobranca da conta'),
  ('AG-07', 'edge', 'meta-token-monitor', 'Sonda de validade e escopo de token'),

  ('AG-08', 'subagente', 'conhecimento', 'Deixa de competir como especialista: vira capacidade com dono'),
  ('AG-08', 'ferramenta', 'get_conhecimento', 'Leitura por tema e secao, com aviso de validade')
on conflict (agent_codigo, tipo, chave) do update set
  observacao = excluded.observacao,
  vigente = true;

-- Memoria institucional: registrar a decisao para o agente nao contradizer a propria estrutura.
-- agent_context nao tem unique no texto do fato, entao a reexecucao e guardada por NOT EXISTS.
insert into public.agent_context (categoria, fato, vigente, desde, company_id)
select 'sistema',
   'ARQUITETURA DE AGENTES (03/09/2026): o sistema tem 9 agentes nomeados em public.agents. AG-00 Gestor recebe a mensagem e entrega a resposta. AG-01 Roteador le, interpreta e delega ao menor conjunto de especialistas. Sao 7 especialistas roteaveis: AG-02 Analista (desempenho e estrutura), AG-03 Estudio (ativo criativo e copy), AG-04 Guardiao (conformidade), AG-05 Mensageiro (canal WhatsApp), AG-06 Executor (atos na Meta), AG-07 Sentinela (saude e pendencias), AG-08 Bibliotecario (conhecimento). Especialista NAO atende fora do proprio setor: recusa e registra a lacuna. O prompt de delegacao do Roteador e gerado a partir da tabela, entao catalogo e prompt nunca divergem.',
   true, current_date, null
where not exists (
  select 1 from public.agent_context
  where categoria = 'sistema' and fato like 'ARQUITETURA DE AGENTES (03/09/2026):%'
);
