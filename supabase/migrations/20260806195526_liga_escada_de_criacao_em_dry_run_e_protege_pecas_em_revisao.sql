-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260806195526
-- name: liga_escada_de_criacao_em_dry_run_e_protege_pecas_em_revisao
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

-- LIGA A ESCADA DE CRIACAO, em dry_run, e protege as pecas sob revisao.
--
-- DECISAO DO RYAN (06/08/2026): ligar as flags para testar a criacao na pratica.
--
-- O QUE ESTA MUDANCA FAZ: liga criar_conjunto_a_partir_de, criar_anuncio_a_partir_de e
-- upload_midia, E liga dry_run junto. Com dry_run a corrente inteira roda - proposta, travas,
-- compliance, montagem, card, aprovacao, gatilho e execucao - e NADA e persistido na Meta. A
-- execucao registra o que faria.
--
-- POR QUE dry_run JUNTO E NAO DEPOIS: e o ritual que este projeto ja estabeleceu para primeira
-- escrita, e aqui ele vale mais do que de costume por tres motivos abertos:
--   1. As oito funcoes do bloco de midia AINDA NAO CHEGAM ao agente. Ele julga pela regua velha
--      de R$ 2,30 - provado no PO-04 da rodada de perguntas-ouro de hoje.
--   2. pedido_de_anuncio_completo falhou TRES vezes em ser completa, porque a lista de campos foi
--      escrita por deducao e nao derivada do codigo que executa. Nao foi consertada.
--   3. A montagem roda ANTES da trava (inversao estrutural ja registrada), entao o primeiro card
--      de anuncio e tambem o primeiro teste dessa ordem.
-- Com dry_run, os tres viram observacao em vez de incidente.
--
-- O QUE EU NAO LIGUEI, e e deliberado: pausar_campanha, pausar_criativo e alterar_orcamento. O
-- pedido foi testar CRIACAO, e essas tres nao participam disso - ligariam risco sem servir ao
-- teste. Alem disso a arvore de decisao acabou de concluir que os tres conjuntos que entregam NAO
-- devem ser pausados, e o motor de alertas foi reconciliado hoje para dizer isso. Ligar pausa no
-- mesmo dia seria abrir a porta que a doutrina acabou de fechar. E uma palavra do Ryan para ligar.
--
-- PECAS EM REVISAO PASSAM A BLOQUEAR: os 5 videos que citam valor, parcela e prazo sem CET estao
-- liberados e na biblioteca. Com criacao de anuncio ligada, nada impedia um card usar o video 22.
-- bloqueia_uso vira true ate o veredito do Roberto. E reversivel com um update.

update public.meta_execution_config
   set action_flags = action_flags
         || jsonb_build_object('criar_conjunto_a_partir_de', true)
         || jsonb_build_object('criar_anuncio_a_partir_de', true)
         || jsonb_build_object('upload_midia', true),
       dry_run = true
 where company_id = 'ded20b38-f42e-4c71-800c-31b97ea48bcf';

update public.pecas_em_revisao
   set bloqueia_uso = true
 where veredito is null;

insert into public.agent_context (categoria, fato, vigente, desde, company_id)
values ('execucao',
'ESCADA DE CRIACAO LIGADA EM MODO DE SIMULACAO (06/08/2026, decisao do Ryan). '
|| 'Estao ligadas: criar_campanha, criar_conjunto_a_partir_de, criar_anuncio_a_partir_de e upload_midia. '
|| 'dry_run esta LIGADO: card aprovado NAO cria nada na Meta - a execucao registra o que faria. '
|| 'DECLARE ISSO AO GESTOR EM TODO CARD, antes de ele decidir: aprovar agora nao produz objeto. '
|| 'NAO estao ligadas pausar_campanha, pausar_criativo nem alterar_orcamento - o teste e de CRIACAO. '
|| 'AS 5 PECAS EM REVISAO DE COMPLIANCE PASSARAM A BLOQUEAR USO: videos 22, 23, 25, 26 e 27 citam '
|| 'valor, parcela e prazo sem CET e estao aguardando veredito do Roberto. Pedido de anuncio com '
|| 'qualquer uma delas e IMPEDIMENTO, nao ressalva. '
|| 'CUIDADO CONHECIDO: o bloco de funcoes de midia (teto_vigente, decidir_sobre_conjunto, '
|| 'avaliar_escala, diagnosticar_custo, avaliar_fadiga, pode_pausar_por_custo, avaliar_pacing) ainda '
|| 'pode nao estar exposto como ferramenta. Se voce nao conseguir chamar teto_vigente, NAO julgue '
|| 'custo pela regua de R$ 2,30 de targets - declare que a regua de negocio e R$ 1,60 decidida pelo '
|| 'Roberto em 30/07 e que voce nao tem a ferramenta para confirmar.',
true, '2026-08-06', 'ded20b38-f42e-4c71-800c-31b97ea48bcf');
