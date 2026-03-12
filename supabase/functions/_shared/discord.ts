// supabase/functions/_shared/discord.ts
import { verify } from "https://deno.land/x/discord_verify@1.0.2/mod.ts";

export async function verifyDiscordRequest(req: Request) {
  const signature = req.headers.get("x-signature-ed25519") ?? "";
  const timestamp = req.headers.get("x-signature-timestamp") ?? "";
  const body = await req.text();

  const valid = await verify(
    body,
    signature,
    timestamp,
    Deno.env.get("DISCORD_PUBLIC_KEY")!
  );

  return { valid, body };
}