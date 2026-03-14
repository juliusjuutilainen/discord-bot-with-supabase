declare const Deno: {
  env: {
    get: (key: string) => string | undefined;
  };
  serve: (
    handler: (req: Request) => Response | Promise<Response>,
  ) => void;
};

const DISCORD_APP_ID = Deno.env.get("discord_application_id")!;
const DISCORD_BOT_TOKEN = Deno.env.get("discord_bot_token")!;
const GEMINI_API_KEY = Deno.env.get("gemini_api_key")!;

const InteractionType = {
  APPLICATION_COMMAND: 2,
} as const;

const InteractionResponseType = {
  DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE: 5,
} as const;

const DISCORD_API_BASE = "https://discord.com/api/v10";
const DISCORD_MAX_LENGTH = 2000;
const MESSAGE_LIMIT = 30;

const MODELS: string[] = [
  "gemini-2.5-pro",
  "gemini-3-flash-preview",
  "gemini-3.1-flash-lite-preview",
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
];

const SYSTEM_PROMPT = `You are a neutral and concise judge for Discord disagreements.

Task:
- Read the transcript and decide who has the stronger case, or return "No clear winner".

Rules:
- Be respectful and non-hostile.
- Judge only argument quality: evidence, logic, consistency, and clarity.
- If there is not enough context, explicitly say that.
- Keep response concise and Discord-friendly.

Output format:
**Verdict:** <winner name or "No clear winner">
**Confidence:** <Low|Medium|High>
**Why:**
- <bullet>
- <bullet>
**What could change this verdict:**
- <bullet>
`;

type DiscordMessage = {
  id: string;
  content: string;
  author?: {
    id: string;
    username: string;
    global_name?: string | null;
    bot?: boolean;
  };
};

interface MessageFetchDiagnostics {
  rawCount: number;
  filteredCount: number;
  droppedEmpty: number;
  droppedBot: number;
  nonBotCount: number;
  nonBotEmptyCount: number;
  likelyMessageContentRestricted: boolean;
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function sanitizeMessageContent(content: string): string {
  return content.replace(/\s+/g, " ").trim();
}

function toTranscript(messages: DiscordMessage[]): string {
  return messages
    .map((message, index) => {
      const name = message.author?.global_name || message.author?.username || "Unknown";
      return `${index + 1}. ${name}: ${message.content}`;
    })
    .join("\n");
}

async function editOriginalResponse(token: string, content: string): Promise<void> {
  const url = `${DISCORD_API_BASE}/webhooks/${DISCORD_APP_ID}/${token}/messages/@original`;

  const res = await fetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });

  if (!res.ok) {
    console.error("Discord PATCH error:", res.status, await res.text());
  }
}

async function fetchLastMessages(
  channelId: string,
): Promise<{ messages: DiscordMessage[]; diagnostics: MessageFetchDiagnostics }> {
  const requestUrl = `${DISCORD_API_BASE}/channels/${channelId}/messages?limit=${MESSAGE_LIMIT}`;
  console.log(`[fetchLastMessages] channel=${channelId} limit=${MESSAGE_LIMIT}`);

  const res = await fetch(
    requestUrl,
    {
      headers: {
        Authorization: `Bot ${DISCORD_BOT_TOKEN}`,
        "Content-Type": "application/json",
      },
    },
  );

  if (!res.ok) {
    const body = await res.text();
    console.error(`[fetchLastMessages] request failed channel=${channelId} status=${res.status} body=${body}`);
    throw new Error(`Discord message fetch failed ${res.status}: ${body}`);
  }

  const data = await res.json() as DiscordMessage[];

  console.log(`[fetchLastMessages] raw_count=${data.length} channel=${channelId}`);
  if (data.length > 0) {
    const sample = data.slice(0, 5).map((message) => ({
      id: message.id,
      author: message.author?.username ?? "unknown",
      isBot: !!message.author?.bot,
      contentLength: message.content?.length ?? 0,
      hasTrimmedContent: !!message.content?.trim(),
    }));
    console.log("[fetchLastMessages] sample_raw_messages:", sample);
  }

  const filtered = data.filter((message) => !!message.content?.trim() && !message.author?.bot);
  const droppedEmpty = data.filter((message) => !message.content?.trim()).length;
  const droppedBot = data.filter((message) => !!message.author?.bot).length;
  const nonBotMessages = data.filter((message) => !message.author?.bot);
  const nonBotCount = nonBotMessages.length;
  const nonBotEmptyCount = nonBotMessages.filter((message) => !message.content?.trim()).length;
  const likelyMessageContentRestricted =
    nonBotCount >= 5 &&
    nonBotEmptyCount >= 5 &&
    nonBotEmptyCount / nonBotCount >= 0.9;

  console.log(
    `[fetchLastMessages] filtered_count=${filtered.length} dropped_empty=${droppedEmpty} dropped_bot=${droppedBot} channel=${channelId}`,
  );
  console.log(
    `[fetchLastMessages] non_bot_count=${nonBotCount} non_bot_empty_count=${nonBotEmptyCount} likely_message_content_restricted=${likelyMessageContentRestricted} channel=${channelId}`,
  );

  if (likelyMessageContentRestricted) {
    console.warn(
      `[fetchLastMessages] probable_message_content_restriction channel=${channelId}. Most non-bot messages have empty content. Enable Message Content intent and verify bot permission scopes.`,
    );
  }

  const messages = filtered
    .reverse()
    .map((message) => ({
      ...message,
      content: sanitizeMessageContent(message.content),
    }));

  return {
    messages,
    diagnostics: {
      rawCount: data.length,
      filteredCount: filtered.length,
      droppedEmpty,
      droppedBot,
      nonBotCount,
      nonBotEmptyCount,
      likelyMessageContentRestricted,
    },
  };
}

