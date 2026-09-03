-- Camada de conhecimento deterministico — SEED dos 14 moldes (03/09/2026)
--
-- Segunda metade da 20260903200454: as tabelas primeiro, o conteudo depois. Separado de
-- proposito — corrigir um gabarito errado nao deve exigir tocar em DDL, e a governanca desta
-- camada e feita de reescrita de gabarito, nao de mudanca de estrutura.
--
-- Os seis primeiros sao TEXTO CANONICO e estao duplicados no fallback local de
-- _shared/resposta_canonica.ts, byte a byte de proposito: recusa nao depende de dado, entao o
-- fallback consegue estar CORRETO com o banco fora do ar. A duplicacao e conferida por hash
-- sha256 na secao [7] de _shared/_prova_determinismo_camada.ts — editar um lado sem o outro
-- quebra a prova, porque dois textos diferentes para a mesma pergunta sao exatamente a
-- variancia que esta camada existe para matar.
--
-- Molde calculado NAO tem fallback local. Sem o numero, a forma fixa emitiria lacuna, e forma
-- fixa com lacuna soa completa. Banco fora do ar => cai para o LLM, que pode declarar a falta.

-- ============================================================================
-- TEXTO CANONICO — emitido LITERAL, sem parafrase
-- ============================================================================

insert into public.moldes_de_resposta (codigo, classe, titulo, gabarito, campos, fronteira, revalidar_ate, versao) values

('REC_SEGMENTAR_IDADE', 'texto_canonico',
 'Recusa de segmentacao por idade em Categoria Especial',
 'Nao vou segmentar por faixa de idade nesta conta.

As campanhas de credito rodam em **Categoria Especial de Anuncio (Credito)**. Nessa categoria a Meta remove idade, genero e CEP das opcoes de segmentacao, e o motivo nao e tecnico: e tratamento justo. Restringir a oferta de credito por idade e exatamente o que a regra existe para impedir. Nao e uma trava que se contorna — e uma condicao para a conta continuar entregando.

O que da para fazer com o mesmo objetivo:
- **Criativo**: peca e linguagem que conversam com o publico que voce quer, sem excluir ninguem na segmentacao.
- **Angulo de oferta**: o beneficio que importa para esse perfil no texto e no gancho.
- **Leitura por faixa**: o relatorio de resultado ainda pode ser aberto por idade. Voce ve onde o custo e melhor sem restringir a entrega.

Se quiser, eu abro o desempenho por faixa de idade da janela atual para escolhermos o angulo com base no que ja aconteceu.',
 '[]'::jsonb,
 'Nao usar quando a conta NAO esta em Categoria Especial. Fora dela a segmentacao por idade e permitida e a recusa seria errada.',
 '2027-03-03', 1),

('REC_ESCALAR_CRIATIVO', 'texto_canonico',
 'Escalar criativo nao e ato — escala mora no orcamento do conjunto',
 '"Escalar criativo" nao existe como acao na Meta. O que escala e o **orcamento do conjunto** onde o criativo esta rodando.

A diferenca importa na pratica: o criativo nao tem verba propria. Se o objetivo e dar mais volume ao vencedor, o caminho e aumentar o orcamento diario do conjunto que o contem — e ai o aumento vale para todos os anuncios daquele conjunto, nao so para o vencedor. Se a intencao e isolar o vencedor, o caminho e outro: conjunto novo so com ele.

Me diga qual dos dois voce quer e eu monto o card:
1. **Aumentar o orcamento do conjunto atual** — mais rapido, o vencedor divide a verba com os demais anuncios do conjunto.
2. **Conjunto novo isolado com o vencedor** — a verba fica toda nele, mas reinicia fase de aprendizado.

Nao vou emitir card antes de voce escolher, porque os dois mudam coisas diferentes na conta.',
 '[]'::jsonb,
 'Nao usar quando o pedido ja nomeia orcamento, conjunto ou campanha como alvo do aumento — nesse caso o pedido e legitimo e tem caminho proprio.',
 '2027-03-03', 1),

