const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict'),{stripTypeScriptTypes}=require('node:module');
let handler,inserted,authCalls=0;
const raw=fs.readFileSync(path.resolve(__dirname,'../supabase/functions/website-analytics/index.ts'),'utf8').replace(/^import .*;\r?\n/m,'');
vm.runInNewContext(stripTypeScriptTypes(raw),{Deno:{serve:f=>handler=f,env:{get:n=>n==='SUPABASE_URL'?'https://api.test':'fixture-key'}},Request,Response,AbortSignal,
 fetch:async(url,options)=>{if(url.endsWith('/auth/v1/user')){authCalls++;return{ok:options.headers.authorization==='Bearer valid-fixture',json:async()=>({id:'12345678-1234-4123-8123-123456789abc'})};}inserted=JSON.parse(options.body);return{ok:true};}});
const req=(body,origin='https://r-multicam.pages.dev',token='')=>new Request('https://edge.test',{method:'POST',headers:{origin,'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},body:JSON.stringify(body)});
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
})().catch(e=>{console.error(e);process.exitCode=1;});
