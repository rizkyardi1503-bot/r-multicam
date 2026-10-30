const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict'),{stripTypeScriptTypes}=require('node:module');
let handler,inserted,authCalls=0,secret='';
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
 await handler(req({event_name:'page_view'},undefined,'',{...geo,'x-rp-proxy-secret':'forged-fixture'}));assert.equal(inserted.country_code,null);assert.equal(inserted.region,null);
 await handler(req({event_name:'page_view'},undefined,'',{'cf-ipcountry':'SG'}));assert.equal(inserted.country_code,null,'browser cf-* headers are not trusted once the proxy secret is set');
 await handler(req({event_name:'page_view'},undefined,'',{...geo,'x-rp-geo-country':'<script>','x-rp-geo-region':'%E0%A4%A'}));assert.equal(inserted.country_code,null);assert.equal(inserted.region,null);
 secret='';
 console.log('PASS analytics Edge: chatgpt.site origin removed; geo from cf-* without secret, from the proxy only with the shared secret, forged/garbled geo dropped');

 // Pages Function proxy (functions/api/analytics.js).
 const proxySrc=fs.readFileSync(path.resolve(__dirname,'../functions/api/analytics.js'),'utf8').replace(/^export async function /m,'async function ')+';globalThis.onRequestPost=onRequestPost;';
 const forwarded=[];const pctx={Request,Response,Headers,AbortSignal,fetch:async(url,o)=>{forwarded.push({url,headers:new Headers(o.headers),body:o.body});return new Response(null,{status:204});}};
 vm.runInNewContext(proxySrc,pctx);
 const preq=(headers={},body='{"event_name":"page_view"}')=>{const r=new Request('https://r-multicam.pages.dev/api/analytics',{method:'POST',headers:{'content-type':'application/json',origin:'https://r-multicam.pages.dev','user-agent':'UA-fixture','x-rp-proxy-secret':'client-forged','x-rp-geo-country':'XX',...headers},body});Object.defineProperty(r,'cf',{value:{country:'ID',region:'Jakarta'}});return r;};
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
 console.log('PASS analytics proxy: forwards body/origin/UA/auth, adds cf country/region + secret only when configured, drops client-sent proxy headers, size limit, end-to-end country stored');
})().catch(e=>{console.error(e);process.exitCode=1;});