('REC_PECA_FORA_BIBLIOTECA', 'texto_canonico',
 'Peca fora da biblioteca da Meta e impedimento, nao aviso',
 'Nao consigo criar o anuncio: a peca ainda nao esta na biblioteca da Meta.

Isto e um **impedimento**, nao uma ressalva. O anuncio nasce apontando para um `creative_id` que so existe depois do upload. Emitir o card agora produziria um pedido que o gestor aprova e que morre na execucao, sem anuncio e sem motivo legivel.

A ordem que funciona:
1. Subir a peca do Drive para a biblioteca da Meta.
2. Confirmar que o `creative_id` voltou.
3. Emitir o card do anuncio.

Se voce me disser qual peca e, eu faco o upload e volto com o card na sequencia — sem card intermediario.',
 '[]'::jsonb,
 'Nao usar quando a peca ja tem creative_id conhecido: nesse caso o pedido esta completo.',
 '2027-03-03', 1),

('REC_CONFIG_OUTRA_EMPRESA', 'texto_canonico',
 'Isolamento entre empresas — configuracao nao se empresta',
 'Nao vou usar a configuracao de outra empresa para liberar esta acao aqui.

Cada empresa tem a sua configuracao de execucao, e essa separacao e o que impede que uma decisao tomada para um cliente passe a valer para outro sem ninguem ter decidido. O que esta liberado la foi liberado para o contexto de la — conta, produto, risco e responsavel sao outros.

Para liberar aqui, o caminho e habilitar a acao **nesta** empresa, de forma explicita e registrada. Se voce quiser, eu digo exatamente qual permissao esta faltando nesta conta para o ato que voce pediu.',
 '[]'::jsonb,
 null,
 '2027-03-03', 1),

('REC_TABELA_DE_MEMORIA', 'texto_canonico',
 'Nao remontar numero de lembranca',
 'Nao vou reproduzir aquela tabela de memoria.

Eu nao tenho como garantir que os numeros que eu reescrevesse agora sao os mesmos que sairam antes, e uma tabela de orcamento remontada de lembranca parece exata sem ser — e o tipo de erro que ninguem pega, porque a forma esta certa.

Duas saidas honestas:
- **Eu busco agora** e monto a tabela com o dado da fonte, marcando a janela e o horario da leitura. Se algo mudou desde a semana passada, voce ve o que mudou.
- **Voce me manda a tabela antiga** e eu confiro linha por linha contra a fonte atual.

Qual dos dois?',
 '[]'::jsonb,
 null,
 '2027-03-03', 1),

('SIS_SONDA_OK', 'texto_canonico',
 'Sonda de disponibilidade',
 'ok',
 '[]'::jsonb,
 'So para sonda automatizada que pede resposta literal.',
 null, 1),

-- --- MOLDE CALCULADO -------------------------------------------------------
-- Sem fallback local. Banco fora do ar => cai para o LLM, que pelo menos pode declarar a
-- lacuna. Forma fixa sem o numero seria pior: soaria completa.

('NUM_EXPOSICAO_ORCAMENTO', 'molde_calculado',
 'Exposicao de orcamento diario e pior dia possivel',
 '**Exposicao de orcamento diario — leitura de {data}**

Soma dos orcamentos diarios programados: **{soma}**
Pior dia possivel (teto de 125% sobre o programado): **{pior}**
Conjuntos ativos considerados: {qtd}

O orcamento diario da Meta e uma MEDIA, nao um teto rigido: a plataforma pode gastar ate 125% do programado em um unico dia e compensar nos seguintes. O valor de pior dia acima e esse limite, nao uma projecao de gasto.',
 '[{"nome":"data","tipo":"data","origem":"parametro do turno","obrigatorio":true},
   {"nome":"soma","tipo":"dinheiro","origem":"avaliar_orcamento_diario.soma_programada","obrigatorio":true},
   {"nome":"pior","tipo":"dinheiro","origem":"avaliar_orcamento_diario.teto_125","obrigatorio":true},
   {"nome":"qtd","tipo":"inteiro","origem":"avaliar_orcamento_diario.qtd_conjuntos","obrigatorio":true}]'::jsonb,
 'Nao usar quando a leitura de orcamento falhou ou voltou parcial: sem soma nao ha molde. O teto de 125% e fato datado — se a Meta mudar, este molde mente com autoridade.',
 '2027-03-03', 1),

