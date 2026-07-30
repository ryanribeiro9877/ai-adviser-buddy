-- [F5.3 alicerce] Flag de execução para a CRIAÇÃO de templates (desligada nas 2 empresas).
-- Mesmo padrão de governança das demais ações: master + flag específica + dry_run.
-- A edge de criação (waba-template-create, a construir no padrão da replicate) só executa
-- com as três camadas abertas — nascer com a flag já existente e OFF evita o singleton/
-- default-aberto de sempre.

update meta_execution_config
   set action_flags = jsonb_set(action_flags, '{criar_template}', 'false'::jsonb, true);
