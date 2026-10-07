'use strict';
(() => {
 let currency='USD',country=null;
 const prices={IDR:'Rp3.575.000',USD:'US$200'};
 function label(){return prices[currency];}
 function apply(){
  document.querySelectorAll('[data-rp-price]').forEach(node=>{if(node.textContent!==label())node.textContent=label();});
  document.querySelectorAll('[data-rp-currency-caption]').forEach(node=>{const text=currency+' · one-time';if(node.textContent!==text)node.textContent=text;});
 }
 window.RPPrice={label,apply,get currency(){return currency;},get country(){return country;}};
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