('NUM_CUSTO_LLM_PERIODO', 'molde_calculado',
 'Custo de LLM no periodo',
 '**Custo de LLM — {periodo}**

Total apurado: **{total}**
Turnos medidos: {turnos}
Modelos com preco cadastrado: {modelos_com_preco}
Modelos SEM preco cadastrado: {modelos_sem_preco}

{ressalva}',
 '[{"nome":"periodo","tipo":"texto","origem":"parametro do turno","obrigatorio":true},
   {"nome":"total","tipo":"dinheiro","origem":"custo_llm_periodo.total_usd","obrigatorio":true},
   {"nome":"turnos","tipo":"inteiro","origem":"custo_llm_periodo.turnos","obrigatorio":true},
   {"nome":"modelos_com_preco","tipo":"inteiro","origem":"custo_llm_periodo.modelos_precificados","obrigatorio":true},
   {"nome":"modelos_sem_preco","tipo":"inteiro","origem":"custo_llm_periodo.modelos_sem_preco","obrigatorio":true},
   {"nome":"ressalva","tipo":"texto","origem":"custo_llm_periodo.ressalva_de_cobertura","obrigatorio":true}]'::jsonb,
 'Nao usar quando NENHUM modelo tem preco cadastrado: nesse caso o total seria zero por ausencia de preco, e zero e a resposta errada mais convincente que existe. Cai para o LLM declarar a lacuna.',
 '2027-03-03', 1),

('EST_SAUDE_INTEGRACOES', 'molde_calculado',
 'Contas conectadas versus contas trazendo dado',
 '**Integracoes — leitura de {data}**

O cadastro AFIRMA e o dado MEDE coisas diferentes, entao as duas colunas vem separadas:

Contas com status conectada no cadastro: {afirmadas}
Contas com coleta medida nos ultimos 7 dias: {medidas}
Contas conectadas SEM coleta medida: {sem_coleta}

{detalhe}

Conectada no cadastro nao e prova de dado chegando: o status e uma afirmacao de configuracao, e a coleta e um fato observavel. Quando os dois numeros divergem, o segundo e o que vale.',
 '[{"nome":"data","tipo":"data","origem":"parametro do turno","obrigatorio":true},
   {"nome":"afirmadas","tipo":"inteiro","origem":"saude_das_integracoes.status_connected","obrigatorio":true},
   {"nome":"medidas","tipo":"inteiro","origem":"saude_das_integracoes.com_coleta_7d","obrigatorio":true},
   {"nome":"sem_coleta","tipo":"inteiro","origem":"saude_das_integracoes.connected_sem_coleta","obrigatorio":true},
   {"nome":"detalhe","tipo":"lista","origem":"saude_das_integracoes.por_conta","obrigatorio":true}]'::jsonb,
 'Nao usar quando a janela de coleta nao pode ser medida: sem o lado MEDIDO o molde viraria so o lado AFIRMADO, que e exatamente o erro que ele existe para corrigir.',
 '2027-03-03', 1),

('EST_ROTULO_RASTREIO', 'molde_calculado',
 'Legibilidade de teste A/B por rotulo de rastreio',
 '**Legibilidade do teste — leitura de {data}**

Anuncios na comparacao: {total_anuncios}
Anuncios COM rotulo de rastreio: {com_rotulo}
Anuncios SEM rotulo de rastreio: {sem_rotulo}

{veredito}

Ausencia de rotulo de rastreio e ausencia de CONFIGURACAO, nao ausencia de dado. O numero de cada anuncio existe; o que falta e o que permitiria atribuir o resultado a uma variante nomeada. Sem isso eu nao aponto vencedor.',
 '[{"nome":"data","tipo":"data","origem":"parametro do turno","obrigatorio":true},
   {"nome":"total_anuncios","tipo":"inteiro","origem":"panorama_utm_anuncios.total","obrigatorio":true},
   {"nome":"com_rotulo","tipo":"inteiro","origem":"panorama_utm_anuncios.com_utm","obrigatorio":true},
   {"nome":"sem_rotulo","tipo":"inteiro","origem":"panorama_utm_anuncios.sem_utm","obrigatorio":true},
   {"nome":"veredito","tipo":"texto","origem":"panorama_utm_anuncios.veredito_legibilidade","obrigatorio":true}]'::jsonb,
 'Nao usar para apontar vencedor. Este molde responde se o teste E LEGIVEL; quem esta ganhando e leitura de desempenho, com base de resultado declarada.',
 '2027-03-03', 1),

