/**
 * Het mailboxwachtwoord versleutelen en weer openmaken.
 *
 * AES-GCM met een sleutel die alleen als function-secret bestaat
 * (MAIL_SLEUTEL, 32 willekeurige bytes in base64). Een kopie van de database
 * alleen is dus niet genoeg om het wachtwoord te lezen.
 */

function naarBase64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function uitBase64(tekst: string): Uint8Array {
  return Uint8Array.from(atob(tekst), (c) => c.charCodeAt(0));
}

async function sleutel(): Promise<CryptoKey> {
  const ruw = Deno.env.get("MAIL_SLEUTEL") ?? "";
  const bytes = ruw ? uitBase64(ruw) : new Uint8Array();
  if (bytes.length !== 32) throw new Error("MAIL_SLEUTEL ontbreekt of is geen 32 bytes.");
  return await crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function versleutel(tekst: string): Promise<{ versleuteld: string; iv: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const uit = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await sleutel(),
    new TextEncoder().encode(tekst),
  );
  return { versleuteld: naarBase64(new Uint8Array(uit)), iv: naarBase64(iv) };
}

export async function ontsleutel(versleuteld: string, iv: string): Promise<string> {
  const uit = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: uitBase64(iv) },
    await sleutel(),
    uitBase64(versleuteld),
  );
  return new TextDecoder().decode(uit);
}
