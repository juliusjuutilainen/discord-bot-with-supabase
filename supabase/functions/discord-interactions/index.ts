// supabase/functions/discord-interactions/index.ts
import { verifyDiscordRequest } from "../_shared/discord.ts";

Deno.serve(async (req) => {
  // 1. Verify Discord signature (required!)
  const { valid, body } = await verifyDiscordRequest(req);
  if (!valid) return new Response("Unauthorized", { status: 401 });

  const interaction = JSON.parse(body);

  // 2. Handle Discord's PING (required for endpoint verification)
  if (interaction.type === 1) {
    return new Response(JSON.stringify({ type: 1 }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  // 3. Route to command handlers
  if (interaction.type === 2) { // APPLICATION_COMMAND
    const command = interaction.data.name as string;

    const commandToFunction: Record<string, string> = {
      //commands go here
      ask: "grounded-llm-inference",
      openrouter: "openrouter-llm-inference",
    };

    const fnName = commandToFunction[command];
    if (!fnName) {
      return jsonResponse({
        type: 4,
        data: { content: "Unknown command" },
      });
    }

    return await invokeFunction(fnName, interaction);
  } else {
    return new Response("Bad Request", { status: 400 });
  }
});

// Invokes another Supabase Edge Function internally
async function invokeFunction(fnName: string, payload: unknown) {
  const res = await fetch(
    `${Deno.env.get("SUPABASE_URL")}/functions/v1/${fnName}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${Deno.env.get("SUPABASE_ANON_KEY")}`,
      },
      body: JSON.stringify(payload),
    }
  );
  return res; // Forward the response back to Discord
}

function jsonResponse(data: unknown) {
  return new Response(JSON.stringify(data), {
    headers: { "Content-Type": "application/json" },
  });
}