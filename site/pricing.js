'use strict';
(() => {
 let currency='USD',country=null;
 // One price for every country (charged in IDR); the country is still detected for analytics/UI.
 const prices={IDR:'Rp2.000.000',USD:'Rp2.000.000'};
 // The previous list price (Rp3.575.000 in Indonesia, US$200 elsewhere, until 22 Oct 2026) is shown struck through
 // before every price. US$200 also matches the price text inside Premiere plugin v2.3.11.8 and older.
 const was={IDR:'Rp3.575.000',USD:'US$200'};
 function label(){return prices[currency];}
 function wasLabel(){return was[currency];}
 function strike(node){
  if(typeof node.before!=='function')return;
  let old=node.previousElementSibling;
  if(!old||!old.hasAttribute('data-rp-was')){
   old=document.createElement('s');old.setAttribute('data-rp-was','');
   // In the big price card the old price gets its own line, so both fit on a phone.
   const card=node.parentElement?.classList?.contains('price');
   old.style.cssText='opacity:.55;font-weight:400;white-space:nowrap;'+(card?'display:block;font-size:.42em;letter-spacing:0;margin-bottom:.2em':'font-size:.72em;margin-right:.35em');node.before(old);}
  if(old.textContent!==wasLabel())old.textContent=wasLabel();
 }
 function apply(){
  document.querySelectorAll('[data-rp-price]').forEach(node=>{if(node.textContent!==label())node.textContent=label();strike(node);});
  document.querySelectorAll('[data-rp-currency-caption]').forEach(node=>{const text='IDR · one-time';if(node.textContent!==text)node.textContent=text;});
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
   currency=country==='ID'?'IDR':'USD';
  }catch{currency='USD';}finally{clearTimeout(timer);apply();}
 }
 apply();
 // Account dialogs are inserted after this script and receive the same display price.
 if(typeof MutationObserver==='function')new MutationObserver(records=>{if(records.some(record=>Array.from(record.addedNodes).some(node=>node.nodeType===1)))apply();}).observe(document.body,{childList:true,subtree:true});
 window.RPPrice.ready=detect();
})();
