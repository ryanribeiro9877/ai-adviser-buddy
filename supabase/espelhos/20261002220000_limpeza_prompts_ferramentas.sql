-- Limpeza dos prompts de ferramenta (02/10/2026).
--
-- O que entra no turno (agents.papel e agent_ferramentas.descricao/doutrina/parametros)
-- fica com o que nao envelhece: o que a ferramenta faz, o que exige, como ler o retorno
-- e o erro de leitura que o modelo comete sempre. Nome de linha, pasta, telefone, incidente
-- datado, contagem e cifra de exemplo saem daqui.
--
-- Gavetas:
--   agent_context  — fato da empresa, com vigente e desde (desliga sem deploy)
--   agent_knowledge — incidente e metodo, lidos so por get_conhecimento
--
-- Texto novo de descricao/doutrina entra nas tags desc, dou ou new.
-- A tag old e o trecho que sai e nao e prompt vigente. A prova de CI varre so as tres primeiras.

-- ---------------------------------------------------------------------------
-- Grupo 1. Nomes de empresa e de linha. A regra fica; o nome proprio sai.
-- ---------------------------------------------------------------------------

-- ferramenta: ler_brand_identity
update public.agent_ferramentas
   set descricao = $desc$Identidade de marca vigente da empresa do turno. Uma empresa pode ter mais de uma voz, uma por linha de produto; o parametro meio escolhe. Sem meio, a RPC devolve a voz padrao da empresa.$desc$,
       doutrina = $dou$Nunca use a copy de uma linha em outra. Campanha e produto definem o meio. gerar_legendas consome a identidade quando produto e meio vem certos.$dou$,
       atualizado_em = now()
 where chave = 'ler_brand_identity';

-- ferramenta: gerar_legendas
update public.agent_ferramentas
   set doutrina = $dou$Entregue as 3 com veredito: apto_para_card=true inclui aprovado e atencao. CET e as regras financeiras valem SO em empresa de credito, e a leitura de brand_identity diz se e o caso; nao assuma produto consignado por padrao. Produto e meio vem do pedido ou da campanha — e proibido escrever na voz de outra linha. Campanha ou conjunto de uma linha com peca de outra reprova — erro grave, nao aviso. VOCE preenche as referencias. Se a tool falhar, NAO diga que a ferramenta esta indisponivel e NAO ofereca ao gestor esperar ou escrever ele mesmo: escreva as 3 no tom certo e registre com registrar_legenda_da_conversa.$dou$,
       atualizado_em = now()
 where chave = 'gerar_legendas';

-- ferramenta: checar_par_texto_e_peca
update public.agent_ferramentas
   set doutrina = $dou$Veredito por deteccao de padroes, NAO aprovacao. Audio sem transcricao permanece explicitamente nao lido; repasse cobertura e lacunas. Se so um dos dois veio, peca o dado faltante sem negar a capacidade. Campanha ou conjunto de uma linha com peca de outra reprova — erro grave, nao aviso. A linha da peca e a do destino vem do nome e de brand_identity.$dou$,
       atualizado_em = now()
 where chave = 'checar_par_texto_e_peca';

-- ferramenta: check_compliance
update public.agent_ferramentas
   set doutrina = $dou$NAO use get_criativos_conteudo vazio como desculpa de '0 textos para validar' nem diga que precisa sincronizar a Meta para auditar copy que voce acabou de propor. Campanha ou conjunto de uma linha com peca de outra reprova — erro grave, nao aviso. A linha da peca e a do destino vem do nome e de brand_identity. Se o NOME da peca ja e da linha certa e so a LEGENDA vazou a voz de outra, o erro e voz_linha_errada: reescreva a copy na voz do destino e reemita na MESMA campanha, sem trocar de linha.$dou$,
       atualizado_em = now()
 where chave = 'check_compliance';

