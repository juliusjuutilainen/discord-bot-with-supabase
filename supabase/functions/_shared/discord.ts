// supabase/functions/_shared/discord.ts
import nacl from "npm:tweetnacl@1.0.3";

const DISCORD_PUBLIC_KEY = Deno.env.get("discord_public_key")!;

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

export async function verifyDiscordRequest(req: Request) {
  const signature = req.headers.get("x-signature-ed25519") ?? "";
  const timestamp = req.headers.get("x-signature-timestamp") ?? "";
  const body = await req.text();

  const valid = await verifySignature(
    body,
    signature,
    timestamp,
  );

  return { valid, body };
}