// Same-origin analytics endpoint (/api/analytics). analytics.js posts here; the event is forwarded to the Supabase
// website-analytics function together with the visitor's country/region from Cloudflare (request.cf). Supabase never
// sees the visitor's Cloudflare edge, so without this proxy country_code stays empty.
// The geo headers are trusted by the function only with the shared secret ANALYTICS_PROXY_SECRET (Pages env secret and
// Supabase function secret, same value). Without the secret the event is still forwarded, without geo headers.
const UPSTREAM = 'https://ngotkvqtzqiotztnqwaw.supabase.co/functions/v1/website-analytics';
const MAX_BODY = 4096;

export async function onRequestPost({ request, env }) {
  const tooLarge = () => new Response('Event too large', { status: 413, headers: { 'cache-control': 'no-store' } });
  // Refuse a declared oversize body before reading it; a body without (or with a false) length is checked after.
  if (Number(request.headers.get('content-length') || 0) > MAX_BODY) return tooLarge();
  const body = await request.text();
  if (body.length > MAX_BODY) return tooLarge();
  const headers = new Headers({ 'content-type': 'application/json' });
  for (const name of ['origin', 'authorization', 'user-agent']) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  const secret = env && env.ANALYTICS_PROXY_SECRET;
  const cf = request.cf || {};
  if (secret) {
    headers.set('x-rp-proxy-secret', secret);
    if (typeof cf.country === 'string' && cf.country) headers.set('x-rp-geo-country', cf.country.slice(0, 3));
    // request.cf.region is the region name ("Jakarta"); HTTP headers carry it URI-encoded (non-ASCII names).
    if (typeof cf.region === 'string' && cf.region) headers.set('x-rp-geo-region', encodeURIComponent(cf.region.slice(0, 120)));
  }
  let upstream;
  try {
    upstream = await fetch(UPSTREAM, { method: 'POST', headers, body, signal: AbortSignal.timeout(8000) });
  } catch {
    return new Response('Analytics unavailable', { status: 502, headers: { 'cache-control': 'no-store' } });
  }
  return new Response(upstream.status === 204 ? null : await upstream.text(), { status: upstream.status, headers: { 'cache-control': 'no-store' } });
}
