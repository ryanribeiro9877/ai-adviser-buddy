-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260804192159
-- name: drive_convencao_de_base_evidencia_e_criterio
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

-- 04/08/2026 - CONVENCAO DE NOME DA BASE DE ANALISE. Decisao minha, pedida pelo Claude Code.
--
-- O QUE O LEVANTAMENTO DELE PROVOU: as 67 analises sao de UMA corrida, 31/07 17:11-17:16 UTC. O
-- deploy da v2.4 - que acrescentou "educacao financeira" e "seguranca" a lista de produto, pelo
-- critério do Roberto - foi 31/07 19:27 UTC, DUAS HORAS E ONZE MINUTOS DEPOIS. A distribuicao
-- confirma: zero pecas em educacao financeira ou seguranca. E os textos das indeterminadas sao
-- Registrato, BC Proteje+, BCB.gov.br, verificacao de numero - exatamente esses dois temas.
-- Boa parte dos 43 "indeterminado" NAO e falta de evidencia: e TAXONOMIA VELHA.
-- Medicao dele que derrubou a hipotese da resolucao: imagem indeterminada tem MAIS texto lido
-- (145 chars) que a determinada (128). A miniatura nao estava ilegivel.
--
-- POR QUE A CONVENCAO E NAO SO UM NOME: se a base guardar apenas a evidencia ("thumbnail"), uma
-- releitura com critério novo casa na chave e SOBRESCREVE o veredito em que o gestor decidiu. Se
-- guardar evidencia E critério, mudanca de critério passa a disparar reanalise POR CONSTRUCAO -
-- ninguem precisa lembrar de inventar nome. E o conserto da raiz que eu levantei em 03/08 e que
-- ficou parado: "a chave tem versao de arquivo, nao versao de critério".
--
-- FORMATO: <evidencia>/criterio-<versao do prompt de visao>
--   thumbnail                        -> legado, as 67 de 31/07 (evidencia sem criterio declarado)
--   thumbnail/criterio-v2.4          -> mesma evidencia, taxonomia com educacao financeira e seguranca
--   multiquadro+audio/criterio-v2.4  -> evidencia mais rica, mesma taxonomia
-- Se o prompt virar v2.6, a base vira /criterio-v2.6 e a reanalise acontece sozinha.

COMMENT ON COLUMN public.drive_midia_analises.base_da_analise IS
  'CONVENCAO OBRIGATORIA: <evidencia>/criterio-<versao do prompt de visao>. Ex.: "thumbnail/criterio-v2.4", "multiquadro+audio/criterio-v2.4". O valor "thumbnail" puro e LEGADO - sao as 67 pecas de 31/07 17:11-17:16 UTC, julgadas ANTES do deploy da v2.4 (19:27 UTC), com taxonomia que nao tinha "educacao financeira" nem "seguranca". FAZ PARTE DA CHAVE de proposito: evidencia E criterio juntos fazem mudanca de criterio disparar reanalise por construcao, sem sobrescrever veredito em que o gestor decidiu. Ao citar veredito, diga a base.';

-- Fato: a taxonomia velha explica parte grande dos indeterminados.
INSERT INTO agent_context (categoria, fato, vigente, desde, atualizado, company_id)
VALUES ('armadilha',
  'OS 43 "INDETERMINADO" DO DRIVE SAO EM BOA PARTE TAXONOMIA VELHA, NAO FALTA DE EVIDENCIA '
  || '(provado em 04/08/2026 por timestamp). As 67 pecas foram analisadas numa unica corrida em 31/07 entre '
  || '17:11 e 17:16 UTC. O prompt de visao v2.4, que acrescentou "educacao financeira" e "seguranca" a lista '
  || 'de produto por critério do gestor Roberto, subiu as 19:27 UTC do mesmo dia - duas horas e onze minutos '
  || 'DEPOIS. Consequencia: zero pecas classificadas nesses dois temas, e os textos lidos das indeterminadas '
  || 'sao justamente Registrato, BC Proteje+, BCB.gov.br e verificacao de numero de WhatsApp - ou seja, '
  || 'educacao financeira e seguranca julgadas com uma lista que nao tinha a opcao. '
  || 'E A EVIDENCIA NAO ERA O PROBLEMA nas imagens: imagem indeterminada tem MAIS texto lido (145 caracteres '
  || 'em media) que imagem determinada (128). A miniatura nao estava ilegivel. Nos videos sim: 36 contra 73, '
  || 'coerente com um quadro pegar uma cartela e nada mais. '
  || 'CONSEQUENCIA PARA VOCE: ao citar produto detectado de peca cuja base seja "thumbnail" puro, DECLARE que '
  || 'o veredito e anterior ao critério vigente e pode estar desatualizado por taxonomia, nao por falta de '
  || 'evidencia. Nao repita "43 indeterminados" como se fosse propriedade do acervo.',
  true, '2026-08-04', now(), 'ded20b38-f42e-4c71-800c-31b97ea48bcf');