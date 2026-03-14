# Discord Bot + Supabase Template

Template repo for deploying a Discord slash-command bot with Supabase Edge Functions as backend.

Actual code documented in [supabase/README.md](supabase/README.md).

---

## What's included?

- A Discord interactions entrypoint (`discord-interactions`) for signature verification and command routing
- Instructions on how to set the whole thing up

I can't include imagination or creativity here. You're going to have to cough it up yourself.

In /supabase/ there are other edge-functions you can just deploy and use if you'd like something easy. They are a product of me trying out stuff. You will need secrets, reference the other README.

---

## High-level setup

1. **Create Discord app + bot**
   - Create an application in Discord Developer Portal
   - Add a bot to it
   - Keep these values: `Application ID`, `Public Key`, `bot token`

   You could do step 5 right after if you know what you're doing.

2. **Create Supabase project**
   - Create a new project in Supabase
   - Note your `project-ref`

3. **Set required secrets**
   - `discord_public_key`
   - `discord_application_id`
   - `discord_bot_token`
   - Add provider secrets as needed (details in [supabase/README.md](supabase/README.md))

```bash
supabase secrets set \
    discord_public_key=YOUR_DISCORD_PUBLIC_KEY \
    discord_application_id=YOUR_DISCORD_APPLICATION_ID \
    discord_bot_token=YOUR_DISCORD_BOT_TOKEN
```

4. **Deploy functions**
   - Start with deploying `discord-interactions`
   - Then deploy only the handler functions you actually map and use
   - Use Supabase CLI directly

```supabase functions deploy discord-interactions --no-verify-jwt```
or if with npm
```npx supabase functions deploy discord-interactions --no-verify-jwt```
Just replace the 'discord-interactions' with your folder name.

5. **Register slash commands**
   - Register commands in Discord API
   - Make command names match your `commandToFunction` map in `discord-interactions`

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

6. **Set Discord Interactions Endpoint URL**
   - Go get the endpoint for 'discord-interactions' from supabase
   - Point discord to `discord-interactions` function URL
   - Include `?apikey=<SUPABASE_ANON_KEY>` query parameter. This can be found in supabase console under project settings -> api keys -> publishable keys


## It doesn't fucking work?!?!
You didn't deploy from cli with --no-verify-jwt. Delete edge functions and deploy as described.

---

## Scripts

- Windows deploy script: `scripts\deploy.bat`
- macOS/Linux deploy script: `scripts/deploy.sh`
- Both deploy scripts expect a `.env` file in the repository root and will read secret values from it.