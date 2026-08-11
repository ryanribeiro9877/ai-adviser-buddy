-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260807224441
-- name: fin04_v3_o_cet_mora_na_legenda_da_publicacao
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

-- FIN-04 v3 · o CET mora na LEGENDA DA PUBLICACAO, nao dentro da peca.
--
-- A CONTRADICAO ERA MINHA, e escrita em dois dias diferentes:
--   FIN-04 v2 (05/08): "toda PECA que citar taxa, prazo ou valor precisa trazer o CET"
--   checar_par_texto_e_peca (06/08): "se o CET estiver na LEGENDA e o numero na peca, o par esta conforme"
-- Uma exigia do artefato, a outra aceitava do conjunto. As duas minhas, e incompativeis. Foi essa
-- ambiguidade que travou 5 videos sem que ninguem pudesse decidir com clareza.
--
-- A DISTINCAO QUE EU CONFLACIONEI (apontada pelo Ryan em 07/08): legenda do VIDEO e o que esta
-- dentro da peca, produzido por quem a fez - nao temos ingerencia. Legenda da PUBLICACAO e o texto
-- do anuncio, que e nosso e segue padrao da campanha. A regua estava exigindo do artefato errado.
--
-- A REGRA CORRIGIDA: o que precisa carregar o CET e o ANUNCIO, e o lugar onde nos podemos poe-lo e
-- a legenda da publicacao. Quando a peca EXIBE numero, isso nao a reprova - isso OBRIGA a legenda a
-- trazer o CET. O gate deixa de julgar o video e passa a exigir da parte que e nossa.
--
-- RESSALVA QUE NAO DESAPARECE E TEM DE SER DECLARADA: em Reels e Stories a legenda e truncada ou
-- nao aparece. O criativo de maior lastro da conta e AD_LP_C3REELS_R06, ou seja Reels. Nesses
-- posicionamentos, CET so na legenda cumpre menos. Isso NAO e decisao de engenharia: e risco
-- regulatorio, e a palavra e do Roberto. A regra registra a ressalva em vez de esconde-la.
--
-- O QUE ISSO MUDA NA PRATICA: as 5 pecas em revisao passam a ser liberaveis por REGRA, e nao uma
-- por uma - o veredito do Roberto pode ser "liberado desde que a legenda traga o CET", que se
-- aplica as cinco de uma vez. Continua sendo decisao dele; eu so parei de pedir a coisa impossivel.

update public.compliance_rules set active = false where code = 'FIN-04' and version = 2;

insert into public.compliance_rules (code, categoria, severidade, regra, fonte, exemplos_violacao, version, active)
values ('FIN-04', 'ambos', 'bloqueia',
 'Quando o ANUNCIO citar TAXA de juros, PRAZO de pagamento ou VALOR DE PARCELA - esteja o numero na LEGENDA DA PUBLICACAO ou exibido dentro da PECA -, a LEGENDA DA PUBLICACAO precisa trazer o CET (Custo Efetivo Total) e a ressalva de que a taxa e "a partir de", sujeita a analise de credito e de margem. '
 || 'O QUE ISTO NAO EXIGE: nao exige que o CET esteja DENTRO do video. A peca e produzida por terceiros e nao temos ingerencia sobre ela; o que temos e a legenda da publicacao. Peca que exibe numero nao esta reprovada - ela OBRIGA a legenda a completar a informacao. '
 || 'RESSALVA DE POSICIONAMENTO, declarada e nao resolvida: em Reels e Stories a legenda e truncada ou nao exibida, entao CET so na legenda cumpre menos nesses lugares. O criativo de maior lastro da conta e Reels. Se a peca exibe numero E o posicionamento for Reels ou Stories, DECLARE esse risco ao gestor em vez de tratar como resolvido. '
 || 'SE A LEGENDA NAO TROUXER O CET e houver numero em qualquer um dos dois lugares, reprova.',
 'Res. CMN 4.935/2021 + CDC art. 52 (informacao previa e adequada sobre custo do credito). Reescrita em 07/08/2026: a v2 exigia o CET DENTRO da peca, o que contradizia o checar_par_texto_e_peca e cobrava de um artefato que nao controlamos.',
 'REPROVAM: legenda com "taxa de 1,29% a.m." sem CET · legenda limpa mas peca exibindo "12x de R$ 250" e legenda sem CET. PASSA: peca exibe "parcela R$ 509,53" e a legenda traz "CET de X% a Y% ao ano, taxa a partir de Z%, sujeito a analise de credito e margem".',
 3, true);