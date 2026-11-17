const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict'),{stripTypeScriptTypes}=require('node:module');
let handler,inserted,authCalls=0,secret='';
// supabase/config.toml matches the functions in the repo and the deployed verify_jwt settings.
{const toml=fs.readFileSync(path.resolve(__dirname,'../supabase/config.toml'),'utf8');const tables=Object.fromEntries([...toml.matchAll(/^\[functions\.([a-z-]+)\]\r?\nverify_jwt = (true|false)/gm)].map(m=>[m[1],m[2]==='true']));
 const slugs=fs.readdirSync(path.resolve(__dirname,'../supabase/functions')).filter(n=>fs.existsSync(path.resolve(__dirname,'../supabase/functions',n,'index.ts'))).sort();assert.deepEqual(Object.keys(tables).sort(),slugs,'every function in the repo has a config table');
 const off=['midtrans-lifetime-webhook','plugin-update-download','plugin-update-manifest','website-analytics'];for(const slug of slugs)assert.equal(tables[slug],!off.includes(slug),slug);
 console.log('PASS supabase/config.toml: verify_jwt off only for webhook, analytics and update functions');}
const raw=fs.readFileSync(path.resolve(__dirname,'../supabase/functions/website-analytics/index.ts'),'utf8').replace(/^import .*;\r?\n/m,'');
vm.runInNewContext(stripTypeScriptTypes(raw),{Deno:{serve:f=>handler=f,env:{get:n=>n==='SUPABASE_URL'?'https://api.test':n==='ANALYTICS_PROXY_SECRET'?secret:'fixture-key'}},Request,Response,AbortSignal,
 fetch:async(url,options)=>{if(url.endsWith('/auth/v1/user')){authCalls++;return{ok:options.headers.authorization==='Bearer valid-fixture',json:async()=>({id:'12345678-1234-4123-8123-123456789abc'})};}inserted=JSON.parse(options.body);return{ok:true};}});