-- ferramenta: get_waba_status
update public.agent_ferramentas
   set descricao = $desc$INVENTARIO WHATSAPP da empresa. Obrigatoria para qualquer pergunta sobre numero operacional, WABA, Cloud, qualidade ou tier, e para verificar isolamento entre linhas de produto. O filtro meio aceita os valores cadastrados da empresa. NAO decide se um conjunto CTWA pode ser emitido: isso e get_whatsapp_da_pagina.$desc$,
       doutrina = $dou$Devolve DUAS listas que nunca se misturam: waba_cloud_on_premise (CLOUD_API + ON_PREMISE; de_pe so quando CONNECTED, com qualidade e tier) e click_to_whatsapp_inventario (destino wa.me; de_pe so quando IN_ACTIVE_ADS). NUNCA trate CTWA IN_ADS como numero de pe nem peca ao gestor para escolher so entre os CTWA se a lista WABA veio no retorno. get_estrutura_conjuntos e get_criativos_conteudo mostram apenas o destino wa.me do anuncio e NAO substituem esta leitura. Numero de uma linha nao substitui o de outra. Cruzamento de linha reprova: erro grave, nao aviso.$dou$,
       atualizado_em = now()
 where chave = 'get_waba_status';

-- ferramenta: get_instagram_dos_anuncios
update public.agent_ferramentas
   set descricao = $desc$LEITURA AO VIVO na Graph: o Instagram de CADA anuncio da campanha (conjuntos ACTIVE e PAUSED), com handle quando a Meta expoe, id e classificacao. Chame antes de afirmar vinculo ou de emitir alteracao. A classificacao segue o de-para da empresa: perfil proprio, perfil relacionado, terceiro, sem vinculo.$desc$,
       doutrina = $dou$NAO presuma pelo perfil unico da conta e nao use so get_criativos_conteudo. Cobre a campanha em trabalho no fio. Para alterar, chame vincular_instagram_dos_anuncios na mesma campanha.$dou$,
       atualizado_em = now()
 where chave = 'get_instagram_dos_anuncios';

-- ferramenta: get_drive_criativos
update public.agent_ferramentas
   set descricao = $desc$INVENTARIO DA PASTA DE CRIATIVOS NOVOS no Google Drive (somente leitura): caminho, nome, tipo e data, sem thumbnail. Recorte com meio e formatos, usando os valores cadastrados da empresa. Use para LISTAR o que existe na pasta; nao substitui por get_criativos_conteudo, que traz anuncios ja no ar. Se o gestor citou a pasta do mes, passe pasta com esse mes: o servidor recorta o caminho e nao devolve o acervo inteiro.$desc$,
       doutrina = $dou$Nao le o conteudo interno do video: a leitura e por nome e caminho. Pode vir truncado — leia aviso_corte e nunca trate item omitido como inexistente. RECORTE DE FORMATO SO QUANDO O GESTOR RESTRINGIR: retorno com 0 arquivos quase sempre e recorte errado, nao pasta vazia. Pasta com estrutura diferente devolve lista vazia sob filtro de formato: se voltar zero, releia na mesma rodada sem formatos e sem produto. As pastas monitoradas estao no banco — e proibido perguntar o caminho ao gestor.$dou$,
       atualizado_em = now()
 where chave = 'get_drive_criativos';

-- ferramenta: alterar_idade_do_conjunto
update public.agent_ferramentas
   set doutrina = $dou$Aprovar troca age_min e age_max DESTE conjunto. Geo, interesses, plataformas e WhatsApp permanecem. Edicao significativa pode resetar aprendizado — o card avisa; nao invente a recusa antes de emitir. Se a Graph recusar, o card falha e AI o caminho e criar_conjunto + pausar o antigo. Uma dimensao por teste. Em categoria especial de credito, estreitamento e recusado pelo portao. Fora de categoria especial, estreitar e permitido.$dou$,
       atualizado_em = now()
 where chave = 'alterar_idade_do_conjunto';

-- ferramenta: propose_action
update public.agent_ferramentas
   set doutrina = replace(
         doutrina,
         $old$COHAPM, ERRO GRAVE e nao aviso: peca La Felicita (_LAF_, CONJ.1_LAF, FELICITA) NUNCA em campanha ou conjunto JURIDICO, e peca Juridico NUNCA em LAFELICITA — o sistema RECUSA o card. params.conjunto_destino e o NOME com CONJ.N (CONJ.1_LAF_..., CONJ.1, CONJ.01):$old$,
         $new$Peca de uma linha nunca entra em campanha ou conjunto de outra — erro grave, nao aviso. A linha se reconhece pelo nome da peca e pela identidade de marca, nao por memoria. O sistema RECUSA o card. params.conjunto_destino e o NOME com CONJ.N (CONJ.1, CONJ.01):$new$
       ),
       atualizado_em = now()
 where chave = 'propose_action';

