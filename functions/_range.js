// Serves static files with HTTP byte ranges. Cloudflare Pages answers every request with the full file (200), and
// Safari/iOS (including the Instagram in-app browser) will not play a <video> unless a range request gets a 206.
export async function serveWithRanges({ request, env }) {
  const full = await env.ASSETS.fetch(new Request(request.url, { method: 'GET' }));
  const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get('Range') || '');
  const headers = new Headers(full.headers);
  headers.set('Accept-Ranges', 'bytes');
  if (full.status !== 200 || !range || (!range[1] && !range[2])) {
    return new Response(full.body, { status: full.status, headers });
  }
  const body = await full.arrayBuffer(), size = body.byteLength;
  let start = range[1] ? Number(range[1]) : size - Number(range[2]);
  let end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
  if (start < 0) start = 0;
  if (start >= size || start > end) {
    headers.set('Content-Range', `bytes */${size}`);
    return new Response(null, { status: 416, headers });
  }
  headers.set('Content-Range', `bytes ${start}-${end}/${size}`);
  headers.set('Content-Length', String(end - start + 1));
  return new Response(body.slice(start, end + 1), { status: 206, headers });
}
