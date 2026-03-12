# Discord Bot on Supabase — Free Hosting Template

A free-to-use proof-of-concept for hosting Discord bots on Supabase Edge Functions. The template covers three LLM inference backends, a shared query cache, and Discord slash command routing — all within Supabase's free tier.

Originally built to answer WoW TBC questions in a Discord channel, but the pattern works for any topic you want to ground in web search. To the end user it's a single slash command (e.g. `/ask`).

**Gemini API pricing:** https://ai.google.dev/gemini-api/docs/pricing  
**Free OpenRouter models:** https://openrouter.ai/models?max_price=0

---

## Architecture

```
User types /ask in Discord
        │
        ▼
Discord API
        │  HTTP POST (slash command payload)
        ▼
discord-interactions  (Supabase Edge Function)
        │  verify signature, route by command name
        ▼
Handler Edge Function  (grounded-llm-inference / openrouter-*)
        │  call LLM, build response
        ▼
Discord API
        │
        ▼
Answer appears in channel
```

---

## Edge Functions

| Function | Description |
|----------|-------------|
| `discord-interactions` | Entry point. Verifies Discord signature, routes slash commands to handler functions. |
| `grounded-llm-inference` | Gemini 2.x with Google Search grounding + Supabase query cache. |
| `openrouter-llm-inference` | OpenRouter free-tier models without caching. |
| `openrouter-jina-inference` | OpenRouter free-tier models + Jina.ai web search grounding + Supabase query cache. |

### Slash command routing

Edit the `commandToFunction` map in `discord-interactions/index.ts` to add or remap commands:

```typescript
const commandToFunction: Record<string, string> = {
  ask: "grounded-llm-inference",
  openrouter: "openrouter-llm-inference",
  // add more here
};
```

---

## Project Structure

```
supabase/
  functions/
    _shared/
      discord.ts                        ← Ed25519 signature verification (shared)
    discord-interactions/
      index.ts                          ← Signature check + command router
    grounded-llm-inference/
      index.ts                          ← Gemini 2.x + Google Search grounding + cache
    openrouter-llm-inference/
      index.ts                          ← OpenRouter free models + cache
    openrouter-jina-inference/
      index.ts                          ← OpenRouter free models + Jina.ai grounding + cache
  migrations/
    20260311000000_create_query_cache.sql
README.md
```

---

## Prerequisites

All services have free tiers.

| Service | What you need | Where |
|---------|--------------|-------|
| **Discord** | Developer account | https://discord.com/developers |
| **Supabase** | Free project | https://supabase.com |
| **Google AI** | Gemini API key (if using Gemini) | https://aistudio.google.com/apikey |
| **OpenRouter** | API key (if using OpenRouter) | https://openrouter.ai |
| **Jina.ai** | API key (optional, but recommended if using Jina grounding) | https://jina.ai |

Local tooling:

