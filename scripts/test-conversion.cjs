const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict'),{webcrypto}=require('node:crypto');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
for(const slug of ['quick-start','compatibility']){
 const html=read('site/'+slug+'/index.html');
 assert.equal((html.match(/<h1[ >]/g)||[]).length,1);
 assert(html.includes('content="index,follow,max-image-preview:large"'));
 assert(html.includes('href="https://r-multicam.pages.dev/'+slug+'/"'));
 assert(html.includes('og:image:width" content="1200"'));
 assert(html.includes('/analytics.js'));
 for(const match of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g))JSON.parse(match[1]);
 assert(!/AggregateRating|ratingValue|100% accurate/i.test(html));
 assert(read('site/sitemap.xml').includes('/'+slug+'/'));
}
const window={};vm.runInNewContext(read('site/compatibility.js'),{window,document:{getElementById:()=>null}});
const check=window.RPCompatibility.evaluate;
assert.equal(check('mobile','26','16').level,'unsupported');
assert.equal(check('macos','outside','16').level,'check_version');
assert.equal(check('macos','26','8').level,'low_memory');
assert.equal(check('windows','25','8').level,'memory_caution');
assert.equal(check('macos','26','32').level,'trial_first');
assert.equal(check('windows','25','unknown').level,'check_memory');
function visit(search='',session=new Map(),referrer=''){
 const events=[];const storage={getItem:k=>session.get(k)||null,setItem:(k,v)=>session.set(k,v)};
 vm.runInNewContext(read('site/analytics.js'),{window:{sessionStorage:storage,localStorage:storage},crypto:webcrypto,URL,URLSearchParams,Date,
 location:{search,pathname:'/start/'},document:{referrer,title:'test',getElementById:()=>null,querySelectorAll:()=>[]},
 fetch:async(u,o)=>{events.push(JSON.parse(o.body));return{};}});
 return{events,session};
}
let v=visit('?utm_source=threads&utm_content=t02_demo&analytics_test=1');
assert.equal(v.events[0].metadata.content_id,'t02_demo');assert.equal(v.events[0].metadata.reporting_exclude,true);
v=visit('?oauth=google&code=private',v.session,'https://accounts.google.com/');
assert.equal(v.events[0].utm_source,'threads');assert.equal(v.events[0].metadata.content_id,'t02_demo');assert.equal(v.events[0].metadata.reporting_exclude,true);
assert(!JSON.stringify(v.events).includes('private'));
assert.equal(visit('?utm_source=qa').events[0].metadata.reporting_exclude,true);
assert.equal(visit().events[0].metadata.reporting_exclude,false);
assert(read('site/portal.js').includes("track('checkout_opened'"));
assert(read('site/index.html').includes('home_quickstart'));
assert(read('site/id/index.html').includes('id="kompatibilitas"'));
assert(read('site/guides/install-multicam-ai/index.html').includes('macOS · v2.3.11.2'));
assert(read('docs/conversion-funnel.sql').includes('public.plugin_payment_orders'));
assert(read('docs/conversion-funnel.sql').includes('first_activated_at'));
console.log('PASS conversion: SEO/schema, quick start, compatibility limits, campaign content, QA exclusion, OAuth continuity and server-record report');