update public.agent_ferramentas
   set doutrina = replace(
         doutrina,
         $old$CONJ.04 no nome nao e R$ 4.$old$,
         $new$Numero que faz parte do nome do conjunto nunca e orcamento.$new$
       ),
       atualizado_em = now()
 where chave = 'propose_action';

update public.agent_ferramentas
   set doutrina = replace(doutrina, $old$ (12/09/2026)$old$, $new$$new$),
       atualizado_em = now()
 where chave = 'propose_action';

update public.agent_ferramentas
   set doutrina = replace(
         doutrina,
         $old$em reais (30, nao 75 da idade, nao 3000 centavos)$old$,
         $new$em reais por dia, nao a idade e nao centavos$new$
       ),
       atualizado_em = now()
 where chave = 'propose_action';

-- ferramenta: vincular_instagram_dos_anuncios
update public.agent_ferramentas
   set descricao = $desc$Emite CARD DE APROVACAO para vincular o perfil proprio da empresa em TODOS os anuncios da campanha em trabalho que ainda nao o usam, conjuntos ativos e pausados. Le a Graph na hora da proposta. A classificacao do vinculo e perfil proprio da empresa, perfil relacionado, terceiro ou sem vinculo.$desc$,
       atualizado_em = now()
 where chave = 'vincular_instagram_dos_anuncios';

-- ferramenta: get_estrutura_conjuntos
update public.agent_ferramentas
   set doutrina = replace(
         doutrina,
         $old$(CONJ.1_LAF_... = CONJ.1; barra ou nao e CONJ.1 vs CONJ.01 sao o mesmo numero)$old$,
         $new$(CONJ.1 e CONJ.01 sao o mesmo numero, com ou sem barra)$new$
       ),
       atualizado_em = now()
 where chave = 'get_estrutura_conjuntos';

-- ---------------------------------------------------------------------------
-- Grupo 2. Incidente, contagem e identificador. A licao fica; o caso sai.
-- ---------------------------------------------------------------------------

-- ferramenta: get_whatsapp_da_pagina
update public.agent_ferramentas
   set doutrina = $dou$EMITA criar_conjunto_a_partir_de com destination_type=WHATSAPP nos DOIS casos. e_ativo_whatsapp_da_conta e casou_na_api falsos sao inventario, nao impedimento: o create sai pelo driver que cria numero ligado so a Pagina. E proibido dizer que falta vincular o numero a uma WABA, que o numero nao existe, que nao esta no seletor da Pagina, ou que so o Gerenciador cria. E proibido trocar por numero de outra linha de produto. O numero no promoted_object vai em digitos, com DDI; a mascara com traco e so texto do card.$dou$,
       atualizado_em = now()
 where chave = 'get_whatsapp_da_pagina';

-- ferramenta: get_acervo_para_anuncio
update public.agent_ferramentas
   set doutrina = replace(
         doutrina,
         $old$citando taxonomia_drive e inventario_global — a leitura de referencia da COHAPM trouxe 19 videos (10 de Educacao financeira + 9 de Caminho Triste/feliz), mais Capas, 9 Carrosseis e 4 Cards instrucionais; (2) so depois filtre por produto; (3) Capas (Videos/Educacao financeira/Capa) entram sempre no inventario; (4) Cards sao mecanismo instrucional 'leia a legenda', nao imagem generica;$old$,
         $new$citando taxonomia_drive e inventario_global; (2) so depois filtre por produto; (3) Capas entram sempre no inventario; (4) Cards sao mecanismo instrucional, nao imagem generica;$new$
       ),
       atualizado_em = now()
 where chave = 'get_acervo_para_anuncio';

update public.agent_ferramentas
   set doutrina = replace(
         doutrina,
         $old$Em 07/08/2026 o anuncio R06 que ja estava no ar foi proposto no lugar de uma peca nova porque a escolha saiu de get_criativos_conteudo: para montar anuncio novo a fonte e esta leitura, nao a dos anuncios publicados.$old$,
         $new$Para montar anuncio novo a fonte e esta leitura, nao a dos anuncios publicados.$new$
       ),
       atualizado_em = now()
 where chave = 'get_acervo_para_anuncio';

-- ferramenta: get_detalhe_anuncios
update public.agent_ferramentas
   set doutrina = replace(
         doutrina,
         $old$Somar as duas coisas foi o erro de 02/09/2026 na VISTTA: 29 exclusos mais 11 pausados pela campanha viraram '40 anuncios'.$old$,
         $new$Somar excluidos com pausados pela campanha infla o total — sao coisas diferentes e nunca se somam.$new$
       ),
       atualizado_em = now()
 where chave = 'get_detalhe_anuncios';

