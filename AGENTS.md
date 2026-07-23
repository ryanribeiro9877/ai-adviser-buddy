# AGENTS.md

Projeto **ai-adviser-buddy** ("Gestor de Tráfego IA") — app autônomo em
TanStack Start + React + Supabase (sem dependências de plataformas de build de terceiros).

- **Deploy:** Vercel — `https://ai-adviser-buddy.vercel.app`. O push na branch `main`
  dispara o build/deploy automático (Nitro autodetecta o preset `vercel`).
- **Git:** commitar direto na `main` (sem pedir autorização).
- **Manutenção:** alterações feitas via Claude Code.
- **Build local:** `bun run build` · **Dev:** `bun run dev` (porta 8080) ·
  **Typecheck:** `bunx tsc --noEmit`.