interface GeminiResult {
  text: string;
  model: string;
}

async function callGeminiModel(
  question: string,
  model: string,
): Promise<GeminiResult> {
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;

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

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errBody = await res.text();
    console.error(`[${model}] Gemini error ${res.status}:`, errBody);
    throw new Error(`${model} returned ${res.status}`);
  }

  const data = await res.json();
  const parts = data.candidates?.[0]?.content?.parts;
  if (!parts) throw new Error(`${model}: empty response`);

  const text = parts
    .filter((part: { text?: string }) => part.text)
    .map((part: { text: string }) => part.text)
    .join("");

  if (!text) throw new Error(`${model}: no text in response`);

  return { text, model };
}

async function askGemini(question: string): Promise<GeminiResult> {
  let lastError: Error | null = null;

  for (const model of MODELS) {
    try {
      const result = await callGeminiModel(question, model);
      if (model !== MODELS[0]) {
        console.log(`Fallback succeeded with ${model}`);
      }
      return result;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      console.warn(`Model ${model} failed, trying next...`);
    }
  }

  throw lastError ?? new Error("All Gemini models failed");
}

async function processSettleThis(interaction: {
  token: string;
  channel_id: string;
}): Promise<void> {
  try {
    console.log(`[processSettleThis] start channel=${interaction.channel_id} token_present=${!!interaction.token}`);
    const { messages, diagnostics } = await fetchLastMessages(interaction.channel_id);
    console.log(`Fetched ${messages.length} messages for channel ${interaction.channel_id}`);
    console.log("Messages:", messages.map((m) => `${m.author?.username}: ${m.content}`));

    if (messages.length === 0 && diagnostics.likelyMessageContentRestricted) {
      await editOriginalResponse(
        interaction.token,
        "I can see recent messages, but their text content is hidden from the bot. Please enable **Message Content Intent** for this Discord application and re-invite/update bot permissions, then try again.",
      );
      return;
    }

    if (messages.length < 6) {
      await editOriginalResponse(
        interaction.token,
        "I need more context to judge this fairly. I found fewer than 6 meaningful recent messages.",
      );
      return;
    }

    const transcript = toTranscript(messages);
    const prompt = `Analyze this Discord transcript and provide a verdict.\n\n${transcript}`;

    const result = await askGemini(prompt);

    let answer = result.text;
    const footer = `\n-# ${result.model}`;
    const maxLen = DISCORD_MAX_LENGTH - footer.length - 20;

    if (answer.length > maxLen) {
      answer = `${answer.substring(0, maxLen)}\n\n*…truncated*`;
    }

    await editOriginalResponse(interaction.token, `${answer}${footer}`);
  } catch (err) {
    console.error("processSettleThis error:", err);
    await editOriginalResponse(
      interaction.token,
      "⚠️ I couldn’t settle this right now due to a message fetch or model error. Please try again.",
    );
  }
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const interaction = await req.json();

  if (interaction.type !== InteractionType.APPLICATION_COMMAND) {
    return jsonResponse({ error: "Unknown interaction type" }, 400);
  }

  processSettleThis(interaction).catch(console.error);

  return jsonResponse({
    type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
  });
});