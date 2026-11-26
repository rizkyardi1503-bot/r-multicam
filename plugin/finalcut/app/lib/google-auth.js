// Google sign-in for the DaVinci engine: the same flow as the Premiere plugin (plugin/windows/Plugin/plugin-google-auth.js).
// The website page https://r-multicam.pages.dev/#plugin-google=... sends the user to Supabase Google OAuth (PKCE) and
// returns a one-use authorization code to a one-shot listener on 127.0.0.1. The PKCE verifier never leaves this process.
'use strict';
const http = require('http'), crypto = require('crypto');

const SITE = 'https://r-multicam.pages.dev/';
const TIMEOUT_MS = 300000;

function b64(buffer) { return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function coded(message, code) { const e = new Error(message); e.code = code; return e; }

/**
 * Start a Google sign-in. Resolves { link, result } once the callback listener is up: open `link` in a browser;
 * `result` resolves { code, verifier } or rejects (GOOGLE_DENIED / GOOGLE_CANCELLED / GOOGLE_TIMEOUT / GOOGLE_CALLBACK).
 */
async function startGoogle({ timeoutMs = TIMEOUT_MS, host = 'davinci' } = {}) {
  let verifier = b64(crypto.randomBytes(32));
  const state = crypto.randomBytes(32).toString('hex');
  const challenge = b64(crypto.createHash('sha256').update(verifier).digest());
  const route = '/rproject-auth/' + state;
  let port = 0, timer = null, finished = false, resolveResult, rejectResult;
  const result = new Promise((resolve, reject) => { resolveResult = resolve; rejectResult = reject; });
  result.catch(() => {});                       // handled by the caller; never an unhandled rejection
  const server = http.createServer((req, res) => {
    res.setHeader('Connection', 'close'); res.setHeader('Cache-Control', 'no-store'); res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'"); res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    let u;
    try { u = new URL(req.url, 'http://127.0.0.1'); } catch (e) { res.statusCode = 400; res.end('Invalid request'); return; }
    if (finished || req.method !== 'GET' || req.headers.host !== '127.0.0.1:' + port || u.pathname !== route) { res.statusCode = 404; res.end('Not found'); return; }
    if (u.searchParams.has('error')) { res.end('Google sign-in was cancelled. Return to R Project Engine to retry.'); finish(coded('Google sign-in was cancelled or denied.', 'GOOGLE_DENIED')); return; }
    const code = u.searchParams.get('code');
    if (!code || code.length > 2048 || u.searchParams.getAll('code').length !== 1) { res.statusCode = 400; res.end('Missing authorization code'); return; }
    res.end('Login received. Return to R Project Engine: it is verifying your account and license. You can close this tab.');
    finish(null, code);
  });
  server.requestTimeout = 10000; server.headersTimeout = 10000;
  function finish(error, code) {
    if (finished) return;
    finished = true; clearTimeout(timer);
    try { server.close(); } catch (e) { /* closed */ }
    if (error) rejectResult(error); else resolveResult({ code, verifier });
    verifier = '';
  }
  const callbackError = () => coded('Could not start the local Google callback. Check firewall settings or use email login.', 'GOOGLE_CALLBACK');
  await new Promise((resolve, reject) => {
    server.once('error', () => reject(callbackError()));
    server.listen(0, '127.0.0.1', resolve);
  });
  server.on('error', () => finish(callbackError()));
  port = server.address().port;
  timer = setTimeout(() => finish(coded('Google sign-in timed out. Click Continue with Google to retry.', 'GOOGLE_TIMEOUT')), timeoutMs);
  if (timer.unref) timer.unref();
  // Only the challenge and a one-use state leave the engine. The verifier stays in memory.
  const link = SITE + '#plugin-google=' + encodeURIComponent(JSON.stringify({ port, state, challenge, host }));
  return { link, port, state, challenge, result, cancel: () => finish(coded('Google sign-in cancelled.', 'GOOGLE_CANCELLED')) };
}

/** Clear messages for Google sign-in errors (as account-auth.js googleError). */
function googleMessage(e) {
  const m = String(e && e.message || e || ''), c = e && e.code || '';
  if (c === 'GOOGLE_TIMEOUT') return 'Google sign-in timed out before your browser returned. Click Continue with Google and finish in the browser within 5 minutes, or use email login.';
  if (c === 'GOOGLE_CANCELLED') return 'Google sign-in was cancelled. Click Continue with Google to retry, or use email login.';
  if (c === 'GOOGLE_DENIED') return 'Google sign-in was cancelled or access was denied in the browser. Click Continue with Google to retry.';
  if (c === 'GOOGLE_CALLBACK') return 'R Project Engine could not receive the Google sign-in response on this computer (local callback blocked). Check firewall or security software, or use email login.';
  if (/flow[_ ]state|code[_ ]verifier|code[_ ]challenge|auth[_ ]code|invalid[_ ]grant/i.test(m)) return 'The Google sign-in link expired or was already used. Click Continue with Google again and finish in the browser.';
  return m;
}

module.exports = { startGoogle, googleMessage, TIMEOUT_MS };
