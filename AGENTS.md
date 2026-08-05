# AGENTS.md

Projeto **ai-adviser-buddy** ("Gestor de Tráfego IA") — app autônomo em
TanStack Start + React + Supabase (sem dependências de plataformas de build de terceiros).

- **Deploy:** Vercel — `https://ai-adviser-buddy.vercel.app`. O push na branch `main`
  dispara o build/deploy automático (Nitro autodetecta o preset `vercel`).
- **Git:** sempre commitar e dar push direto na `main` (sem pedir autorização,
  sem branch/PR). Alteração concluída = commit + push, não só disco local.
- **Supabase:** após alterar Edge Function ou SQL, sempre redeploy/aplicar no
  projeto `gzjwnjdpxpbmdhcyefvs`. Edge: `supabase functions deploy <nome>
  --project-ref gzjwnjdpxpbmdhcyefvs` (obrigatório — o `config.toml` aponta para
  outro ref). Conferir `functions list` (version + sha) depois.
- **Manutenção:** alterações feitas via Claude Code / Cursor.
- **Build local:** `bun run build` · **Dev:** `bun run dev` (porta 8080) ·
  **Typecheck:** `bunx tsc --noEmit`.