const req=(body,origin='https://r-multicam.pages.dev',token='',extra={})=>new Request('https://edge.test',{method:'POST',headers:{origin,'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{}),...extra},body:JSON.stringify(body)});
(async()=>{
 for(const event_name of ['guide_opened','compatibility_checked','checkout_opened']){
  const result=await handler(req({event_name,user_id:'forged-user',path:'/test?code=private#token',metadata:{content_id:'t02_demo',reporting_exclude:true,password:'must-not-store',result:'low_memory'}}));
  assert.equal(result.status,204);assert.equal(inserted.user_id,null);assert.equal(inserted.path,'/test');assert(!('password' in inserted.metadata));assert.equal(inserted.metadata.content_id,'t02_demo');
 }
 assert.equal(authCalls,0);
 assert.equal((await handler(req({event_name:'made_up'}))).status,400);
 assert.equal((await handler(req({event_name:'page_view'},'https://evil.test'))).status,403);
 await handler(req({event_name:'checkout_opened'},undefined,'invalid'));assert.equal(inserted.user_id,null);
 await handler(req({event_name:'checkout_opened',user_id:'forged'},undefined,'valid-fixture'));assert.equal(inserted.user_id,'12345678-1234-4123-8123-123456789abc');
 console.log('PASS analytics Edge: new events, verified identity only, origin guard, private query stripped and metadata allowlist');
 // Old chatgpt.site origin is gone.
 assert.equal((await handler(req({event_name:'page_view'},'https://r-project-multicam-ai.rizkyardi1503.chatgpt.site'))).status,403);
 // Country/region: without ANALYTICS_PROXY_SECRET the old cf-* headers are read (current behaviour).
 const geo={'cf-ipcountry':'SG','cf-region':'Central','x-rp-proxy-secret':'proxy-fixture','x-rp-geo-country':'ID','x-rp-geo-region':encodeURIComponent('Jawa Barat')};
 secret='';await handler(req({event_name:'page_view'},undefined,'',geo));assert.equal(inserted.country_code,'SG');assert.equal(inserted.region,'Central');
 // With the secret: only the proxy's headers count, and only with the right secret.
 secret='proxy-fixture';await handler(req({event_name:'page_view'},undefined,'',geo));assert.equal(inserted.country_code,'ID');assert.equal(inserted.region,'Jawa Barat');
 await handler(req({event_name:'page_view'},undefined,'',{...geo,'x-rp-geo-country':'<script>','x-rp-geo-region':'%E0%A4%A'}));assert.equal(inserted.country_code,null);assert.equal(inserted.region,null);
 // With the secret every event must carry it: direct posts are refused before anything is read or stored.
 const authBefore=authCalls;inserted=null;
 assert.equal((await handler(req({event_name:'page_view'},undefined,'valid-fixture',{...geo,'x-rp-proxy-secret':'forged-fixture'}))).status,403);
 assert.equal((await handler(req({event_name:'page_view'},undefined,'valid-fixture',{'cf-ipcountry':'SG'}))).status,403);
 assert.equal(inserted,null,'nothing stored');assert.equal(authCalls,authBefore,'no auth lookup');
 secret='';
 console.log('PASS analytics Edge: chatgpt.site origin removed; geo from cf-* without secret, from the proxy only with the shared secret, garbled geo dropped; direct posts refused once the secret is set');
 // A POST without an Origin is refused with or without the secret; the browser preflight still works.
 const noOrigin=()=>new Request('https://edge.test',{method:'POST',headers:{'content-type':'application/json'},body:'{"event_name":"page_view"}'});
 inserted=null;assert.equal((await handler(noOrigin())).status,403);secret='proxy-fixture';assert.equal((await handler(noOrigin())).status,403);secret='';assert.equal(inserted,null);
 assert.equal((await handler(new Request('https://edge.test',{method:'OPTIONS',headers:{origin:'https://r-multicam.pages.dev'}}))).status,204);
 console.log('PASS analytics Edge: no Origin refused');
 // Device and OS from the user agent. Instagram on an Android phone repeats "Android" after "Mobile Safari"
 // ("... Instagram 312.1.0.34.111 Android (33/13; ...)"), which once counted every such phone as a tablet.
 for(const [ua,device,os] of [
  ['Mozilla/5.0 (Linux; Android 13; SM-A536E Build/TP1A.220624.014; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.6099.144 Mobile Safari/537.36 Instagram 312.1.0.34.111 Android (33/13; 450dpi; 1080x2192; samsung; SM-A536E; a53x; s5e8825; in_ID; 548323757)','mobile','android'],
  ['Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36','mobile','android'],
  ['Mozilla/5.0 (Linux; Android 13; SM-A536E Build/TP1A.220624.014; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.6099.144 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/447.0.0.37.106;]','mobile','android'],
  ['Mozilla/5.0 (Android 14; Mobile; rv:121.0) Gecko/121.0 Firefox/121.0','mobile','android'],
  ['Mozilla/5.0 (Linux; Android 13; SM-X200) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36','tablet','android'],
  ['Mozilla/5.0 (Android 14; Tablet; rv:121.0) Gecko/121.0 Firefox/121.0','tablet','android'],
  ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 312.0.1.19.124 (iPhone14,5; iOS 17_1; id_ID; id; scale=3.00; 1170x2532; 548026366)','mobile','ios'],
  ['Mozilla/5.0 (iPad; CPU OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 312.0.1.19.124 (iPad13,4; iPadOS 17_1; id_ID; id; scale=2.00; 1640x2360; 548026366)','tablet','ios'],
  ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36','desktop','windows'],
  ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15','desktop','macos']
 ]){inserted=null;assert.equal((await handler(req({event_name:'page_view'},undefined,'',{'user-agent':ua}))).status,204);assert.equal(inserted.device_type,device,ua);assert.equal(inserted.os_family,os,ua);}
 console.log('PASS analytics Edge: device and OS from the user agent; Instagram on an Android phone counts as mobile');

 // Pages Function proxy (functions/api/analytics.js).
 const proxySrc=fs.readFileSync(path.resolve(__dirname,'../functions/api/analytics.js'),'utf8').replace(/^export async function /m,'async function ')+';globalThis.onRequestPost=onRequestPost;';
 const forwarded=[];const pctx={Request,Response,Headers,URL,AbortSignal,fetch:async(url,o)=>{forwarded.push({url,headers:new Headers(o.headers),body:o.body});return new Response(null,{status:204});}};
 vm.runInNewContext(proxySrc,pctx);
 let ipCounter=0;const preq=(headers={},body='{"event_name":"page_view"}')=>{headers={'cf-connecting-ip':'10.0.0.'+(++ipCounter),...headers};const r=new Request('https://r-multicam.pages.dev/api/analytics',{method:'POST',headers:{'content-type':'application/json',origin:'https://r-multicam.pages.dev','user-agent':'UA-fixture','x-rp-proxy-secret':'client-forged','x-rp-geo-country':'XX',...headers},body});Object.defineProperty(r,'cf',{value:{country:'ID',region:'Jakarta'}});return r;};
 let pr=await pctx.onRequestPost({request:preq({authorization:'Bearer user-fixture'}),env:{ANALYTICS_PROXY_SECRET:'proxy-fixture'}});
 assert.equal(pr.status,204);let f=forwarded.pop();
 assert.equal(f.url,'https://ngotkvqtzqiotztnqwaw.supabase.co/functions/v1/website-analytics');assert.equal(f.body,'{"event_name":"page_view"}');
 assert.equal(f.headers.get('x-rp-proxy-secret'),'proxy-fixture');assert.equal(f.headers.get('x-rp-geo-country'),'ID');assert.equal(decodeURIComponent(f.headers.get('x-rp-geo-region')),'Jakarta');
 assert.equal(f.headers.get('origin'),'https://r-multicam.pages.dev');assert.equal(f.headers.get('user-agent'),'UA-fixture');assert.equal(f.headers.get('authorization'),'Bearer user-fixture');
 pr=await pctx.onRequestPost({request:preq(),env:{}});f=forwarded.pop();
 assert.equal(f.headers.get('x-rp-proxy-secret'),null,'client-sent secret is never forwarded');assert.equal(f.headers.get('x-rp-geo-country'),null,'no geo without the Pages secret');
 pr=await pctx.onRequestPost({request:preq({},'x'.repeat(5000)),env:{}});assert.equal(pr.status,413);assert.equal(forwarded.length,0);
 let read=false;pr=await pctx.onRequestPost({request:{headers:new Headers({'content-length':'999999'}),text:async()=>{read=true;return '';}},env:{}});assert.equal(pr.status,413);assert.equal(read,false,'declared oversize body is refused before it is read');
 // End to end: proxy -> function stores the proxy's country.
 secret='proxy-fixture';pctx.fetch=async(url,o)=>handler(new Request(url,{method:'POST',headers:o.headers,body:o.body}));
 pr=await pctx.onRequestPost({request:preq(),env:{ANALYTICS_PROXY_SECRET:'proxy-fixture'}});assert.equal(pr.status,204);assert.equal(inserted.country_code,'ID');assert.equal(inserted.region,'Jakarta');secret='';
 // Origin: this site only, and a missing one is refused.
 secret='';forwarded.length=0;pctx.fetch=async(url,o)=>{forwarded.push({url,headers:new Headers(o.headers),body:o.body});return new Response(null,{status:204});};
 const bare=new Request('https://r-multicam.pages.dev/api/analytics',{method:'POST',body:'{}'});assert.equal((await pctx.onRequestPost({request:bare,env:{}})).status,403);
 assert.equal((await pctx.onRequestPost({request:preq({origin:'https://evil.test'}),env:{}})).status,403);assert.equal(forwarded.length,0,'nothing forwarded');
 // Rate limit: per IP, per minute and per day; other visitors are unaffected, and nothing goes upstream when limited.
 let clock=Date.UTC(2026,10,5,1,0,0);vm.runInContext('Date.now=()=>globalThis.__clock',pctx);pctx.__clock=clock;
 const hit=(ip)=>pctx.onRequestPost({request:preq({'cf-connecting-ip':ip}),env:{}});
 for(let i=0;i<60;i++)assert.equal((await hit('1.1.1.1')).status,204);
 const before=forwarded.length,limited=await hit('1.1.1.1');assert.equal(limited.status,429);assert.equal(limited.headers.get('retry-after'),'60');assert.equal(forwarded.length,before,'a limited event is not forwarded');
 assert.equal((await hit('2.2.2.2')).status,204,'another visitor is not limited');
 let sent=61;pctx.__clock=clock+=60000;assert.equal((await hit('1.1.1.1')).status,204,'next minute is open again');sent++;
 while(sent<600){pctx.__clock=clock+=60000;for(let i=0;i<60&&sent<600;i++,sent++)assert.equal((await hit('1.1.1.1')).status,204);}
 pctx.__clock=clock+=60000;assert.equal((await hit('1.1.1.1')).status,429,'daily limit');
 pctx.__clock=clock+=86400000;assert.equal((await hit('1.1.1.1')).status,204,'next day is open again');
 // The table of IPs stays bounded.
 for(let i=0;i<5100;i++)await hit('3.'+i);assert.equal(vm.runInContext('seen.size',pctx)<=5000,true);
 console.log('PASS analytics proxy limits: missing/foreign Origin refused, 60 a minute and 600 a day per IP, others unaffected, limited events not forwarded, bounded memory');
 console.log('PASS analytics proxy: forwards body/origin/UA/auth, adds cf country/region + secret only when configured, drops client-sent proxy headers, size limit, end-to-end country stored');
})().catch(e=>{console.error(e);process.exitCode=1;});
