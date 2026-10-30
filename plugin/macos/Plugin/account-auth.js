(function(global){
'use strict';
var URL='https://ngotkvqtzqiotztnqwaw.supabase.co';
var KEY='sb_publishable_aBJ_h2Gaearwl5nG2Xo75g_j7YAUOxS';
var STORE='rp.account.session.v23100', PERSIST='account-session-v4.json', SIGNUP_COOLDOWN='rp.account.signup.cooldown.v239', RESET_COOLDOWN='rp.account.reset.cooldown.v239';
var EMAIL_REDIRECT='https://r-multicam.pages.dev/auth/confirmed/';
var session=null,profile=null,entitlement=null,busy=false,restoring=true,listeners=[],entitlementTick=0,entitlementBase=0;
var refreshFlight=null,authGeneration=0,verified=false,storageWarning='',sessionSavedAt=0,oauthPending=false;
/* Offline grace: the last server-verified entitlement stays usable for 72 h when the account server cannot be reached (network/timeout/5xx only). */
var GRACE_MS=72*3600000,CLOCK_SLACK_MS=300000,verifiedMeta=null,offline=false,offlineReason='',pendingLogin=null;
/* Clock handling. SKEW_MAX_MS: a server/PC clock difference larger than this is ignored. highWater: latest PC time (UTC ms) seen,
   saved in every session copy; offline use stops while the PC clock is more than ROLLBACK_SLACK_MS before it (clock set back). */
var SKEW_MAX_MS=24*3600000,ROLLBACK_SLACK_MS=3600000,HW_PERSIST_MS=600000,highWater=0,hwSavedAt=0;
/* Signed offline grace: once a real key is embedded, offline use needs an entitlement signed by plugin-entitlement-signed (Ed25519).
   SIGN_KEYS = {key_id: base64 of the raw 32-byte Ed25519 public key}. PLACEHOLDER = signing not deployed yet: unsigned grace as before. */
var SIGN_KEYS={'k1-2026-10':'fULotW3Lu1EYyfk3ZkEOjgOI+H0mGvWf59SsDTq83lg='},SIGN_AUD='r-multicam-plugin-entitlement',SIGN_REFRESH_MS=3600000,signedEnt=null,signedCheck=null,signedFlight=null;
var nfs=null,nos=null,ncrypto=null,npath=null,nproc=null;
function nreq(n){try{if(global.cep_node&&global.cep_node.require)return global.cep_node.require(n);}catch(e){}try{if(typeof require==='function')return require(n);if(typeof global.require==='function')return global.require(n);}catch(e2){}return null;}
function storageInit(){if(nfs&&nos&&ncrypto&&npath&&nproc)return;nfs=nreq('fs');nos=nreq('os');ncrypto=nreq('crypto');npath=nreq('path');nproc=nreq('process');}
function storageDir(){storageInit();if(!nfs||!nos||!npath||!nproc)return '';var home=nos.homedir(),d=nproc.platform==='win32'?npath.join(nproc.env.LOCALAPPDATA||npath.join(home,'AppData','Local'),'RProjectMulticam'):npath.join(home,'Library','Application Support','RProjectMulticam');try{if(!nfs.existsSync(d))nfs.mkdirSync(d,{recursive:true});}catch(e){}return d;}
function sessionFile(){storageInit();var d=storageDir();return d&&npath?npath.join(d,PERSIST):'';}
function legacySessionFile(){storageInit();var d=storageDir();return d&&npath?npath.join(d,'account-session.dat'):'';}
function v2SessionFile(){storageInit();var d=storageDir();return d&&npath?npath.join(d,'account-session-v2.json'):'';}
function legacyStorageKey(){storageInit();if(!ncrypto||!nos)return null;var seed='RProjectMulticam|'+String(nos.hostname())+'|'+String(nos.platform())+'|session-v1';return ncrypto.createHash('sha256').update(seed).digest();}
function legacyDecrypt(text){storageInit();var b=Buffer.from(String(text||'').trim(),'base64');if(b.length<32||b.slice(0,4).toString()!=='RPS1')return null;var key=legacyStorageKey(),iv=b.slice(4,16),tag=b.slice(16,32),enc=b.slice(32),d=ncrypto.createDecipheriv('aes-256-gcm',key,iv);d.setAuthTag(tag);return JSON.parse(Buffer.concat([d.update(enc),d.final()]).toString('utf8'));}
/* Tokens at rest: AES-256-GCM under a random data key that DPAPI (Windows) or the login Keychain (macOS) protects, the same OS stores
   online-music-ai.js uses for the OpenAI key. The OS store is asked once per panel run, not on every save. Without Node or a working
   OS store the tokens are saved as before (plain JSON), so nobody is signed out by this. */
var DK_SERVICE='RProjectMulticamAI',DK_ACCOUNT='Account Session Key',DK_AAD='rp-session-v1',dataKey=null,dataKeyFailed=false,sealConfirmed=false;
function winCrypt(input,decrypt){
 var common="$ErrorActionPreference='Stop';Add-Type -AssemblyName System.Security;$s=[Console]::In.ReadToEnd();";
 var script=common+(decrypt?"$b=[Convert]::FromBase64String($s);$v=[Security.Cryptography.ProtectedData]::Unprotect($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser);[Console]::Out.Write([Text.Encoding]::UTF8.GetString($v));":"$b=[Text.Encoding]::UTF8.GetBytes($s);$v=[Security.Cryptography.ProtectedData]::Protect($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser);[Console]::Out.Write([Convert]::ToBase64String($v));");
 var exe=npath.join(nproc.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
 var r=nreq('child_process').spawnSync(exe,['-NoProfile','-NonInteractive','-Command',script],{input:input,encoding:'utf8',windowsHide:true,timeout:decrypt?12000:8000,maxBuffer:16384});
 if(r.error||r.status!==0||!r.stdout)throw Error('secure_storage_unavailable');return String(r.stdout).trim();}
function macRun(args,allowMissing,input){var r=nreq('child_process').spawnSync('/usr/bin/security',args,{input:input,encoding:'utf8',timeout:12000,maxBuffer:16384});if(r.error)throw Error('secure_storage_unavailable');if(r.status!==0){if(allowMissing)return '';throw Error('secure_storage_unavailable');}return String(r.stdout||'').trim();}
/* read(): the stored key text, '' when there is none. create(v): stores v only if no key exists yet (another panel may have made one first). */
function keyStore(){storageInit();if(!nfs||!npath||!nproc||!nreq('child_process'))return null;
 if(nproc.platform==='win32'){var d=storageDir();if(!d)return null;var f=npath.join(d,'account-key.dpapi');return {read:function(){return nfs.existsSync(f)?winCrypt(nfs.readFileSync(f,'utf8'),true):'';},create:function(v){var blob=winCrypt(v,false);try{nfs.writeFileSync(f,blob,{encoding:'utf8',flag:'wx',mode:384});}catch(e){if(!e||e.code!=='EEXIST')throw e;}}};}
 /* The key goes to `security -i` on stdin, never argv (visible in ps). No -U: an existing key is never replaced. */
 if(nproc.platform==='darwin')return {read:function(){return macRun(['find-generic-password','-s',DK_SERVICE,'-a',DK_ACCOUNT,'-w'],true);},create:function(v){macRun(['-i'],true,'add-generic-password -s "'+DK_SERVICE+'" -a "'+DK_ACCOUNT+'" -w "'+v+'"\n');}};
 return null;}
function dataKeyGet(create){if(dataKey)return dataKey;if(dataKeyFailed)return null;try{storageInit();var ks=keyStore(),B=nbuf();if(!ks||!ncrypto||!B)return null;var v;/* One retry: a slow first PowerShell start must not cost the saved login. */try{v=ks.read();}catch(re){v=ks.read();}if(!v){if(!create)return null;ks.create(ncrypto.randomBytes(32).toString('base64'));v=ks.read();}var raw=B.from(String(v||'').trim(),'base64');if(raw.length!==32)throw Error('bad session key');dataKey=raw;return dataKey;}catch(e){dataKeyFailed=true;return null;}}
function sealSession(s){var k=dataKeyGet(true);if(!k)return null;try{var B=nbuf(),iv=ncrypto.randomBytes(12),c=ncrypto.createCipheriv('aes-256-gcm',k,iv);c.setAAD(B.from(DK_AAD));var enc=B.concat([c.update(JSON.stringify(s),'utf8'),c.final()]);return {v:1,iv:iv.toString('base64'),tag:c.getAuthTag().toString('base64'),data:enc.toString('base64')};}catch(e){return null;}}
function openSession(x){if(!x||x.v!==1)return null;var k=dataKeyGet(false);if(!k)return null;try{var B=nbuf(),d=ncrypto.createDecipheriv('aes-256-gcm',k,B.from(String(x.iv),'base64'),{authTagLength:16});d.setAAD(B.from(DK_AAD));d.setAuthTag(B.from(String(x.tag),'base64'));return JSON.parse(B.concat([d.update(B.from(String(x.data),'base64')),d.final()]).toString('utf8'));}catch(e){return null;}}
/* Two-phase migration: the plain copy is kept next to the sealed one until a later run has opened a sealed copy (sealConfirmed). */
function sessionPayload(obj,sealed,full){var p={schema:4,saved_at:sessionSavedAt,hw:highWater};if(sealed)p.session_enc=sealed;if(!sealed||!sealConfirmed)p.session=obj;if(full){p.profile=profile;p.entitlement=entitlement;p.verified_meta=verifiedMeta;p.signed_entitlement=signedEnt;}return p;}
function payloadSession(x){return x?(x.session_enc&&openSession(x.session_enc))||x.session||null:null;}
function atomicSessionWrite(text){storageInit();var f=sessionFile();if(!f||!nfs)throw Error('Node persistent storage unavailable');var t=f+'.tmp-'+String(Date.now());nfs.writeFileSync(t,text,{encoding:'utf8',mode:384});try{nfs.renameSync(t,f);}catch(e){try{nfs.unlinkSync(f);}catch(x){}nfs.renameSync(t,f);}}
function persistentWrite(obj,sealed){atomicSessionWrite(JSON.stringify(sessionPayload(obj,sealed,true)));var verify=JSON.parse(nfs.readFileSync(sessionFile(),'utf8')),vs=payloadSession(verify);if(!verify||verify.schema!==4||!vs||vs.refresh_token!==obj.refresh_token)throw Error('Persistent session read-back verification failed.');}
function cepRoot(){try{var cs=new global.CSInterface(),u=cs.getSystemPath(global.SystemPath.USER_DATA)||'';u=decodeURIComponent(String(u).replace(/^file:\/\//i,''));if(/^\/[A-Za-z]:\//.test(u))u=u.slice(1);return u.replace(/\\/g,'/').replace(/\/$/,'')+'/RProjectMulticam';}catch(e){return '';}}
function cepFs(){try{return global.cep&&global.cep.fs?global.cep.fs:null;}catch(e){return null;}}
function cepSessionFile(){var d=cepRoot();return d?d+'/'+PERSIST:'';}
function cepEnsureDir(){var fs=cepFs(),d=cepRoot();if(!fs||!d)return false;try{var r=fs.makedir(d);return !r||r.err===0||r.err===3;}catch(e){return false;}}
function cepPersistentWrite(obj,sealed){var fs=cepFs(),f=cepSessionFile();if(!fs||!f)throw Error('CEP persistent storage unavailable');cepEnsureDir();var text=JSON.stringify(sessionPayload(obj,sealed,true)),w=fs.writeFile(f,text);if(w&&w.err)throw Error('CEP session write failed '+w.err);var r=fs.readFile(f);if(!r||r.err||!r.data)throw Error('CEP session read-back failed '+(r&&r.err));var v=JSON.parse(r.data),vs=payloadSession(v);if(!v||v.schema!==4||!vs||vs.refresh_token!==obj.refresh_token)throw Error('CEP session verification mismatch');return true;}
function cepPersistentDelete(){try{var fs=cepFs(),f=cepSessionFile();if(fs&&f)fs.deleteFile(f);}catch(e){}}

function notify(){for(var i=0;i<listeners.length;i++)try{listeners[i](status());}catch(e){}}
var restoreDiagnostic='NOT_RUN';
function save(){
 /* A sign-in is persisted only after the device bind + entitlement step succeeded. */
 if(session&&pendingLogin&&pendingLogin.session===session)return;
 if(session){
  sessionSavedAt=Math.max(Date.now(),sessionSavedAt+1);hwObserve();hwSavedAt=Date.now();storageWarning='';var cepOK=false,nodeOK=false,localOK=false,sealed=sealSession(session);
  try{cepPersistentWrite(session,sealed);cepOK=true;}catch(cx){}
  try{persistentWrite(session,sealed);nodeOK=true;}catch(nx){}
  try{localStorage.setItem(STORE,JSON.stringify(sessionPayload(session,sealed,false)));localOK=true;}catch(e){}
  /* Encrypted copy saved and sealed copies proven readable: remove copies that may still hold plain tokens (a copy whose write failed, pre-encryption files). */
  if(sealed&&sealConfirmed&&(cepOK||nodeOK)){if(!cepOK)cepPersistentDelete();if(!localOK)try{localStorage.removeItem(STORE);}catch(e3){}try{storageInit();[nodeOK?'':sessionFile(),legacySessionFile(),v2SessionFile()].forEach(function(old){try{if(old&&nfs&&nfs.existsSync(old))nfs.unlinkSync(old);}catch(x4){}});}catch(x3){}}
  storageWarning=cepOK||nodeOK?'':localOK?'Login is saved only in the panel cache. Permanent storage is unavailable; login may be required after restarting Premiere.':'Login could not be saved. Check write permissions for your user application-data folder.';restoreDiagnostic=cepOK?'SESSION_SAVED_CEP_VERIFIED':nodeOK?'SESSION_SAVED_NODE_VERIFIED':localOK?'SESSION_SAVED_LOCAL_FALLBACK':'SESSION_SAVE_FAILED';
 }else{
  try{localStorage.removeItem(STORE);}catch(e2){}
  cepPersistentDelete();
  try{storageInit();var f=sessionFile();if(nfs){[f,legacySessionFile(),v2SessionFile()].forEach(function(old){if(old&&nfs.existsSync(old))nfs.unlinkSync(old);});}}catch(x2){}
 }
}
function storedCandidates(){
 var candidates=[],hw=0,plain=false,opened=false;
 /* hw: highest clock high-water mark of all readable copies (older copies without one: their save time). */
 function add(text,source){try{var x=JSON.parse(text||'null');if(!x||typeof x!=='object')return;var h=Number(x.hw!=null?x.hw:x.saved_at)||0;if(h>hw)hw=h;/* A sealed copy that cannot be opened falls back to the plain copy kept beside it (phase 1). */var v=x.session_enc?openSession(x.session_enc):null;if(v)opened=true;if(x.session||!x.session_enc)plain=true;if(!v)v=x.session?x.session:x.session_enc?null:x;if(v&&v.access_token&&v.refresh_token){candidates.push({session:v,profile:x.profile||null,entitlement:x.entitlement||null,meta:x.verified_meta||null,signed:x.signed_entitlement||null,saved:Number(x.saved_at)||0,expires:Number(v.expires_at)||0,source:source});}}catch(e){}}
 try{var cf=cepFs(),cp=cepSessionFile(),cr=cf&&cp?cf.readFile(cp):null;if(cr&&!cr.err)add(cr.data,'CEP');}catch(e0){}
 try{storageInit();var nf=sessionFile();if(nfs&&nf&&nfs.existsSync(nf))add(nfs.readFileSync(nf,'utf8'),'NODE');}catch(e1){}
 try{add(localStorage.getItem(STORE),'LOCAL');}catch(e2){}
 if(!candidates.length){
  try{var vf=v2SessionFile();if(nfs&&vf&&nfs.existsSync(vf))add(nfs.readFileSync(vf,'utf8'),'V2');}catch(e3){}
  try{var lf=legacySessionFile();if(nfs&&lf&&nfs.existsSync(lf))add(JSON.stringify(legacyDecrypt(nfs.readFileSync(lf,'utf8'))),'LEGACY');}catch(e4){}
 }
 // Prefer the most recently issued token; expiry also orders legacy bare-token
 // localStorage entries, which have no saved_at timestamp.
 candidates.sort(function(a,b){return b.expires-a.expires||b.saved-a.saved;});
 /* The panel-cache copy carries only tokens; borrow entitlement/verification from a file copy of the same token. */
 if(candidates.length&&!candidates[0].entitlement)for(var i=1;i<candidates.length;i++)if(candidates[i].entitlement&&candidates[i].session.refresh_token===candidates[0].session.refresh_token){candidates[0].profile=candidates[i].profile;candidates[0].entitlement=candidates[i].entitlement;candidates[0].meta=candidates[i].meta;candidates[0].signed=candidates[i].signed;break;}
 candidates.hw=hw;candidates.plain=plain;candidates.opened=opened;return candidates;
}
function load(){
 verified=false;offline=false;offlineReason='';session=null;profile=null;entitlement=null;verifiedMeta=null;signedEnt=null;storageWarning='';restoreDiagnostic='SESSION_NOT_FOUND';
 var candidates=storedCandidates();
 if(candidates.length){var best=candidates[0];session=best.session;profile=best.profile;entitlement=best.entitlement;verifiedMeta=best.meta&&typeof best.meta==='object'?best.meta:null;signedEnt=best.signed&&typeof best.signed==='object'?best.signed:null;sessionSavedAt=best.saved;var since=verifiedMeta?Math.max(0,(Date.now()-Number(verifiedMeta.at||0))/1000):0;entitlementBase=Number(entitlement&&entitlement.remaining_seconds||0)-since;entitlementTick=(global.performance&&performance.now)?performance.now():Date.now();restoreDiagnostic='SESSION_LOADED_'+best.source;}
 highWater=Number(candidates.hw)||0;hwSavedAt=Date.now();sealConfirmed=!!candidates.opened;
 /* Migration: plain tokens found and the OS key store works -> phase 1 writes sealed + plain; once a later run has opened a sealed
    copy (phase 2) every copy is rewritten sealed only and the plain files are removed. A failed key read writes plain and deletes nothing. */
 if(session&&candidates.plain&&dataKeyGet(true)){save();restoreDiagnostic='SESSION_LOADED_'+candidates[0].source+'_ENCRYPTED';}
}
function userKey(s){return s&&s.user?String(s.user.id||s.user.email||''):'';}
/* An online answer restarts the high-water mark at the true time: a PC clock that was fast and has since been corrected does not count as set back. */
function markVerified(ent){var local=Date.now(),srv=Date.parse(ent&&ent.server_time||'');verifiedMeta={at:local,server_at:isFinite(srv)?srv:0,skew:isFinite(srv)?srv-local:0,user:userKey(session),device:device(),allowed:!!(ent&&ent.allowed===true)};highWater=isFinite(srv)?Math.min(local,srv):local;}
function perfNow(){return global.performance&&performance.now?performance.now():0;}
var monoWall=Date.now(),monoPerf=perfNow();
/* PC time (UTC ms), never earlier than the time this panel has already seen pass (performance.now is monotonic). */
function observedNow(){return Math.max(Date.now(),monoWall+(perfNow()-monoPerf));}
/* Skew measured online in this run is used as is; a skew read from the (editable) cache only within SKEW_MAX_MS. */
function skewMs(){var s=Number(verifiedMeta&&verifiedMeta.skew);if(!isFinite(s))return 0;return verified||Math.abs(s)<=SKEW_MAX_MS?s:0;}
/* Server time estimated from the last online answer: a PC clock a few minutes slow does not make a fresh grant look issued in the future. */
function srvNow(){return observedNow()+skewMs();}
/* The later of PC time and server estimate: a grant counts as issued in the future only if it is in the future by both (a slow PC,
   or a fast PC corrected after the last online check, is not a clock set back; the high-water mark catches real rollbacks). */
function latestNow(){return Math.max(observedNow(),srvNow());}
/* For expiry: the skew measured this run is trusted; a cached (editable) skew may only move the deadline earlier, never later. */
function expNow(){return verified?srvNow():latestNow();}
/* PC clock set back more than ROLLBACK_SLACK_MS before the latest time seen (DST / time-zone changes do not move UTC ms). */
function hwObserve(){var t=Date.now(),o=verified?Math.min(t,srvNow()):t;if(o>highWater)highWater=o;return t;}
function rolledBack(){return hwObserve()<highWater-ROLLBACK_SLACK_MS;}
/* Persist the high-water mark every 10 min while in use, so a restart after a long offline session cannot rewind it far. */
function keepHighWater(){if(!session||(pendingLogin&&pendingLogin.session===session)||Date.now()-hwSavedAt<HW_PERSIST_MS)return;var d=restoreDiagnostic;try{save();}catch(e){}restoreDiagnostic=d;}
/* Network errors, timeouts and 5xx/408/429 are transient. Auth rejections and explicit server answers are not. */
function transient(e){if(!e||e.code==='SESSION_REPLACED'||authRejected(e))return false;var s=Number(e.status||0);if(s)return s>=500||s===408||s===429;return true;}
function goOffline(e){offline=true;offlineReason=String(e&&e.message||e||'');}
function own(o,k){return Object.prototype.hasOwnProperty.call(o,k);}
function signingActive(){for(var k in SIGN_KEYS)if(own(SIGN_KEYS,k)&&!/PLACEHOLDER/.test(k+SIGN_KEYS[k]))return true;return false;}
/* Unsigned cache is trusted only when this run verified it online, or while signing is not deployed (placeholder key). */
function signedOnly(){return !verified&&signingActive();}
function nbuf(){var m=nreq('buffer');return m&&m.Buffer?m.Buffer:(typeof Buffer!=='undefined'?Buffer:null);}
function signingKey(id){if(!own(SIGN_KEYS,id)||/PLACEHOLDER/.test(id+SIGN_KEYS[id]))return null;storageInit();var B=nbuf(),raw=B.from(SIGN_KEYS[id],'base64');if(raw.length!==32)return null;return ncrypto.createPublicKey({key:B.concat([B.from('302a300506032b6570032100','hex'),raw]),format:'der',type:'spki'});}
function verifySigned(se){if(!se||typeof se.payload!=='string'||typeof se.signature!=='string')return null;if(signedCheck&&signedCheck.src===se)return signedCheck.payload;var p=null;try{var B=nbuf(),key=signingKey(String(se.key_id||''));if(key&&ncrypto.verify(null,B.from(se.payload,'utf8'),key,B.from(se.signature,'base64'))){p=JSON.parse(se.payload);if(!p||p.v!==1||p.aud!==SIGN_AUD||p.key_id!==se.key_id)p=null;}}catch(e){p=null;}signedCheck={src:se,payload:p};return p;}
function signedFor(p){return !!(p&&session&&p.user_id===String(session.user&&session.user.id||'')&&p.device_id===device()&&device());}
/* Valid signature, this user and device, issued_at - slack <= server-time estimate, deadline < expires_at, allowed. */
function signedGrant(){var p=verifySigned(signedEnt);if(!p||p.allowed!==true||!signedFor(p))return null;var iss=Date.parse(p.issued_at),exp=Date.parse(p.expires_at);if(!isFinite(iss)||!isFinite(exp)||latestNow()<iss-CLOCK_SLACK_MS||expNow()>=exp)return null;return p;}
function sameTime(a,b){return (Date.parse(a||'')||0)===(Date.parse(b||'')||0);}
/* After an online check: drop a signed copy that disagrees with the server's answer, fetch a fresh one when missing or older than 1 h. Failures only cost offline grace. */
function refreshSigned(generation){
 if(!signingActive()||!session||!entitlement||entitlement.session_replaced||signedFlight)return null;
 var p=verifySigned(signedEnt),now=srvNow();
 if(p&&!(signedFor(p)&&p.allowed===(entitlement.allowed===true)&&p.license_status===entitlement.license_status&&sameTime(p.trial_expires_at,entitlement.trial_expires_at))){signedEnt=null;p=null;}
 if(p){var iss=Date.parse(p.issued_at);if(now-iss<SIGN_REFRESH_MS&&iss<=now+CLOCK_SLACK_MS)return null;}
 signedFlight=(async function(){try{var d=await request('/functions/v1/plugin-entitlement-signed',{method:'POST',auth:true,body:rpcBody()});if(generation!==authGeneration||!session)return;var se=d&&d.signed,q=verifySigned(se);if(q&&signedFor(q)){signedEnt={payload:se.payload,signature:se.signature,key_id:se.key_id};save();notify();}}catch(e){}finally{signedFlight=null;}}());
 return signedFlight;
}
function graceState(){
 if(!verified&&rolledBack())return null;
 if(signedOnly()){var g=signedGrant();if(!g)return null;return {ageMs:Math.max(0,srvNow()-Date.parse(g.issued_at)),leftMs:Math.max(0,Date.parse(g.expires_at)-expNow())};}
 if(!session||!entitlement||entitlement.allowed!==true||!verifiedMeta||verifiedMeta.allowed===false)return null;
 if(String(verifiedMeta.user||'')!==userKey(session))return null;
 var dev=device();if(verifiedMeta.device&&dev&&verifiedMeta.device!==dev)return null;
 var age=observedNow()-Number(verifiedMeta.at||0);
 /* Clock moved back before the last verification, or past the 72 h window: no grace. */
 if(!(age>=-CLOCK_SLACK_MS&&age<=GRACE_MS))return null;
 age=Math.max(0,age);return {ageMs:age,leftMs:GRACE_MS-age};
}
function headers(auth){var h={'apikey':KEY,'Content-Type':'application/json'};if(auth&&session&&session.access_token)h.Authorization='Bearer '+session.access_token;return h;}
function accountFetch(url,opt){
 return new Promise(function(resolve,reject){var ctrl=typeof AbortController==='function'?new AbortController():null,finished=false,timer;
 function done(err,v){if(finished)return;finished=true;clearTimeout(timer);err?reject(err):resolve(v);}
 timer=setTimeout(function(){if(ctrl)ctrl.abort();done(Error('Account server timed out. Please retry.'));},30000);
 opt=opt||{};if(ctrl)opt.signal=ctrl.signal;
 Promise.resolve().then(function(){return fetch(url,opt);}).then(function(res){return res.text().then(function(body){done(null,{ok:res.ok,status:res.status,text:function(){return Promise.resolve(body);}});});}).catch(function(e){done(e);});
 });
}
/* The account server always answers JSON. Any other body (a proxy, firewall or captive-portal page, whatever its HTTP status) is a
   transient error without a status, never an answer: it must not lock the account or replace the signed copy. */
function unreadableResponse(){var e=Error('The account server could not be reached cleanly (a proxy, firewall or hotspot login page answered instead). Check your connection and retry.');e.code='UNREADABLE_RESPONSE';return e;}
async function request(path,opt){opt=opt||{};var r=await accountFetch(URL+path,{method:opt.method||'GET',headers:opt.headers||headers(opt.auth),body:opt.body?JSON.stringify(opt.body):undefined});var text=await r.text(),data=null;try{data=text?JSON.parse(text):{};}catch(e){throw unreadableResponse();}if(!r.ok){var d=data&&typeof data==='object'?data:{},er=Error(d.msg||d.message||d.error_description||d.error||('HTTP '+r.status));er.status=r.status;if(typeof d.code==='string')er.pgCode=d.code;throw er;}return data;}
function authRejected(e){var m=String(e&&e.message||'').toLowerCase();return !!(e&&e.status===401)||(/refresh[_ ]?token/.test(m)&&/(invalid|expired|revoked|not found|already used)/.test(m))||/invalid[_ ]?grant/.test(m);}
async function refresh(){if(refreshFlight)return refreshFlight;refreshFlight=refreshOnce();try{return await refreshFlight;}finally{refreshFlight=null;}}
function sleep(ms){return new Promise(function(r){setTimeout(r,ms);});}
/* Refresh tokens are single-use. Another panel (or a previous panel instance) may already have rotated ours and saved the result. */
function storedNewerSession(){try{if(!session||(pendingLogin&&pendingLogin.session===session))return null;var c=storedCandidates()[0];if(!c||!c.session||c.session.refresh_token===session.refresh_token)return null;if(userKey(c.session)!==userKey(session))return null;if(Number(c.session.expires_at||0)<Number(session.expires_at||0))return null;return c.session;}catch(e){return null;}}
async function refreshOnce(){if(!session||!session.refresh_token)return false;var generation=authGeneration,prior=session,attempt=0;
 function adopt(){var s=storedNewerSession();if(!s)return 0;if(pendingLogin&&pendingLogin.session===session)pendingLogin.session=s;session=s;prior=s;restoreDiagnostic='TOKEN_ADOPTED_FROM_OTHER_INSTANCE';return Number(s.expires_at||0)>Math.floor(Date.now()/1000)+60?2:1;}
 try{if(adopt()===2){notify();return true;}
 for(;;){try{restoreDiagnostic='TOKEN_REFRESHING';var d=await request('/auth/v1/token?grant_type=refresh_token',{method:'POST',body:{refresh_token:session.refresh_token}});if(!d||!d.access_token||!d.refresh_token)throw Error('Refresh response missing session tokens');if(generation!==authGeneration||session!==prior)return false;if(!d.user&&prior.user)d.user=prior.user;if(pendingLogin&&pendingLogin.session===prior)pendingLogin.session=d;session=d;save();restoreDiagnostic='TOKEN_REFRESHED';return true;}
 catch(re){/* "Already used": give the other instance a moment to save, then retry once with the stored token before giving up. */if(attempt++===0&&/already used/i.test(String(re&&re.message||''))&&generation===authGeneration&&session===prior){await sleep(1000);if(generation!==authGeneration||session!==prior)return false;var a=adopt();if(a===2){notify();return true;}if(a===1)continue;}throw re;}}
 }catch(e){/* Never turn a temporary server/network problem into a logout. */restoreDiagnostic='TOKEN_REFRESH_FAILED:'+String(e&&e.message||e);if(authRejected(e)&&generation===authGeneration&&session===prior){verified=false;offline=false;session=null;profile=null;entitlement=null;verifiedMeta=null;signedEnt=null;save();restoreDiagnostic='TOKEN_REJECTED_LOGIN_REQUIRED';notify();}return false;}}
/* deviceId() directly: RPLicense.status() reads RPAccountAuth.status(), which needs device() for the offline-grace check. */
function device(){try{var L=global.RPLicense;return (L.deviceId?L.deviceId():L.status().deviceId)||'';}catch(e){return '';}}
function platform(){try{var p=nreq('process').platform;return p==='darwin'?'macOS':p==='win32'?'Windows':p;}catch(e){return 'Unknown';}}
function rpcBody(){return {p_device_id:device(),p_platform:platform(),p_plugin_version:'2.3.11.16-public-v19'};}
/* Refresh shortly before the access token expires, so heartbeat/entitlement calls do not hit the server with an expired JWT (401) first. */
async function freshen(){var exp=session&&Number(session.expires_at||0);if(exp&&exp<=Math.floor(Date.now()/1000)+60){try{await refresh();}catch(e){}}}
async function rpc(name){await freshen();var body=rpcBody();try{return await request('/rest/v1/rpc/'+name,{method:'POST',auth:true,headers:Object.assign(headers(true),{'Accept':'application/vnd.pgrst.object+json'}),body:body});}catch(e){if(/jwt|token|expired/i.test(e.message)&&await refresh())return request('/rest/v1/rpc/'+name,{method:'POST',auth:true,headers:Object.assign(headers(true),{'Accept':'application/vnd.pgrst.object+json'}),body:body});throw e;}}
function sessionReplacedError(){var e=Error('Your account was signed in on another device. Only one device can use this account at a time.');e.code='SESSION_REPLACED';return e;}
function clearReplacedSession(){authGeneration++;verified=false;offline=false;session=null;profile=null;entitlement=null;verifiedMeta=null;signedEnt=null;save();restoreDiagnostic='SESSION_REPLACED_BY_ANOTHER_DEVICE';notify();}
/* A real entitlement answer always has a boolean allowed and a license status (a replaced-session answer at least the flag). */
function entitlementAnswer(x){return !!x&&typeof x==='object'&&typeof x.allowed==='boolean'&&(typeof x.license_status==='string'||x.session_replaced===true);}
/* Only a 403 in the account server's own JSON error shape ({code,message}) is a denial; a renamed RPC (404), a bad deploy (400/405)
   or a gateway page must not lock running panels, so those take the offline-grace path like a network error. */
function entitlementDenied(e){return !!e&&Number(e.status)===403&&typeof e.pgCode==='string';}
/* Transient failure or a server-side fault: offline grace. A denial ends "verified" for this run. An expired login (401) is left to the refresh/logout path. */
async function syncEntitlement(){if(!session)return null;var generation=authGeneration,received;try{received=await rpc('plugin_entitlement');if(!entitlementAnswer(received))throw unreadableResponse();}catch(e){if(generation===authGeneration&&session){if(entitlementDenied(e)){offline=false;verified=false;}else if(authRejected(e))offline=false;else if(e&&e.code!=='SESSION_REPLACED')goOffline(e);else offline=false;notify();}throw e;}if(generation!==authGeneration||!session)return null;entitlement=received;verified=true;offline=false;offlineReason='';if(entitlement&&entitlement.session_replaced){clearReplacedSession();throw sessionReplacedError();}markVerified(entitlement);entitlementBase=Number(entitlement.remaining_seconds||0);entitlementTick=(global.performance&&performance.now)?performance.now():Date.now();refreshSigned(generation);if(session)save();notify();return entitlement;}
async function bind(){if(!session)return null;var generation=authGeneration,received=await rpc('register_plugin_device');if(generation!==authGeneration||!session)return null;profile=received;await syncEntitlement();if(session)save();notify();return profile;}
/* Bind the device and verify entitlement while the new session is held in memory only; persist on success, wipe on failure. */
async function commitLogin(generation){var p={session:session};pendingLogin=p;var ok=false,err=null;try{await bind();ok=generation===authGeneration&&!!session&&session===p.session;}catch(e){err=e;}finally{if(pendingLogin===p)pendingLogin=null;}
 if(ok){save();notify();return;}
 if(session&&session===p.session){verified=false;offline=false;session=null;profile=null;entitlement=null;verifiedMeta=null;signedEnt=null;save();restoreDiagnostic='LOGIN_DEVICE_BIND_FAILED';notify();}
 throw err||Error('Sign-in was cancelled before this device was verified.');}

function resetWait(){try{return Math.max(0,Number(localStorage.getItem(RESET_COOLDOWN)||0)-Date.now());}catch(e){return 0;}}
async function forgotPassword(email){
 if(resetWait()>0)throw Error('Please wait '+Math.ceil(resetWait()/1000)+' seconds before requesting another password reset email.');
 if(!email)throw Error('Enter your email first.');
 var d=await request('/auth/v1/recover?redirect_to='+encodeURIComponent(EMAIL_REDIRECT),{method:'POST',body:{email:email}});
 try{localStorage.setItem(RESET_COOLDOWN,String(Date.now()+65000));}catch(_e){}
 return d||{ok:true};
}
function signupWait(){try{return Math.max(0,Number(localStorage.getItem(SIGNUP_COOLDOWN)||0)-Date.now());}catch(e){return 0;}}
function friendly(e){var m=(e&&e.message?e.message:String(e||''));if(/email rate limit exceeded/i.test(m))return 'Verification email limit reached. Wait a few minutes, then try once. If this email was already registered, use Sign In instead.';if(/user already registered|already been registered/i.test(m))return 'This email already has an account. Use Sign In instead.';if(/email not confirmed/i.test(m))return 'Email not confirmed yet. Open the verification email first, then Sign In.';if(/invalid login credentials/i.test(m))return 'Email or password is incorrect, or the email is not confirmed yet. Created your account with Google? Use Continue with Google instead. Never type your Google password into the plugin.';if(/failed to fetch|networkerror|network request failed|account server timed out/i.test(m))return 'Cannot reach the account server. Check your internet connection and retry.';return m;}
async function signUp(email,password){email=String(email||'').trim();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw Error('Enter a valid email address.');if(String(password||'').length<8)throw Error('Use a password with at least 8 characters.');if(busy)throw Error('An account request is already running.');if(signupWait()>0)throw Error('Please wait '+Math.ceil(signupWait()/1000)+' seconds before requesting another verification email.');var generation=++authGeneration;verified=false;busy=true;notify();try{var d=await request('/auth/v1/signup?redirect_to='+encodeURIComponent(EMAIL_REDIRECT),{method:'POST',body:{email:email,password:password}});try{localStorage.setItem(SIGNUP_COOLDOWN,String(Date.now()+65000));}catch(x){}if(generation!==authGeneration)throw Error('Sign-up cancelled.');if(d&&d.access_token){session=d;profile=null;entitlement=null;verifiedMeta=null;signedEnt=null;offline=false;await commitLogin(generation);return {ok:true,needsConfirmation:false,signedIn:true};}return {ok:true,needsConfirmation:true};}catch(e){throw Error(friendly(e));}finally{busy=false;notify();}}
async function resendConfirmation(email){email=String(email||'').trim();if(!email)throw Error('Enter your email first.');if(signupWait()>0)throw Error('Please wait '+Math.ceil(signupWait()/1000)+' seconds before requesting another confirmation email.');var result=await request('/auth/v1/resend?redirect_to='+encodeURIComponent(EMAIL_REDIRECT),{method:'POST',body:{type:'signup',email:email}});try{localStorage.setItem(SIGNUP_COOLDOWN,String(Date.now()+65000));}catch(e){}return result;}
async function signIn(email,password){if(busy)return;var generation=++authGeneration;verified=false;busy=true;notify();try{var d=await request('/auth/v1/token?grant_type=password',{method:'POST',body:{email:email,password:password}});if(generation!==authGeneration)throw Error('Sign-in cancelled.');if(!d||!d.access_token||!d.refresh_token)throw Error('The account server did not return a valid session.');session=d;profile=null;entitlement=null;verifiedMeta=null;signedEnt=null;offline=false;/* Explicit sign-in takes ownership of the single active device. Latest login wins. Persisted only after bind succeeds. */await commitLogin(generation);restoreDiagnostic='LOGIN_ACTIVE_DEVICE_TAKEOVER_OK';return {ok:true};}finally{busy=false;notify();}}
var heartbeatFlight=null;
function heartbeat(){if(heartbeatFlight)return heartbeatFlight;heartbeatFlight=heartbeatOnce().then(function(v){heartbeatFlight=null;return v;},function(e){heartbeatFlight=null;throw e;});return heartbeatFlight;}
async function heartbeatOnce(){if(!session)return null;try{profile=await rpc('plugin_heartbeat');await syncEntitlement();restoreDiagnostic='HEARTBEAT_OK';notify();return profile;}catch(e){var m=String(e&&e.message||e);if(/SESSION_REPLACED_BY_ANOTHER_DEVICE|SIGNED_IN_ON_ANOTHER_DEVICE/i.test(m)){clearReplacedSession();throw sessionReplacedError();}/* Preserve entitlement only for transient failures. */restoreDiagnostic='HEARTBEAT_FAILED_PRESERVED:'+m;if(transient(e))goOffline(e);if(authRejected(e)){var ok=await refresh();if(ok)try{profile=await rpc('plugin_heartbeat');await syncEntitlement();restoreDiagnostic='HEARTBEAT_REFRESHED_OK';notify();return profile;}catch(e2){var m2=String(e2&&e2.message||e2);if(/SESSION_REPLACED_BY_ANOTHER_DEVICE|SIGNED_IN_ON_ANOTHER_DEVICE/i.test(m2)){clearReplacedSession();throw sessionReplacedError();}restoreDiagnostic='HEARTBEAT_RETRY_FAILED:'+m2;}}notify();return null;}}
function cancelSocial(){if(!oauthPending)return;authGeneration++;oauthPending=false;busy=false;if(global.RPPluginGoogle)global.RPPluginGoogle.cancel();notify();}
function signOut(){cancelSocial();authGeneration++;pendingLogin=null;verified=false;offline=false;session=null;profile=null;entitlement=null;verifiedMeta=null;signedEnt=null;save();notify();}
/* Server-verified this run, or offline (transient failure) within 72 h of the last verification. Explicit answers (allowed:false, replaced, rejected) lock immediately. */
function canUse(){keepHighWater();if(signedOnly()){var g=offline&&graceState()&&signedGrant();return !!g&&(g.license_status==='lifetime'||remainingMs()>0);}if(!session||!entitlement||entitlement.allowed!==true)return false;if(!verified&&!offline)return false;if(!graceState())return false;return entitlement.license_status==='lifetime'||remainingMs()>0;}
function remainingMs(){if(signedOnly()){var g=signedGrant();if(!g)return 0;if(g.license_status==='lifetime')return null;var te=Date.parse(g.trial_expires_at||'');return isFinite(te)?Math.max(0,te-expNow()):0;}if(!entitlement)return 0;if(entitlement.license_status==='lifetime')return null;var elapsed=Math.max(0,((global.performance&&performance.now?performance.now():Date.now())-entitlementTick)/1000),ms=Math.max(0,(entitlementBase-elapsed)*1000),exp=Date.parse(entitlement.trial_expires_at||'');if(isFinite(exp))ms=Math.min(ms,Math.max(0,exp-expNow()));return ms;}
/* Offline with signing deployed: license fields shown to the panel come from the signed copy, not the editable cache. */
function shownEntitlement(){if(!signedOnly()||!entitlement)return entitlement;var g=signedGrant(),e=Object.assign({},entitlement);if(g){e.allowed=true;e.license_status=g.license_status;e.trial_started_at=g.trial_started_at;e.trial_expires_at=g.trial_expires_at;}return e;}
function shownVerifiedAt(){if(!signedOnly())return verifiedMeta?Number(verifiedMeta.at||0):0;var g=signedGrant();return g?Date.parse(g.issued_at)-skewMs():0;}
function status(){return {signedIn:!!session,email:session&&session.user?session.user.email:'',profile:profile,entitlement:shownEntitlement(),busy:busy,oauthPending:oauthPending,restoring:restoring,canUse:canUse(),remainingMs:remainingMs(),restoreDiagnostic:restoreDiagnostic,storageWarning:storageWarning,verified:verified,offline:offline,offlineReason:offlineReason,verifiedAt:shownVerifiedAt(),clockRolledBack:!verified&&!!session&&rolledBack(),graceRemainingMs:(function(){var g=graceState();return g?g.leftMs:0;}())};}
function onChange(fn){listeners.push(fn);}
async function restore(){restoring=true;load();if(!session){restoring=false;restoreDiagnostic='NO_SAVED_SESSION';notify();return;}busy=true;notify();try{var now=Math.floor(Date.now()/1000),exp=Number(session.expires_at||0);if(exp&&exp<=now+120){var refreshed=await refresh();if(!refreshed&&!session){restoring=false;busy=false;notify();return;}}/* Existing saved account is restored automatically and entitlement is verified without requiring logout/login. */if(session){await syncEntitlement();restoreDiagnostic='SESSION_RESTORED_ENTITLEMENT_OK';}}catch(e){restoreDiagnostic='RESTORE_ENTITLEMENT_FAILED_PRESERVED:'+String(e&&e.message||e);/* Only an explicit auth rejection may trigger one token refresh attempt. Device/RPC/network failures preserve the saved login. */if(session&&authRejected(e)){var ok=await refresh();if(ok)try{await syncEntitlement();restoreDiagnostic='SESSION_REFRESHED_ENTITLEMENT_OK';}catch(e2){restoreDiagnostic='RESTORE_ENTITLEMENT_RETRY_FAILED:'+String(e2&&e2.message||e2);}}}finally{busy=false;restoring=false;notify();}}
async function providerSettings(){try{return await request('/auth/v1/settings');}catch(e){return {external:{}};}}
function openUrl(u){try{if(global.cep&&global.cep.util&&global.cep.util.openURLInDefaultBrowser){global.cep.util.openURLInDefaultBrowser(u);return true;}}catch(e){}return false;}
/* Clear Google sign-in errors. The plugin never asks for a Google password. */
function googleError(e){var m=String(e&&e.message||e||''),c=e&&e.code||'',out=m;
 if(c==='SESSION_REPLACED')return e;
 if(c==='GOOGLE_TIMEOUT')out='Google sign-in timed out before your browser returned to Premiere. Click Continue with Google to retry and finish in the browser within 5 minutes, or use email login.';
 else if(c==='GOOGLE_CANCELLED'||/sign-in cancelled|sign-in was cancelled/i.test(m))out='Google sign-in was cancelled. Click Continue with Google to retry, or use email login.';
 else if(c==='GOOGLE_DENIED')out='Google sign-in was cancelled or access was denied in the browser. Click Continue with Google to retry.';
 else if(c==='GOOGLE_CALLBACK')out='The plugin could not receive the Google sign-in response on this computer (local callback blocked). Check firewall or security software for Adobe Premiere, or use email login.';
 else if(c==='GOOGLE_BROWSER')out='Could not open your system browser for Google sign-in. Set a default browser, then retry, or use email login.';
 else if(/flow[_ ]state|code[_ ]verifier|code[_ ]challenge|auth[_ ]code|invalid[_ ]grant/i.test(m))out='The Google sign-in link expired or was already used. Click Continue with Google again and finish in the browser.';
 else if(transient(e)&&(Number(e.status||0)>=500||/failed to fetch|network|timed out|abort|ECONN|ENOTFOUND|EAI_AGAIN|ETIMEDOUT/i.test(m)))out='Cannot reach the account server. Check your internet connection, then click Continue with Google again.';
 var x=Error(out);x.code=c||'GOOGLE_SIGNIN_FAILED';x.cause=e;return x;}
async function social(provider){
 if(provider!=='google')throw Error('Use Google or email login.');
 if(busy||restoring)throw Error('An account request is already running.');
 if(!global.RPPluginGoogle)throw Error('Google login module unavailable. Reinstall the latest plugin.');
 var generation=++authGeneration;busy=true;oauthPending=true;notify();
 try{
  var settings;try{settings=await request('/auth/v1/settings');}catch(se){if(transient(se))throw se;settings={external:{}};}
  if(generation!==authGeneration)throw Error('Google sign-in cancelled.');
  if(!(settings.external||{}).google)throw Error('Google login is unavailable. Use email login.');
  var callback=await global.RPPluginGoogle.start(openUrl);
  if(generation!==authGeneration)throw Error('Google sign-in cancelled.');
  var data=await request('/auth/v1/token?grant_type=pkce',{method:'POST',body:{auth_code:callback.code,code_verifier:callback.verifier}});
  callback.verifier='';
  if(!data||!data.access_token||!data.refresh_token)throw Error('Google did not return a valid account session.');
  var user=await request('/auth/v1/user',{headers:{apikey:KEY,Authorization:'Bearer '+data.access_token}});
  if(!user||!user.id||!user.email||!user.email_confirmed_at||!(user.identities||[]).some(function(identity){return identity.provider==='google';}))throw Error('Could not verify the Google account. Please retry.');
  if(generation!==authGeneration)throw Error('Google sign-in cancelled.');
  delete data.provider_token;delete data.provider_refresh_token;
  data.user=user;data.expires_at=Number(data.expires_at)||Math.floor(Date.now()/1000)+Number(data.expires_in||3600);
  verified=false;session=data;profile=null;entitlement=null;verifiedMeta=null;signedEnt=null;offline=false;
  await commitLogin(generation);
  restoreDiagnostic='GOOGLE_LOGIN_DEVICE_AND_ENTITLEMENT_VERIFIED';
  return {ok:true,canUse:canUse()};
 }catch(e){throw googleError(e);}finally{if(generation===authGeneration){busy=false;oauthPending=false;notify();}}
}
var checkoutFlight=null;
async function paymentRequest(path,body){if(!session)throw Error('Sign in first.');try{return await request(path,{method:'POST',auth:true,body:body||{}});}catch(e){if(authRejected(e)&&await refresh())return request(path,{method:'POST',auth:true,body:body||{}});throw e;}}
function createLifetimeCheckout(promoCode){if(checkoutFlight)return checkoutFlight;var promo=promoCode==null?'':String(promoCode).trim().toUpperCase();if(promo&&!/^[A-Z0-9]{3,40}$/.test(promo))return Promise.reject(Error('Invalid promo code. Use 3-40 letters or numbers.'));checkoutFlight=paymentRequest('/functions/v1/create-lifetime-checkout',promo?{promo_code:promo}:{}).then(function(data){var match=/^https:\/\/app\.midtrans\.com\//i.test(String(data.checkout_url||''));if(!match||data.charge_currency!=='IDR'||!isFinite(Number(data.gross_amount_idr))||Number(data.gross_amount_idr)<=0)throw Error('The payment server returned invalid checkout details.');return data;});checkoutFlight=checkoutFlight.then(function(data){checkoutFlight=null;return data;},function(e){checkoutFlight=null;throw e;});return checkoutFlight;}
async function reconcileLifetimePayment(){var result=await paymentRequest('/functions/v1/check-lifetime-payment',{});try{await refreshEntitlement();}catch(e){if(!result||!result.paid||(e&&e.code==='SESSION_REPLACED')||authRejected(e))throw e;}return result;}
async function refreshEntitlement(){
 if(!session)throw Error('Sign in first.');
 await syncEntitlement();return status();
}
global.RPAccountAuth={openExternalUrl:openUrl,cancelSocial:cancelSocial,signUp:signUp,resendConfirmation:resendConfirmation,signupWait:signupWait,resetWait:resetWait,forgotPassword:forgotPassword,friendly:friendly,signIn:signIn,social:social,providerSettings:providerSettings,signOut:signOut,status:status,canUse:canUse,onChange:onChange,restore:restore,heartbeat:heartbeat,createLifetimeCheckout:createLifetimeCheckout,reconcileLifetimePayment:reconcileLifetimePayment,refreshEntitlement:refreshEntitlement};
}(window));
