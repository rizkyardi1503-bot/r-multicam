const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const {stripTypeScriptTypes}=require('node:module');
const root=path.resolve(__dirname,'../supabase/functions');
function load(slug,fetch){let handler;let source=fs.readFileSync(path.join(root,slug,'index.ts'),'utf8').replace(/^import .*;\n/m,'');
 if(stripTypeScriptTypes)source=stripTypeScriptTypes(source);
 else source=source.replaceAll(': Record<string, string>','').replaceAll(': Record<string, { windows?: string; macos?: string }>','').replaceAll(': string | null','').replaceAll(': string','').replaceAll(': boolean','').replaceAll(': Request','');
 vm.runInNewContext(source,{Deno:{serve:f=>handler=f,env:{get:n=>n==='SUPABASE_URL'?'https://api.test':'test-key-not-a-secret'}},fetch,Request,Response,Headers,URL,AbortSignal});return handler;}
(async()=>{
 const versions={windows:'2.3.11.0',macos:'2.3.11.1'};
 const manifest=load('plugin-update-manifest',()=>{throw Error('Unexpected network');});
 for(const platform of ['windows','macos'])for(const installed of ['2.3.10.137','2.3.11.0','2.3.11.1','bad']){
  const d=await (await manifest(new Request('https://edge.test?platform='+platform+'&v='+installed))).json();
  assert.equal(d.version,versions[platform]);assert.equal(d.minimum_version,versions[platform]);assert.equal(d.platform,platform);
  assert.equal(d.required,installed==='bad'||installed==='2.3.10.137'||(platform==='macos'&&installed==='2.3.11.0'));
  assert.equal(d.grace_period_days,0);assert(d[platform+'_download'].endsWith('version='+versions[platform]));
  assert.equal(d.windows_sha256,'317f3412b0c0db3f4df5adc87e1f9e7668194f39217f094e38fb068bc0a052a2');
  assert.equal(d.macos_sha256,'f945488da9be7d45e97e6744d1ca4cde87b64583895bac1d74c1d24bebe1eded');
 }
 for(const [ua,platform] of [['Mozilla/5.0 (Macintosh; Intel Mac OS X)','macos'],['Windows NT','windows']])assert.equal((await (await manifest(new Request('https://edge.test',{headers:{'user-agent':ua}}))).json()).platform,platform);
 let source='';const download=load('plugin-update-download',async url=>{source=url;return new Response(new Uint8Array([80,75,3,4]));});
 for(const platform of ['windows','macos']){const r=await download(new Request('https://edge.test?platform='+platform));assert.equal(r.status,200);assert(r.headers.get('content-disposition').includes('v'+versions[platform]+'-PUBLIC.zip'));assert(source.includes('/'+(platform==='macos'?'245814b70cbac98a9fef9d2309571b3ff19c71e0':'2c60fe73ab57abeabc427532af282b2f21bcdf6b')+'/'));}
 assert.equal((await download(new Request('https://edge.test?platform=windows&version=2.3.11.1'))).status,404);
 assert.equal((await download(new Request('https://edge.test?version=unknown'))).status,404);
 assert.equal((await download(new Request('https://edge.test?platform=macos&version=2.3.11.0'))).status,200);
 let confirmed=true;const website=load('website-download',async url=>{
  if(url.endsWith('/auth/v1/user'))return Response.json({id:'test',email_confirmed_at:confirmed?'2026-10-08':null});
  if(url.includes('/storage/'))return new Response('',{status:404});source=url;return new Response(new Uint8Array([80,75,3,4]));
 });
 const req=(platform,auth=true)=>new Request('https://edge.test?platform='+platform,{headers:{origin:'https://r-multicam.pages.dev',...(auth?{authorization:'Bearer mock'}:{})}});
 assert.equal((await website(req('macos',false))).status,401);confirmed=false;assert.equal((await website(req('macos'))).status,403);confirmed=true;
 for(const platform of ['windows','macos']){const r=await website(req(platform));assert.equal(r.status,200);assert(r.headers.get('content-disposition').includes('v'+versions[platform]+'-PUBLIC.zip'));assert.equal(r.headers.get('access-control-allow-origin'),'https://r-multicam.pages.dev');assert.equal(r.headers.get('cache-control'),'private, no-store, max-age=0');assert(source.includes('/'+(platform==='macos'?'245814b70cbac98a9fef9d2309571b3ff19c71e0':'2c60fe73ab57abeabc427532af282b2f21bcdf6b')+'/'));}
 const portal=fs.readFileSync(path.join(__dirname,'../site/portal.js'),'utf8');assert(portal.includes("windows:'2.3.11.0',macos:'2.3.11.1'"));assert(portal.includes("devicePlatform==='darwin'"));
 console.log('PASS split Mac/Windows versions/minima, pinned downloads, confirmed-account/CORS checks; network and auth mocked');
})().catch(e=>{console.error(e);process.exitCode=1;});
