-- OS AGENDAMENTOS QUE RODAM EM PRODUCAO SEM ARQUIVO QUE OS DECLARE
--
-- Levantado porque em 20260904100500 eu precisei escrever uma migration para um cron que ja
-- existia em producao, e deriva desse tipo raramente acontece uma vez so. Aconteceu 9 vezes.
--
-- METODO, e por que a primeira medicao estava errada
-- =========================================================================================
-- Cruzei os 31 `cron.job` vivos contra as migrations. A primeira passagem procurou o NOME do
-- job em qualquer lugar dos arquivos e devolveu 31 de 31 versionados — resultado limpo e
-- falso. `alerts-eval-daily`, por exemplo, aparece em 10 migrations, todas em consultas de
-- MONITORAMENTO do tipo `where j.jobname in (...)`; nenhuma o agenda. Presenca do nome nao e
-- declaracao do agendamento, e a checagem barata deu a resposta que eu queria ouvir.
--
-- A segunda passagem procurou `cron.schedule('<nome>'` e a resposta mudou para 9 casos, em
-- duas familias distintas.
--
-- FAMILIA A — SEIS SEM NENHUMA DECLARACAO
-- =========================================================================================
-- Rodam todo dia e nao existem no repositorio. Em banco reconstruido do zero pelas
-- migrations, a operacao subiria sem espelho da Meta, sem relatorio diario, sem sincronia de
-- WhatsApp e sem varredura do Drive da Legal — e sem nada acusando, porque `tarefas_agendadas`
-- continuaria listando as tarefas como ativas. Sao os quatro coletores mais antigos, de antes
-- de o projeto passar a versionar cron, mais dois.
--
-- Caso a destacar: `drive-watch-0845`. A UNICA mencao dele no repositorio e um
-- `cron.unschedule` em 20260806120620. Foi desagendado por arquivo e reagendado a mao, entao
-- o repositorio afirma hoje o oposto do que roda.
--
-- Nota sobre `daily-report-0830`, que parece deriva e nao e: roda `30 11 * * *`, e o nome diz
-- 0830. Cron do Postgres esta em UTC e 11:30 UTC e 08:30 em Brasilia — o nome fala horario
-- local. Nao mexo. Outros jobs nomeiam pelo UTC (`bm-monitor-0920` roda 09:20 UTC), entao a
-- convencao de nome e inconsistente no projeto, mas isso e assunto de nomenclatura e nao de
-- agendamento; renomear job em producao para arrumar estetica troca risco por aparencia.
--
-- FAMILIA B — TRES DECLARADOS COM O HORARIO ERRADO
-- =========================================================================================
-- O trio de estrutura do Pipeboard esta declarado em 20260814130000 as 09:12, 09:17 e 09:22,
-- e roda as 08:40, 08:45 e 08:50.
--
-- Aqui houve decisao de direcao, porque versionar e escolher qual dos dois lados e a verdade.
-- PRODUCAO ESTA CERTA E O ARQUIVO ESTA VELHO, e a evidencia e a ordem de dependencia:
-- `pipeboard-metrics-daily` roda as 09:00 e le a estrutura que o trio coleta. No horario do
-- arquivo, a estrutura chegaria DEPOIS das metricas, que e a ordem invertida — as metricas
-- casariam com a estrutura do dia anterior. Alguem antecipou o trio para corrigir isso e nao
-- versionou. Escrever `12 9` de volta neste arquivo "para bater com o repositorio" quebraria a
-- coleta em nome da consistencia.
--
-- LIXO ESQUECIDO: NENHUM. Conferido pelos dois lados — as 32 linhas de `tarefas_agendadas`
-- tem cron vivo, e os 31 crons apontam para tarefa registrada e ativa (o `alerts-eval-daily`
-- cobre duas). Nao ha job apontando para tarefa que nao existe, nem tarefa ativa sem quem a
-- dispare. A deriva e so entre producao e repositorio, nao dentro de producao.
--
-- Os quatro `windsor-*` continuam declarados e desagendados no repositorio, o que esta certo:
-- o Windsor foi aposentado em 20260814123000 e a ausencia deles em producao e o desfecho
-- desejado, nao deriva.
--
-- =========================================================================================
-- ESTE ARQUIVO NAO MUDA NADA EM PRODUCAO, DE PROPOSITO
-- =========================================================================================
-- Horario e comando abaixo foram copiados de `cron.job` como estao rodando agora. Em producao
-- cada `cron.schedule` reescreve o job com valor identico ao que ja tem — inocuo. Em banco
-- novo, cria. O objetivo e fechar a deriva sem tocar na operacao: alterar horario de coletor
-- e assunto de outra decisao, e misturar as duas coisas aqui esconderia a mudanca dentro de
-- uma migration cujo titulo promete so versionar.

-- FAMILIA A
select cron.schedule('meta-campaign-status-0910', '10 9 * * *',
  $cron$select public.disparar_tarefa_http('espelho-meta-diario');$cron$);

select cron.schedule('alerts-eval-daily', '15 9 * * *',
  $cron$select public.rodar_tarefa_sql('alertas-de-midia'); select public.rodar_tarefa_sql('criativos-vencedores');$cron$);

select cron.schedule('campaign-config-snapshot-0925', '25 9 * * *',
  $cron$select public.rodar_tarefa_sql('snapshot-config-campanhas');$cron$);

select cron.schedule('waba-sync-daily', '30 9 * * *',
  $cron$select public.disparar_tarefa_http('sincronizar-whatsapp');$cron$);

-- 11:30 UTC = 08:30 em Brasilia. Ver nota acima antes de "corrigir" para 30 8.
select cron.schedule('daily-report-0830', '30 11 * * *',
  $cron$select public.rodar_tarefa_sql('relatorio-diario-no-chat');$cron$);

-- Reagendado a mao depois do unschedule de 20260806120620.
select cron.schedule('drive-watch-0845', '45 8 * * *',
  $cron$select public.disparar_tarefa_http('varredura-drive-legal');$cron$);

-- FAMILIA B — horario de producao, que precede as metricas das 09:00.
select cron.schedule('pipeboard-structure-campaigns-0912', '40 8 * * *',
  $cron$select public.disparar_tarefa_http('estrutura-campanhas');$cron$);

select cron.schedule('pipeboard-structure-adsets-0917', '45 8 * * *',
  $cron$select public.disparar_tarefa_http('estrutura-conjuntos');$cron$);

select cron.schedule('pipeboard-structure-ads-0922', '50 8 * * *',
  $cron$select public.disparar_tarefa_http('estrutura-anuncios');$cron$);
