-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260805181558
-- name: gt17_registra_relatorio_deterministico_como_zero_verificavel
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

-- GT-17 ajuste · o unico preco que eu posso registrar sem inventar numero.
--
-- 'relatorio-deterministico' aparece em chat_messages.model com 14 chamadas e ZERO tokens
-- em todas: e o relatorio diario montado por SQL, nao chamada de LLM. Deixa-lo sem preco
-- inflava 'chamadas_sem_preco' de 124 para 138 e sugeria lacuna onde nao ha.
-- Preco zero aqui NAO e chute: zero token vezes qualquer preco e zero, e isso e verificavel
-- na propria tabela. Fonte declarada, como manda a coluna.
--
-- Os precos que faltam - anthropic/claude-opus-4.8, claude-sonnet-5, claude-sonnet-4.5 -
-- EU NAO SEI e nao vou preencher. Tem de ser lido do painel do OpenRouter pelo Ryan.

insert into public.model_prices
  (model, moeda, preco_in_por_milhao, preco_out_por_milhao,
   preco_cache_read_por_milhao, preco_cache_write_por_milhao,
   vigente_de, fonte)
values
  ('relatorio-deterministico', 'USD', 0, 0, 0, 0, '2026-01-01',
   'Nao e chamada de LLM: relatorio diario montado em SQL. Zero tokens em 100% das 14 ocorrencias medidas em 05/08/2026 - zero verificavel, nao estimado.')
on conflict (model, vigente_de) do nothing;