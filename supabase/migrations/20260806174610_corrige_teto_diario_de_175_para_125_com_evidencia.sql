-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260806174610
-- name: corrige_teto_diario_de_175_para_125_com_evidencia
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

-- CORRECAO DE FATO SOBRE DINHEIRO · o teto de um dia isolado e 25%, nao 75%.
--
-- O QUE ESTAVA REGISTRADO: "A Meta trata orcamento diario como MEDIA e permite ate 175% num dia
-- isolado". Entrou como "texto da Meta" sem fonte citada, e virou o fator da RPC
-- avaliar_orcamento_diario e da memoria das linhas de teto_gasto_diario.
--
-- MEDIDO NA NOSSA PROPRIA CONTA em 06/08/2026, janela de 14 dias com orcamento estavel em
-- R$72,00/dia nos tres conjuntos que entregam (42 pares conjunto-dia):
--   razao maxima observada: 1,249  (os tres maiores: 1,249 / 1,249 / 1,236)
--   dias acima de 1,00x: 18 de 42
--   dias acima de 1,25x: ZERO
--   dias acima de 1,75x: ZERO
--   soma de 7 dias dividida por (7 x diario): 0,995 / 0,993 / 0,986
-- O teto de um dia bate em 1,25 e nao passa; a semana fecha praticamente exata em 7x. E o
-- comportamento de media com folga diaria de 25% compensada dentro da semana.
--
-- RESSALVA DA MEDICAO, declarada: nao existe historico de orcamento de conjunto no banco. A
-- primeira versao deste teste comparou gasto de maio contra orcamento de agosto e deu razao de
-- 16,8x - numero sem sentido, divergencia de denominador. So a janela de 14 dias, onde o
-- orcamento e plausivelmente o mesmo, sustenta a conclusao.
--
-- CONSEQUENCIA: a RPC avaliar_orcamento_diario SUPERESTIMA a exposicao do pior dia em 40%
-- (diria R$378 onde o observado e R$270 para os R$216/dia atuais). A correcao do fator dentro
-- dela vai por briefing, com cuidado, porque e funcao de dinheiro.

update public.targets
   set memoria = coalesce(memoria,'{}'::jsonb) || jsonb_build_object(
     'aviso_meta','A Meta trata orcamento diario como MEDIA: um dia isolado pode chegar a 125% do diario e a semana fecha em 7x o diario. Com R$ 60,00 o maximo de um dia e R$ 75,00 e o semanal R$ 420,00. Este teto e referencia de leitura, NAO limite imposto na plataforma.',
     'correcao_06_08_2026','O valor anterior dizia 175% num dia isolado, sem fonte citada. Medicao na propria conta em 06/08 (42 pares conjunto-dia, 14 dias, orcamento estavel): razao maxima 1,249 e ZERO dias acima de 1,25x; semana em 0,986 a 0,995 de 7x. O 175% estava errado.')
 where metric = 'teto_gasto_diario';

insert into public.agent_context (categoria, fato, vigente, desde, company_id)
select 'midia',
'TETO DE UM DIA ISOLADO E 125% DO ORCAMENTO DIARIO, NAO 175% (corrigido em 06/08/2026 por medicao). '
|| 'A Meta trata orcamento diario como MEDIA: um dia pode chegar a ~1,25x o diario, e a semana fecha em 7x o diario, '
|| 'porque os dias acima sao compensados por dias abaixo. '
|| 'EVIDENCIA: 42 pares conjunto-dia na propria conta, janela de 14 dias com orcamento estavel de R$72,00/dia - '
|| 'razao maxima observada 1,249, ZERO dias acima de 1,25x, e a soma de 7 dias entre 0,986 e 0,995 de 7x o diario. '
|| 'O QUE FOI CORRIGIDO: o registro anterior dizia 175% e entrou sem fonte citada. Estava errado. '
|| 'ATENCAO AO USAR: a RPC avaliar_orcamento_diario AINDA calcula com 1,75 e portanto SUPERESTIMA o pior dia em 40% '
|| 'ate ser corrigida. Enquanto isso, ao citar pior dia, use 1,25x e diga que a RPC esta desatualizada. '
|| 'RESSALVA DA MEDICAO: nao existe historico de orcamento de conjunto no banco, entao a conclusao vale para a janela '
|| 'em que o orcamento e estavel. Comparar gasto antigo com orcamento de hoje produz numero sem sentido.',
true, '2026-08-06', c.id
from public.companies c;

update public.perguntas_ouro_execucoes
   set veredito = 'passou',
       evidencia = 'REAVALIADO em 06/08/2026 apos medicao. O veredito original era "falhou" porque a resposta divergia da fonte registrada (175%). A MEDICAO MOSTROU QUE A FONTE ESTAVA ERRADA: 42 pares conjunto-dia, razao maxima 1,249, zero dias acima de 1,25x. O agente disse "ate 25% acima" e R$270 de pior dia - CORRETO. Quem errou foi o fato do sistema, e a RPC avaliar_orcamento_diario ainda superestima em 40%. '
                || 'O agente tambem acertou os R$216 de exposicao, o travamento semanal em 7x e declarou corretamente que orcamento diario e MEDIA. '
                || 'NOTA DE INSTRUMENTO: este caso validou o desenho do conjunto - a pergunta aponta para a FONTE VIVA em vez de guardar o numero, e foi por isso que o erro apareceu do lado certo. Se a expectativa tivesse o numero gravado, o conjunto teria reprovado o agente e preservado o erro. '
                || 'Continua de pe a observacao de que ele declarou nao ter a ferramenta de orcamento no alcance, o que contradiz o PO-11 - ver aquele registro.'
 where conjunto='v1' and codigo='PO-01' and rodada='2026-08-06-v62';