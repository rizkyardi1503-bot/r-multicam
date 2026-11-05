// Same-origin analytics endpoint (/api/analytics). analytics.js posts here; the event is forwarded to the Supabase
// website-analytics function together with the visitor's country/region from Cloudflare (request.cf). Supabase never
// sees the visitor's Cloudflare edge, so without this proxy country_code stays empty.
// The geo headers are trusted by the function only with the shared secret ANALYTICS_PROXY_SECRET (Pages env secret and
// Supabase function secret, same value). Without the secret the event is still forwarded, without geo headers.
// Once the secret is set on the function, this proxy is the only way in, so its limits below are what stops forged rows
// (50,000 rows in the dashboard's window make the owner dashboard answer 503).
const UPSTREAM = 'https://ngotkvqtzqiotztnqwaw.supabase.co/functions/v1/website-analytics';
const MAX_BODY = 4096;
// Per visitor IP. A busy visit sends a few events per page; several people can share one mobile-carrier IP. Going over
// loses analytics events only. Pages Functions have no rate-limit binding, so the counts live in this isolate's memory:
// they reset when it is replaced and are not shared between Cloudflare locations, which holds one script back but not a
// botnet. The IP is only a key in memory, never logged, stored or forwarded.
const PER_MINUTE = 60;
const PER_DAY = 600;
const MAX_TRACKED = 5000;
const seen = new Map();

function overLimit(ip, now) {
  const minute = Math.floor(now / 60000), day = Math.floor(now / 86400000);
  if (seen.size >= MAX_TRACKED && !seen.has(ip)) seen.clear();
  let entry = seen.get(ip);
  if (!entry || entry.day !== day) { entry = { day, dayCount: 0, minute, minuteCount: 0 }; seen.set(ip, entry); }
  if (entry.minute !== minute) { entry.minute = minute; entry.minuteCount = 0; }
  entry.minuteCount++; entry.dayCount++;
  return entry.minuteCount > PER_MINUTE || entry.dayCount > PER_DAY;
}

export async function onRequestPost({ request, env }) {
  const tooLarge = () => new Response('Event too large', { status: 413, headers: { 'cache-control': 'no-store' } });
  // Refuse a declared oversize body before reading it; a body without (or with a false) length is checked after.
  if (Number(request.headers.get('content-length') || 0) > MAX_BODY) return tooLarge();
  // Browsers always send Origin on this POST; analytics.js posts from the same site.
  if (request.headers.get('origin') !== new URL(request.url).origin) return new Response('Origin not allowed', { status: 403, headers: { 'cache-control': 'no-store' } });
  if (overLimit(request.headers.get('cf-connecting-ip') || 'unknown', Date.now())) return new Response('Too many events', { status: 429, headers: { 'cache-control': 'no-store', 'retry-after': '60' } });
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
