const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict'),{webcrypto}=require('node:crypto');
const root=path.resolve(__dirname,'../site'),source=fs.readFileSync(path.join(root,'analytics.js'),'utf8');
function visit({query='',referrer='',session=new Map(),blocked=false}={}){
 const events=[],storage={getItem:k=>session.get(k)||null,setItem:(k,v)=>session.set(k,v)};
 const window={sessionStorage:storage,localStorage:storage};if(blocked)for(const key of ['sessionStorage','localStorage'])Object.defineProperty(window,key,{get(){throw Error('blocked');}});
 vm.runInNewContext(source,{window,Date,crypto:webcrypto,URL,URLSearchParams,location:{search:query,pathname:'/'},document:{referrer,title:'Test',querySelectorAll:()=>[],getElementById:()=>null},fetch:async(u,o)=>{events.push(JSON.parse(o.body));return{};}});
 return{event:events[0],session};
}
let first=visit({query:'?utm_source=ig&utm_medium=social&utm_campaign=profile',referrer:'https://l.instagram.com/'});assert.equal(first.event.utm_source,'instagram');
let second=visit({referrer:'https://r-multicam.pages.dev/start/',session:first.session});assert.equal(second.event.utm_source,'instagram');assert.equal(second.event.referrer_host,'l.instagram.com');
let callback=visit({query:'?oauth=google&code=secret-code',referrer:'https://accounts.google.com/',session:first.session});assert.equal(callback.event.utm_source,'instagram');assert(!JSON.stringify(callback.event).includes('secret-code'));
assert.equal(visit({referrer:'https://accounts.google.com/'}).event.utm_source,null);assert.equal(visit({referrer:'https://accounts.google.com/'}).event.referrer_host,null);
for(const referrer of ['https://www.google.com/','https://www.google.co.id/']){const e=visit({referrer}).event;assert.equal(e.utm_source,'google');assert.equal(e.utm_medium,'organic');}
assert.equal(visit({referrer:'https://www.google.com.evil.test/'}).event.utm_source,null);
for(const referrer of ['https://l.threads.com/','https://www.threads.net/'])assert.equal(visit({referrer}).event.utm_source,'threads');
assert.equal(visit({query:'?utm_source=google&utm_medium=cpc',referrer:'https://www.google.com/'}).event.utm_medium,'cpc');
const expired=new Map([['rp_analytics_attribution_v2',JSON.stringify({utm_source:'instagram',expires_at:Date.now()-1})]]);assert.equal(visit({session:expired}).event.utm_source,null);
assert.equal(visit({blocked:true,query:'?utm_source=threads&utm_medium=social'}).event.utm_source,'threads');
const landing=fs.readFileSync(path.join(root,'start/index.html'),'utf8');assert(landing.includes('noindex,follow'));assert(landing.includes('data-download="windows"'));assert(landing.includes('data-download="macos"'));assert(landing.includes('/pricing.js'));assert(landing.includes('og:image:width" content="1200"'));assert(landing.includes('Chrome or Safari'));
for(const file of ['index.html','id/index.html']){const html=fs.readFileSync(path.join(root,file),'utf8');assert(html.includes('og:image:width" content="1200"'));assert(html.includes('og:image:height" content="630"'));assert(html.includes('rel="canonical"'));assert(html.includes('hreflang="id"'));}
console.log('PASS growth: Instagram/Threads/Google attribution, internal/OAuth continuity, expiry, paid vs organic, blocked storage; mobile landing, download links and social/SEO metadata');
