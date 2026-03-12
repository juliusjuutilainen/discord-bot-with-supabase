// supabase/functions/openrouter-jina-inference/index.ts
// LLM inference via OpenRouter (tiered model fallback) with Jina.ai web search grounding.
// Mirrors grounded-llm-inference/index.ts — same caching, same deferral pattern.

import { createClient } from "npm:@supabase/supabase-js@2";

// ─── Environment ─────────────────────────────────────────────────────────────
const DISCORD_APP_ID = Deno.env.get("discord_application_id")!;
const OPENROUTER_API_KEY = Deno.env.get("openrouter_api_key")!;
const JINA_API_KEY = Deno.env.get("jina_api_key")!; // get free key at jina.ai
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ─── Constants ───────────────────────────────────────────────────────────────
const CACHE_TTL_HOURS = 168; // 7 days
const DISCORD_MAX_LENGTH = 2000;
const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";
const JINA_SEARCH_URL = "https://s.jina.ai/";

// ─── Model tiers (best → worst, tried in order, fallback on failure) ─────────
// Tier 1: capable paid models (used if you have OpenRouter credits)
// Tier 2: free-tier models (:free suffix = always free, no credits needed)
// Add/remove models as needed. Full list: https://openrouter.ai/models
interface ModelConfig {
  model: string;
  tier: number;
}

const MODELS: ModelConfig[] = [
  // Tier 1 — paid but capable
  { model: "google/gemini-2.5-flash", tier: 1 },
  { model: "meta-llama/llama-4-maverick", tier: 1 },
  // Tier 2 — free fallbacks
  { model: "google/gemini-2.0-flash-exp:free", tier: 2 },
  { model: "meta-llama/llama-4-maverick:free", tier: 2 },
  { model: "deepseek/deepseek-chat-v3-0324:free", tier: 2 },
  { model: "mistralai/mistral-7b-instruct:free", tier: 2 },
];

// ─── Discord Types ────────────────────────────────────────────────────────────
const InteractionType = {
  APPLICATION_COMMAND: 2,
} as const;

const InteractionResponseType = {
  PONG: 1,
  CHANNEL_MESSAGE_WITH_SOURCE: 4,
  DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE: 5,
} as const;

// ─── System Prompt ────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are a focused assistant for a single, well-defined topic chosen by the bot owner.

Rules:
- Answer ONLY about that chosen topic.
- If a question is clearly outside that topic, say so and decline.
- Prefer short, practical answers: direct answer first, then 2–5 bullet points if needed.
- State your assumptions when the question is ambiguous.
- If you don't know or reliable sources disagree, say that you're not sure.
- Always mention the sources or references you relied on.
- Format for Discord: use **bold** for key terms, bullet points for lists.
- Keep total response under 1800 characters.
`;

// ─── JSON response helper ─────────────────────────────────────────────────────
function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// ─── Query normalization (for cache key) ──────────────────────────────────────
function normalizeQuery(query: string): string {
  return query
    .toLowerCase()
    .trim()
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ");
}

// ─── Cache: read ──────────────────────────────────────────────────────────────
async function checkCache(normalized: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("query_cache")
    .select("id, response_text, hit_count")
    .eq("query_normalized", normalized)
    .gt("expires_at", new Date().toISOString())
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;

  // bump hit_count (fire-and-forget, non-blocking)
  supabase
    .from("query_cache")
    .update({ hit_count: (data.hit_count ?? 0) + 1 })
    .eq("id", data.id)
    .then();

  return data.response_text;
}

// ─── Cache: write ─────────────────────────────────────────────────────────────
async function saveCache(
  original: string,
  normalized: string,
  responseText: string,
): Promise<void> {
  const expiresAt = new Date(
    Date.now() + CACHE_TTL_HOURS * 60 * 60 * 1000,
  ).toISOString();

  await supabase.from("query_cache").upsert(
    {
      query_normalized: normalized,
      query_original: original,
      response_text: responseText,
      expires_at: expiresAt,
      hit_count: 0,
    },
    { onConflict: "query_normalized" },
  );
}

// ─── Jina.ai: fetch grounding context ────────────────────────────────────────
// Jina's search API returns a clean markdown summary of top web results.
// Free tier: 1M tokens/month. Docs: https://jina.ai/search/
async function fetchGrounding(question: string): Promise<string | null> {
  try {
    const res = await fetch(
      `${JINA_SEARCH_URL}${encodeURIComponent(question)}?count=5`,
      {
        headers: {
          "Authorization": `Bearer ${JINA_API_KEY}`,
          "Accept": "application/json",
          "X-Retain-Images": "none", // text only, saves tokens
        },
      },
    );

    if (!res.ok) {
      console.warn(`Jina search failed: ${res.status}`);
      return null;
    }

    const data = await res.json();

    // Jina returns an array of results with title, url, content
    // We take the top 3 and concatenate for context
    const results: Array<{ title: string; url: string; content: string }> =
      data.data ?? [];

    if (results.length === 0) return null;

    const context = results
      .slice(0, 5)
      .map((r) => `### ${r.title}\nSource: ${r.url}\n${r.content}`)
      .join("\n\n---\n\n");

    return context;
  } catch (err) {
    console.warn("Jina grounding error:", err);
    return null; // grounding is best-effort; don't fail the whole request
  }
}