-- ferramenta: origem_drive_dos_anuncios
update public.agent_ferramentas
   set doutrina = replace(
         doutrina,
         $old$ e NUNCA declare 'sem vinculo' quando a tool trouxe o id — em 02/09/2026, 5 de 6 anuncios do VISTTA sairam como 'sem vinculo' com os cards tendo pasta e drive_file_id.$old$,
         $new$ e NUNCA declare sem vinculo quando a ferramenta trouxe o drive_file_id.$new$
       ),
       atualizado_em = now()
 where chave = 'origem_drive_dos_anuncios';

-- ferramenta: get_criativos_conteudo
update public.agent_ferramentas
   set doutrina = replace(
         replace(
           doutrina,
           $old$wa.me/5571993451315$old$,
           $new$wa.me/<numero>$new$
         ),
         $old$ — sao 67 anuncios e ja houve anuncio existente dado por inexistente por estar no pedaco omitido$old$,
         $new$$new$
       ),
       atualizado_em = now()
 where chave = 'get_criativos_conteudo';

-- Datas que sobraram no mesmo tipo de frase: a licao fica, o dia sai.
-- ferramenta: get_legendas_da_conversa
update public.agent_ferramentas
   set doutrina = replace(
         doutrina,
         $old$Em 20/08/2026 o agente gerou 5 legendas de impulsao e depois pediu ao gestor para colar 3 de novo porque o corte de historico levou o final do slate — isso e proibido.$old$,
         $new$Pedir ao gestor para colar de novo uma legenda que ja esta no store, porque o corte de historico levou o final, e proibido.$new$
       ),
       atualizado_em = now()
 where chave = 'get_legendas_da_conversa';

-- ferramenta: get_meta_dicas
update public.agent_ferramentas
   set doutrina = replace(
         doutrina,
         $old$20/08/2026: nao abra listar_ferramentas_pipeboard nem ler_pipeboard para essa pergunta, era o padrao que estourava 150s em pergunta simples.$old$,
         $new$Nao abra listar_ferramentas_pipeboard nem ler_pipeboard para essa pergunta: esse desvio estoura o tempo em pergunta simples.$new$
       ),
       atualizado_em = now()
 where chave = 'get_meta_dicas';

-- ferramenta: ler_pipeboard
update public.agent_ferramentas
   set doutrina = replace(
         doutrina,
         $old$(reconectar Pipeboard se o token for anterior a 04/05/2026)$old$,
         $new$(reconectar o Pipeboard se o token nao tiver esse escopo)$new$
       ),
       atualizado_em = now()
 where chave = 'ler_pipeboard';

-- ferramenta: registrar_veredito_peca_em_revisao
update public.agent_ferramentas
   set doutrina = replace(
         doutrina,
         $old$Nunca faca UPDATE a mao: em 10/08/2026 um subagente escreveu veredito direto assinando com o nome do fundador e liberou 5 pecas do FIN-04 sem decisao dele, e foi por isso que essa porta foi fechada.$old$,
         $new$Nunca faca UPDATE a mao: escrever veredito direto, sem o card, libera peca sem a decisao de quem aprova. A porta existe por isso.$new$
       ),
       atualizado_em = now()
 where chave = 'registrar_veredito_peca_em_revisao';

-- ferramenta: get_funil_credito
update public.agent_ferramentas
   set descricao = replace(descricao, $old$FORA DE ESCOPO desde 28/07/2026:$old$, $new$FORA DE ESCOPO:$new$),
       atualizado_em = now()
 where chave = 'get_funil_credito';

-- ---------------------------------------------------------------------------
-- Grupo 3. Cifra de exemplo. A unidade fica; o caso numerico sai.
-- ---------------------------------------------------------------------------

-- ferramenta: alterar_orcamento
update public.agent_ferramentas
   set descricao = $desc$Emite CARD DE APROVACAO para alterar o ORCAMENTO DIARIO de UM conjunto JA PUBLICADO. Passe conjunto (nome atual) e orcamento_diario_reais. O parametro orcamento_diario_reais e em reais por dia, nao em centavos — a conversao para centavos e da Graph, nao sua. Numero que faz parte do nome do conjunto nunca e orcamento. Pedido de alterar o orcamento deste conjunto, com o valor e a ordem nesta mensagem: emita o card. Orcamento de criacao anterior nesta conversa NAO trava. NAO peca confirmacao de que o valor novo substitui o antigo.$desc$,
       atualizado_em = now()
 where chave = 'alterar_orcamento';

