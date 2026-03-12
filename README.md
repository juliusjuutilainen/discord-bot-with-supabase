# Discord bot using supabase as a free hosting platform.

The purpose of this repo is to serve as a free-to-use POC on hosting Siscord bots on Supabase. Supabase is a postgres development platform, more here (github.com/supabase/supabase).

My template is for creating a simple bot that uses Gemini's generous free tier LLM inference to reference the web and answer a user question. Gemini API pricing guide (https://ai.google.dev/gemini-api/docs/pricing).
But you could use this same guide for pretty much anything a discord bot would like to do, as long as it's within Supabase edge function runtime limits. In my case, I wanted a bot to answer WoW TBC related questions straight in channel. To the end user it's just a single HTTP endpoint that Discord calls when someone uses a slash command (for example, `/ask`).

## Architecture for my usecase

```
User runs /ask in Discord
        │
        ▼
Discord sends HTTP POST ──▶ Supabase Edge Function
                                    │
                            ┌───────┴───────┐
                            │  Cache hit?   │
                            └───┬───────┬───┘
                              yes       no
                               │         │
                               │    Gemini 2.0 Flash (or your setup)
                               │    (Google Search grounding)
                               │         │
                               │    Save to cache
                               │         │
                               └────┬────┘
                                    │
                                    ▼
                            Discord response
```

## Prerequisites

You need accounts and API keys from three services. All have free tiers.

| Service | What you need | Where to get it |
|---------|--------------|-----------------|
| **Discord** | Developer account | https://discord.com/developers |
| **Supabase** | Project (free plan) | https://supabase.com |
For AI
| **Google AI** | Gemini API key | https://aistudio.google.com/apikey |

Alternatively look into https://openrouter.ai/models?max_price=0 for free to use LLM's via API.

Local tooling:

