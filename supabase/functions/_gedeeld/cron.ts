/**
 * Voor functies die door pg_cron worden aangeroepen: klopt de sleutel?
 *
 * Eerst allebei hashen, dan elk byte bekijken: zo verraadt de rekentijd niet
 * hoeveel tekens er al goed waren.
 */
export async function cronSleutelKlopt(req: Request): Promise<boolean> {
  const geheim = Deno.env.get("MAIL_CRON_SLEUTEL") ?? "";
  if (!geheim) return false;
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(req.headers.get("x-cron-sleutel") ?? "")),
    crypto.subtle.digest("SHA-256", enc.encode(geheim)),
  ]);
  const x = new Uint8Array(ha);
  const y = new Uint8Array(hb);
  let verschil = 0;
  for (let i = 0; i < x.length; i++) verschil |= x[i] ^ y[i];
  return verschil === 0;
}
