-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260806184634
-- name: esp15_ctr_saudavel_e_referencia_nao_limiar
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

-- ESP-15 ajuste · a faixa de CTR saudavel sai da tabela de limiares.
--
-- DECISAO DO RYAN (06/08/2026): trazer o parametro e NAO estabelecer teto.
--
-- O QUE EU FIZ DE ERRADO NA FORMA: gravei a faixa de 4 a 8% como linha de limiares_de_midia, com
-- operador '>' e valor 4. Mesmo com acao_prescrita "nenhuma" e denominador_incerto true, a FORMA
-- dela e de teto. Quem consultar a tabela depois encontra uma linha que estruturalmente parece
-- limiar, e limiar e coisa que prescreve. Tabela de limiares guarda limiar; referencia nao e
-- limiar e nao deve morar la.
--
-- ONDE PASSA A MORAR: em agent_context, como parametro de referencia declarado. E doutrina, nao
-- regra de decisao - e doutrina neste projeto vive no banco e se corrige sem deploy.
--
-- E CONTINUA SEM DENOMINADOR: o contrato cita 4 a 8% para credito no Brasil e nao diz se mede
-- clique no link ou todos os cliques. A conta opera de 3,1% a 4,9% de CTR de LINK. Sem o
-- denominador os dois numeros nao se comparam, e por isso a referencia entra proibida de virar
-- veredito - nem para dizer que a conta esta bem, nem para dizer que esta mal.

update public.limiares_de_midia
   set vigente = false
 where metrica = 'ctr_link' and tipo = 'absoluto' and operador = '>' and denominador_incerto;

insert into public.agent_context (categoria, fato, vigente, desde, company_id)
select 'midia',
'CTR SAUDAVEL EM CREDITO - PARAMETRO DE REFERENCIA, NAO TETO (registrado em 06/08/2026 por decisao do Ryan). '
|| 'O contrato do gestor cita faixa de 4 a 8% como CTR saudavel para credito no Brasil. '
|| 'ISTO E REFERENCIA E NAO PRESCREVE NADA. Nao existe teto de CTR neste sistema, e nao ha acao '
|| 'associada a esta faixa - nem pausar, nem escalar, nem alertar. '
|| 'POR QUE NAO PRESCREVE: o contrato nao declara o DENOMINADOR. Nao se sabe se a faixa mede clique '
|| 'no link ou todos os cliques. A conta opera hoje entre 3,1% e 4,9% de CTR de LINK. Se a faixa do '
|| 'contrato for de todos os cliques, os dois numeros nao se comparam. '
|| 'COMO USAR: pode ser citada como contexto de mercado, sempre dizendo que o denominador nao esta '
|| 'declarado. NAO usar para afirmar que a conta esta boa nem que esta ruim, e NAO derivar acao dela. '
|| 'O que prescreve acao sobre CTR e outra coisa e esta em limiares_de_midia: o minimo absoluto de '
|| '0,8% com piso de gasto, e a queda relativa de 25% contra a media de 3 dias. Esses dois tem '
|| 'denominador declarado (clique no link sobre impressoes).',
true, '2026-08-06', c.id
from public.companies c;