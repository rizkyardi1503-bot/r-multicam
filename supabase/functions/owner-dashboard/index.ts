import "jsr:@supabase/functions-js/edge-runtime.d.ts";
const origins = new Set(['https://r-multicam.pages.dev','http://127.0.0.1:8765']);
Deno.serve(async (req: Request) => {
 const origin=req.headers.get('origin')||'';
 const headers={'content-type':'application/json','cache-control':'no-store','vary':'Origin',...(origins.has(origin)?{'access-control-allow-origin':origin}:{}),'access-control-allow-methods':'POST, OPTIONS','access-control-allow-headers':'authorization,apikey,content-type'};
 const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers});
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
 if(req.method!=='POST')return json({error:'METHOD_NOT_ALLOWED'},405);
 if(origin&&!origins.has(origin))return json({error:'ORIGIN_NOT_ALLOWED'},403);
 try {
  const url=Deno.env.get('SUPABASE_URL')!,key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const token=(req.headers.get('authorization')||'').replace(/^Bearer\s+/i,'');
  if(!token)return json({error:'Sign in first.'},401);
  const identity=await fetch(url+'/auth/v1/user',{headers:{apikey:key,authorization:'Bearer '+token},signal:AbortSignal.timeout(8000)});
  if(!identity.ok)return json({error:'Sign in again.'},401);
  const user=await identity.json();
  if(!user.id||!user.email_confirmed_at)return json({error:'Owner access required.'},403);
  const admin={apikey:key,authorization:'Bearer '+key};
  const roleResponse=await fetch(url+'/rest/v1/plugin_profiles?select=account_role&user_id=eq.'+encodeURIComponent(user.id),{headers:admin,signal:AbortSignal.timeout(8000)});
  if(!roleResponse.ok)throw Error('role query');
  const roles=await roleResponse.json();
  if(roles[0]?.account_role!=='owner')return json({error:'Owner access required.'},403);
  const input=await req.json().catch(()=>({}));
  const days=Number(input.days??7);
  if(![1,7,28].includes(days))return json({error:'Choose today, 7 or 28 days.'},400);
  // WITA calendar days, not browser timezone or a rolling 24-hour window.
  const now=new Date(),today=new Date(now.getTime()+8*3600000).toISOString().slice(0,10);
  const start=new Date(Date.parse(today+'T00:00:00+08:00')-(days-1)*86400000).toISOString(),end=now.toISOString();
  async function rows(table:string,select:string,time:string,extra='') {
   const all:Record<string,any>[]=[];
   for(let offset=0;offset<50000;offset+=1000){
    const p=new URLSearchParams({select,order:time+'.asc,id.asc',limit:'1000',offset:String(offset)});
    // Profiles use user_id rather than id; deterministic ordering avoids duplicate pages.
    if(table==='plugin_profiles')p.set('order',time+'.asc,user_id.asc');
    p.append(time,'gte.'+start);p.append(time,'lte.'+end);
    const r=await fetch(url+'/rest/v1/'+table+'?'+p+extra,{headers:admin,signal:AbortSignal.timeout(10000)});
    if(!r.ok)throw Error('aggregate query');
    const page=await r.json();all.push(...page);
    if(page.length<1000)return all;
   }
   throw Error('Window exceeds dashboard row limit; use a shorter period.');
  }
  const ownersResponse=await fetch(url+'/rest/v1/plugin_profiles?select=user_id&account_role=eq.owner',{headers:admin,signal:AbortSignal.timeout(8000)});
  if(!ownersResponse.ok)throw Error('owner query');
  const ownerIds=new Set((await ownersResponse.json()).map((x:any)=>x.user_id));
  const [events,activations,paid]=await Promise.all([
   rows('website_analytics_events','id,event_name,occurred_at,visitor_id,user_id,utm_source,referrer_host,metadata','occurred_at'),
   rows('plugin_profiles','user_id,first_activated_at,trial_started_at,device_platform,plugin_version','first_activated_at','&account_role=neq.owner'),
   rows('plugin_payment_orders','id,user_id,paid_at,gross_amount_idr','paid_at')
  ]);
  const isExcluded=(x:Record<string,any>)=>x.metadata?.reporting_exclude===true||ownerIds.has(x.user_id)||x.utm_source==='qa';
  const excluded=events.filter(isExcluded);
  const clean=events.filter(x=>!isExcluded(x));
  const visitors=(name:string)=>new Set(clean.filter(x=>x.event_name===name&&x.visitor_id).map(x=>x.visitor_id)).size;
  const views=clean.filter(x=>x.event_name==='page_view');
  const groups:Record<string,Set<string>>=Object.create(null),daily:Record<string,{views:number,visitors:Set<string>}>=Object.create(null);
  function sourceFor(e:Record<string,any>){const campaign=String(e.utm_source||'').trim().toLowerCase();if(campaign)return ['ig','insta'].includes(campaign)?'instagram':campaign==='thread'?'threads':campaign;const host=String(e.referrer_host||'').toLowerCase();if(!host||host==='r-multicam.pages.dev'||host==='accounts.google.com'||host.endsWith('.supabase.co'))return 'direct / unattributed';if(/(^|\.)instagram\.com$/.test(host))return 'instagram';if(/(^|\.)threads\.(net|com)$/.test(host))return 'threads';return host;}
  for(const e of views){const source=sourceFor(e);(groups[source]??=new Set()).add(e.visitor_id||'');const day=new Date(Date.parse(e.occurred_at)+8*3600000).toISOString().slice(0,10);const d=daily[day]??={views:0,visitors:new Set()};d.views++;if(e.visitor_id)d.visitors.add(e.visitor_id);}
  const customers=paid.filter(x=>!ownerIds.has(x.user_id));
  return json({generated_at:end,start,end,timezone:'Asia/Makassar',excluded_events:excluded.length,
   metrics:{visitors:visitors('page_view'),page_views:views.length,pricing_visitors:visitors('pricing_view'),trial_click_visitors:visitors('trial_cta_clicked'),signup_submissions:visitors('signup_submitted'),download_visitors:visitors('download_started'),plugin_activations:activations.length,trial_activations:activations.filter(x=>x.trial_started_at).length,checkout_visitors:visitors('checkout_created'),paid_orders:customers.length,paid_customers:new Set(customers.map(x=>x.user_id)).size,revenue_idr:customers.reduce((a,x)=>a+Number(x.gross_amount_idr||0),0)},
   sources:Object.entries(groups).map(([source,ids])=>({source,visitors:[...ids].filter(Boolean).length})).sort((a,b)=>b.visitors-a.visitors),
   daily:Object.entries(daily).map(([date,d])=>({date,views:d.views,visitors:d.visitors.size})).sort((a,b)=>a.date.localeCompare(b.date)),
   notes:['Counts are independent stage totals, not a matched-person conversion cohort.','Browser events can be blocked or forged; activation and payment totals use server records.','Known owner and marked test events excluded. Anonymous historical owner visits cannot be identified retroactively.','Trial activations shown here belong to first plugin activations in this period.']});
 } catch {return json({error:'Dashboard could not load completely. Try a shorter period or refresh.'},503);}
});