-- ferramenta: alterar_publico_do_conjunto
update public.agent_ferramentas
   set descricao = replace(
         descricao,
         $old$NAO afirma que o recorte prova renda R$ 8 mil.$old$,
         $new$Segmentacao por interesse e afinidade declarada, nao renda verificada: nao afirme que o recorte prova faixa de renda.$new$
       ),
       doutrina = replace(
         doutrina,
         $old$CRM fora de escopo: aptidao comercial (renda R$ 8 mil) nao e metrica desta conta; proxy = conversas sem estouro de custo vs o irmao amplo, 7 dias fechados.$old$,
         $new$Segmentacao por interesse e afinidade declarada, nao renda verificada: nao afirme que o recorte prova faixa de renda. O proxy honesto e conversas sem estouro de custo contra o conjunto amplo irmao, em 7 dias fechados.$new$
       ),
       atualizado_em = now()
 where chave = 'alterar_publico_do_conjunto';

-- ferramenta: buscar_interesses
update public.agent_ferramentas
   set doutrina = $dou$Interesse e afinidade, nao historico de busca nem renda familiar. Empilhar termos nao aproxima faixa salarial — amplia o publico e dilui o recorte. Um nucleo tematico por teste; o que estiver fora do nucleo e segundo teste, separado. Pedido de imovel: leia get_conhecimento com tema interesses_imobiliario antes de escolher os termos. geo_nao_interesse no retorno = use alterar_geo, nao esta tool. resolvidos[] alimenta params.interesses do card.$dou$,
       atualizado_em = now()
 where chave = 'buscar_interesses';

-- ---------------------------------------------------------------------------
-- Schema que tambem entra no turno. O enum de meio era a lista de uma empresa.
-- ---------------------------------------------------------------------------

update public.agent_ferramentas
   set parametros = jsonb_set(
         parametros #- '{properties,meio,enum}',
         '{properties,meio,description}',
         to_jsonb('Valor cadastrado da empresa.'::text),
         true
       ),
       atualizado_em = now()
 where chave in (
   'check_compliance',
   'gerar_legendas',
   'get_acervo_para_anuncio',
   'get_analise_visual_drive',
   'get_drive_criativos',
   'ler_brand_identity'
 )
   and parametros #> '{properties,meio}' is not null;

update public.agent_ferramentas
   set parametros = jsonb_set(
         parametros,
         '{properties,meio,description}',
         to_jsonb('Valor cadastrado da empresa. Sem meio, a RPC devolve a voz padrao.'::text)
       ),
       atualizado_em = now()
 where chave = 'ler_brand_identity';

update public.agent_ferramentas
   set parametros = jsonb_set(
         jsonb_set(
           parametros,
           '{properties,meio,description}',
           to_jsonb('Valor cadastrado da empresa. Campanha e produto definem.'::text)
         ),
         '{properties,produto,description}',
         to_jsonb('Produto do pedido ou da campanha. Sem default. A leitura de brand_identity diz a voz.'::text)
       ),
       atualizado_em = now()
 where chave = 'gerar_legendas';

update public.agent_ferramentas
   set parametros = jsonb_set(
         parametros,
         '{properties,meio,description}',
         to_jsonb('Opcional. Valor cadastrado da empresa.'::text)
       ),
       atualizado_em = now()
 where chave = 'get_waba_status';

update public.agent_ferramentas
   set parametros = jsonb_set(
         parametros,
         '{properties,campanha,description}',
         to_jsonb('Nome da campanha destino. A linha da peca tem de casar com a do destino.'::text)
       ),
       atualizado_em = now()
 where chave = 'checar_par_texto_e_peca';

update public.agent_ferramentas
   set parametros = jsonb_set(
         parametros,
         '{properties,campanha,description}',
         to_jsonb('Nome da campanha em trabalho no fio.'::text)
       ),
       atualizado_em = now()
 where chave in ('get_instagram_dos_anuncios', 'vincular_instagram_dos_anuncios');