('EST_ALERTAS_ABERTOS', 'molde_calculado',
 'Inventario de alertas e recomendacoes pendentes',
 '**Pendencias abertas — leitura de {data}**

Alertas nao resolvidos: {alertas}
Recomendacoes na fila: {recomendacoes}

{lista}',
 '[{"nome":"data","tipo":"data","origem":"parametro do turno","obrigatorio":true},
   {"nome":"alertas","tipo":"inteiro","origem":"alerts where resolved = false","obrigatorio":true},
   {"nome":"recomendacoes","tipo":"inteiro","origem":"ai_recommendations pendentes","obrigatorio":true},
   {"nome":"lista","tipo":"lista","origem":"alerts + ai_recommendations, severidade desc","obrigatorio":true}]'::jsonb,
 'Nao usar quando o pedido e o que FAZER com o alerta: inventario e leitura, a acao sugerida e julgamento do especialista do setor.',
 '2027-03-03', 1),

('EST_CAMPANHAS_ATIVAS', 'molde_calculado',
 'Inventario de campanhas ativas',
 '**Campanhas ativas — leitura de {data}**

Total no cadastro: {total}
Ativas agora: {ativas}

{lista}

Este e o estado do cadastro na hora da leitura. Nao inclui desempenho: custo, CTR e resultado tem base de calculo declarada e vem por outro caminho.',
 '[{"nome":"data","tipo":"data","origem":"parametro do turno","obrigatorio":true},
   {"nome":"total","tipo":"inteiro","origem":"campaigns do company_id","obrigatorio":true},
   {"nome":"ativas","tipo":"inteiro","origem":"campaigns com status ACTIVE","obrigatorio":true},
   {"nome":"lista","tipo":"lista","origem":"campaigns ACTIVE, nome + objetivo + external_id","obrigatorio":true}]'::jsonb,
 'Nao usar quando o pedido junta desempenho ao inventario — nesse caso a resposta precisa da base de resultado declarada e o caminho e o de leitura de numero.',
 '2027-03-03', 1),

-- --- CONFIRMACAO DE ATO ----------------------------------------------------
-- A maior familia da operacao: 320 das 741 respostas do assistente (43,2%) contem confirmacao
-- de card. RESSALVA MEDIDA: so 22 delas caberiam INTEIRAS neste molde (6 com ate 200 chars,
-- 16 entre 201 e 500). As outras 287 misturam confirmacao com analise, media de 1.933 chars e
-- maximo de quase 3.000. Ou seja: este molde cobre o SEGMENTO de confirmacao, e ligar ele como
-- resposta inteira encurtaria o que o gestor recebe hoje. A decisao de encurtar e dele.
--
-- O INCIDENTE QUE ISTO FECHA (01/09/2026, 19:00-19:30, CONJ.2 do VISTTA): em cinco rodadas
-- seguidas a resposta anunciou "6 Cards de Pausa Emitidos" e "2 Cards Emitidos", com tabela e
-- approval_id, e o registro de ferramentas dessas rodadas nao tem NENHUMA chamada de
-- propose_action. Nenhum card existiu em 30 minutos. O modelo narrou o ato em vez de praticar.
--
-- Texto livre pode narrar ato que nao houve. Molde cujas lacunas vem de approval_requests nao
-- pode: sem linha na tabela, o campo obrigatorio nao preenche e a emissao inteira cai para o
-- LLM. A mentira deixa de ser expressavel neste caminho.
--
-- DUAS VARIANTES, escolhidas pelo CHAMADOR depois de as ferramentas rodarem — o classificador
-- de texto nao tem como saber quantos cards sairao antes de eles sairem.

