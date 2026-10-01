-- Agenda o passe diario da vigia de regua (T7).
--
-- O registro da tarefa ja existia sem cron: o agendamento esperava duas
-- execucoes manuais limpas e a confirmacao das constantes. As duas corridas
-- fecharam em sucesso e, em 2026-10-01, o gestor confirmou os numeros.
-- 30 10 * * * = 10:30 UTC = 07:30 America/Sao_Paulo (Brasil sem horario de verao).
--
-- Idempotente: unschedule previo do mesmo jobname (padrao de
-- 20260914193000_ritmo_boletim_diario e 20260827120000). cron.schedule com o
-- mesmo nome tambem sobrescreve, mas o unschedule so age se o job ja existe.
-- Nao altera metas_de_negocio e nao dispara a tarefa.

select cron.unschedule(jobid)
  from cron.job
 where jobname = 'vigia-de-regua-1030';

select cron.schedule(
  'vigia-de-regua-1030',
  '30 10 * * *',
  $$select public.disparar_tarefa_http('vigia-de-regua')$$
);

insert into public.agent_knowledge (tema, descricao, conteudo, fonte, verificado_em, revalidar_ate)
values (
  'vigia_de_regua',
  'Pisos, margem, vazao e carencia do vigia de custo por conversa. O detector le o bloco constantes. Nao e prompt: a trava mora no codigo.',
  $vigia$<!--constantes {"min_conversas":10,"min_gasto":150,"margem":0.15,"vazao":3,"carencia_dias":3,"maturacao_dias":3} -->
# Vigia de regua de custo por conversa

Constantes confirmadas pelo gestor em 2026-10-01:

- minimo de 10 conversas na janela de 7 dias
- minimo de R$ 150 de gasto da base na mesma janela
- margem de 15% acima da regua (centavo nao e estouro)
- no maximo 3 planos de acao por passe por empresa
- carencia de 3 dias entre intervencoes no mesmo alvo
- maturacao de 3 dias com entrega antes de julgar

Em 2026-10-01 o gestor confirmou: reguas de conversa da COHAPM unificadas em R$ 7; pisos de 10 conversas, R$ 150 de gasto da base e margem de 15%; vazao de 3 planos por passe por empresa. A revisao de 24/09/2026 nao foi reconstituida; a confirmacao vigente e esta.

A janela de 7 dias decide. A de 3 dias e tendencia. Peca nova so do acervo com aproveitavel=sim e aprovado pelo gestor. Linha de produto da COHAPM nao cruza.
$vigia$,
  'confirmacao do gestor, 2026-10-01',
  date '2026-10-01',
  date '2026-10-31'
)
on conflict (tema) do update set
  descricao = excluded.descricao,
  conteudo = excluded.conteudo,
  fonte = excluded.fonte,
  verificado_em = excluded.verificado_em,
  revalidar_ate = excluded.revalidar_ate,
  updated_at = now();
