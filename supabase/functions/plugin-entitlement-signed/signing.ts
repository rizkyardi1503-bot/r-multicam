// Shared by the edge function (Deno) and the harness tests (Node): canonical payload + Ed25519 signing.
// The plugin (account-auth.js) verifies the signature over the exact payload bytes and checks these fields.

export const AUDIENCE = "r-multicam-plugin-entitlement";
export const GRACE_SECONDS = 72 * 3600;

export type PayloadInput = {
  keyId: string;
  userId: string;
  deviceId: string;
  platform: string;
  pluginVersion: string;
  entitlement: Record<string, unknown>;
  now: Date;
};

const text = (v: unknown) => (v == null ? null : String(v));

// Fixed key order, no whitespace: the string itself is what gets signed and cached.
export function canonicalPayload(i: PayloadInput): string {
  const e = i.entitlement || {};
  return JSON.stringify({
    v: 1,
    aud: AUDIENCE,
    key_id: i.keyId,
    user_id: i.userId,
    device_id: i.deviceId,
    platform: i.platform,
    plugin_version: i.pluginVersion,
    allowed: e.allowed === true,
    license_status: text(e.license_status),
    trial_started_at: text(e.trial_started_at),
    trial_expires_at: text(e.trial_expires_at),
    issued_at: i.now.toISOString(),
    expires_at: new Date(i.now.getTime() + GRACE_SECONDS * 1000).toISOString()
  });
}

const fromBase64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const toBase64 = (b: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(b)));

// pkcs8Base64: base64 of the PKCS#8 DER private key (openssl genpkey -algorithm ed25519 -outform DER | base64).
export function importSigningKey(subtle: SubtleCrypto, pkcs8Base64: string): Promise<CryptoKey> {
  return subtle.importKey("pkcs8", fromBase64(pkcs8Base64.replace(/\s+/g, "")), { name: "Ed25519" }, false, ["sign"]);
}

export async function signPayload(subtle: SubtleCrypto, key: CryptoKey, payload: string): Promise<string> {
  return toBase64(await subtle.sign({ name: "Ed25519" }, key, new TextEncoder().encode(payload)));
}
