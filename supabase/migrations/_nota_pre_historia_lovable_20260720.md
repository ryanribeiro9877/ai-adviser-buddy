# Pré-história Lovable (20/07) — fora de schema_migrations

Três arquivos em `supabase/migrations/` com nome de UUID existem no repo
mas **não** estão em `supabase_migrations.schema_migrations` do projeto
`gzjwnjdpxpbmdhcyefvs`:

- `20260720141447_7c4be527-92d9-4f55-add1-c988f898acf4.sql`
- `20260720141506_49cb2f3b-8425-4f03-bc34-b9e861e258d6.sql`
- `20260720142808_95a081ad-f96d-415c-8234-1ffab2c7d1a5.sql`

São bootstrap do Lovable, anteriores ao momento em que a trilha passou a
registrar versões em `schema_migrations`. Os objetos que criam (enums,
`profiles`, etc.) já existem em produção via a cadeia posterior
(`20260720182610_initial_schema` e seguintes).

**Não reconstruir trilha para eles.** Não aplicar, não espelhar via RPC
(a RPC não os devolve — não estão na tabela), não movê-los. Ficam no repo
só como artefato histórico do bootstrap; a fonte de verdade do que o
banco tem é `schema_migrations` + `supabase/espelhos/`.
