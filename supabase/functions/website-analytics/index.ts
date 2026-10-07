import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const allowedOrigins = new Set([
  "https://r-multicam.pages.dev",
  "https://r-project-multicam-ai.rizkyardi1503.chatgpt.site",
  "http://127.0.0.1:8765"
]);

const allowedEvents = new Set([
  "page_view","pricing_view","trial_cta_clicked","demo_started","signup_submitted","login_success",
  "download_requested","download_started","checkout_started",
  "checkout_created","purchase_paid","guide_opened","compatibility_checked","checkout_opened"
]);

function cors(req: Request) {
  const origin = req.headers.get("origin") || "";
  return {
    ...(allowedOrigins.has(origin) ? {"access-control-allow-origin":origin} : {}),
    "access-control-allow-headers":"authorization, apikey, content-type",
    "access-control-allow-methods":"POST, OPTIONS",
    "vary":"Origin"
  };
}
function clean(value: unknown, max: number) {
  if (typeof value !== "string") return null;
  const v=value.trim();
  return v ? v.slice(0,max) : null;
}
function deviceFromUa(ua:string){
  if(/iPad|Tablet|Android(?!.*Mobile)/i.test(ua))return "tablet";
  if(/Mobi|iPhone|Android/i.test(ua))return "mobile";
  return "desktop";
}
function osFromUa(ua:string){
  if(/Windows/i.test(ua))return "windows";
  if(/iPhone|iPad|iPod/i.test(ua))return "ios";
  if(/Macintosh|Mac OS X/i.test(ua))return "macos";
  if(/Android/i.test(ua))return "android";
  if(/Linux/i.test(ua))return "linux";
  return "other";
}

Deno.serve(async (req: Request) => {
  const h=cors(req);
  if(req.method==="OPTIONS") return new Response(null,{status:204,headers:h});
  if(req.method!=="POST") return new Response("Method not allowed",{status:405,headers:h});

  const origin=req.headers.get("origin")||"";
  if(origin && !allowedOrigins.has(origin)) return new Response("Origin not allowed",{status:403,headers:h});

  const body=await req.json().catch(()=>null);
  if(!body || !allowedEvents.has(body.event_name)) return new Response("Invalid event",{status:400,headers:h});

  const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const visitorId=typeof body.visitor_id==="string"&&uuid.test(body.visitor_id)?body.visitor_id:null;
  const sessionId=typeof body.session_id==="string"&&uuid.test(body.session_id)?body.session_id:null;

  const supabaseUrl=Deno.env.get("SUPABASE_URL")!;
  const serviceKey=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  let userId:null|string=null;
  const auth=(req.headers.get("authorization")||"").replace(/^Bearer\s+/i,"");
  if(auth){
    const identity=await fetch(supabaseUrl+"/auth/v1/user",{
      headers:{apikey:serviceKey,authorization:"Bearer "+auth},
      signal:AbortSignal.timeout(6000)
    }).catch(()=>null);
    if(identity?.ok){
      const u=await identity.json();
      if(u?.id)userId=u.id;
    }
  }

  const ua=req.headers.get("user-agent")||"";
  const supplied=body.metadata && typeof body.metadata==="object" && !Array.isArray(body.metadata)
    ? (JSON.stringify(body.metadata).length <= 2000 ? body.metadata : {})
    : {};
  const metadata:Record<string,string|number|boolean|null>={};
  for(const key of ["title","label","position","requires_confirmation","method","platform","filename","price_idr","promo_code_used","amount_idr","content_id","entry_point","premiere_major","ram_bucket","result","reporting_exclude"]){
    const value=supplied[key];
    if(typeof value==="string")metadata[key]=value.slice(0,key==="title"?200:100);
    else if(typeof value==="boolean"||value===null)metadata[key]=value;
    else if(typeof value==="number"&&Number.isFinite(value))metadata[key]=value;
  }

  const row={
    event_name:body.event_name,
    visitor_id:visitorId,
    session_id:sessionId,
    user_id:userId,
    path:(clean(body.path,500)||"/").split(/[?#]/)[0],
    referrer_host:clean(body.referrer_host,255),
    utm_source:clean(body.utm_source,120),
    utm_medium:clean(body.utm_medium,120),
    utm_campaign:clean(body.utm_campaign,200),
    country_code:clean(req.headers.get("cf-ipcountry"),3),
    region:clean(req.headers.get("cf-region"),120),
    device_type:deviceFromUa(ua),
    os_family:osFromUa(ua),
    metadata
  };

  const ins=await fetch(supabaseUrl+"/rest/v1/website_analytics_events",{
    method:"POST",
    headers:{
      apikey:serviceKey,
      authorization:"Bearer "+serviceKey,
      "content-type":"application/json",
      prefer:"return=minimal"
    },
    body:JSON.stringify(row),
    signal:AbortSignal.timeout(6000)
  });
  if(!ins.ok)return new Response("Analytics unavailable",{status:503,headers:h});
  return new Response(null,{status:204,headers:h});
});
