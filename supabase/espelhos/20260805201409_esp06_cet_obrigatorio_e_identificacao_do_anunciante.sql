-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260805201409
-- name: esp06_cet_obrigatorio_e_identificacao_do_anunciante
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

-- ESP-06 · CET obrigatorio quando cita taxa, e identificacao do anunciante.
--
-- O BURACO: a FIN-04 v1 dizia que oferta com taxa deve indicar "a partir de", sujeita a
-- analise, "e IDEALMENTE mencionar o CET". "Idealmente" transforma requisito em boa pratica -
-- e o resultado e que hoje nenhuma das 16 regras vivas exige CET nem identificacao do
-- anunciante, que sao os dois itens que o contrato do gestor trata como obrigatorios
-- (CONTRA_2 secao 4.4: razao social + CNPJ; correspondente bancario com numero CMN 4.935/2021;
-- CET sempre que citar taxa).
--
-- COMO A CORRECAO E FEITA: pelo mecanismo que a propria tabela tem - UNIQUE (code, version) com
-- flag active. A v1 e DESATIVADA e a v2 entra ativa. Nada e editado no lugar, entao a decisao
-- de compliance de ontem continua auditavel contra a regra que valia ontem.
--
-- DUAS SEVERIDADES DIFERENTES, e o porque:
--   FIN-04 v2 = BLOQUEIA. Citar taxa, prazo ou valor de parcela sem CET nao e imprecisao, e
--   informacao incompleta sobre preco de credito.
--   LGL-04 = ATENCAO, nao bloqueia. O contrato admite que a identificacao esteja no criativo
--   OU na landing conectada. Bloquear a legenda por ausencia de CNPJ reprovaria peca correta
--   cuja identificacao vive na LP. Entao a regra EXIGE VERIFICACAO na LP em vez de reprovar as
--   cegas - e isso ficou verificavel agora que o GT-12 passou a coletar destino_url.
--
-- LIMITE DECLARADO: estas duas regras fecham o caminho da LEGENDA. Os 5 videos CLT que citam
-- taxa/prazo/valor carregam isso no PIXEL e no AUDIO, que nenhum verificador le - essa lacuna
-- e do ESP-11 e do ESP-12 e continua aberta. Nao tratar o ESP-06 como se tivesse resolvido os
-- videos.

update public.compliance_rules
   set active = false
 where code = 'FIN-04' and version = 1;

insert into public.compliance_rules (code, categoria, severidade, regra, fonte, exemplos_violacao, version, active)
values
('FIN-04', 'ambos', 'bloqueia',
 'Toda peca que citar TAXA de juros, PRAZO de pagamento ou VALOR DE PARCELA precisa trazer o CET (Custo Efetivo Total) e a ressalva de que a taxa e "a partir de" e sujeita a analise de credito e de margem. Citar preco de credito pela metade e informacao incompleta, nao imprecisao de estilo. Se a peca nao tiver espaco para o CET, retire a taxa da peca.',
 'Res. CMN 4.935/2021 + CDC art. 52 (informacao previa e adequada sobre custo do credito) + politica Meta de Produtos e Servicos Financeiros',
 'exemplos que REPROVAM: "taxa de 1,29% ao mes" sem CET · "12x de R$ 250" sem CET · "menor taxa do mercado" com numero e sem CET. Exemplo que PASSA: "taxa a partir de 1,29% a.m., CET de X% a Y% ao ano, sujeito a analise de credito e margem".',
 2, true),

('LGL-04', 'ambos', 'atencao',
 'A peca ou a landing conectada precisa identificar quem anuncia: razao social e CNPJ - nao apenas o nome fantasia. Se a operacao for como correspondente bancario, citar tambem o banco concedente e a condicao de correspondente (Res. CMN 4.935/2021). Quando a identificacao nao estiver na peca, NAO reprove por isso: declare que a verificacao tem de ser feita na URL de destino, e diga qual e a URL. Rodape de referencia: "Legal e Viver - Correspondente Bancario (Res. CMN 4.935/2021). Credito sujeito a analise. CET de X% a Y% ao ano. Concedido por [Banco], CNPJ XX.XXX.XXX/0001-XX."',
 'Res. CMN 4.935/2021 (correspondentes) + CDC art. 31 (identificacao do fornecedor)',
 'exemplos de ATENCAO: peca assinada so como "Legal e Viver" sem razao social/CNPJ · mencao a "nossos parceiros bancarios" sem nomear o concedente quando a peca cita condicao de credito.',
 1, true);