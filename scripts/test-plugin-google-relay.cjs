const vm=require('node:vm'),fs=require('node:fs'),assert=require('node:assert/strict');
const source=fs.readFileSync(require('node:path').join(__dirname,'../site/plugin-google.js'),'utf8');
function run({hash='',search='',stored=null,origin='https://r-multicam.pages.dev'}={}){
 const storage=new Map(stored?[['rp_plugin_google_v1',JSON.stringify(stored)]]:[]),elements=[],navigations=[];
 const window={location:{hash,search,origin,assign:u=>navigations.push(u),replace:u=>navigations.push(u)},RP_CONFIG:{supabaseUrl:'https://ngotkvqtzqiotztnqwaw.supabase.co'}};
 const context={window,URLSearchParams,Date,Number,JSON,history:{replaceState:()=>{}},sessionStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},document:{body:{append:x=>elements.push(x)},createElement:tag=>{const e={tag,style:{},append:(...items)=>elements.push(...items),setAttribute:()=>{}};elements.push(e);return e;}}};
 vm.runInNewContext(source,context);return{window,elements,navigations,storage};
}
const flow={port:45321,state:'a'.repeat(64),challenge:'b'.repeat(43)};
let s=run({hash:'#plugin-google='+encodeURIComponent(JSON.stringify(flow))});assert.equal(s.window.RP_PLUGIN_GOOGLE_ACTIVE,true);s.elements.find(x=>x.tag==='button').onclick();
const auth=new URL(s.navigations[0]);assert.equal(auth.hostname,'ngotkvqtzqiotztnqwaw.supabase.co');assert.equal(auth.searchParams.get('redirect_to'),'https://r-multicam.pages.dev/?oauth=google');assert.equal(auth.searchParams.get('code_challenge'),flow.challenge);assert(!auth.searchParams.has('code_verifier'));
const stored=JSON.parse(s.storage.get('rp_plugin_google_v1'));
s=run({search:'?oauth=google&code=one-use-code',stored});assert.equal(s.navigations[0],`http://127.0.0.1:${flow.port}/rproject-auth/${flow.state}?code=one-use-code`);assert.equal(s.storage.size,0);
for(const bad of [{...stored,state:'invalid'},{...stored,port:80},{...stored,createdAt:Date.now()-300001},{...stored,createdAt:Date.now()+100000}]){s=run({search:'?oauth=google&code=x',stored:bad});assert.equal(s.navigations.length,0);}
s=run({search:'?oauth=google&error=access_denied',stored});assert(s.navigations[0].endsWith('?error=cancelled'));
s=run({search:'?oauth=google&code=website-code'});assert(!s.window.RP_PLUGIN_GOOGLE_ACTIVE);assert.equal(s.navigations.length,0);
s=run({hash:'#plugin-google='+encodeURIComponent(JSON.stringify(flow)),origin:'https://evil.invalid'});assert.equal(s.navigations.length,0);assert(!s.elements.some(x=>x.tag==='button'));
console.log('PASS: Google relay start/challenge/allowlisted redirect, one-use code-only loopback, expired/tampered/foreign origin rejection, Google denial, website login preserved');
