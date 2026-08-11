-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260811182604
-- name: imagem_reprovada_em_revisao_fecha_furo_do_hash
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

-- Fecha o furo do objetivo 2 tambem para IMAGEM: registra em revisao (fail-closed) uma peca de
-- imagem reprovada na leitura visual, agora que a imagem existe na biblioteca da conta
-- (upload-midia -> Graph /adimages, meta_image_hash conhecido em media_uploads). Sem esta linha,
-- peca_bloqueada_por_revisao resolvia o hash e devolvia peca_identificada=true, bloqueada=false:
-- o guardiao reconhecia a peca mas nao tinha o que bloquear. Ate 11/08 pecas_em_revisao so tinha
-- os 5 VIDEOS de FIN-04; nenhuma IMAGEM estava em revisao. A peca abaixo (08 Carrossel -
-- Financiamento3.png) foi reprovada (aproveitavel=nao) com risco de dar a entender APROVACAO sem
-- ressalva visivel de analise de credito - risco regulatorio, distinto de estar fora do universo
-- (off-brand liberado em 31/07). Mesmo padrao do ESP-07: nota declara e o portao bloqueia; veredito
-- e do responsavel (veredito=null = aguardando). evidencia DERIVADA da propria analise, nao
-- transcrita a mao.
insert into public.pecas_em_revisao
  (company_id, drive_file_id, nome, motivo, regra_code, evidencia, bloqueia_uso, aberto_por)
select d.company_id, d.drive_file_id, coalesce(d.nome, '08 Carrossel - Financiamento3.png'),
  'Leitura visual de compliance reprovou a peca (aproveitavel=nao) com risco de dar a entender APROVACAO sem ressalva visivel de analise de credito. Registrada EM REVISAO (fail-closed) agora que a imagem foi enviada a biblioteca da conta (upload-midia/adimages) e o hash e conhecido em media_uploads (meta_image_hash b427c1cefdeaa8a9fc98912329da0711): sem este registro o guardiao reconheceria a peca pelo hash mas nao teria o que bloquear. Aguarda veredito do responsavel; sem veredito nao vai para anuncio.',
  null,
  d.riscos_compliance,
  true,
  'Claude via upload-midia (peca de imagem reprovada na leitura visual)'
from public.drive_midia_analises d
where d.company_id = 'ded20b38-f42e-4c71-800c-31b97ea48bcf'
  and d.drive_file_id = '1SB0eqdTJsCPYpnwtBUa6b3cWzR8CR2ml'
  and d.aproveitavel = 'nao'
order by d.analisado_em desc
limit 1
on conflict (company_id, drive_file_id, aberto_em) do nothing;
