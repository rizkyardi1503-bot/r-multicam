import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Online lifetime checkout is closed. This stub is deployed in place of create-lifetime-checkout,
// check-lifetime-payment and midtrans-lifetime-webhook; it reads and writes nothing.
// - Website and Premiere panel show `message` as-is, including plugins already installed (2.3.11.x).
// - Midtrans retries a notification that gets 503, so a late notification is processed once the real
//   webhook (supabase/functions/midtrans-lifetime-webhook) is deployed again.
// Reopen: deploy the three real functions from supabase/functions/ (webhook with verify_jwt off), then set
// checkoutOpen: true in site/config.js and CHECKOUT_OPEN = true in the plugin's panel.js.

const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, apikey, content-type, x-client-info",
  "access-control-allow-methods": "POST, OPTIONS"
};

Deno.serve((req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  return new Response(JSON.stringify({
    error: "CHECKOUT_CLOSED",
    message: "Online checkout is closed for now. Your trial and existing licenses are not affected."
  }), { status: 503, headers: { "content-type": "application/json", "retry-after": "86400", ...cors } });
});
