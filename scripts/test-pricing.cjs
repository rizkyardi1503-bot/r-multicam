const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync(path.join(__dirname,'../site/pricing.js'),'utf8');
async function check(trace,error=false){
 const nodes=[{textContent:'Rp3.575.000'}],captions=[{textContent:'IDR · one-time'}];let observer;
 const window={},context={window,AbortController,setTimeout,clearTimeout,console,MutationObserver:class{constructor(fn){observer=fn;}observe(){}},document:{body:{},querySelectorAll:selector=>selector==='[data-rp-price]'?nodes:captions},fetch:async(url,opt)=>{assert.equal(url,'/cdn-cgi/trace');assert.equal(opt.credentials,'omit');assert.equal(opt.cache,'no-store');if(error)throw Error('offline');return{ok:true,text:async()=>trace};}};
 vm.runInNewContext(source,context);await window.RPPrice.ready;
 const isID=!error&&/^loc=ID\s*$/m.test(trace);
 assert.equal(window.RPPrice.currency,isID?'IDR':'USD');assert.equal(window.RPPrice.label(),isID?'Rp3.575.000':'US$200');assert.equal(nodes[0].textContent,window.RPPrice.label());assert.equal(captions[0].textContent,(isID?'IDR':'USD')+' · one-time');
 nodes.push({textContent:'new account dialog'});observer([{addedNodes:[{nodeType:1}]}]);assert.equal(nodes[1].textContent,window.RPPrice.label());
 assert(!source.includes('localStorage'));assert(!source.includes('create-lifetime-checkout'));return window.RPPrice.currency;
}
(async()=>{for(const country of ['ID','US','SG','AU','NL','XX'])await check('ip=private\nloc='+country+'\n');await check('invalid');await check('',true);console.log('PASS regional prices: Indonesia IDR; overseas USD; unknown/offline USD; dynamic account dialog; payment untouched');})().catch(error=>{console.error(error);process.exitCode=1;});