- [Deno](https://deno.com/)
- [Supabase CLI](https://supabase.com/docs/guides/cli/getting-started) — `npm install -g supabase` or `brew install supabase/tap/supabase`
- [Git](https://git-scm.com/)

---

## Step 1 — Create a Discord Application

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications)
2. Click **New Application**, name it, and create it
3. On **General Information**, copy:
   - **Application ID** → `discord_application_id` secret
   - **Public Key** → `discord_public_key` secret
4. Go to **Bot**, click **Add Bot**
5. Under Token, click **Reset Token** and copy it (needed once for slash command registration)

### Add the bot to your server

1. Go to **OAuth2 → URL Generator**
2. Under **Scopes**: check `bot` and `applications.commands`
3. Under **Bot Permissions**: check `Send Messages` and `Use Slash Commands`
4. Copy the generated URL, open it in your browser, and add the bot to your server

---

## Step 2 — Get API Keys

**Gemini** (for `grounded-llm-inference`):
1. Go to [Google AI Studio](https://aistudio.google.com/apikey)
2. Click **Create API Key** → copy as `gemini_api_key`

**OpenRouter** (for `openrouter-llm-inference` or `openrouter-jina-inference`):
1. Sign up at [openrouter.ai](https://openrouter.ai)
2. Create an API key → copy as `openrouter_api_key`

**Jina.ai** (for `openrouter-jina-inference` only):
1. Sign up at [jina.ai](https://jina.ai)
2. Create a free API key → copy as `jina_api_key`

---

## Step 3 — Set Up Supabase

### Create the project

1. Go to [supabase.com](https://supabase.com), sign in, click **New Project**
2. Name the project, set a database password, choose a region
3. Note your **Project Reference** (e.g. `abcdefghijkl` from `https://abcdefghijkl.supabase.co`)

### Create the cache table

In the **SQL Editor**, run the contents of `supabase/migrations/20260311000000_create_query_cache.sql`:

```sql
create table if not exists query_cache (
  id                uuid primary key default gen_random_uuid(),
  query_normalized  text not null unique,
  query_original    text not null,
  response_text     text not null,
  created_at        timestamptz not null default now(),
  expires_at        timestamptz not null,
  hit_count         int not null default 0
);

create index if not exists idx_query_cache_lookup
  on query_cache (query_normalized, expires_at);

create index if not exists idx_query_cache_expires
  on query_cache (expires_at);

alter table query_cache enable row level security;

create policy "Allow all for service role" on query_cache
  for all using (true) with check (true);
```

### Add secrets

```bash
supabase secrets set \
  discord_public_key=YOUR_DISCORD_PUBLIC_KEY \
  discord_application_id=YOUR_DISCORD_APPLICATION_ID \
  gemini_api_key=YOUR_GEMINI_API_KEY \
  openrouter_api_key=YOUR_OPENROUTER_API_KEY \
  jina_api_key=YOUR_JINA_API_KEY
```

You can also set these in **Supabase Dashboard → Edge Functions → Secrets**.

> `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are provided automatically — do not add them.

---

## Step 4 — Deploy the Edge Functions

```bash
# Log in and link your project
supabase login
supabase link --project-ref YOUR_PROJECT_REF

# Deploy all functions
supabase functions deploy discord-interactions --no-verify-jwt
supabase functions deploy grounded-llm-inference --no-verify-jwt
supabase functions deploy openrouter-llm-inference --no-verify-jwt
supabase functions deploy openrouter-jina-inference --no-verify-jwt
```

> **⚠️ `--no-verify-jwt` is required.** Discord sends raw HTTP requests without Supabase auth tokens. Creating functions via the Supabase console enforces JWT and will result in a permanent 401 from Discord.

Your function URLs will follow the pattern:
```
https://YOUR_PROJECT_REF.supabase.co/functions/v1/FUNCTION_NAME
```

---

## Step 5 — Register the Slash Command

Run this once. Replace placeholders and choose your command name:

```bash
curl -X POST \
  -H "Content-Type: application/json" \
  -H "Authorization: Bot YOUR_BOT_TOKEN" \
  -d '{
    "name": "ask",
    "description": "Ask a question",
    "options": [{
      "name": "question",
      "description": "Your question",
      "type": 3,
      "required": true
    }]
  }' \
  "https://discord.com/api/v10/applications/YOUR_APPLICATION_ID/commands"
```

> **Tip:** For immediate availability during testing, register a guild-specific command:
> ```
> https://discord.com/api/v10/applications/YOUR_APPLICATION_ID/guilds/YOUR_GUILD_ID/commands
> ```
> Global commands can take up to an hour to propagate. In my testing they become available in 15-30min of time.

---

## Step 6 — Set the Interactions Endpoint URL

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications) → select your app
2. On **General Information**, find **Interactions Endpoint URL**
3. Enter your `discord-interactions` URL with the anon key as a query parameter:
   ```
   https://YOUR_PROJECT_REF.supabase.co/functions/v1/discord-interactions?apikey=YOUR_SUPABASE_ANON_KEY
   ```

> **Why `?apikey=...`?** Even with `--no-verify-jwt`, Supabase's API gateway requires an API key to route the request. Discord sends plain POST requests with no custom headers, so the key must be in the URL. The anon key is safe to expose — security comes from Discord's signature verification inside the function.
>
> Find it at: **Supabase Dashboard → Settings → API → Project API keys → Publishable key**

4. Click **Save Changes**

Discord will send a PING to verify. A successful deploy responds with PONG.

If verification fails:
- Confirm the function is deployed: `supabase functions list`
- Check `discord_public_key` is set correctly
- Confirm `--no-verify-jwt` was used
- Confirm the `apikey` query param matches your anon key

---

## Step 7 — Test It

These commands depend on your mapping, use whatever you've created.

```
/ask question: how do I deploy this bot?
/ask question: what is the best tank spec for TBC?
/ask question: how does the cache work?
```

- **First request:** "Bot is thinking…" while the LLM processes, then answer appears
- **Same question again:** instant response from cache

---

## How It Works

### Request flow

1. User runs a slash command in Discord
2. Discord sends an HTTP POST to `discord-interactions`
3. Function verifies the Ed25519 request signature using `discord_public_key`
4. Function routes to the appropriate inference function based on command name
5. Inference function checks `query_cache` for a matching (non-expired) answer
6. **Cache hit** → responds instantly (Discord interaction type 4)
7. **Cache miss** → defers with "Bot is thinking…" (type 5), then:
   - Optionally fetches web grounding context (Gemini Search / Jina.ai)
   - Calls LLM with system prompt + optional context
   - Saves the answer to cache (7-day TTL)
   - Edits the original deferred response with the answer

### Cache behaviour

- Queries are normalised (lowercase, trimmed, punctuation removed) before lookup
- TTL is 7 days (set `CACHE_TTL_HOURS` in each `index.ts`)
- `hit_count` tracks reuse per cached answer
- Upsert on `query_normalized` — re-asking after expiry refreshes the entry

---

## Customising the System Prompt

Edit the `SYSTEM_PROMPT` constant in whichever `index.ts` you're using, then redeploy that function.

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Discord says "Interactions Endpoint URL is invalid" | Confirm function is deployed with `--no-verify-jwt` and `discord_public_key` is correct |
| Bot responds "Please provide a question!" | Ensure you're using the `question:` option in the slash command |
| Bot says "Something went wrong" | Check logs: `supabase functions logs grounded-llm-inference` — likely a bad API key |
| Slash command doesn't appear | Global commands take up to an hour. Use guild commands for immediate testing |
| Cache never hits | Confirm `query_cache` table exists and RLS policy allows service role access |
| 401 on every Discord request | Function was deployed via Supabase console (enforces JWT) — redeploy via CLI with `--no-verify-jwt` |

---

## Optional: Clean Up Expired Cache

Run manually or schedule with `pg_cron`:

```sql
delete from query_cache where expires_at < now();
```

---

## License

Do whatever you want with this. It's a Discord bot, not a space shuttle.

Questions or cool stuff → julius.juutilainen@protonmail.com