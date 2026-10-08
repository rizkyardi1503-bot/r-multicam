const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict'),{stripTypeScriptTypes}=require('node:module');
const root=path.resolve(__dirname,'..');
function load(slug,fetch){let handler;let source=fs.readFileSync(path.join(root,'supabase/functions',slug,'index.ts'),'utf8').replace(/^import .*;\n/m,'');source=stripTypeScriptTypes(source);vm.runInNewContext(source,{Deno:{serve:f=>handler=f,env:{get:n=>n==='SUPABASE_URL'?'https://api.test':'mock'}},fetch,Request,Response,Headers,URL,AbortSignal});return handler;}
(async()=>{
const manifest=load('plugin-update-manifest',()=>{throw Error('Unexpected fetch');});
for(const os of ['windows','macos'])for(const v of ['2.3.10.137','2.3.11.0','2.3.11.1','2.3.11.2','2.3.11.3','bad']){let d=await(await manifest(new Request('https://test?platform='+os+'&v='+v))).json();assert.equal(d.version,'2.3.11.2');assert.equal(d.minimum_version,'2.3.11.2');assert.equal(d.grace_period_days,0);assert.equal(d.required,!['2.3.11.2','2.3.11.3'].includes(v));assert.equal(d.platform,os);assert.equal(d[os+'_sha256'].length,64);}
let source='';const download=load('plugin-update-download',async url=>{source=url;return new Response(new Uint8Array([80,75,3,4]));});
for(const os of ['windows','macos']){let r=await download(new Request('https://test?platform='+os));assert.equal(r.status,200);assert(r.headers.get('content-disposition').includes('v2.3.11.2-PUBLIC.zip'));assert(source.includes('/58a692fada04e3ba3c17b28aa5ddc028679e7c97/'));}
assert.equal((await download(new Request('https://test?platform=windows&version=2.3.11.1'))).status,404);assert.equal((await download(new Request('https://test?platform=macos&version=2.3.11.1'))).status,200);assert.equal((await download(new Request('https://test?version=unknown'))).status,404);
let confirmed=true;const website=load('website-download',async url=>{if(url.endsWith('/auth/v1/user'))return Response.json({id:'test',email_confirmed_at:confirmed?'2026':null});if(url.includes('/storage/'))return new Response('',{status:404});source=url;return new Response(new Uint8Array([80,75,3,4]));});
const req=(os,auth=true)=>new Request('https://test?platform='+os,{headers:{origin:'https://r-multicam.pages.dev',...(auth?{authorization:'Bearer mock'}:{})}});
assert.equal((await website(req('macos',false))).status,401);confirmed=false;assert.equal((await website(req('macos'))).status,403);confirmed=true;
for(const os of ['windows','macos']){let r=await website(req(os));assert.equal(r.status,200);assert(r.headers.get('content-disposition').includes('v2.3.11.2-PUBLIC.zip'));assert(source.includes('/58a692fada04e3ba3c17b28aa5ddc028679e7c97/'));assert.equal(r.headers.get('cache-control'),'private, no-store, max-age=0');assert.equal(r.headers.get('access-control-allow-origin'),'https://r-multicam.pages.dev');}
assert(fs.readFileSync(path.join(root,'site/portal.js'),'utf8').includes("windows:'2.3.11.2',macos:'2.3.11.2'"));
console.log('PASS 2.3.11.2 manifest/minima/zero-grace/version comparisons/pinned downloads/old versions/website auth/CORS');
})().catch(e=>{console.error(e);process.exitCode=1;});
