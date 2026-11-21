const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync(path.join(__dirname,'../site/pricing.js'),'utf8');
async function check(trace,error=false,pathname='/'){
 const el=(text='')=>{const n={textContent:text,attrs:{},style:{},previousElementSibling:null,setAttribute(k,v){this.attrs[k]=v},hasAttribute(k){return k in this.attrs},before(x){this.previousElementSibling=x;inserted++;}};return n;};let inserted=0;
 const nodes=[el('Rp2.000.000')],captions=[{textContent:'IDR · one-time'}];let observer;
 const window={location:{pathname}},context={window,AbortController,setTimeout,clearTimeout,console,MutationObserver:class{constructor(fn){observer=fn;}observe(){}},document:{body:{},createElement:()=>el(),querySelectorAll:selector=>selector==='[data-rp-price]'?nodes:selector==='[data-rp-currency-caption]'?captions:[]},fetch:async(url,opt)=>{assert.equal(url,'/cdn-cgi/trace');assert.equal(opt.credentials,'omit');assert.equal(opt.cache,'no-store');if(error)throw Error('offline');return{ok:true,text:async()=>trace};}};
 vm.runInNewContext(source,context);
 const idPage=/^\/id(\/|$)/.test(pathname);
 // Before the location lookup answers: the struck price is already right on Indonesian pages.
 assert.equal(window.RPPrice.currency,idPage?'IDR':'USD');assert.equal(nodes[0].previousElementSibling.textContent,idPage?'Rp3.575.000':'US$200');
 await window.RPPrice.ready;
 const isID=idPage||(!error&&/^loc=ID\s*$/m.test(trace));
 assert.equal(window.RPPrice.currency,isID?'IDR':'USD');assert.equal(window.RPPrice.label(),'Rp2.000.000','one price for every country');assert.equal(nodes[0].textContent,window.RPPrice.label());assert.equal(captions[0].textContent,'IDR · one-time');assert.equal(nodes[0].previousElementSibling.textContent,isID?'Rp3.575.000':'US$200','old price struck out');assert.equal(window.RPPrice.wasLabel(),isID?'Rp3.575.000':'US$200');assert.equal(inserted,1,'one struck price per node, also after re-apply');
 nodes.push(el('new account dialog'));observer([{addedNodes:[{nodeType:1}]}]);assert.equal(nodes[1].textContent,window.RPPrice.label());assert.equal(nodes[1].previousElementSibling.textContent,window.RPPrice.wasLabel());assert.equal(inserted,2);
 assert(!source.includes('localStorage'));assert(!source.includes('create-lifetime-checkout'));return window.RPPrice.currency;
}
// Plan prices: the founder counter and the lifetime cutoff come from the subscription_pricing RPC.
const CUTOFF='2026-12-01T00:00:00+08:00',BEFORE=Date.parse('2026-11-21T10:00:00Z'),LAST_MS=Date.parse(CUTOFF)-1;
async function plans({pathname='/',rpc,now=BEFORE,salesEnd=CUTOFF}={}){
 const node=(text='',extra={})=>({textContent:text,hidden:false,dataset:{},...extra});
 const monthly=[node('Rp59.000')],note=[node('Rp59.000 founder price for the first 100 subscribers')],lifetime=[node('',{dataset:{salesEnd}})],dialogLifetime=[node('',{dataset:{salesEnd}})];
 const calls=[];let observer;
 class FakeDate extends Date{constructor(...a){a.length?super(...a):super(now);}static now(){return now;}}
 const window={location:{pathname},RP_CONFIG:{supabaseUrl:'https://api.test',supabasePublishableKey:'public-key'}};
 const lists={'[data-monthly-price]':monthly,'[data-founder-note]':note,'[data-lifetime-only]':[...lifetime,...dialogLifetime]};
 const context={window,Date:FakeDate,AbortController,setTimeout,clearTimeout,console,MutationObserver:class{constructor(fn){observer=fn;}observe(){}},document:{body:{},createElement:()=>node(),querySelectorAll:selector=>lists[selector]||[]},
  fetch:async(url,opt)=>{if(url==='/cdn-cgi/trace')throw Error('offline');calls.push({url,opt});if(rpc==='down')throw TypeError('Failed to fetch');if(typeof rpc==='number')return{ok:false,status:rpc,json:async()=>({})};return{ok:true,json:async()=>rpc};}};
 vm.runInNewContext(source,context);
 // Before the server answers the page already shows the static founder wording and the built-in cutoff.
 assert.equal(monthly[0].textContent,'Rp59.000');
 await window.RPPrice.pricingReady;
 if(rpc!==undefined){assert.equal(calls.length,1);assert.equal(calls[0].url,'https://api.test/rest/v1/rpc/subscription_pricing');assert.equal(calls[0].opt.method,'POST');assert.equal(calls[0].opt.body,'{}');assert.equal(calls[0].opt.headers.apikey,'public-key');assert.equal(calls[0].opt.credentials,'omit');}
 return{monthly:monthly[0].textContent,note:note[0].textContent,lifetimeHidden:lifetime[0].hidden,dialogLifetimeHidden:dialogLifetime[0].hidden,observer,window,lifetime};
}
const pricing=(over={})=>({founder_limit:100,founder_slots_left:37,lifetime_sales_end:CUTOFF,monthly_idr:99000,monthly_founder_idr:59000,annual_idr:799000,lifetime_idr:2000000,...over});
(async()=>{
 for(const country of ['ID','US','SG','AU','NL','XX'])await check('ip=private\nloc='+country+'\n');await check('invalid');await check('',true);for(const path of ['/id/','/id/start/','/id']){for(const country of ['ID','SG'])await check('ip=private\nloc='+country+'\n',false,path);await check('invalid',false,path);await check('',true,path);}await check('ip=private\nloc=SG\n',false,'/idea/');
 console.log('PASS /id/ pages show the Indonesian old price from the first paint, also abroad or when the lookup fails');
 console.log('PASS one price Rp2.000.000 in every country (IDR caption) with the old price struck out (Rp3.575.000 in Indonesia, US$200 elsewhere); dynamic account dialog; payment untouched');
 // Live counter, English and Indonesian.
 let r=await plans({rpc:pricing()});assert.equal(r.note,'37 of 100 founder spots left');assert.equal(r.monthly,'Rp59.000');assert.equal(r.lifetimeHidden,false);
 r=await plans({rpc:pricing(),pathname:'/id/'});assert.equal(r.note,'Sisa 37 dari 100 slot founder');
 r=await plans({rpc:pricing({founder_slots_left:1})});assert.equal(r.note,'1 of 100 founder spots left');assert.equal(r.monthly,'Rp59.000');
 // All founder places taken: the standard monthly price is shown and the counter says so.
 r=await plans({rpc:pricing({founder_slots_left:0})});assert.equal(r.monthly,'Rp99.000');assert.equal(r.note,'All 100 founder spots are taken.');
 r=await plans({rpc:pricing({founder_slots_left:0}),pathname:'/id/'});assert.equal(r.note,'Semua 100 slot founder sudah terisi.');
 r=await plans({rpc:[pricing({founder_slots_left:12})]});assert.equal(r.note,'12 of 100 founder spots left','a one-row array answer works too');
 console.log('PASS founder counter from the RPC ("X of 100 founder spots left", also in Indonesian); standard price once all founder places are taken');
 // The RPC is not deployed yet, or the network fails: static founder wording, no number, nothing breaks.
 for(const rpc of ['down',404,500]){
  r=await plans({rpc});assert.equal(r.note,'Rp59.000 founder price for the first 100 subscribers');assert.equal(r.monthly,'Rp59.000');assert.equal(r.lifetimeHidden,false);
  r=await plans({rpc,pathname:'/id/'});assert.equal(r.note,'Rp59.000 harga founder untuk 100 pelanggan pertama');
 }
 r=await plans({rpc:{}});assert.equal(r.note,'Rp59.000 founder price for the first 100 subscribers','an answer without a counter keeps the static wording');
 r=await plans();assert.equal(r.note,'Rp59.000 founder price for the first 100 subscribers','no call needed to render the fallback');
 console.log('PASS counter falls back to "Rp59.000 founder price for the first 100 subscribers" when the RPC fails, is missing or has no counter');
 // Lifetime card: shown until the cutoff (server date or the card\'s own data-sales-end), hidden afterwards, also in the account dialog.
 r=await plans({rpc:pricing(),now:LAST_MS});assert.equal(r.lifetimeHidden,false,'last millisecond before 1 Dec 2026 00:00 WITA');
 r=await plans({rpc:pricing(),now:LAST_MS+1});assert.equal(r.lifetimeHidden,true);assert.equal(r.dialogLifetimeHidden,true);
 r=await plans({rpc:'down',now:LAST_MS+1});assert.equal(r.lifetimeHidden,true,'cutoff also applies when the RPC fails');
 r=await plans({rpc:'down',now:LAST_MS});assert.equal(r.lifetimeHidden,false);
 r=await plans({rpc:pricing({lifetime_sales_end:'2026-11-25T00:00:00+08:00'}),now:Date.parse('2026-11-26T00:00:00Z')});assert.equal(r.lifetimeHidden,true,'the server cutoff wins');
 r=await plans({rpc:pricing(),now:Date.parse('2027-01-15T00:00:00Z')});assert.equal(r.lifetimeHidden,true);
 // Dialog elements added later get the same treatment.
 r=await plans({rpc:pricing(),now:LAST_MS+1});r.lifetime[0].hidden=false;r.observer([{addedNodes:[{nodeType:1}]}]);assert.equal(r.lifetime[0].hidden,true);
 console.log('PASS lifetime card hidden from 1 Dec 2026 00:00 WITA (server date, own data-sales-end, or fallback), visible before; dialog card too');
})().catch(error=>{console.error(error);process.exitCode=1;});