// ─── OpenRouter: single model call ───────────────────────────────────────────
interface OpenRouterResult {
  text: string;
  model: string;
  tier: number;
  grounded: boolean;
}

async function callOpenRouterModel(
  question: string,
  groundingContext: string | null,
  config: ModelConfig,
): Promise<OpenRouterResult> {
  const messages: Array<{ role: string; content: string }> = [
    { role: "system", content: SYSTEM_PROMPT },
  ];

  if (groundingContext) {
    messages.push({
      role: "system",
      content:
        `Here is current web search context to help answer the question:\n\n${groundingContext}`,
    });
  }

  messages.push({ role: "user", content: question });

  const res = await fetch(OPENROUTER_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
      "HTTP-Referer": SUPABASE_URL,
      "X-Title": "Discord Bot",
    },
    body: JSON.stringify({
      model: config.model,
      messages,
      max_tokens: 600,
    }),
  });

  if (!res.ok) {
    const errBody = await res.text();
    console.error(`[${config.model}] OpenRouter error ${res.status}:`, errBody);
    throw new Error(`${config.model} returned ${res.status}`);
  }

  const data = await res.json();
  const text: string | undefined = data.choices?.[0]?.message?.content?.trim();

  if (!text) throw new Error(`${config.model}: empty response`);

  return {
    text,
    model: config.model,
    tier: config.tier,
    grounded: groundingContext !== null,
  };
}

// ─── OpenRouter: try models in tier order, fallback on failure ────────────────
async function askOpenRouter(
  question: string,
  groundingContext: string | null,
): Promise<OpenRouterResult> {
  let lastError: Error | null = null;

  for (const config of MODELS) {
    try {
      const result = await callOpenRouterModel(question, groundingContext, config);
      if (config !== MODELS[0]) {
        console.log(`Fallback succeeded with ${config.model} (tier ${config.tier})`);
      }
      return result;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      console.warn(`Model ${config.model} failed, trying next...`);
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

// ─── Process a query (runs after deferral) ────────────────────────────────────
async function processQuery(
  question: string,
  interactionToken: string,
): Promise<void> {
  const normalized = normalizeQuery(question);

  try {
    // 1. Check cache
    const cached = await checkCache(normalized);
    if (cached) {
      await editOriginalResponse(interactionToken, cached);
      return;
    }

    // 2. Fetch grounding context from Jina (best-effort, runs in parallel with nothing — fast enough)
    const groundingContext = await fetchGrounding(question);

    // 3. Ask OpenRouter (tries models in tier order, falls back automatically)
    const result = await askOpenRouter(question, groundingContext);

    // 4. Build response with subtle model/grounding footer
    let answer = result.text;
    const footer = result.grounded
      ? `\n-# ${result.model} · grounded via jina.ai`
      : `\n-# ${result.model} · not grounded`;
    const maxLen = DISCORD_MAX_LENGTH - footer.length - 20;
    if (answer.length > maxLen) {
      answer = answer.substring(0, maxLen) + "\n\n*…truncated*";
    }
    answer += footer;

    // 5. Save to cache (non-blocking)
    saveCache(question, normalized, answer).catch((e) =>
      console.error("Cache save error:", e)
    );

    // 6. Send answer to Discord
    await editOriginalResponse(interactionToken, answer);
  } catch (err) {
    console.error("processQuery error:", err);
    await editOriginalResponse(
      interactionToken,
      "⚠️ Something went wrong while searching. Please try again.",
    );
  }
}

// ─── Main handler ─────────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const interaction = await req.json();

  // ── APPLICATION_COMMAND ──
  if (interaction.type === InteractionType.APPLICATION_COMMAND) {
    const options = interaction.data?.options ?? [];
    const questionOpt = options.find(
      (o: { name: string; value: string }) => o.name === "question",
    );
    const question: string | undefined = questionOpt?.value?.trim();

    if (!question) {
      return jsonResponse({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          content:
            "Please provide a question!\nExample: `/ask question: how do I deploy this bot?`",
        },
      });
    }

    // ── Fast path: cache hit → respond immediately ──
    const normalized = normalizeQuery(question);
    const cached = await checkCache(normalized);
    if (cached) {
      return jsonResponse({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: { content: cached },
      });
    }

    // ── Slow path: defer → process in background → edit response ──
    processQuery(question, interaction.token).catch(console.error);

    return jsonResponse({
      type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
    });
  }

  return jsonResponse({ error: "Unknown interaction type" }, 400);
});