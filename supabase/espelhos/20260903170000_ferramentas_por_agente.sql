-- Ferramentas do chat sincrono atribuidas a agentes (03/09/2026)
--
-- POR QUE: o traffic-chat manda as 54 definicoes de ferramenta em TODO turno, escolhido o
-- assunto ou nao. Isso e parte do inchaco de contexto medido (mediana de 145 mil tokens de
-- entrada por turno, contra 6,5 mil no comeco da operacao). Com o Roteador delegando, o turno
-- so precisa das ferramentas dos agentes escolhidos.
--
-- CRITERIO: cada ferramenta vai para o agente cuja PERGUNTA ela responde, nao para quem por
-- acaso a chama hoje. Ferramenta que serve a mais de um setor entra em mais de um agente —
-- o unique e (agent_codigo, tipo, chave), entao isso e suportado de proposito.
--
-- TRANSVERSAIS: get_conhecimento fica sob AG-08 (dono da pergunta conceitual) mas tambem sob
-- os agentes que ja o usam nos orcamentos do traffic-agent-job. Estreitar sem isso tiraria o
-- fundamento tecnico de quem hoje se apoia nele.
--
-- NUCLEO: AG-00 (memoria da conversa) e AG-06 (atos) NAO sao estreitados em runtime - entram
-- em todo turno. Sem memoria o fio se perde no meio do turno; sem propose_action o gestor
-- muda de leitura para ato na mesma frase e nenhum card sai. A regra mora em _shared/agentes.ts
-- (NUCLEO_SEMPRE), nao aqui: aqui so se declara de quem a ferramenta e.