- [Deno](https://deno.com/) 
- [Supabase CLI](https://supabase.com/docs/guides/cli/getting-started) — install with `npm install -g supabase` or `brew install supabase/tap/supabase`
- [Git](https://git-scm.com/)

---

## Step 1 — Create a Discord Application

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications)
2. Click **New Application**, give it a name (e.g. "Q&A Bot"), and create it
3. On the **General Information** page, note down:
   - **Application ID** (you'll need this as `discord_application_id`)
   - **Public Key** (you'll need this as `discord_public_key`)
4. Go to the **Bot** section in the sidebar
5. Click **Add Bot** (if there isn't one already)
6. Under the bot's Token section, click **Reset Token** and copy it — you'll need this once to register the slash command. Also note it down for later ref.


### Add the bot to your Discord server

1. Go to **OAuth2 → URL Generator** in the sidebar
2. Under **Scopes**, check:
   - `bot`
   - `applications.commands`
3. Under **Bot Permissions**, check:
   - `Send Messages`
   - `Use Slash Commands`
4. Copy the generated URL at the bottom, open it in your browser, and select the server you want to add the bot to

If you want to build more powerful features, you should select the applicable scopes. It's not uncommong that discord bots need aministrator because developers are lazy - but that would never be me.

---

## Step 2 (if you want to use Gemini) — Get a Gemini API Key

1. Go to [Google AI Studio](https://aistudio.google.com/apikey)
2. Click **Create API Key**
3. Copy the key — you'll need this as `gemini_api_key`

---

## Step 3 — Set Up Supabase

### Create the project

1. Go to [supabase.com](https://supabase.com) and sign in
2. Click **New Project**
3. Pick an organization, name the project, set a database password, and choose a region
4. Wait for the project to finish provisioning
5. Note your **Project Reference** (the subdomain in your project URL, e.g. `abcdefghijkl` from `https://abcdefghijkl.supabase.co`)

### Create the cache table

Go to the **SQL Editor** in your Supabase dashboard and run the contents of `supabase/migrations/20260311000000_create_query_cache.sql`:
sql is in migrations dir. 

### Add secrets

Set your custom secrets via the Supabase CLI:

```bash
supabase secrets set \
  discord_public_key=YOUR_DISCORD_PUBLIC_KEY \
  discord_application_id=YOUR_DISCORD_APPLICATION_ID \
  gemini_api_key=YOUR_GEMINI_API_KEY
```

> **Note:** `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are provided automatically by Supabase — you do **not** need to add them.
You can do this in supabase console as well, in the section for edge functions.
---

## Step 4 — Deploy the Edge Functions

### Link your local project

```bash
# Log in to Supabase CLI (opens browser)
supabase login

# Link to your remote project
supabase link --project-ref YOUR_PROJECT_REF
```

### Deploy

```bash
supabase functions deploy discord-interactions --no-verify-jwt
supabase functions deploy grounded-llm-inference --no-verify-jwt
supabase functions deploy openrouter-llm-inference --no-verify-jwt
```

The `--no-verify-jwt` flag is required because Discord sends raw HTTP requests — not Supabase auth tokens.

After deploying, your function URL will be:

```
https://YOUR_PROJECT_REF.supabase.co/functions/v1/grounded-llm-inference
```
NOTE: YOU NEED TO DO IT THIS WAY. CREATING A FUNCTION IN SUPABASE CONSOLE WILL ENFOCE JWT AND CAUSE A PERMANENT 401 CODE ON THE FUNCTION FROM CALLS FROM DISCORD.
---

## Step 5 — Register the Slash Command

Run this once from your terminal. Replace `YOUR_BOT_TOKEN` and `YOUR_APPLICATION_ID`, and choose your own command name (for example, `ask`):

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

You should get a JSON response with the command details. Global commands can take up to an hour to propagate to all servers.

> **Tip:** For faster testing, register a guild-specific command instead by changing the URL to:
> `https://discord.com/api/v10/applications/YOUR_APPLICATION_ID/guilds/YOUR_GUILD_ID/commands`
> Guild commands are available immediately.

---

## Step 6 — Set the Interactions Endpoint URL

1. Go back to the [Discord Developer Portal](https://discord.com/developers/applications)
2. Select your application
3. On the **General Information** page, find **Interactions Endpoint URL**
4. Enter your `discord-interactions` Edge Function URL **with the anon key as a query parameter**:
   ```
   https://YOUR_PROJECT_REF.supabase.co/functions/v1/discord-interactions?apikey=YOUR_SUPABASE_ANON_KEY
   ```
   > **Why the `apikey`?** Even with `--no-verify-jwt`, Supabase's API gateway still
   > requires an API key to route the request. Discord sends plain POST requests with
   > no custom headers, so without the key in the URL, the gateway rejects the request
   > before it ever reaches your function. The anon key is designed to be public
   > (it's used in frontends), so this is safe — your real security comes from
   > Discord's signature verification inside the function.
   >
   > Find the publishable key in **Supabase Dashboard → Settings → API → Project API keys → Publishable key** (also called the anon key).
5. Click **Save Changes**

Discord will send a PING to verify the endpoint. If the function is deployed correctly, it will respond with PONG and Discord will accept the URL.

If it fails, check:
- The function is deployed (`supabase functions list`)
- The `discord_public_key` secret is correct
- The `--no-verify-jwt` flag was used during deploy
- The `apikey` query parameter in the URL matches your Supabase publishable key

---

## Step 7 — Test It

Go to your Discord server and try (assuming you named your command `ask`):

```
/ask question: how do I deploy this bot?
/ask question: what environment variables does this bot need?
/ask question: how does the cache work?
```

- First time: you'll see "Bot is thinking…" while Gemini processes, then the answer appears
- Second time (same question): instant response from cache

---

## Project Structure

```
supabase/
  functions/
    grounded-llm-inference/            ← Supabase Edge Function
      index.ts              ← main handler & logic
  migrations/
    20260311000000_create_query_cache.sql  ← cache table
README.md
```

---

## Customizing the System Prompt
Edit the system prompt in function code, redeploy. 

---

## How It Works

### Request flow

1. User types `/ask question: <text>` in Discord
2. Discord sends an HTTP POST to your Edge Function
3. Function verifies the request signature (Ed25519 using the public key)
4. Function checks the `query_cache` table for a cached answer
5. **Cache hit** → responds instantly (Discord interaction type 4)
6. **Cache miss** → responds with "Bot is thinking…" (type 5 — deferred), then:
   - Calls Gemini 2.0 Flash with Google Search grounding
   - Saves the answer to cache (7-day TTL)
   - Edits the original Discord response with the answer

### Secrets reference

| Secret | Auto-provided | Description |
|--------|:---:|-------------|
| `SUPABASE_URL` | ✅ | Your project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | Bypasses RLS for DB access |
| `discord_public_key` | ❌ | For signature verification |
| `discord_application_id` | ❌ | For Discord webhook URLs |
| `gemini_api_key` | ❌ | For Gemini API calls |

### Cache behavior

- Queries are normalized (lowercase, trimmed, punctuation removed) before lookup
- Cache TTL is 7 days (configurable via `CACHE_TTL_HOURS` in `index.ts`)
- `hit_count` tracks how often each cached answer is reused
- Cache uses upsert on `query_normalized` — re-asking after expiry refreshes the entry

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Discord says "Interactions Endpoint URL is invalid" | Check that the function is deployed with `--no-verify-jwt` and `discord_public_key` is correct |
| Bot responds with "Please provide a question!" | Make sure you're using the `question:` option — type `/tbc` and wait for the autocomplete |
| Bot says "Something went wrong" | Check Edge Function logs: `supabase functions logs grounded-llm-inference` — likely a bad `gemini_api_key` |
| Slash command doesn't appear in Discord | Global commands take up to an hour. Use a guild command for instant testing |
| Cache never hits | Check that the `query_cache` table exists and RLS is disabled (or you're using the service role key) |

---

## Free Tier Limits

| Service | Limit | Enough for |
|---------|-------|-----------|
| **Supabase Edge Functions** | 500K invocations/month, 150s wall-clock, 256MB memory | Plenty for a Discord bot |
| **Supabase Postgres** | 500MB database | Thousands of cached queries |
| **Gemini API (free)** | 15 RPM / 1M TPM | Light-to-moderate usage; cache reduces calls |
| **Discord** | No hard limit on interactions | N/A |

---

## Optional: Clean Up Expired Cache

You can periodically delete expired rows to keep the table tidy. Run this manually or set up a Supabase cron job (pg_cron):

```sql
delete from query_cache where expires_at < now();
```

---

## License

Do whatever you want with this. It’s a Discord bot, not a space shuttle.


Oh yeah and for any cool shit you can email me at julius.juutilainen@protonmail.com
