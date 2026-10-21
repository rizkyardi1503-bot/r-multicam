const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync(path.join(__dirname,'../site/pricing.js'),'utf8');
async function check(trace,error=false){
 const el=(text='')=>{const n={textContent:text,attrs:{},style:{},previousElementSibling:null,setAttribute(k,v){this.attrs[k]=v},hasAttribute(k){return k in this.attrs},before(x){this.previousElementSibling=x;inserted++;}};return n;};let inserted=0;
 const nodes=[el('Rp2.000.000')],captions=[{textContent:'IDR · one-time'}];let observer;
 const window={},context={window,AbortController,setTimeout,clearTimeout,console,MutationObserver:class{constructor(fn){observer=fn;}observe(){}},document:{body:{},createElement:()=>el(),querySelectorAll:selector=>selector==='[data-rp-price]'?nodes:captions},fetch:async(url,opt)=>{assert.equal(url,'/cdn-cgi/trace');assert.equal(opt.credentials,'omit');assert.equal(opt.cache,'no-store');if(error)throw Error('offline');return{ok:true,text:async()=>trace};}};
 vm.runInNewContext(source,context);await window.RPPrice.ready;
 const isID=!error&&/^loc=ID\s*$/m.test(trace);
 assert.equal(window.RPPrice.currency,isID?'IDR':'USD');assert.equal(window.RPPrice.label(),'Rp2.000.000','one price for every country');assert.equal(nodes[0].textContent,window.RPPrice.label());assert.equal(captions[0].textContent,'IDR · one-time');assert.equal(nodes[0].previousElementSibling.textContent,isID?'Rp3.575.000':'US$200','old price struck out');assert.equal(window.RPPrice.wasLabel(),isID?'Rp3.575.000':'US$200');assert.equal(inserted,1,'one struck price per node, also after re-apply');
 nodes.push(el('new account dialog'));observer([{addedNodes:[{nodeType:1}]}]);assert.equal(nodes[1].textContent,window.RPPrice.label());assert.equal(nodes[1].previousElementSibling.textContent,window.RPPrice.wasLabel());assert.equal(inserted,2);
 assert(!source.includes('localStorage'));assert(!source.includes('create-lifetime-checkout'));return window.RPPrice.currency;
}
(async()=>{for(const country of ['ID','US','SG','AU','NL','XX'])await check('ip=private\nloc='+country+'\n');await check('invalid');await check('',true);console.log('PASS one price Rp2.000.000 in every country (IDR caption) with the old price struck out (Rp3.575.000 in Indonesia, US$200 elsewhere); dynamic account dialog; payment untouched');})().catch(error=>{console.error(error);process.exitCode=1;});