insert into public.agent_unidades (agent_codigo, tipo, chave, observacao) values

  -- AG-00 Gestor: memoria da conversa. Sempre na mesa.
  ('AG-00', 'ferramenta', 'get_slate_da_conversa', 'Pecas ja tratadas no fio'),
  ('AG-00', 'ferramenta', 'registrar_peca_da_conversa', 'Fixa a peca corrente do fio'),
  ('AG-00', 'ferramenta', 'get_legendas_da_conversa', 'Copy ja escrita neste fio'),
  ('AG-00', 'ferramenta', 'registrar_legenda_da_conversa', 'Guarda a copy para nao pedir recolagem'),

  -- AG-02 Analista: numeros de midia e a configuracao que os produz.
  ('AG-02', 'ferramenta', 'get_overview', null),
  ('AG-02', 'ferramenta', 'get_funnel', null),
  ('AG-02', 'ferramenta', 'get_ads_ranking', 'Ranking por gasto/alcance/conversas'),
  ('AG-02', 'ferramenta', 'get_campaign_detail', null),
  ('AG-02', 'ferramenta', 'get_funil_credito', null),
  ('AG-02', 'ferramenta', 'teto_vigente', 'Fonte prioritaria da regua de custo'),
  ('AG-02', 'ferramenta', 'diagnosticar_custo', null),
  ('AG-02', 'ferramenta', 'avaliar_fadiga', null),
  ('AG-02', 'ferramenta', 'pode_pausar_por_custo', 'Julga maturacao; quem emite e AG-06'),
  ('AG-02', 'ferramenta', 'decidir_sobre_conjunto', null),
  ('AG-02', 'ferramenta', 'avaliar_escala', null),
  ('AG-02', 'ferramenta', 'avaliar_pacing', null),
  ('AG-02', 'ferramenta', 'computar_perfil_vencedor', null),
  ('AG-02', 'ferramenta', 'ler_perfil_vencedor', null),
  ('AG-02', 'ferramenta', 'panorama_utm_anuncios', null),
  ('AG-02', 'ferramenta', 'get_estrutura_conjuntos', 'CBO/ABO, orcamento, lance, targeting'),
  ('AG-02', 'ferramenta', 'casar_criativo_performance', 'Peca x resultado: tambem serve ao AG-03'),
  ('AG-02', 'ferramenta', 'listar_ferramentas_pipeboard', null),
  ('AG-02', 'ferramenta', 'ler_pipeboard', 'Leitura ao vivo quando falta numero critico'),
  ('AG-02', 'ferramenta', 'buscar_geolocalizacao', 'Targeting: tambem serve ao AG-06 no payload'),
  ('AG-02', 'ferramenta', 'get_conhecimento', 'Transversal: fundamenta a leitura de metrica'),

  -- AG-03 Estudio: o ativo criativo no acervo, nos pixels e no ar, mais a copy.
  ('AG-03', 'ferramenta', 'get_criativos_conteudo', 'Legenda/titulo/CTA das pecas no ar'),
  ('AG-03', 'ferramenta', 'get_drive_criativos', null),
  ('AG-03', 'ferramenta', 'get_acervo_para_anuncio', null),
  ('AG-03', 'ferramenta', 'get_analise_visual_drive', null),
  ('AG-03', 'ferramenta', 'nota_visual_da_peca', null),
  ('AG-03', 'ferramenta', 'casar_criativo_performance', 'Julgar peca do acervo por resultado'),
  ('AG-03', 'ferramenta', 'ler_brand_identity', 'Voz por linha de produto'),
  ('AG-03', 'ferramenta', 'gerar_legendas', 'Cascata obrigatoria para AG-04'),
  ('AG-03', 'ferramenta', 'get_instagram_dos_anuncios', 'Identidade com que a peca aparece'),
  ('AG-03', 'ferramenta', 'get_ads_ranking', 'Ranking de peca por alcance/conversas'),
  ('AG-03', 'ferramenta', 'get_conhecimento', 'Transversal: biblioteca de formato e criativo'),

  -- AG-04 Guardiao: o que pode ir ao ar.
  ('AG-04', 'ferramenta', 'check_compliance', null),
  ('AG-04', 'ferramenta', 'checar_par_texto_e_peca', 'PAR legenda + peca'),
  ('AG-04', 'ferramenta', 'auditar_compliance_financeira', null),
  ('AG-04', 'ferramenta', 'registrar_veredito_peca_em_revisao', 'Propoe veredito; quem libera e humano'),
  ('AG-04', 'ferramenta', 'get_conhecimento', 'Transversal: politica da Meta aplicada'),

  -- AG-05 Mensageiro: o destino da conversa.
  ('AG-05', 'ferramenta', 'get_waba_status', 'Inventario WABA vs CTWA'),
  ('AG-05', 'ferramenta', 'get_whatsapp_da_pagina', 'Checagem antes do conjunto CTWA'),
  ('AG-05', 'ferramenta', 'get_conhecimento', 'Transversal: doutrina de canal'),

  -- AG-06 Executor: tudo que provoca escrita. Sempre na mesa.
  ('AG-06', 'ferramenta', 'get_aprovacoes', 'Estado real da fila de cards'),
  ('AG-06', 'ferramenta', 'renomear_campanha', null),
  ('AG-06', 'ferramenta', 'alterar_categoria_especial', null),
  ('AG-06', 'ferramenta', 'vincular_instagram_dos_anuncios', null),
  ('AG-06', 'ferramenta', 'buscar_geolocalizacao', 'Monta o targeting do payload'),

  -- AG-07 Sentinela: a operacao, nao o resultado de midia.
  ('AG-07', 'ferramenta', 'get_alerts', null),
  ('AG-07', 'ferramenta', 'get_recommendations', 'Fila interna, nao o badge da Meta'),
  ('AG-07', 'ferramenta', 'get_meta_dicas', 'Opportunity Score e dicas da Meta'),
  ('AG-07', 'ferramenta', 'saude_das_integracoes', null),
  ('AG-07', 'ferramenta', 'saude_dos_tokens', null),
  ('AG-07', 'ferramenta', 'score_de_prontidao', null),
  ('AG-07', 'ferramenta', 'ler_entregas_digest', null),
  ('AG-07', 'ferramenta', 'custo_llm_periodo', null)

on conflict (agent_codigo, tipo, chave) do update set
  observacao = coalesce(excluded.observacao, public.agent_unidades.observacao),
  vigente = true;
