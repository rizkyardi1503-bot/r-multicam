const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert'),{webcrypto}=require('crypto');
async function analyticsTest(){
 const events=[];const w={};Object.defineProperty(w,'localStorage',{get(){throw Error('blocked')}});Object.defineProperty(w,'sessionStorage',{get(){throw Error('blocked')}});
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../site/analytics.js'),'utf8'),{window:w,crypto:webcrypto,localStorage:undefined,sessionStorage:undefined,URL,URLSearchParams,location:{search:'',pathname:'/'},document:{referrer:'',title:'Test',querySelectorAll:()=>[],getElementById:()=>null},fetch:async(u,o)=>{events.push(JSON.parse(o.body));return{};}});
 assert.equal(events[0].event_name,'page_view');assert.match(events[0].visitor_id,/^[0-9a-f-]{36}$/);console.log('PASS analytics survives blocked storage');
}
async function portalTest(){
 const els=new Map();const elem=()=>({hidden:false,value:'',textContent:'',dataset:{},classList:{toggle(){}},setAttribute(){},removeAttribute(){},replaceChildren(){},appendChild(){},remove(){},checkValidity(){return true},click(){},style:{}});
 const el=id=>{if(!els.has(id))els.set(id,elem());return els.get(id)};let restoredToken='saved';let mode='normal';let downloads=0;
 const portal=elem();portal.querySelector=q=>el(q.replace(/^#/,''));portal.querySelectorAll=()=>[];portal.showModal=()=>{portal.open=true};portal.close=()=>{portal.open=false};
 class TestURL extends URL{};TestURL.createObjectURL=()=>{downloads++;return 'blob:test'};TestURL.revokeObjectURL=()=>{};
 const w={RP_CONFIG:{supabaseUrl:'https://api.test',supabasePublishableKey:'public'},location:{pathname:'/',search:''},addEventListener(){}};
 const ctx={window:w,document:{createElement:t=>t==='dialog'?portal:elem(),body:{appendChild(){}},querySelectorAll:()=>[]},localStorage:{getItem:()=>null,setItem(){},removeItem(){restoredToken=null}},URL:TestURL,URLSearchParams,AbortSignal,Uint8Array,Date,setTimeout(){},fetch:async(u,o)=>{
  if(u.includes('/auth/v1/user'))return{ok:true,json:async()=>({id:'user1',email:'person@example.com'})};
  if(u.includes('/rest/v1/plugin_profiles'))return{ok:true,json:async()=>[{license_status:'trial',plugin_version:'2.3.10.137'}]};
  if(u.includes('/rest/v1/plugin_payment_orders'))return{ok:true,json:async()=>[]};
  if(u.includes('create-lifetime-checkout'))return{ok:true,json:async()=>({checkout_url:mode==='evil'?'https://app.midtrans.com.evil.test/':'https://app.midtrans.com/snap/test',charge_currency:'IDR',gross_amount_idr:mode==='amount'?0:3575000})};
  if(u.includes('website-download'))return{ok:true,headers:{get:()=>''},blob:async()=>new Blob([mode==='badzip'?'<!doctype html>':new Uint8Array([0x50,0x4b,0x03,0x04,1])])};
  throw Error('Unexpected request '+u);
 }};
 let source=fs.readFileSync(path.join(__dirname,'../site/portal.js'),'utf8').replace(' bootstrap().catch(error=>say(friendly(error),true));',' window.test={acceptSession,purchase,downloadRelease};');
 vm.runInNewContext(source,ctx);await w.test.acceptSession({access_token:'access',refresh_token:'refresh',expires_in:3600});assert(!el('version-summary').textContent.includes('Update available'));
 mode='amount';await assert.rejects(w.test.purchase(),/invalid payment amount/);assert(el('checkout-confirm').hidden);
 mode='evil';await assert.rejects(w.test.purchase(),/unexpected checkout/);assert(el('checkout-confirm').hidden);
 mode='normal';await w.test.purchase();assert.equal(el('checkout-link').href,'https://app.midtrans.com/snap/test');assert(!el('checkout-confirm').hidden);
 mode='badzip';await assert.rejects(w.test.downloadRelease('windows'),/invalid installer/);assert.equal(downloads,0);
 mode='normal';await w.test.downloadRelease('windows');assert.equal(downloads,1);
 console.log('PASS future installed version, invalid amount, hostile checkout host, ZIP validation and valid download');
}
(async()=>{await analyticsTest();await portalTest()})().catch(e=>{console.error(e);process.exit(1)});
