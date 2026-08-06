-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260806110514
-- name: congelar_pos_clique_whatsapp_e_atribuicao
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

-- CONGELAMENTO DO POS-CLIQUE · decisao do Ryan em 06/08/2026.
--
-- A REGUA: o sistema e de TRAFEGO PAGO e trata de tres pilares - campanha, conjunto e
-- criativo/anuncio. Tudo que descreve o anuncio e a entrega dele FICA (o que ele diz, quem ele
-- mira, quanto custa o resultado, qual publico converte, qualidade do criativo). Tudo que
-- acontece DEPOIS DO CLIQUE sai de escopo e e CONGELADO.
--
-- CONGELAR, NAO APAGAR: nenhuma tabela e derrubada e nenhum dado e perdido. As rotinas param
-- de escrever, os alertas do tema saem da tela, e um fato datado registra o que reativa. Mesmo
-- padrao usado em 29/07 com custo_por_lead_dashboard.
--
-- MEDIDO ANTES (06/08 ~10:55 UTC): 2 de 15 crons sao WABA; 10 dos 20 alertas ativos sao de
-- WhatsApp - ou seja, METADE do que o gestor le hoje e de um tema fora de escopo; 8 tabelas
-- waba_* com ~1.843 linhas, preservadas.
--
-- O QUE NAO ENTRA AQUI e continua vivo de proposito: compliance do que o ANUNCIO diz (CET,
-- promessas proibidas, identificacao) e de QUEM ELE MIRA (gate de segmentacao). Isso descreve
-- o anuncio, nao o pos-clique - e e o que impede a conta de anuncios de ser restringida, o que
-- derrubaria os tres pilares de uma vez.

-- 1) as duas rotinas de WhatsApp param de escrever. Edges seguem publicadas, apenas sem agenda.
do $$
declare j record;
begin
  for j in select jobid, jobname from cron.job where jobname in ('waba-sync-daily','waba-tier-alerts-0940')
  loop
    perform cron.alter_job(j.jobid, active := false);
    raise notice 'cron desativado: %', j.jobname;
  end loop;
end $$;

-- 2) alertas de WhatsApp saem da tela. resolved = true preserva a linha.
update public.alerts
   set resolved = true
 where resolved = false
   and rule_id is null
   and (title ilike '%whatsapp%' or title ilike '%waba%' or title ilike '%numero%'
        or title ilike '%tier%' or title ilike '%qualidade%');

-- 3) teto de custo por conversa sai de vigencia: e teto de um resultado que o sistema deixou
--    de gerir. Manter teto ativo para metrica fora de escopo permitiria julgar bom ou ruim
--    sobre algo que ninguem mais acompanha - mesmo motivo do custo_por_lead_dashboard em 29/07.
update public.targets
   set active = false,
       memoria = coalesce(memoria,'{}'::jsonb) || jsonb_build_object(
         'desativado_em','2026-08-06',
         'motivo','Congelado pelo corte de escopo do pos-clique (decisao do Ryan, 06/08/2026). Conversa e resultado que acontece DEPOIS do clique; o sistema passou a tratar so campanha, conjunto e criativo. Reativar exige decisao humana de voltar CTWA ao escopo.')
 where metric = 'custo_por_conversa' and active;

-- 4) o fato datado, que e o que faz isto ser congelamento e nao esquecimento
insert into public.agent_context (categoria, fato, vigente, desde, company_id)
select 'escopo',
'CORTE DE ESCOPO - POS-CLIQUE CONGELADO (decisao do Ryan, 06/08/2026). '
|| 'A REGUA: este sistema e de TRAFEGO PAGO e trata de TRES PILARES - campanha, conjunto e criativo/anuncio. '
|| 'FICA tudo que descreve o anuncio e a entrega dele: o que a peca diz, quem ela mira, custo por resultado, '
|| 'qual publico e qual genero convertem, qualidade do criativo, e o compliance DO ANUNCIO (CET, promessas '
|| 'proibidas, identificacao do anunciante, gate de segmentacao) - porque isso descreve o anuncio e e o que '
|| 'impede a conta de ser restringida. '
|| 'CONGELADO tudo que acontece DEPOIS DO CLIQUE: WhatsApp e WABA por inteiro (rotinas desativadas, dados '
|| 'preservados), atribuicao e a tabela proposals, LGPD de formulario, regras de pixel, dashboard da Legal e '
|| 'Viver, leads gerados no sistema deles, Banco V8 / V3 / qualquer banco, CAC, funil e verificacao de cliente. '
|| 'COMO SE COMPORTAR: se o gestor perguntar sobre qualquer tema congelado, NAO invente e NAO tente responder '
|| 'com dado velho - diga que saiu de escopo em 06/08 por decisao dele e que os dados foram preservados, nao '
|| 'apagados. NAO proponha card, alerta nem recomendacao sobre tema congelado. '
|| 'O QUE REATIVA: palavra do Ryan. Congelamento nao e apagamento - as tabelas waba_* seguem com o historico '
|| 'e as rotinas so precisam ser reagendadas.',
true, '2026-08-06', c.id
from public.companies c;