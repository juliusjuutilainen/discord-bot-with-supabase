I just generated this so just bear that in mind. I'm too poor to pay for good AI so let's just deal with it.

# Supabase Backend Reference

This folder contains the Supabase backend for the template:

- Edge functions for Discord interaction handling and example bot behaviors
- SQL migration(s) for backend data structures (cache table)

At the repository root, [README.md](../README.md) intentionally stays high-level.

---

## Folder structure

```
supabase/
  functions/
    _shared/
      discord.ts
    discord-interactions/
      index.ts
    gemini-grounded-llm-inference/
      index.ts
    grounded-llm-inference/
      index.ts
    openrouter-llm-inference/
      index.ts
    settle-this/
      index.ts
  migrations/
    20260311000000_create_query_cache.sql
```

---

## Edge functions (reference implementations)

These are examples you can keep, modify, or remove.

| Function | Role | Typical command |
|---|---|---|
| `discord-interactions` | Public Discord endpoint. Verifies Ed25519 signature and routes by command name. | n/a (entrypoint) |
| `grounded-llm-inference` | OpenRouter inference with query cache support. Jina for grounding. | `/ask-openrouter` |
| `gemini-grounded-llm-inference` | Alternate Gemini-based grounded inference implementation. | `/ask` |
| `openrouter-llm-inference` | OpenRouter inference implementation. | `/openrouter` |
| `settle-this` | Reads recent channel messages and returns a neutral verdict. | `/settlethis` |

---

## Command routing

Routing lives in [functions/discord-interactions/index.ts](functions/discord-interactions/index.ts).

Start here first. `discord-interactions` is the central entrypoint: it verifies Discord signatures and controls which handler function each slash command invokes.

Update `commandToFunction` to decide which handler each slash command calls.

---

## Secrets

Common Discord secrets:

- `discord_public_key`
- `discord_application_id`
- `discord_bot_token`

Provider-specific secrets (depending on which functions you deploy/use):

- `gemini_api_key`
- `openrouter_api_key`
- `jina_api_key`

Supabase runtime secrets are injected automatically:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

---

## Migration

Run [migrations/20260311000000_create_query_cache.sql](migrations/20260311000000_create_query_cache.sql) before using cache-enabled handlers.

---

## Deploy notes

- Deploy Discord-facing functions with `--no-verify-jwt`
- Set Discord Interactions Endpoint URL to your `discord-interactions` function URL
- Include `?apikey=<SUPABASE_ANON_KEY>` in that endpoint URL

You can deploy only the functions you actively route to.