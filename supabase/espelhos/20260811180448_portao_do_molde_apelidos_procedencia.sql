-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260811180448
-- name: portao_do_molde_apelidos_procedencia
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

comment on function public.avaliar_estado_destino_execucao(text, jsonb, uuid) is
'Avalia contrato_de_estado_execucao contra o estado observado do destino. 11/08/2026: as regras de molde declaram campo_destino=creative_id, mas pedido_de_anuncio_completo aceita o molde por tres apelidos (creative_id, molde, molde_creative_id). Pedido que nomeava o molde como molde caia em destino_ausente e PULAVA todas as regras de molde - o card saia completo=true sem portao. Observado com pedido de IMAGEM (meta_image_hash) apontando para molde de VIDEO 1011059938579189: devolvia completo=true; com a chave creative_id recusava molde_sem_link_data. Buraco antigo (valia igual para molde_expoe_video_data no caminho de video), perigoso so agora que o caminho de imagem esta no ar. Corrigido resolvendo os mesmos apelidos, na mesma ordem do pedido.';

insert into public.agent_context (company_id, categoria, fato, vigente)
select 'ded20b38-f42e-4c71-800c-31b97ea48bcf'::uuid,
       'criacao',
       'PORTAO DO MOLDE (11/08/2026): avaliar_estado_destino_execucao resolve o molde por creative_id, molde ou molde_creative_id - os mesmos apelidos que pedido_de_anuncio_completo aceita. Antes, pedido que dizia apenas molde pulava as regras de molde e o card saia completo=true sem portao. Provas: imagem+molde de video recusa molde_sem_link_data; video+molde de imagem recusa molde_sem_video_data; os dois formatos juntos recusam formatos_de_midia_conflitantes.',
       true
where not exists (
  select 1 from public.agent_context
   where company_id = 'ded20b38-f42e-4c71-800c-31b97ea48bcf'
     and fato like 'PORTAO DO MOLDE (11/08/2026):%'
     and vigente
);
