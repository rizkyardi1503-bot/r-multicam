(function(global){
'use strict';
var URL='https://ngotkvqtzqiotztnqwaw.supabase.co';
var KEY='sb_publishable_aBJ_h2Gaearwl5nG2Xo75g_j7YAUOxS';
var STORE='rp.account.session.v23100', PERSIST='account-session-v4.json', SIGNUP_COOLDOWN='rp.account.signup.cooldown.v239', RESET_COOLDOWN='rp.account.reset.cooldown.v239';
var EMAIL_REDIRECT='https://r-multicam.pages.dev/auth/confirmed/';
var session=null,profile=null,entitlement=null,busy=false,restoring=true,listeners=[],entitlementTick=0,entitlementBase=0;
var refreshFlight=null,authGeneration=0,verified=false,storageWarning='',sessionSavedAt=0,oauthPending=false;
var nfs=null,nos=null,ncrypto=null,npath=null,nproc=null;
function nreq(n){try{if(global.cep_node&&global.cep_node.require)return global.cep_node.require(n);}catch(e){}try{if(typeof require==='function')return require(n);if(typeof global.require==='function')return global.require(n);}catch(e2){}return null;}
function storageInit(){if(nfs&&nos&&ncrypto&&npath&&nproc)return;nfs=nreq('fs');nos=nreq('os');ncrypto=nreq('crypto');npath=nreq('path');nproc=nreq('process');}
function storageDir(){storageInit();if(!nfs||!nos||!npath||!nproc)return '';var home=nos.homedir(),d=nproc.platform==='win32'?npath.join(nproc.env.LOCALAPPDATA||npath.join(home,'AppData','Local'),'RProjectMulticam'):npath.join(home,'Library','Application Support','RProjectMulticam');try{if(!nfs.existsSync(d))nfs.mkdirSync(d,{recursive:true});}catch(e){}return d;}
function sessionFile(){storageInit();var d=storageDir();return d&&npath?npath.join(d,PERSIST):'';}
function legacySessionFile(){storageInit();var d=storageDir();return d&&npath?npath.join(d,'account-session.dat'):'';}
function v2SessionFile(){storageInit();var d=storageDir();return d&&npath?npath.join(d,'account-session-v2.json'):'';}
function legacyStorageKey(){storageInit();if(!ncrypto||!nos)return null;var seed='RProjectMulticam|'+String(nos.hostname())+'|'+String(nos.platform())+'|session-v1';return ncrypto.createHash('sha256').update(seed).digest();}
function legacyDecrypt(text){storageInit();var b=Buffer.from(String(text||'').trim(),'base64');if(b.length<32||b.slice(0,4).toString()!=='RPS1')return null;var key=legacyStorageKey(),iv=b.slice(4,16),tag=b.slice(16,32),enc=b.slice(32),d=ncrypto.createDecipheriv('aes-256-gcm',key,iv);d.setAuthTag(tag);return JSON.parse(Buffer.concat([d.update(enc),d.final()]).toString('utf8'));}
function atomicSessionWrite(text){storageInit();var f=sessionFile();if(!f||!nfs)throw Error('Node persistent storage unavailable');var t=f+'.tmp-'+String(Date.now());nfs.writeFileSync(t,text,{encoding:'utf8',mode:384});try{nfs.renameSync(t,f);}catch(e){try{nfs.unlinkSync(f);}catch(x){}nfs.renameSync(t,f);}}
function persistentWrite(obj){var payload={schema:4,saved_at:sessionSavedAt,session:obj,profile:profile,entitlement:entitlement};atomicSessionWrite(JSON.stringify(payload));var verify=JSON.parse(nfs.readFileSync(sessionFile(),'utf8'));if(!verify||verify.schema!==4||!verify.session||verify.session.refresh_token!==obj.refresh_token)throw Error('Persistent session read-back verification failed.');}
function cepRoot(){try{var cs=new global.CSInterface(),u=cs.getSystemPath(global.SystemPath.USER_DATA)||'';u=decodeURIComponent(String(u).replace(/^file:\/\//i,''));if(/^\/[A-Za-z]:\//.test(u))u=u.slice(1);return u.replace(/\\/g,'/').replace(/\/$/,'')+'/RProjectMulticam';}catch(e){return '';}}
function cepFs(){try{return global.cep&&global.cep.fs?global.cep.fs:null;}catch(e){return null;}}
function cepSessionFile(){var d=cepRoot();return d?d+'/'+PERSIST:'';}
function cepEnsureDir(){var fs=cepFs(),d=cepRoot();if(!fs||!d)return false;try{var r=fs.makedir(d);return !r||r.err===0||r.err===3;}catch(e){return false;}}
function cepPersistentWrite(obj){var fs=cepFs(),f=cepSessionFile();if(!fs||!f)throw Error('CEP persistent storage unavailable');cepEnsureDir();var payload={schema:4,saved_at:sessionSavedAt,session:obj,profile:profile,entitlement:entitlement};var text=JSON.stringify(payload),w=fs.writeFile(f,text);if(w&&w.err)throw Error('CEP session write failed '+w.err);var r=fs.readFile(f);if(!r||r.err||!r.data)throw Error('CEP session read-back failed '+(r&&r.err));var v=JSON.parse(r.data);if(!v||v.schema!==4||!v.session||v.session.refresh_token!==obj.refresh_token)throw Error('CEP session verification mismatch');return true;}
function cepPersistentRead(){var fs=cepFs(),f=cepSessionFile();if(!fs||!f)return null;try{var r=fs.readFile(f);if(!r||r.err||!r.data)return null;var x=JSON.parse(r.data);if(x&&x.schema===4&&x.session&&x.session.access_token&&x.session.refresh_token){profile=x.profile||null;entitlement=x.entitlement||null;if(entitlement){entitlementBase=Number(entitlement.remaining_seconds||0);entitlementTick=(global.performance&&performance.now)?performance.now():Date.now();}return x.session;}}catch(e){}return null;}
function cepPersistentDelete(){try{var fs=cepFs(),f=cepSessionFile();if(fs&&f)fs.deleteFile(f);}catch(e){}}
function persistentRead(){storageInit();var f=sessionFile();if(!f||!nfs||!nfs.existsSync(f))return null;var x=JSON.parse(nfs.readFileSync(f,'utf8'));if(x&&x.session&&x.session.access_token&&x.session.refresh_token){profile=x.profile||null;entitlement=x.entitlement||null;if(entitlement){entitlementBase=Number(entitlement.remaining_seconds||0);entitlementTick=(global.performance&&performance.now)?performance.now():Date.now();}return x.session;}return null;}

function notify(){for(var i=0;i<listeners.length;i++)try{listeners[i](status());}catch(e){}}
var restoreDiagnostic='NOT_RUN';
function save(){
 if(session){
  sessionSavedAt=Math.max(Date.now(),sessionSavedAt+1);storageWarning='';var cepOK=false,nodeOK=false,localOK=false;
  try{cepPersistentWrite(session);cepOK=true;}catch(cx){}
  try{persistentWrite(session);nodeOK=true;}catch(nx){}
  try{localStorage.setItem(STORE,JSON.stringify({schema:4,saved_at:sessionSavedAt,session:session}));localOK=true;}catch(e){}
  storageWarning=cepOK||nodeOK?'':localOK?'Login is saved only in the panel cache. Permanent storage is unavailable; login may be required after restarting Premiere.':'Login could not be saved. Check write permissions for your user application-data folder.';restoreDiagnostic=cepOK?'SESSION_SAVED_CEP_VERIFIED':nodeOK?'SESSION_SAVED_NODE_VERIFIED':localOK?'SESSION_SAVED_LOCAL_FALLBACK':'SESSION_SAVE_FAILED';
 }else{
  try{localStorage.removeItem(STORE);}catch(e2){}
  cepPersistentDelete();
  try{storageInit();var f=sessionFile();if(nfs){[f,legacySessionFile(),v2SessionFile()].forEach(function(old){if(old&&nfs.existsSync(old))nfs.unlinkSync(old);});}}catch(x2){}
 }
}
function load(){
 verified=false;session=null;profile=null;entitlement=null;storageWarning='';restoreDiagnostic='SESSION_NOT_FOUND';
 var candidates=[];
 function add(text,source){try{var x=JSON.parse(text||'null'),v=x&&x.session?x.session:x;if(v&&v.access_token&&v.refresh_token)candidates.push({session:v,profile:x.profile||null,entitlement:x.entitlement||null,saved:Number(x.saved_at)||0,expires:Number(v.expires_at)||0,source:source});}catch(e){}}
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
 if(candidates.length){var best=candidates[0];session=best.session;profile=best.profile;entitlement=best.entitlement;sessionSavedAt=best.saved;entitlementBase=Number(entitlement&&entitlement.remaining_seconds||0);entitlementTick=(global.performance&&performance.now)?performance.now():Date.now();restoreDiagnostic='SESSION_LOADED_'+best.source;}
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
async function request(path,opt){opt=opt||{};var r=await accountFetch(URL+path,{method:opt.method||'GET',headers:opt.headers||headers(opt.auth),body:opt.body?JSON.stringify(opt.body):undefined});var text=await r.text(),data=null;try{data=text?JSON.parse(text):{};}catch(e){data={message:text};}if(!r.ok){var er=Error(data.msg||data.message||data.error_description||data.error||('HTTP '+r.status));er.status=r.status;throw er;}return data;}
function authRejected(e){var m=String(e&&e.message||'').toLowerCase();return !!(e&&e.status===401)||(/refresh[_ ]?token/.test(m)&&/(invalid|expired|revoked|not found|already used)/.test(m))||/invalid[_ ]?grant/.test(m);}
async function refresh(){if(refreshFlight)return refreshFlight;refreshFlight=refreshOnce();try{return await refreshFlight;}finally{refreshFlight=null;}}
async function refreshOnce(){if(!session||!session.refresh_token)return false;var generation=authGeneration,prior=session;try{restoreDiagnostic='TOKEN_REFRESHING';var d=await request('/auth/v1/token?grant_type=refresh_token',{method:'POST',body:{refresh_token:session.refresh_token}});if(!d||!d.access_token||!d.refresh_token)throw Error('Refresh response missing session tokens');if(generation!==authGeneration||session!==prior)return false;session=d;save();restoreDiagnostic='TOKEN_REFRESHED';return true;}catch(e){/* Never turn a temporary server/network problem into a logout. */restoreDiagnostic='TOKEN_REFRESH_FAILED:'+String(e&&e.message||e);if(authRejected(e)&&generation===authGeneration&&session===prior){verified=false;session=null;profile=null;entitlement=null;save();restoreDiagnostic='TOKEN_REJECTED_LOGIN_REQUIRED';notify();}return false;}}
function device(){try{return global.RPLicense.status().deviceId||'';}catch(e){return '';}}
function platform(){try{var p=nreq('process').platform;return p==='darwin'?'macOS':p==='win32'?'Windows':p;}catch(e){return 'Unknown';}}
async function rpc(name){var body={p_device_id:device(),p_platform:platform(),p_plugin_version:'2.3.11.3-public-v18'};try{return await request('/rest/v1/rpc/'+name,{method:'POST',auth:true,headers:Object.assign(headers(true),{'Accept':'application/vnd.pgrst.object+json'}),body:body});}catch(e){if(/jwt|token|expired/i.test(e.message)&&await refresh())return request('/rest/v1/rpc/'+name,{method:'POST',auth:true,headers:Object.assign(headers(true),{'Accept':'application/vnd.pgrst.object+json'}),body:body});throw e;}}
function sessionReplacedError(){var e=Error('Your account was signed in on another device. Only one device can use this account at a time.');e.code='SESSION_REPLACED';return e;}
function clearReplacedSession(){authGeneration++;verified=false;session=null;profile=null;entitlement=null;save();restoreDiagnostic='SESSION_REPLACED_BY_ANOTHER_DEVICE';notify();}
async function syncEntitlement(){if(!session)return null;var generation=authGeneration;var received=await rpc('plugin_entitlement');if(generation!==authGeneration||!session)return null;entitlement=received;verified=true;if(entitlement&&entitlement.session_replaced){clearReplacedSession();throw sessionReplacedError();}entitlementBase=Number(entitlement.remaining_seconds||0);entitlementTick=(global.performance&&performance.now)?performance.now():Date.now();if(session)save();notify();return entitlement;}
async function bind(){if(!session)return null;var generation=authGeneration,received=await rpc('register_plugin_device');if(generation!==authGeneration||!session)return null;profile=received;await syncEntitlement();if(session)save();notify();return profile;}

function resetWait(){try{return Math.max(0,Number(localStorage.getItem(RESET_COOLDOWN)||0)-Date.now());}catch(e){return 0;}}
async function forgotPassword(email){
 if(resetWait()>0)throw Error('Please wait '+Math.ceil(resetWait()/1000)+' seconds before requesting another password reset email.');
 if(!email)throw Error('Enter your email first.');
 var d=await request('/auth/v1/recover?redirect_to='+encodeURIComponent(EMAIL_REDIRECT),{method:'POST',body:{email:email}});
 try{localStorage.setItem(RESET_COOLDOWN,String(Date.now()+65000));}catch(_e){}
 return d||{ok:true};
}
function signupWait(){try{return Math.max(0,Number(localStorage.getItem(SIGNUP_COOLDOWN)||0)-Date.now());}catch(e){return 0;}}
function friendly(e){var m=(e&&e.message?e.message:String(e||''));if(/email rate limit exceeded/i.test(m))return 'Verification email limit reached. Wait a few minutes, then try once. If this email was already registered, use Sign In instead.';if(/user already registered|already been registered/i.test(m))return 'This email already has an account. Use Sign In instead.';if(/email not confirmed/i.test(m))return 'Email not confirmed yet. Open the verification email first, then Sign In.';if(/invalid login credentials/i.test(m))return 'Email or password is incorrect, or the email is not confirmed yet.';return m;}
async function signUp(email,password){email=String(email||'').trim();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw Error('Enter a valid email address.');if(String(password||'').length<8)throw Error('Use a password with at least 8 characters.');if(busy)throw Error('An account request is already running.');if(signupWait()>0)throw Error('Please wait '+Math.ceil(signupWait()/1000)+' seconds before requesting another verification email.');var generation=++authGeneration;verified=false;busy=true;notify();try{var d=await request('/auth/v1/signup?redirect_to='+encodeURIComponent(EMAIL_REDIRECT),{method:'POST',body:{email:email,password:password}});try{localStorage.setItem(SIGNUP_COOLDOWN,String(Date.now()+65000));}catch(x){}if(generation!==authGeneration)throw Error('Sign-up cancelled.');if(d&&d.access_token){session=d;profile=null;entitlement=null;save();await bind();return {ok:true,needsConfirmation:false,signedIn:true};}return {ok:true,needsConfirmation:true};}catch(e){throw Error(friendly(e));}finally{busy=false;notify();}}
async function resendConfirmation(email){email=String(email||'').trim();if(!email)throw Error('Enter your email first.');if(signupWait()>0)throw Error('Please wait '+Math.ceil(signupWait()/1000)+' seconds before requesting another confirmation email.');var result=await request('/auth/v1/resend?redirect_to='+encodeURIComponent(EMAIL_REDIRECT),{method:'POST',body:{type:'signup',email:email}});try{localStorage.setItem(SIGNUP_COOLDOWN,String(Date.now()+65000));}catch(e){}return result;}
async function signIn(email,password){if(busy)return;var generation=++authGeneration;verified=false;busy=true;notify();try{var d=await request('/auth/v1/token?grant_type=password',{method:'POST',body:{email:email,password:password}});if(generation!==authGeneration)throw Error('Sign-in cancelled.');session=d;profile=null;entitlement=null;save();/* Explicit sign-in takes ownership of the single active device. Latest login wins. */await bind();restoreDiagnostic='LOGIN_ACTIVE_DEVICE_TAKEOVER_OK';return {ok:true};}finally{busy=false;notify();}}
var heartbeatFlight=null;
function heartbeat(){if(heartbeatFlight)return heartbeatFlight;heartbeatFlight=heartbeatOnce().then(function(v){heartbeatFlight=null;return v;},function(e){heartbeatFlight=null;throw e;});return heartbeatFlight;}
async function heartbeatOnce(){if(!session)return null;try{profile=await rpc('plugin_heartbeat');await syncEntitlement();restoreDiagnostic='HEARTBEAT_OK';notify();return profile;}catch(e){var m=String(e&&e.message||e);if(/SESSION_REPLACED_BY_ANOTHER_DEVICE|SIGNED_IN_ON_ANOTHER_DEVICE/i.test(m)){clearReplacedSession();throw sessionReplacedError();}/* Preserve entitlement only for transient failures. */restoreDiagnostic='HEARTBEAT_FAILED_PRESERVED:'+m;if(authRejected(e)){var ok=await refresh();if(ok)try{profile=await rpc('plugin_heartbeat');await syncEntitlement();restoreDiagnostic='HEARTBEAT_REFRESHED_OK';notify();return profile;}catch(e2){var m2=String(e2&&e2.message||e2);if(/SESSION_REPLACED_BY_ANOTHER_DEVICE|SIGNED_IN_ON_ANOTHER_DEVICE/i.test(m2)){clearReplacedSession();throw sessionReplacedError();}restoreDiagnostic='HEARTBEAT_RETRY_FAILED:'+m2;}}notify();return null;}}
function cancelSocial(){if(!oauthPending)return;authGeneration++;oauthPending=false;busy=false;if(global.RPPluginGoogle)global.RPPluginGoogle.cancel();notify();}
function signOut(){cancelSocial();authGeneration++;verified=false;session=null;profile=null;entitlement=null;save();notify();}
function canUse(){return !!(verified&&session&&entitlement&&entitlement.allowed===true&&(entitlement.license_status==='lifetime'||remainingMs()>0));}
function remainingMs(){if(!entitlement)return 0;if(entitlement.license_status==='lifetime')return null;var elapsed=Math.max(0,((global.performance&&performance.now?performance.now():Date.now())-entitlementTick)/1000);return Math.max(0,(entitlementBase-elapsed)*1000);}
function status(){return {signedIn:!!session,email:session&&session.user?session.user.email:'',profile:profile,entitlement:entitlement,busy:busy,oauthPending:oauthPending,restoring:restoring,canUse:canUse(),remainingMs:remainingMs(),restoreDiagnostic:restoreDiagnostic,storageWarning:storageWarning};}
function onChange(fn){listeners.push(fn);}
async function restore(){restoring=true;load();if(!session){restoring=false;restoreDiagnostic='NO_SAVED_SESSION';notify();return;}busy=true;notify();try{var now=Math.floor(Date.now()/1000),exp=Number(session.expires_at||0);if(exp&&exp<=now+120){var refreshed=await refresh();if(!refreshed&&!session){restoring=false;busy=false;notify();return;}}/* Existing saved account is restored automatically and entitlement is verified without requiring logout/login. */if(session){await syncEntitlement();restoreDiagnostic='SESSION_RESTORED_ENTITLEMENT_OK';}}catch(e){restoreDiagnostic='RESTORE_ENTITLEMENT_FAILED_PRESERVED:'+String(e&&e.message||e);/* Only an explicit auth rejection may trigger one token refresh attempt. Device/RPC/network failures preserve the saved login. */if(session&&authRejected(e)){var ok=await refresh();if(ok)try{await syncEntitlement();restoreDiagnostic='SESSION_REFRESHED_ENTITLEMENT_OK';}catch(e2){restoreDiagnostic='RESTORE_ENTITLEMENT_RETRY_FAILED:'+String(e2&&e2.message||e2);}}}finally{busy=false;restoring=false;notify();}}
async function providerSettings(){try{return await request('/auth/v1/settings');}catch(e){return {external:{}};}}
function openUrl(u){try{if(global.cep&&global.cep.util&&global.cep.util.openURLInDefaultBrowser){global.cep.util.openURLInDefaultBrowser(u);return true;}}catch(e){}return false;}
async function social(provider){
 if(provider!=='google')throw Error('Use Google or email login.');
 if(busy||restoring)throw Error('An account request is already running.');
 if(!global.RPPluginGoogle)throw Error('Google login module unavailable. Reinstall the latest plugin.');
 var generation=++authGeneration;busy=true;oauthPending=true;notify();
 try{
  var settings=await providerSettings();
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
  verified=false;session=data;profile=null;entitlement=null;save();
  await bind();
  if(generation!==authGeneration)throw Error('Google sign-in cancelled.');
  restoreDiagnostic='GOOGLE_LOGIN_DEVICE_AND_ENTITLEMENT_VERIFIED';
  return {ok:true,canUse:canUse()};
 }finally{if(generation===authGeneration){busy=false;oauthPending=false;notify();}}
}
var checkoutFlight=null;
async function paymentRequest(path,body){if(!session)throw Error('Sign in first.');try{return await request(path,{method:'POST',auth:true,body:body||{}});}catch(e){if(authRejected(e)&&await refresh())return request(path,{method:'POST',auth:true,body:body||{}});throw e;}}
function createLifetimeCheckout(){if(checkoutFlight)return checkoutFlight;checkoutFlight=paymentRequest('/functions/v1/create-lifetime-checkout',{}).then(function(data){var match=/^https:\/\/app\.midtrans\.com\//i.test(String(data.checkout_url||''));if(!match||data.charge_currency!=='IDR'||!isFinite(Number(data.gross_amount_idr))||Number(data.gross_amount_idr)<=0)throw Error('The payment server returned invalid checkout details.');return data;});checkoutFlight=checkoutFlight.then(function(data){checkoutFlight=null;return data;},function(e){checkoutFlight=null;throw e;});return checkoutFlight;}
async function reconcileLifetimePayment(){var result=await paymentRequest('/functions/v1/check-lifetime-payment',{});await refreshEntitlement();return result;}
async function refreshEntitlement(){
 if(!session)throw Error('Sign in first.');
 await syncEntitlement();return status();
}
global.RPAccountAuth={openExternalUrl:openUrl,cancelSocial:cancelSocial,signUp:signUp,resendConfirmation:resendConfirmation,signupWait:signupWait,resetWait:resetWait,forgotPassword:forgotPassword,friendly:friendly,signIn:signIn,social:social,providerSettings:providerSettings,signOut:signOut,status:status,canUse:canUse,onChange:onChange,restore:restore,heartbeat:heartbeat,createLifetimeCheckout:createLifetimeCheckout,reconcileLifetimePayment:reconcileLifetimePayment,refreshEntitlement:refreshEntitlement};
}(window));