update public.agent_ferramentas
   set parametros = jsonb_set(
         parametros,
         '{properties,name_like,description}',
         to_jsonb('Trecho da campanha, se houver mais de um CONJ.N.'::text)
       ),
       atualizado_em = now()
 where chave = 'origem_drive_dos_anuncios';

update public.agent_ferramentas
   set parametros = jsonb_set(
         jsonb_set(
           parametros,
           '{properties,conjunto,description}',
           to_jsonb('Nome atual do conjunto.'::text)
         ),
         '{properties,orcamento_diario_reais,description}',
         to_jsonb('Novo valor em reais por dia, nao em centavos. Alias: novo_orcamento_diario_reais.'::text)
       ),
       atualizado_em = now()
 where chave = 'alterar_orcamento';

-- ---------------------------------------------------------------------------
-- Gaveta agent_context. Fato da empresa, com desde. Desliga sem deploy.
-- O incidente longo de CTWA sai da memoria de todo turno e vai para conhecimento.
-- ---------------------------------------------------------------------------

update public.agent_context
   set vigente = false,
       atualizado = now()
 where vigente
   and categoria = 'whatsapp_pagina'
   and fato like 'CTWA CRIA PELO PIPEBOARD%';

insert into public.agent_context (company_id, categoria, fato, vigente, desde)
select
  '57f755b9-c23d-4f58-a488-8173d697c010',
  'whatsapp_driver',
  $fato$DRIVER DE ESCRITA DESTA EMPRESA para criar_conjunto_a_partir_de: pipeboard (meta_execution_config.driver_por_acao). O conjunto de WhatsApp sai por esse driver, que cria numero ligado so a Pagina. casou_na_api falso nao impede o create.$fato$,
  true,
  date '2026-09-01'
where not exists (
  select 1 from public.agent_context
   where vigente and categoria = 'whatsapp_driver'
     and company_id = '57f755b9-c23d-4f58-a488-8173d697c010'
);

insert into public.agent_context (company_id, categoria, fato, vigente, desde)
select
  '57f755b9-c23d-4f58-a488-8173d697c010',
  'whatsapp_numeros',
  $fato$NUMEROS DO CANAL SISTEMA OCULAR FORA DE WABA (medidos em 01/09/2026; desligue este fato se o vinculo mudar): 7199189-4229, 7199185-8107, 7199264-9576 e 7199188-7731. Nao estao em WABA alguma. Nao use numero de outra linha no lugar deles.$fato$,
  true,
  date '2026-09-01'
where not exists (
  select 1 from public.agent_context
   where vigente and categoria = 'whatsapp_numeros'
     and company_id = '57f755b9-c23d-4f58-a488-8173d697c010'
);

insert into public.agent_context (company_id, categoria, fato, vigente, desde)
select
  '57f755b9-c23d-4f58-a488-8173d697c010',
  'drive_pasta',
  $fato$PASTA DO MEIO JURIDICO (lida em 02/09/2026; desligue este fato se a pasta for renomeada): "COHAPM Juridico - Exports Finais". Nao tem subpasta Reels nem Videos. Filtro de formato nessa pasta devolve lista vazia mesmo com arquivos existentes — releia sem formatos.$fato$,
  true,
  date '2026-09-02'
where not exists (
  select 1 from public.agent_context
   where vigente and categoria = 'drive_pasta'
     and company_id = '57f755b9-c23d-4f58-a488-8173d697c010'
     and fato like 'PASTA DO MEIO JURIDICO%'
);

insert into public.agent_context (company_id, categoria, fato, vigente, desde)
select
  '57f755b9-c23d-4f58-a488-8173d697c010',
  'instagram_de_para',
  $fato$DE-PARA DO INSTAGRAM DESTA EMPRESA: cohapm = perfil proprio (@cohapm); coop_cohapm = perfil relacionado (@coop_cohapm); outro = terceiro; sem_vinculo = sem vinculo; id_sem_handle = id sem nome. O card de vincular aponta o perfil proprio.$fato$,
  true,
  date '2026-08-26'
where not exists (
  select 1 from public.agent_context
   where vigente and categoria = 'instagram_de_para'
     and company_id = '57f755b9-c23d-4f58-a488-8173d697c010'
);

-- ---------------------------------------------------------------------------
-- Gaveta conhecimento. So entra no turno quando get_conhecimento pede o tema.
-- A descricao do indice nao carrega nome, cifra, data nem identificador.
-- ---------------------------------------------------------------------------

