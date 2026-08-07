-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260807211937
-- name: doutrina_execucao_e_sincrona_com_a_aprovacao
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

-- CONSERTO 2 (07/08/2026): a DOUTRINA que o agente aplicou estava errada.
--
-- Em 07/08 as 20:57, perguntado sobre o card b5e2f338, o agente respondeu ao gestor:
-- "aguarde alguns instantes, o conjunto esta sendo criado ... costuma ser questao de segundos a
-- poucos minutos". A criacao tinha FALHADO as 20:56:01. Ele leu o card de verdade (get_aprovacoes
-- esta em chat_messages.tool_calls) - o que ele inventou foi a CAUSALIDADE, porque acreditava
-- numa fila que amadurece. Essa fila nao existe.
--
-- Preferimos MEMORIA a prompt aqui, seguindo o padrao do projeto: o prompt do traffic-chat ja
-- carrega os fatos vigentes de agent_context, e um fato datado pode ser revogado por outro fato
-- (categoria/vigente) sem deploy de edge. Doutrina que muda com o sistema nao deve virar string
-- compilada - foi exatamente assim que a nota da "Fase 3" sobreviveu tres semanas depois de
-- virar mentira.

insert into public.agent_context (categoria, fato, vigente, desde, company_id)
select 'execucao',
'A EXECUCAO E SINCRONA COM A APROVACAO - NAO EXISTE FILA AMADURECENDO (07/08/2026). '
|| 'COMO FUNCIONA DE VERDADE: aprovar um card dispara a execucao NO ATO. O trigger '
|| 'trg_executar_aprovacao na tabela approval_requests chama a edge meta-actions no mesmo instante '
|| 'em que o status vira approved. Medido no card b5e2f338: aprovado 20:55:58, desfecho gravado '
|| '20:56:01 - TRES SEGUNDOS. Nao ha lote noturno, nao ha worker, nao ha nada sendo processado em '
|| 'segundo plano. '
|| 'O QUE VOCE NUNCA DEVE DIZER: "aguarde alguns instantes", "esta sendo criado", "esta sendo '
|| 'processado", "deve aparecer em minutos", "a fila esta rodando". Nenhuma dessas frases descreve '
|| 'um estado que este sistema tem. Dizer isso e prometer ao gestor um objeto que talvez ja tenha '
|| 'falhado - foi o que aconteceu em 07/08/2026 as 20:57 e e a razao deste fato existir. '
|| 'COMO LER UM CARD APROVADO (get_aprovacoes devolve o campo `estado`, use ELE): '
|| 'estado=executado -> o objeto existe e id_criado_na_meta traz o identificador; '
|| 'estado=execucao_falhou -> a tentativa TERMINOU e falhou, e motivo_da_falha diz por que, em '
|| 'linguagem de negocio. Relate o motivo ao gestor. Se re_executavel=true o card ainda pode ser '
|| 'retentado, mas a tentativa anterior ACABOU - isso nao e "esta processando"; '
|| 'estado=aguardando_execucao -> nenhuma tentativa foi registrada. Como a execucao dispara junto '
|| 'com a aprovacao, este estado deve durar segundos: se ele persiste, algo esta ERRADO (trigger, '
|| 'chave, flag master_enabled ou a edge fora do ar) e isso e o que voce reporta - nao "aguarde". '
|| 'A REGRA CURTA: card aprovado e SEM identificador ou FALHOU ou NAO RODOU. Nunca "esta sendo '
|| 'processado". E NUNCA prometa ao gestor que o objeto vai aparecer sozinho: se ele nao esta la '
|| 'agora, ninguem vai coloca-lo la sem uma nova acao.',
true, date '2026-08-07', c.id
from public.companies c
where not exists (
  select 1 from public.agent_context a
   where a.company_id = c.id and a.vigente
     and a.fato like 'A EXECUCAO E SINCRONA COM A APROVACAO%'
);

do $$ declare v_n int; begin
  select count(*) into v_n from public.agent_context
   where vigente and fato like 'A EXECUCAO E SINCRONA COM A APROVACAO%';
  if v_n = 0 then raise exception 'a doutrina de execucao sincrona nao ficou vigente'; end if;
end $$;
