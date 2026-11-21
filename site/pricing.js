'use strict';
(() => {
 // /id/ pages show the Indonesian old price from the first paint.
 const idPage=/^\/id(\/|$)/.test(window.location?.pathname||'');
 const fallback=idPage?'IDR':'USD';
 let currency=fallback,country=null;
 // One price for every country, charged in IDR.
 const prices={IDR:'Rp2.000.000',USD:'Rp2.000.000'};
 // Previous list price (until 22 Oct 2026), struck through before the lifetime price; US$200 matches plugin v2.3.11.8 and older.
 const was={IDR:'Rp3.575.000',USD:'US$200'};
 function label(){return prices[currency];}
 function wasLabel(){return was[currency];}
 function strike(node){
  if(typeof node.before!=='function')return;
  let old=node.previousElementSibling;
  if(!old||!old.hasAttribute('data-rp-was')){
   old=document.createElement('s');old.setAttribute('data-rp-was','');
   const card=node.parentElement?.classList?.contains('price');
   old.style.cssText='opacity:.55;font-weight:400;white-space:nowrap;'+(card?'display:block;font-size:.42em;letter-spacing:0;margin-bottom:.2em':'font-size:.72em;margin-right:.35em');node.before(old);}
  if(old.textContent!==wasLabel())old.textContent=wasLabel();
 }
 function apply(){
  document.querySelectorAll('[data-rp-price]').forEach(node=>{if(node.textContent!==label())node.textContent=label();strike(node);});
  document.querySelectorAll('[data-rp-currency-caption]').forEach(node=>{const text='IDR · one-time';if(node.textContent!==text)node.textContent=text;});
  plans();
 }
 // Plans: founder counter and lifetime cutoff come from subscription_pricing; if it fails the static wording stays.
 const D={monthly:99000,founder:59000,limit:100,end:'2026-12-01T00:00:00+08:00'};
 let pricing=null;
 const rp=n=>'Rp'+String(n).replace(/\B(?=(\d{3})+$)/g,'.');
 const num=(v,d)=>Number(v)>0?Number(v):d;
 const left=()=>Number.isInteger(pricing?.founder_slots_left)?Math.max(0,pricing.founder_slots_left):null;
 const founderOpen=()=>left()!==0;
 const lifetimeOpen=node=>Date.now()<(Date.parse(pricing?.lifetime_sales_end||node?.dataset?.salesEnd)||Date.parse(D.end));
 function note(){const l=left(),max=num(pricing?.founder_limit,D.limit),f=rp(num(pricing?.monthly_founder_idr,D.founder));
  if(l===null)return idPage?f+' harga founder untuk '+max+' pelanggan pertama':f+' founder price for the first '+max+' subscribers';
  if(l===0)return idPage?'Semua '+max+' slot founder sudah terisi.':'All '+max+' founder spots are taken.';
  return idPage?'Sisa '+l+' dari '+max+' slot founder':l+' of '+max+' founder spots left';}
 function plans(){
  const set=(selector,text)=>document.querySelectorAll(selector).forEach(node=>{if(node.textContent!==text)node.textContent=text;});
  set('[data-monthly-price]',rp(founderOpen()?num(pricing?.monthly_founder_idr,D.founder):num(pricing?.monthly_idr,D.monthly)));
  set('[data-founder-note]',note());
  document.querySelectorAll('[data-lifetime-only]').forEach(node=>{const open=lifetimeOpen(node);if(!!node.hidden===open)node.hidden=!open;});
 }
 async function loadPricing(){
  const c=window.RP_CONFIG;if(!c?.supabaseUrl||typeof fetch!=='function')return;
  const controller=typeof AbortController==='function'?new AbortController():null,timer=setTimeout(()=>controller?.abort(),4000);
  try{
   const r=await fetch(c.supabaseUrl+'/rest/v1/rpc/subscription_pricing',{method:'POST',headers:{apikey:c.supabasePublishableKey,'Content-Type':'application/json'},body:'{}',cache:'no-store',credentials:'omit',signal:controller?.signal});
   if(!r.ok)throw Error('Pricing unavailable');
   const data=await r.json(),row=Array.isArray(data)?data[0]:data;pricing=row&&typeof row==='object'?row:null;
  }catch{pricing=null;}finally{clearTimeout(timer);plans();}
 }
 window.RPPrice={label,wasLabel,apply,get currency(){return currency;},get country(){return country;}};
 // Read only the country code, never log or persist the IP/trace response.
 async function detect(){
  const controller=typeof AbortController==='function'?new AbortController():null;
  const timer=setTimeout(()=>controller?.abort(),3000);
  try{
   const response=await fetch('/cdn-cgi/trace',{cache:'no-store',credentials:'omit',signal:controller?.signal});
   if(!response.ok)throw Error('Country unavailable');
   const match=/^loc=([A-Z]{2})\s*$/m.exec(await response.text());
   if(match&&match[1]!=='XX')country=match[1];
   currency=country==='ID'?'IDR':fallback;
  }catch{currency=fallback;}finally{clearTimeout(timer);apply();}
 }
 apply();
 // Account dialogs are inserted after this script and receive the same display price.
 if(typeof MutationObserver==='function')new MutationObserver(records=>{if(records.some(record=>Array.from(record.addedNodes).some(node=>node.nodeType===1)))apply();}).observe(document.body,{childList:true,subtree:true});
 window.RPPrice.ready=detect();
 window.RPPrice.pricingReady=loadPricing();
})();