insert into public.agent_knowledge (tema, descricao, conteudo, fonte, verificado_em, revalidar_ate)
values (
  'incidentes_datados',
  'Relatos datados de medicao e de erro de leitura (WhatsApp, acervo, vinculo de Drive, corte de lista, legenda, veredito). Leia quando perguntarem por que uma proibicao existe ou o que aconteceu numa data. Nao use a contagem como inventario de hoje.',
  $conteudo$# Incidentes datados

Sao registros do que aconteceu. Nao sao o inventario de hoje. Se a pergunta for "quantos tem agora", chame a ferramenta. Se a pergunta for "por que e proibido dizer X", o caso abaixo e a razao.

## WhatsApp — dois drivers, 01/09/2026
Medicao controlada com o mesmo promoted_object (page_id 105656372312257, whatsapp_phone_number 557191894229), o mesmo destination_type WHATSAPP e o mesmo optimization_goal CONVERSATIONS. O driver graph devolveu HTTP 400 / 1487246 as 11:49 UTC (o retry tentou 557191894229, +557191894229 e 5571991894229, os tres recusados). O driver pipeboard criou o conjunto 120249829825270182 as 12:46 UTC. Os numeros do canal sistema ocular 7199189-4229, 7199185-8107, 7199264-9576 e 7199188-7731 nao estavam em WABA alguma, e o create saiu assim mesmo. Por isso e proibido dizer que falta vincular o numero a uma WABA, que o numero nao existe, que nao esta no seletor da Pagina, ou que so o Gerenciador cria.

## Acervo — contagem de uma leitura, nao de hoje
A leitura de referencia que entrou na doutrina trouxe 19 videos (10 de Educacao financeira e 9 de Caminho Triste/feliz), mais Capas, 9 carrosseis e 4 cards. Isso era o recorte daquela chamada. Nao cite como o tamanho do acervo.

Em 07/08/2026 um anuncio que ja estava no ar (R06) foi proposto no lugar de uma peca nova porque a escolha saiu dos anuncios publicados. A fonte de peca nova e a leitura do acervo, nao a dos anuncios no ar.

## Pasta de criativos — 02/09/2026
Naquele dia a pasta do meio juridico devolveu lista vazia sob filtro de formato e tinha 42 videos. Lista vazia com filtro nao era pasta vazia.

## Anuncios excluidos e pausados — 02/09/2026
Numa campanha, 29 excluidos mais 11 pausados pela campanha foram somados como 40 anuncios. Excluido e pausado nao se somam.

## Vinculo de Drive — 02/09/2026
Em 5 de 6 anuncios a resposta saiu como sem vinculo com o card ja trazendo pasta e drive_file_id. Sem vinculo so quando a ferramenta nao trouxe o id.

## Lista truncada
Uma leitura de anuncios ja no ar veio cortada e um anuncio existente foi dado como inexistente porque estava no pedaco omitido. Item omitido nao e item inexistente. O numero de WhatsApp de destino que serviu de exemplo na doutrina era wa.me/5571993451315 — formato, nao o numero vigente.

## Legendas — 20/08/2026
O agente gerou 5 legendas e depois pediu ao gestor para colar 3 de novo porque o corte de historico levou o final do slate. O store e a memoria.

## Dicas da Meta — 20/08/2026
Abrir o catalogo ao vivo do Pipeboard para uma pergunta de dica estourava o tempo. A leitura certa e a ferramenta de dicas.

## Veredito escrito a mao — 10/08/2026
Um subagente gravou veredito direto, sem card, e liberou pecas sem a decisao de quem aprova. A porta do card existe por isso.$conteudo$,
  'limpeza dos prompts de ferramenta, 02/10/2026 — casos que estavam na doutrina',
  date '2026-10-02',
  null
)
on conflict (tema) do update set
  descricao = excluded.descricao,
  conteudo = excluded.conteudo,
  fonte = excluded.fonte,
  verificado_em = excluded.verificado_em,
  revalidar_ate = excluded.revalidar_ate,
  vigente = true,
  updated_at = now();

