// supabase/functions/openrouter-llm-inference/index.ts
// Simple LLM inference via OpenRouter free tier, with Supabase query caching.
// Register the /ask-or (or any) slash command and map it in discord-interactions/index.ts.

import { createClient } from "npm:@supabase/supabase-js@2";

// ─── Environment ─────────────────────────────────────────────────────────────
const DISCORD_APP_ID = Deno.env.get("discord_application_id")!;
const OPENROUTER_API_KEY = Deno.env.get("openrouter_api_key")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ─── Constants ───────────────────────────────────────────────────────────────
const DISCORD_MAX_LENGTH = 2000;
const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";

// ─── Model fallback chain ────────────────────────────────────────────────────
// These are free-tier models on OpenRouter (no credits required).
// Full list: https://openrouter.ai/models?q=free
// Models with ":free" suffix are always free. Add/remove as needed.
const MODELS: string[] = [
  "openrouter/hunter-alpha",
  "nvidia/nemotron-3-super-120b-a12b:free",
  "qwen/qwen3-next-80b-a3b-instruct:free",
  "z-ai/glm-4.5-air:free",
];

// ─── System prompt ───────────────────────────────────────────────────────────
// Edit this to give your bot its personality / topic focus.
const SYSTEM_PROMPT = `
You are a helpful assistant in a Discord server.
 
Rules:
- Prefer short, practical answers: direct answer first, then 2–5 bullet points if needed.
- State your assumptions when the question is ambiguous.
- If you don't know, say so clearly.
- Format for Discord: use **bold** for key terms, bullet points for lists.
- Keep total response under 1800 characters.
`;

// ─── Discord interaction type constants ───────────────────────────────────────
const InteractionType = {
  APPLICATION_COMMAND: 2,
} as const;

const InteractionResponseType = {
  CHANNEL_MESSAGE_WITH_SOURCE: 4,
  DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE: 5,
} as const;

// ─── Helpers ─────────────────────────────────────────────────────────────────
function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function normalizeQuery(query: string): string {
  return query
    .toLowerCase()
    .trim()
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ");
}

// ─── OpenRouter: single model call ───────────────────────────────────────────
interface OpenRouterResult {
  text: string;
  model: string;
}

async function callOpenRouterModel(
  question: string,
  model: string,
): Promise<OpenRouterResult> {
  const res = await fetch(OPENROUTER_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
      // Recommended by OpenRouter for tracking / rate limit attribution
      "HTTP-Referer": Deno.env.get("SUPABASE_URL") ?? "https://supabase.io",
      "X-Title": "Discord Bot",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: question },
      ],
      max_tokens: 600, // ~1800 chars; well within Discord's 2000 char limit
    }),
  });

  if (!res.ok) {
    const errBody = await res.text();
    console.error(`[${model}] OpenRouter error ${res.status}:`, errBody);
    throw new Error(`${model} returned ${res.status}`);
  }

  const data = await res.json();
  const text: string | undefined = data.choices?.[0]?.message?.content?.trim();

  if (!text) throw new Error(`${model}: empty response`);

  return { text, model };
}

// ─── OpenRouter: pick a random model, fallback to others on failure ──────────
async function askOpenRouter(question: string): Promise<OpenRouterResult> {
    // Shuffle a copy so we try all models before giving up, but start randomly
    const shuffled = [...MODELS].sort(() => Math.random() - 0.5);
    let lastError: Error | null = null;
   
    for (const model of shuffled) {
      try {
        const result = await callOpenRouterModel(question, model);
        return result;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        console.warn(`Model ${model} failed, trying next...`);
      }
    }
   
    throw lastError ?? new Error("All OpenRouter models failed");
  }

// ─── Discord: edit the deferred response ─────────────────────────────────────
async function editOriginalResponse(
  token: string,
  content: string,
): Promise<void> {
  const url =
    `https://discord.com/api/v10/webhooks/${DISCORD_APP_ID}/${token}/messages/@original`;

  const res = await fetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });

  if (!res.ok) {
    console.error("Discord PATCH error:", res.status, await res.text());
  }
}

// ─── Process query (runs after deferral) ─────────────────────────────────────
async function processQuery(
  question: string,
  interactionToken: string,
): Promise<void> {
  const normalized = normalizeQuery(question);

  try {

    const result = await askOpenRouter(question);

    // Build response with subtle footer
    let answer = result.text;
    const footer = `\n-# ${result.model}`;
    const maxLen = DISCORD_MAX_LENGTH - footer.length - 20;
    if (answer.length > maxLen) {
      answer = answer.substring(0, maxLen) + "\n\n*…truncated*";
    }
    answer += footer;

    await editOriginalResponse(interactionToken, answer);
  } catch (err) {
    console.error("processQuery error:", err);
    await editOriginalResponse(
      interactionToken,
      "⚠️ Something went wrong. Please try again.",
    );
  }
}

// ─── Main handler ─────────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const interaction = await req.json();

  if (interaction.type === InteractionType.APPLICATION_COMMAND) {
    const options = interaction.data?.options ?? [];
    const questionOpt = options.find(
      (o: { name: string; value: string }) => o.name === "query",
    );
    const question: string | undefined = questionOpt?.value?.trim();

    if (!question) {
      return jsonResponse({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          content:
            "Please provide a question!\nExample: `/ask-or question: what is the meaning of life?`",
        },
      });
    }
    // Slow path: defer and process in background
    processQuery(question, interaction.token).catch(console.error);

    return jsonResponse({
      type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
    });
  }

  return jsonResponse({ error: "Unknown interaction type" }, 400);
});