# EnglishCoach — project rules

- Read `docs/ARCHITECTURE.md` before changing anything; it holds the stack,
  ports, provider model and Telegram UX rules.
- Bun + TypeScript strict. Biome for lint/format. `bun test` for tests.
- Checks every PR must pass locally: `bun run lint`, `bun run typecheck`, `bun test`.
- All repository text (code, comments, commits, PRs, issues) in English.
- **Never add Claude attribution** to commits or PRs: no `Co-Authored-By: Claude …`,
  no `Claude-Session:` trailer, no "Generated with Claude Code" footer.
- Never log or echo user API keys or `MASTER_KEY`. Secrets are encrypted at rest.
- The LLM returns JSON validated by zod; server code owns all state changes
  (FSRS, scores, streaks). Never let model output write to the DB unvalidated.
- Every bot message sent inside a session must go through the session message
  tracker so cleanup can delete it.
- User-facing strings go through i18n (`ru`, `en`, `uk`) — no hardcoded UI text.