insert into public.agent_knowledge (tema, descricao, conteudo, fonte, verificado_em, revalidar_ate)
values (
  'interesses_imobiliario',
  'Nucleo de interesses para pedido de imovel: afinidade de moradia, um nucleo por teste. Leia antes de montar o teste quando o pedido for imobiliario.',
  $conteudo$# Interesses para pedido imobiliario

Interesse e afinidade, nao renda e nao historico de busca. Um nucleo por teste. O que estiver fora do nucleo e outro teste.

## Nucleo de moradia
Termos em OR, dentro do mesmo grupo:

- Investimento imobiliario
- Imobiliario
- Condominio
- Condominio fechado
- Remodelacao da casa

## Fora do nucleo
Carros, academia e piscina nao entram neste teste. Empilhar termos nao aproxima faixa de renda: amplia o publico e dilui o recorte.

Lugar (bairro, cidade, orla) e geo, nao interesse.$conteudo$,
  'limpeza dos prompts de ferramenta, 02/10/2026 — nucleo que estava na doutrina de buscar_interesses',
  date '2026-10-02',
  date '2027-04-02'
)
on conflict (tema) do update set
  descricao = excluded.descricao,
  conteudo = excluded.conteudo,
  fonte = excluded.fonte,
  verificado_em = excluded.verificado_em,
  revalidar_ate = excluded.revalidar_ate,
  vigente = true,
  updated_at = now();

-- ---------------------------------------------------------------------------
-- Varredura. Falha o apply se nome, cifra, data ou identificador longo
-- voltarem para o texto que entra no turno.
-- A frase de exemplo do AG-04 e a unica excecao ja reconhecida nas personas.
-- ---------------------------------------------------------------------------

create or replace function public.varredura_prompt_sem_fato_volatil()
returns table (origem text, chave text, classe text)
language sql
stable
as $$
  with ferramenta as (
    select
      f.chave,
      coalesce(f.descricao, '') || ' ' || coalesce(f.doutrina, '') || ' ' || coalesce(f.parametros::text, '') as texto,
      coalesce(f.descricao, '') || ' ' || coalesce(f.doutrina, '') as prosa
    from public.agent_ferramentas f
    where f.vigente
  ),
  agente as (
    select
      a.codigo,
      regexp_replace(
        coalesce(a.papel, '') || ' ' ||
        coalesce(a.delegar_quando, '') || ' ' ||
        coalesce(a.nao_delegar_quando, '') || ' ' ||
        coalesce(a.exemplos::text, '') || ' ' ||
        coalesce(a.limites::text, ''),
        'essa peca da La Felicita pode entrar na campanha do juridico',
        '',
        'i'
      ) as texto
    from public.agents a
    where a.vigente
  )
  select 'agent_ferramentas', chave, 'nome'
    from ferramenta
   where texto ~* 'cohapm|felicita|vistta|_laf_'
  union all
  select 'agent_ferramentas', chave, 'cifra'
    from ferramenta
   where texto ~ 'R[$]'
  union all
  select 'agent_ferramentas', chave, 'data'
    from ferramenta
   where prosa ~ '[0-9]{2}/[0-9]{2}/[0-9]{4}'
  union all
  select 'agent_ferramentas', chave, 'identificador'
    from ferramenta
   where texto ~ '[0-9]{10,}'
      or texto ~ 'wa\.me/[0-9]'
  union all
  select 'agents', codigo, 'nome'
    from agente
   where texto ~* 'cohapm|felicita|vistta|_laf_'
  union all
  select 'agents', codigo, 'cifra'
    from agente
   where texto ~ 'R[$]'
  union all
  select 'agents', codigo, 'identificador'
    from agente
   where texto ~ '[0-9]{10,}'
      or texto ~ 'wa\.me/[0-9]'
$$;

comment on function public.varredura_prompt_sem_fato_volatil() is
  'Varre agents e agent_ferramentas atras de nome de empresa, cifra, data e identificador longo. Linha zero e o contrato: esse texto entra no turno e nao pode carregar fato que envelhece sozinho.';

revoke all on function public.varredura_prompt_sem_fato_volatil() from public;
grant execute on function public.varredura_prompt_sem_fato_volatil() to service_role;

do $$
declare
  n int;
  amostra text;
begin
  select count(*) into n from public.varredura_prompt_sem_fato_volatil();
  if n > 0 then
    select string_agg(origem || ':' || chave || ':' || classe, ', ' order by origem, chave, classe)
      into amostra
      from public.varredura_prompt_sem_fato_volatil();
    raise exception 'prompt ainda tem fato volatil (%): %', n, amostra;
  end if;
end $$;
