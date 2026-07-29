-- =====================================================================================
-- REMOCAO DO ESPELHO DO CRM (decisao do Roberto, 28/07/2026)
-- O CRM/Dash sai do escopo: a analise de proposta e contrato pago passa a ser feita dentro
-- do proprio dashboard da Legal. O sistema de trafego volta a medir o funil de MIDIA.
--
-- POR QUE APAGAR E NAO SO IGNORAR: o espelho guardava 180.293 leads e 5.645 propostas de
-- pessoas reais (telefone e nome em SHA-256, mas hash de dado pessoal continua sendo dado
-- pessoal - e pseudonimizado, nao anonimo). Manter base de terceiros num sistema que nao a
-- usa e retencao sem finalidade. Minimizacao e principio da LGPD, nao detalhe de arrumacao.
-- Reconstruir, se um dia voltar ao escopo, custa uma varredura paginada.
--
-- CONSEQUENCIA ANALITICA QUE FICA REGISTRADA: sem o CRM nao existe mais CAC por contrato
-- pago, receita por campanha nem gate de escala no funil completo. O melhor criativo passa a
-- ser julgado por custo por lead/formulario - que e exatamente a metrica que o Breakdown
-- Effect manda tratar com cuidado. O agente segue proibido de prescrever pausa por custo
-- medio de recorte, mas perdeu a fonte que permitia distinguir lead barato de cliente real.
-- =====================================================================================

-- 1) Cron de sincronizacao, se existir.
select cron.unschedule(jobname) from cron.job
 where command ilike '%dash-lev-sync%' or command ilike '%lev-varredura%' or jobname ilike '%lev%';

-- 2) A RPC nao e dropada: ela e substituida por uma resposta EXPLICITA de escopo. A tool
-- get_funil_credito segue registrada no traffic-chat v26 e seria chamada; sem isso o agente
-- receberia "function does not exist" e reportaria falha tecnica em vez de limite de escopo.
create or replace function public.get_funil_credito(p_dias integer default 90)
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'fora_de_escopo', true,
    'motivo', 'A analise de proposta e contrato pago saiu do escopo deste sistema em 28/07/2026, por decisao da Legal e Viver. Esses dados sao tratados diretamente no dashboard da empresa.',
    'instrucao_para_o_agente', 'NAO tente obter proposta, contrato pago, receita, CAC por contrato ou atribuicao ate a venda por nenhuma outra via. Informe ao gestor, em uma linha, que a conversao final e acompanhada no dashboard da Legal, e siga a analise com o funil de midia (impressao, clique, formulario, conversa).',
    'disponivel_aqui', jsonb_build_array('gasto', 'impressoes', 'cliques', 'formularios', 'conversas de WhatsApp', 'custo por resultado de midia', 'estrutura de conta', 'conteudo e compliance de criativo')
  );
$$;

comment on function public.get_funil_credito(integer) is
  'DESATIVADA em 28/07/2026: o CRM saiu do escopo. Mantida como stub que devolve motivo e instrucao, para que a tool ja registrada no agente responda com limite de escopo em vez de erro tecnico. Remover quando a tool sair do traffic-chat.';

-- 3) Tabelas do espelho.
drop table if exists public.lev_propostas cascade;
drop table if exists public.lev_leads cascade;
drop table if exists public.lev_sync_state cascade;

-- 4) Fatos da memoria que falavam do CRM deixam de valer.
update public.agent_context set vigente = false
 where vigente and (
   fato ilike '%dash.legaleviver%' or fato ilike '%lev_leads%' or fato ilike '%lev_propostas%'
   or fato ilike '%contrato pago%' or fato ilike '%proposta%' or fato ilike '%CRM%');

-- 5) Registro do novo limite, para o agente nao tentar contornar.
insert into public.agent_context (categoria, fato, vigente, desde, company_id) values
('escopo',
'A conversao final (proposta, contrato pago, receita, CAC por contrato) NAO faz parte deste sistema desde 28/07/2026 - e acompanhada diretamente no dashboard da Legal e Viver. Sua analise vai ate o funil de MIDIA: gasto, impressao, clique, formulario e conversa de WhatsApp. Se o gestor pedir receita ou retorno financeiro, diga em UMA linha que isso e visto no dashboard da empresa e siga com o que e trafego. NUNCA estime receita, comissao ou CAC por contrato a partir de dado de midia.',
true, current_date, null);