('ATO_CONFIRMACAO_CARD', 'confirmacao_de_ato',
 'Confirmacao de cards emitidos, alimentada por approval_requests',
 '**{total} card(s) emitido(s) para sua aprovacao**

{emitidos}

{pendencia}',
 '[{"nome":"total","tipo":"inteiro","origem":"count(approval_requests criados neste turno)","obrigatorio":true},
   {"nome":"emitidos","tipo":"lista","origem":"approval_requests deste turno: id + acao + alvo + orcamento","obrigatorio":true},
   {"nome":"pendencia","tipo":"texto","origem":"o que ficou de fora e por que, ou frase de nada pendente","obrigatorio":true}]'::jsonb,
 'Nao usar com total = 0: use ATO_CARD_NAO_EMITIDO. Um molde de confirmacao que aceita zero e um molde que consegue mentir.',
 '2027-03-03', 1),

('ATO_CARD_NAO_EMITIDO', 'confirmacao_de_ato',
 'Nenhum card emitido — motivo verdadeiro, alimentado pelo retorno da ferramenta',
 '**Nenhum card foi emitido neste turno.**

{motivo}

{proximo_passo}',
 '[{"nome":"motivo","tipo":"texto","origem":"recusa de propose_action ou validar_pedido_contra_contrato","obrigatorio":true},
   {"nome":"proximo_passo","tipo":"texto","origem":"o que falta para o card ser possivel","obrigatorio":true}]'::jsonb,
 'Nao usar quando a ferramenta nem foi chamada: nesse caso nao existe motivo verdadeiro para declarar, e o turno tem que voltar ao modelo exigindo a chamada (deveForcarEmissao em _shared/intencao_turno.ts).',
 '2027-03-03', 1)

on conflict (codigo) do update set
  classe = excluded.classe,
  titulo = excluded.titulo,
  gabarito = excluded.gabarito,
  campos = excluded.campos,
  fronteira = excluded.fronteira,
  revalidar_ate = excluded.revalidar_ate,
  versao = excluded.versao,
  verificado_em = current_date,
  vigente = true,
  updated_at = now();

-- ============================================================================
-- MEMORIA INSTITUCIONAL
-- ============================================================================
-- Registrar a decisao para o agente nao contradizer a propria arquitetura quando o gestor
-- perguntar por que a mesma pergunta agora devolve sempre o mesmo texto.
-- agent_context nao tem unique no texto do fato, entao a reexecucao e guardada por NOT EXISTS.

insert into public.agent_context (categoria, fato, vigente, desde, company_id)
select 'sistema',
  'CAMADA DE CONHECIMENTO DETERMINISTICO (03/09/2026): existe um caminho de resposta que NAO passa por geracao livre. public.moldes_de_resposta guarda moldes em tres classes: texto_canonico (resposta emitida LITERAL), molde_calculado (forma fixa com lacunas preenchidas por valor de SQL) e confirmacao_de_ato (lacunas vindas de approval_requests). A classificacao do turno e por regex antes da geracao, em _shared/molde_pergunta.ts, e a emissao e em _shared/resposta_canonica.ts. A FRONTEIRA E ASSIMETRICA: so emite canonico com molde exato, todos os campos obrigatorios preenchidos e molde dentro do revalidar_ate; qualquer duvida cai para o LLM e o motivo fica em public.resolucoes_de_molde. Campo obrigatorio faltando NAO vira "nao disponivel" dentro do molde — derruba a emissao inteira, porque forma fixa com lacuna soa completa. Molde vencido PARA de emitir, nao emite com aviso. As formulas de metrica tem fonte unica em _shared/metrica_canonica.ts, onde a base de resultado (formularios, conversas, formularios_e_conversas, cliques_no_link) faz parte do nome e viaja com o numero: nao existe "CPL" sem denominador declarado.',
  true, current_date, null
where not exists (
  select 1 from public.agent_context
  where categoria = 'sistema' and fato like 'CAMADA DE CONHECIMENTO DETERMINISTICO (03/09/2026):%'
);
