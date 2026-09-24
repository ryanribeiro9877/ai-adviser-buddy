-- Pasta Drive "09. Setembro" compartilhada com a conta de servico em 24/09/2026.
-- Irma de "08. Agosto" (La Felicita). Sem este registro a varredura nao entra nela.

INSERT INTO public.drive_pastas_monitoradas
  (company_id, folder_id, nome, descricao, meio, declarado_por, declarado_em)
VALUES
  ('57f755b9-c23d-4f58-a488-8173d697c010', '1Og4w_cXyZFo-uwv7N8guaTvT4jnyUApJ',
   'COHAPM La Felicità · 09. Setembro',
   'Acervo La Felicita (pasta Drive "09. Setembro"). Compartilhada com a SA em 24/09/2026. NAO misturar com Juridico nem Sistema Ocular.',
   'la_felicita', 'registro 24/09/2026', current_date)
ON CONFLICT (company_id, folder_id) DO UPDATE SET
  nome = EXCLUDED.nome,
  descricao = EXCLUDED.descricao,
  meio = EXCLUDED.meio,
  ativo = true;
