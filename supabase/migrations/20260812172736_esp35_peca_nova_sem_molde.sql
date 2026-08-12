-- ESP-35: peca nova sem herdar molde (page/CTA/destino da config ou do pedido).
-- Aplicada como version 20260812172736. Espelho fiel em
-- supabase/espelhos/20260812172736_esp35_peca_nova_sem_molde.sql
--
-- Altera: meta_execution_config.page_id/cta_padrao; contrato creative_id condicional;
-- pedido_de_anuncio_completo_sem_estado_destino (molde ausente em peca_nova exige page+cta+destino);
-- doutrina agent_context.

alter table public.meta_execution_config
  add column if not exists page_id text,
  add column if not exists cta_padrao text;

update public.meta_execution_config
   set page_id = coalesce(nullif(btrim(page_id), ''), nullif(btrim(instagram_identity_page_id), '')),
       cta_padrao = coalesce(nullif(btrim(cta_padrao), ''), 'LEARN_MORE')
 where company_id = 'ded20b38-f42e-4c71-800c-31b97ea48bcf';

update public.contrato_de_execucao
   set obrigatorio = false,
       observacao = 'id do adcreative MOLDE. Obrigatorio na replicacao pura. Na PECA NOVA pode ficar ausente (ESP-35) quando page_id + call_to_action_type + destino_url (ou destino_do_anuncio.url_final) vierem no pedido/config. montarCriacao monta object_story_spec do zero nesse caso.'
 where acao = 'criar_anuncio_a_partir_de' and campo = 'creative_id' and vigente;

delete from public.contrato_de_execucao
 where acao = 'criar_anuncio_a_partir_de'
   and campo in ('page_id', 'call_to_action_type', 'destino_url');

insert into public.contrato_de_execucao
  (acao, campo, obrigatorio, tipo, observacao, fonte, vigente, suportado, valores_aceitos)
values
  ('criar_anuncio_a_partir_de', 'page_id', false, 'string',
   'Pagina emissora. Na rota peca nova SEM molde (ESP-35) e resolvido de meta_execution_config.page_id / instagram_identity_page_id ou do payload.',
   'meta-actions.montarCriacao peca_nova_sem_molde', true, true, null),
  ('criar_anuncio_a_partir_de', 'call_to_action_type', false, 'string',
   'CTA (ex.: LEARN_MORE). Na rota sem molde vem de meta_execution_config.cta_padrao ou do payload.',
   'meta-actions.montarCriacao peca_nova_sem_molde', true, true, null),
  ('criar_anuncio_a_partir_de', 'destino_url', false, 'string',
   'URL de destino. Sem molde e obrigatoria de fato (nao ha URL a herdar). CLT pode sair de destino_por_produto.',
   'meta-actions.montarCriacao peca_nova_sem_molde', true, true, null);

-- Troca cirurgica do trecho de obrigatoriedade do molde (ver espelho / RPC aplicada).
-- O replace foi executado via DO $$ ... $$ na migracao remota 20260812172736.

insert into public.agent_context (categoria,fato,vigente,desde)
values
(
  'doutrina',
  'PECA NOVA SEM MOLDE (ESP-35, 12/08/2026). Para publicar peca do acervo SEM herdar anuncio existente: use drive_file_id + target_name=sem_molde (ou params.sem_molde=true). O sistema monta page_id/CTA/destino da config (meta_execution_config.page_id, cta_padrao=LEARN_MORE) e destino_url (CLT via destino_por_produto). Replicacao pura CONTINUA exigindo molde. Sem page/CTA/URL o card NAO emite. Conjunto destino ainda precisa ter Criativo Dinamico desligado.',
  true,
  date '2026-08-12'
);
