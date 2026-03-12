import { createClient } from "npm:@supabase/supabase-js@2";
import nacl from "npm:tweetnacl@1.0.3";

// ─── Environment ─────────────────────────────────────────────────────────────
const DISCORD_PUBLIC_KEY = Deno.env.get("discord_public_key")!;
const DISCORD_APP_ID = Deno.env.get("discord_application_id")!;
const GEMINI_API_KEY = Deno.env.get("gemini_api_key")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ─── Constants ───────────────────────────────────────────────────────────────
const CACHE_TTL_HOURS = 168; // 7 days
const DISCORD_MAX_LENGTH = 2000;

// ─── Model fallback chain (best → worst) ────────────────────────────────────
// Only gemini-2.5-flash and gemini-2.5-flash-lite have free Google Search
// grounding (500 RPD shared). The 3.x models are free for text but grounding
// is paid-only, so we use them as ungrounded fallbacks.
interface ModelConfig {
  model: string;
  grounding: boolean;
}

const MODELS: ModelConfig[] = [
  { model: "gemini-2.5-flash", grounding: true },
  { model: "gemini-2.5-flash-lite", grounding: true },
  { model: "gemini-3-flash-preview", grounding: false },
  { model: "gemini-3.1-flash-lite-preview", grounding: false },
];

// ─── Discord Types ───────────────────────────────────────────────────────────
const InteractionType = {
  PING: 1,
  APPLICATION_COMMAND: 2,
} as const;

const InteractionResponseType = {
  PONG: 1,
  CHANNEL_MESSAGE_WITH_SOURCE: 4,
  DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE: 5,
} as const;

// ─── System Prompt (Jinja template) ──────────────────────────────────────────
const SYSTEM_PROMPT = await Deno.readTextFile(
  new URL("./system_prompt.jinja", import.meta.url),
);

// ─── Hex helpers ─────────────────────────────────────────────────────────────
function hexToUint8Array(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

// ─── Discord signature verification ──────────────────────────────────────────
function verifySignature(
  body: string,
  signature: string | null,
  timestamp: string | null,
): boolean {
  if (!signature || !timestamp) return false;
  try {
    return nacl.sign.detached.verify(
      new TextEncoder().encode(timestamp + body),
      hexToUint8Array(signature),
      hexToUint8Array(DISCORD_PUBLIC_KEY),
    );
  } catch {
    return false;
  }
}

// ─── JSON response helper ────────────────────────────────────────────────────
function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// ─── Query normalization (for cache key) ─────────────────────────────────────
function normalizeQuery(query: string): string {
  return query
    .toLowerCase()
    .trim()
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ");
}

// ─── Cache: read ─────────────────────────────────────────────────────────────
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

// ─── Cache: write ────────────────────────────────────────────────────────────
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

// ─── Gemini: single model call ───────────────────────────────────────────────
interface GeminiResult {
  text: string;
  model: string;
  grounded: boolean;
}

async function callGeminiModel(
  question: string,
  config: ModelConfig,
): Promise<GeminiResult> {
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${config.model}:generateContent?key=${GEMINI_API_KEY}`;

  // deno-lint-ignore no-explicit-any
  const body: Record<string, any> = {
    system_instruction: {
      parts: [{ text: SYSTEM_PROMPT }],
    },
    contents: [
      {
        role: "user",
        parts: [{ text: question }],
      },
    ],
  };

  if (config.grounding) {
    body.tools = [{ google_search: {} }];
  }

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errBody = await res.text();
    console.error(`[${config.model}] Gemini error ${res.status}:`, errBody);
    throw new Error(`${config.model} returned ${res.status}`);
  }

  const data = await res.json();
  const parts = data.candidates?.[0]?.content?.parts;
  if (!parts) throw new Error(`${config.model}: empty response`);

  const text = parts
    .filter((p: { text?: string }) => p.text)
    .map((p: { text: string }) => p.text)
    .join("");

  if (!text) throw new Error(`${config.model}: no text in response`);

  return { text, model: config.model, grounded: config.grounding };
}

// ─── Gemini: try models in order, fallback on failure ────────────────────────
async function askGemini(question: string): Promise<GeminiResult> {
  let lastError: Error | null = null;

  for (const config of MODELS) {
    try {
      const result = await callGeminiModel(question, config);
      if (config !== MODELS[0]) {
        console.log(`Fallback succeeded with ${config.model}`);
      }
      return result;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      console.warn(`Model ${config.model} failed, trying next...`);
    }
  }

  throw lastError ?? new Error("All Gemini models failed");
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

// ─── Process a query (runs after deferral) ───────────────────────────────────
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

    // 2. Ask Gemini (tries models in order, falls back automatically)
    const result = await askGemini(question);

    // 3. Build response with subtle model/grounding footer
    let answer = result.text;
    const footer = result.grounded
      ? `\n-# ${result.model} · grounded`
      : `\n-# ${result.model} · not grounded`;
    const maxLen = DISCORD_MAX_LENGTH - footer.length - 20;
    if (answer.length > maxLen) {
      answer = answer.substring(0, maxLen) + "\n\n*…truncated*";
    }
    answer += footer;

    // 4. Save to cache (non-blocking)
    saveCache(question, normalized, answer).catch((e) =>
      console.error("Cache save error:", e)
    );

    // 5. Send answer to Discord
    await editOriginalResponse(interactionToken, answer);
  } catch (err) {
    console.error("processQuery error:", err);
    await editOriginalResponse(
      interactionToken,
      "⚠️ Something went wrong while searching. Please try again.",
    );
  }
}

// ─── Main handler ────────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const body = await req.text();

  // Verify Discord signature
  const isValid = verifySignature(
    body,
    req.headers.get("x-signature-ed25519"),
    req.headers.get("x-signature-timestamp"),
  );
  if (!isValid) {
    return jsonResponse({ error: "Invalid signature" }, 401);
  }

  const interaction = JSON.parse(body);

  // ── PING (Discord endpoint verification) ──
  if (interaction.type === InteractionType.PING) {
    return jsonResponse({ type: InteractionResponseType.PONG });
  }

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

