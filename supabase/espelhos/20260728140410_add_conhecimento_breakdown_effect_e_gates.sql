-- 20260728140410_add_conhecimento_breakdown_effect_e_gates.sql
-- Espelho da migracao aplicada em producao (projeto gzjwnjdpxpbmdhcyefvs).
-- Extraido de supabase_migrations.schema_migrations - e o SQL EXATO que rodou.
-- NAO re-executar: ja esta aplicado.

-- =====================================================================================
-- DESTILACAO VIA 1: conhecimento CURTO e de DECISAO vai para a memoria institucional.
-- Origem: pacote Skills.zip (28/07/2026), references otimizacao-diagnostico.md e
-- analise-critica-unidade-economica.md. Credito conceitual: documentacao do sistema de
-- entrega da Meta, formalizada por Mathias Chu em meta-ads-analyzer (MIT).
--
-- MOTIVO DE ENTRAR NA MEMORIA E NAO SO NA BASE CONSULTAVEL: estes quatro fatos mudam
-- DECISAO, nao apenas explicacao. Precisam estar presentes em todo turno, inclusive quando
-- o agente nao consultar a base de conhecimento.
--
-- ACHADO QUE MOTIVOU O PRIMEIRO FATO: a ferramenta get_ads_ranking ranqueia criativos por
-- CUSTO MEDIO de midia, e a acao pausar_criativo executaria "pausar o mais caro na media".
-- Isso e exatamente o erro que a regra dura proibe. Havia uma ferramenta produzindo o input
-- do erro no 1 de analise e uma acao capaz de executa-lo.
-- =====================================================================================

insert into agent_context (categoria, fato, vigente, desde) values

('armadilha',
'BREAKDOWN EFFECT (erro no 1 de analise de midia): avalie no NIVEL CORRETO antes de qualquer conclusao. Orcamento na campanha (CBO/Advantage+) -> julgue no nivel da CAMPANHA. Posicionamento automatico ou varios anuncios no mesmo conjunto -> julgue no nivel do CONJUNTO. O sistema da Meta aloca por custo MARGINAL (custo do proximo resultado), nao por custo medio: um segmento com custo medio MAIOR pode estar segurando o custo total, porque o proximo resultado no segmento "barato" ja saiu mais caro. REGRA DURA: nunca recomende pausar ou reduzir um segmento com base apenas em custo medio de recorte. Recorte serve para ENTENDER, nao para PRESCREVER; prescricao exige teste isolado ou tendencia do marginal ao longo do tempo. O ranking de criativos por custo de midia e um recorte - trate como diagnostico, jamais como ordem de pausa.',
true, current_date),

('armadilha',
'TRIAGEM ANTES DE INTERPRETAR NUMERO (nesta ordem, sempre): (1) status real de entrega na fonte, nao no espelho; (2) dinheiro - saldo, cobranca, conta com pendencia, limite de gasto; (3) rejeicao ou restricao de anuncio/conta; (4) alguem editou algo e resetou o aprendizado? Queda de resultado com data marcada tem como primeiro suspeito uma pausa ou rejeicao naquela data, nao o criativo. Só depois desses quatro os numeros merecem interpretacao.',
true, current_date),

('armadilha',
'FASE DE APRENDIZADO: um conjunto sai da fase de aprendizado com cerca de 50 eventos de otimizacao em 7 dias; durante ela o custo e mais alto e instavel e NAO deve ser julgado. Se o conjunto nao alcanca esse volume ("aprendizado limitado"), a saida e CONSOLIDAR - juntar conjuntos, subir orcamento ou otimizar por um evento mais frequente no funil - e nunca fatiar mais. Subentrega e aprendizado limitado ao mesmo tempo em conjuntos do mesmo anunciante sugerem disputa entre eles no leilao: consolide ou desligue o redundante. EDICAO SIGNIFICATIVA reseta o aprendizado - se a campanha esta performando, prefira duplicar e testar em paralelo, ou agrupar as edicoes numa janela unica.',
true, current_date),

('decisao',
'FORMATO OBRIGATORIO DE RECOMENDACAO. Toda proposta de acao entrega, nesta ordem: EVIDENCIA (metrica + nivel + janela + periodo + fonte); MECANISMO (por que o sistema produz esse padrao); HIPOTESE (uma variavel por vez); SUCESSO (metrica-alvo e limiar, lido no funil COMPLETO ate contrato pago, nunca so no custo de midia); LEITURA (janela minima e data de decisao, com minimo de 3-4 dias fora da fase de aprendizado); REVERSA (como desfazer, quem desfaz, em quanto tempo); RISCO (o que pode piorar e como se detecta cedo). Recomendacao sem reversa definida NAO sobe para aprovacao. Gate de escala usa o funil completo: custo por lead baixo com contrato caro e armadilha, nao vitoria.',
true, current_date),

('contexto',
'SAZONALIDADE DO CONSIGNADO NO BRASIL: demanda e custo de midia variam com o calendario de pagamento do INSS, antecipacoes de 13o, liberacoes de margem e concorrencia de grandes players em datas de credito. Antes de culpar criativo por custo de midia alto, compare com o MESMO periodo de meses anteriores - nunca com a media geral.',
true, current_date);
