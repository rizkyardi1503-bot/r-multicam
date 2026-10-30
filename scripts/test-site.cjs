const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert'),{webcrypto}=require('crypto');
async function analyticsTest(){
 const events=[];const w={};Object.defineProperty(w,'localStorage',{get(){throw Error('blocked')}});Object.defineProperty(w,'sessionStorage',{get(){throw Error('blocked')}});
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../site/analytics.js'),'utf8'),{window:w,crypto:webcrypto,localStorage:undefined,sessionStorage:undefined,URL,URLSearchParams,location:{search:'',pathname:'/'},document:{referrer:'',title:'Test',querySelectorAll:()=>[],getElementById:()=>null},fetch:async(u,o)=>{events.push(JSON.parse(o.body));return{};}});
 assert.equal(events[0].event_name,'page_view');assert.match(events[0].visitor_id,/^[0-9a-f-]{36}$/);console.log('PASS analytics survives blocked storage');
}
async function analyticsProxyTest(){
 // Events go to the same-origin proxy first; the direct Supabase URL is used only when the proxy is missing or down.
 const run=async proxy=>{const urls=[];vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../site/analytics.js'),'utf8'),{window:{},crypto:webcrypto,URL,URLSearchParams,location:{search:'',pathname:'/'},document:{referrer:'',title:'Test',querySelectorAll:()=>[],getElementById:()=>null},
  fetch:async u=>{urls.push(u);if(u==='/api/analytics'){if(proxy==='down')throw TypeError('Failed to fetch');return{status:proxy};}return{status:204};}});await new Promise(r=>setImmediate(r));return urls;};
 assert.deepEqual(await run(204),['/api/analytics']);
 assert.deepEqual(await run(503),['/api/analytics'],'an upstream failure is not sent twice');
 for(const proxy of [404,405,'down'])assert.deepEqual(await run(proxy),['/api/analytics','https://ngotkvqtzqiotztnqwaw.supabase.co/functions/v1/website-analytics']);
 console.log('PASS analytics posts to the same-origin proxy, falls back to Supabase when the proxy is missing or unreachable');
}
function landingTest(){
 // /start/ (Instagram/Threads landing): send-link first on phones, light page (no 76 KB image, video only on tap, no affiliate script).
 for(const rel of ['start/index.html','id/start/index.html']){
  const html=fs.readFileSync(path.join(__dirname,'../site',rel),'utf8');
  const at=k=>{const i=html.indexOf(k);assert(i>0,rel+' has '+k);return i;};
  assert(at('data-handoff ')<at('data-download="windows"'),'send-link CTA comes before the downloads');at('data-handoff-email');at('data-desktop-primary');at('class="start-steps"');at('data-rp-price');at('data-login');
  assert(/<video[^>]*preload="none"[^>]*poster="\/media\/druva-auto-edit\.webp"/.test(html),'demo video loads only on tap');
  assert(!html.includes('<img'),'no image above the fold');assert(!html.includes('affiliate-ui.js'));assert(html.includes('noindex,follow'));
  assert(/(FREE 7-DAY TRIAL|TRIAL GRATIS 7 HARI) · (PREMIERE PRO PLUGIN|PLUGIN PREMIERE PRO) · WINDOWS &amp; MAC/.test(html));
 }
 // FAQPage structured data repeats exactly the questions visible on the page.
 for(const rel of ['help/index.html','id/help/index.html','dj-multicam-editing/index.html','id/dj-multicam-editing/index.html','ai-multicam-editor-premiere-pro/index.html','id/ai-multicam-editor-premiere-pro/index.html']){
  const html=fs.readFileSync(path.join(__dirname,'../site',rel),'utf8');
  const ld=[...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(m=>JSON.parse(m[1])).flat().flatMap(x=>x['@graph']||[x]).filter(x=>x['@type']==='FAQPage');
  assert.equal(ld.length,1,rel+': one FAQPage');
  const main=html.slice(html.indexOf('<main'),html.indexOf('</main>'));
  for(const q of ld[0].mainEntity)assert(main.includes(q.name.replace(/&/g,'&amp;'))||main.includes(q.name),rel+': visible question '+q.name);
 }
 console.log('PASS landing: send-link first, light page, IDR price, email sign-in; FAQPage data matches visible questions (help, DJ, AI editor; EN+ID)');
}
function confirmationTest(){
 // Safari 15 (macOS Catalina): no <dialog>.showModal and no AbortSignal.timeout.
 const made=[];const node=()=>({style:{},attrs:{},textContent:'',setAttribute(k,v){this.attrs[k]=v},removeAttribute(k){delete this.attrs[k]},after(){},querySelector(q){return this.kids[q]||(this.kids[q]=node())},kids:{}});
 let signal=null;class OldAbortSignal{};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../site/confirmation.js'),'utf8'),{location:{hash:'#access_token=t&type=signup',search:'',pathname:'/'},history:{replaceState(){}},URLSearchParams,AbortSignal:OldAbortSignal,AbortController,setTimeout(){},window:{RP_CONFIG:{supabaseUrl:'https://api.test',supabasePublishableKey:'p'}},
  document:{getElementById:()=>null,createElement:()=>{const n=node();made.push(n);return n;},body:{appendChild(){}}},fetch:async(u,o)=>{signal=o.signal;return{ok:true,json:async()=>({id:'u',email_confirmed_at:'2026'})};}});
 const box=made[0];assert.equal(box.attrs.open,'','dialog fallback opens');assert.equal(box.style.position,'fixed');box.querySelector('button').onclick();assert.equal(box.style.display,'none');assert.equal('open' in box.attrs,false);
 return new Promise(r=>setImmediate(r)).then(()=>{assert(signal&&typeof signal.aborted==='boolean','AbortController signal used');console.log('PASS confirmation page on Safari 15: dialog fallback and request timeout fallback');});
}
async function portalTest(open=true,phone=false,opts={}){
 const els=new Map();const elem=()=>({hidden:false,value:'',textContent:'',dataset:{},classList:{toggle(){}},setAttribute(){},removeAttribute(){},replaceChildren(){},appendChild(){},remove(){},checkValidity(){return true},click(){},scrollIntoView(){},style:{}});
 const el=id=>{if(!els.has(id))els.set(id,elem());return els.get(id)};let restoredToken='saved';let mode='normal';let downloads=0;let checkoutCalls=0;
 const portal=elem();portal.querySelector=q=>el(q.replace(/^#/,''));portal.querySelectorAll=()=>[];if(!opts.safari15){portal.showModal=()=>{portal.open=true};portal.close=()=>{portal.open=false};}const signals=[];
 class TestURL extends URL{};TestURL.createObjectURL=()=>{downloads++;return 'blob:test'};TestURL.revokeObjectURL=()=>{};
 const w={RP_CONFIG:{supabaseUrl:'https://api.test',supabasePublishableKey:'public',checkoutOpen:open},location:{origin:'https://r-multicam.pages.dev',pathname:'/',search:'',assigned:null,assign(u){this.assigned=u}},addEventListener(){}};
 const ua=opts.ua||(phone?'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Instagram':null);
 class OldAbortSignal{};
 const ctx={...(ua?{navigator:{userAgent:ua,platform:phone?'iPhone':'Win32',maxTouchPoints:phone?5:0}}:{}),window:w,document:{createElement:t=>t==='dialog'?portal:elem(),body:{appendChild(){}},querySelectorAll:q=>(opts.dom&&opts.dom[q])||[]},localStorage:{getItem:()=>null,setItem(){},removeItem(){restoredToken=null}},URL:TestURL,URLSearchParams,AbortSignal:opts.safari15?OldAbortSignal:AbortSignal,AbortController,Uint8Array,Date,setTimeout(){},fetch:async(u,o)=>{signals.push(o&&o.signal);
  if(u.includes('/auth/v1/user'))return{ok:true,json:async()=>({id:'user1',email:'person@example.com'})};
  if(u.includes('/rest/v1/plugin_profiles'))return{ok:true,json:async()=>[opts.profile||{license_status:'trial',plugin_version:'2.3.11.0'}]};
  if(u.includes('/rest/v1/plugin_payment_orders'))return{ok:true,json:async()=>[]};
  if(u.includes('create-lifetime-checkout')&&++checkoutCalls)return{ok:true,json:async()=>({checkout_url:mode==='evil'?'https://app.midtrans.com.evil.test/':'https://app.midtrans.com/snap/test',charge_currency:'IDR',gross_amount_idr:mode==='amount'?0:3575000})};
  if(u.includes('website-download'))return{ok:true,headers:{get:()=>''},blob:async()=>new Blob([mode==='badzip'?'<!doctype html>':new Uint8Array([0x50,0x4b,0x03,0x04,1])])};
  throw Error('Unexpected request '+u);
 }};
 let source=fs.readFileSync(path.join(__dirname,'../site/portal.js'),'utf8').replace(' bootstrap().catch(error=>say(friendly(error),true));',' window.test={acceptSession,purchase,downloadRelease,show,hide};');
 vm.runInNewContext(source,ctx);
 if(opts.profile){await w.test.acceptSession({access_token:'access',refresh_token:'refresh',expires_in:3600});const v=el('version-summary').textContent;assert(v.startsWith('Installed plugin: v2.3.11.13 · '),v);assert(v.endsWith('· Update available.'),v);assert(!/public-v19/.test(v+el('device-details').textContent),'build suffix never shown');console.log('PASS stored plugin version with a build suffix: compared and shown without it, update offered');return;}
 if(opts.safari15){await w.test.acceptSession({access_token:'access',refresh_token:'refresh',expires_in:3600});assert(signals.length&&signals.every(x=>x&&typeof x.aborted==='boolean'),'every request gets an AbortController signal');assert.equal(portal.style.display,'none','no <dialog>: portal starts hidden');w.test.show();assert.equal(portal.style.display,'block');assert.equal(portal.style.position,'fixed');w.test.hide();assert.equal(portal.style.display,'none');console.log('PASS Safari 15: AbortController timeout fallback and fixed-panel dialog fallback');return;}
 if(ua){const inApp=opts.inApp??phone;if(inApp){assert.equal(el('google-signin').hidden,true,'in-app: Google button hidden');assert.equal(el('inapp-google').hidden,false,'in-app: open-in-browser box shown');const link=new URL(el('inapp-link').value);assert.equal(link.origin,'https://r-multicam.pages.dev');assert.equal(link.searchParams.get('account'),'signin');assert.equal(typeof el('inapp-copy').onclick,'function');}else{assert.notEqual(el('google-signin').hidden,true);assert.equal(el('inapp-link').value,'');}}
 if(opts.ua)return;
 if(phone){assert(!el('phone-handoff').hidden,'phone sees the send-to-laptop box');const wa=decodeURIComponent(el('handoff-whatsapp').href);assert(wa.startsWith('https://wa.me/?text='));assert.match(wa,/utm_source=handoff&utm_medium=whatsapp&utm_campaign=mobile_to_desktop/);const mail=decodeURIComponent(el('handoff-email').href);assert(mail.startsWith('mailto:?subject='),mail);assert(mail.includes('&body=')&&mail.includes('utm_medium=email'),mail);assert(wa.includes('#downloads'),'handoff opens the downloads on the computer');if(opts.dom){const [box]=opts.dom['[data-phone-only]'],[mailBtn]=opts.dom['[data-handoff-email]'],[dl]=opts.dom['[data-desktop-primary]'];assert.equal(box.hidden,false,'landing send-link box shown on a phone');assert.equal(mailBtn.hidden,false);assert.equal(mailBtn.href,el('handoff-email').href);assert(dl.classes.has('secondary'),'download buttons step back on a phone');console.log('PASS /start/ on a phone: send-link box first, email link wired, download buttons secondary');return;}console.log('PASS phone visitors can send the link to WhatsApp/email');return;}
 assert.equal(el('handoff-whatsapp').href,undefined,'desktop never sets up the phone box');await w.test.acceptSession({access_token:'access',refresh_token:'refresh',expires_in:3600});assert(!el('version-summary').textContent.includes('Update available'));
 if(!open){await w.test.purchase();assert.equal(checkoutCalls,0,'closed checkout never calls the payment function');assert(el('account-purchase').hidden,'buy button hidden');assert(el('check-payment').hidden,'check payment hidden');
  mode='normal';await w.test.downloadRelease('windows');assert.equal(downloads,1);console.log('PASS checkout closed: Buy/Check payment hidden, no payment request, downloads still work');return;}
 mode='amount';await assert.rejects(w.test.purchase(),/invalid payment amount/);assert(el('checkout-confirm').hidden);
 mode='evil';await assert.rejects(w.test.purchase(),/unexpected checkout/);assert(el('checkout-confirm').hidden);
 assert.equal(w.location.assigned,null,'rejected checkouts never leave the site');
 mode='normal';await w.test.purchase();assert.equal(el('checkout-link').href,'https://app.midtrans.com/snap/test');assert(!el('checkout-confirm').hidden);assert.equal(w.location.assigned,'https://app.midtrans.com/snap/test','buyer goes straight to Midtrans');
 mode='badzip';await assert.rejects(w.test.downloadRelease('windows'),/invalid installer/);assert.equal(downloads,0);
 mode='normal';await w.test.downloadRelease('windows');assert.equal(downloads,1);
 console.log('PASS future installed version, invalid amount, hostile checkout host, straight to Midtrans, ZIP validation and valid download');
}
(async()=>{await analyticsTest();await analyticsProxyTest();await portalTest(true);await portalTest(false);await portalTest(true,true);
 const node=()=>({hidden:true,href:'',classes:new Set(),get classList(){const c=this.classes;return{add:x=>c.add(x),toggle(){}};}});
 await portalTest(true,true,{dom:{'[data-phone-only]':[node()],'[data-handoff-email]':[node()],'[data-desktop-primary]':[node()]}});
 landingTest();
 // Google sign-in: app browsers get the open-in-Safari/Chrome box (Instagram is covered by the phone run above).
 for(const [ua,inApp] of [['Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP2A; wv) AppleWebKit/537.36 Chrome/129 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/480.0.0]',true],['Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 musical_ly_35.1.0 BytedanceWebview TikTok',true],['Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) Mobile/15E148 Line/14.10.0',true],['Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130 Safari/537.36',false],['Mozilla/5.0 (X11; Linux x86_64) Firefox/131.0',false],['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Version/15.6 Safari/605.1.15',false]])await portalTest(true,false,{ua,inApp});
 console.log('PASS in-app browsers (Facebook/Android WebView, TikTok, LINE, Instagram) swap Google for open-in-browser + copy link; desktop browsers keep Google');
 await portalTest(true,false,{profile:{license_status:'trial',plugin_version:'2.3.11.13-public-v19',device_platform:'windows'}});
 await portalTest(true,false,{safari15:true});
 await confirmationTest();})().catch(e=>{console.error(e);process.exit(1)});
