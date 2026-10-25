(function(global){
'use strict';
/* R6 persistent device identity bridge. Migrates the legacy R5 fingerprint once, then keeps it outside the plugin folder. */
var fs,os,crypto,cp,path,proc,deviceIdCache=null;
function req(n){try{if(global.cep_node&&global.cep_node.require)return global.cep_node.require(n);}catch(e){}try{if(typeof require==='function')return require(n);if(typeof global.require==='function')return global.require(n);}catch(e2){}return null;}
function init(){if(os)return;fs=req('fs');os=req('os');crypto=req('crypto');cp=req('child_process');path=req('path');proc=req('process');}
function sha(v){init();try{return crypto.createHash('sha256').update(String(v)).digest('hex');}catch(e){return String(v);}}
function machineSeed(){init();var parts=[];try{parts.push(os.platform());parts.push(os.arch());}catch(e){}
 try{if(proc.platform==='win32'&&cp){var r=String(cp.execSync('reg query "HKLM\\SOFTWARE\\Microsoft\\Cryptography" /v MachineGuid',{encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','ignore']}));var m=r.match(/MachineGuid\s+REG_SZ\s+([^\r\n]+)/i);if(m&&m[1])parts.push('MG:'+m[1].trim());}}catch(e1){}
 try{if(parts.length<3&&proc.platform==='win32'&&cp){var x=String(cp.execSync('wmic csproduct get uuid',{encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','ignore']}));parts.push('UUID:'+x.replace(/\s+/g,' ').trim());}}catch(e2){}
 try{if(proc.platform==='darwin'&&cp){var y=String(cp.execSync("ioreg -rd1 -c IOPlatformExpertDevice",{encoding:'utf8',stdio:['ignore','pipe','ignore']}));var mm=y.match(/\"IOPlatformUUID\"\s*=\s*\"([^\"]+)\"/);if(mm&&mm[1])parts.push('IOPlatformUUID:'+mm[1].trim());}}catch(eMac){}
 try{if(parts.length<3)parts.push('HOST:'+os.hostname());}catch(e3){} return parts.join('|');}
function legacyDeviceId(){var h=sha(machineSeed()).toUpperCase().replace(/[^A-F0-9]/g,'');return 'RP-'+h.slice(0,4)+'-'+h.slice(4,8)+'-'+h.slice(8,12)+'-'+h.slice(12,16);}
function dataDir(){init();var home=os.homedir();if(proc.platform==='win32')return path.join(proc.env.LOCALAPPDATA||path.join(home,'AppData','Local'),'RProjectMulticam');return path.join(home,'Library','Application Support','RProjectMulticam');}
function ensureDir(){var d=dataDir();try{if(!fs.existsSync(d))fs.mkdirSync(d,{recursive:true});}catch(e){}return d;}
function idFile(){return path.join(ensureDir(),'device-id.txt');}
function cepDeviceFile(){try{var cs=new global.CSInterface(),u=cs.getSystemPath(global.SystemPath.USER_DATA)||'';u=decodeURIComponent(String(u).replace(/^file:\/\//i,''));if(/^\/[A-Za-z]:\//.test(u))u=u.slice(1);return u.replace(/\\/g,'/').replace(/\/$/,'')+'/RProjectMulticam/device-id.txt';}catch(e){return '';} }
function cepReadDevice(){try{var f=cepDeviceFile(),cfs=global.cep&&global.cep.fs;if(!f||!cfs)return '';var r=cfs.readFile(f);return r&&!r.err?String(r.data||'').trim():'';}catch(e){return '';} }
function cepWriteDevice(v){try{var f=cepDeviceFile(),cfs=global.cep&&global.cep.fs;if(!f||!cfs)return false;var d=f.replace(/\/[^\/]+$/,'');try{cfs.makedir(d);}catch(_e){}var w=cfs.writeFile(f,String(v)+'\n');return !w||w.err===0;}catch(e){return false;} }
function validId(v){return /^RP-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}$/i.test(String(v||'').trim());}
function atomicWrite(file,text){var tmp=file+'.tmp-'+String(Date.now());fs.writeFileSync(tmp,text,{encoding:'utf8',mode:384});try{fs.renameSync(tmp,file);}catch(e){try{fs.unlinkSync(file);}catch(x){}fs.renameSync(tmp,file);}}
function getDeviceId(){if(deviceIdCache)return deviceIdCache;init();var f=idFile(),v='';try{v=String(fs.readFileSync(f,'utf8')).trim();}catch(e){}
 if(!validId(v)){var cv=cepReadDevice();if(validId(cv))v=cv;}
 if(!validId(v)){/* First-install migration only: preserve the legacy machine fingerprint instead of creating a random ID. */v=legacyDeviceId();}
 try{atomicWrite(f,v+'\n');}catch(e2){}try{cepWriteDevice(v);}catch(e3){}deviceIdCache=v;return deviceIdCache;}
function account(){try{return global.RPAccountAuth&&global.RPAccountAuth.status?global.RPAccountAuth.status():null;}catch(e){return null;}}
function hours(ms){var h=Math.floor(Math.max(0,Number(ms)||0)/3600000);return h<1?'<1 h':h+' h';}
function status(){var a=account(),ent=a&&a.entitlement||{},signed=!!(a&&a.signedIn),ok=!!(signed&&a.canUse),life=ent.license_status==='lifetime';var mode=ok?(life?'lifetime':'trial'):'expired';
 var label=ok?(life?'ACCOUNT · LIFETIME':'ACCOUNT · TRIAL'):'ONLINE ACCOUNT REQUIRED',detail=ok?'Access verified by the account server.':'Connect to the internet and sign in to verify access.',accountLabel=ok&&life?'LIFETIME · ACTIVE':'';
 var reason=String(ent.reason||'').toUpperCase(),minV=String(ent.minimum_version||''),latest=String(ent.latest_version||''),url=String(ent.update_url||'https://r-multicam.pages.dev/');
 var updateRequired=signed&&ent.allowed!==true&&reason==='UPDATE_REQUIRED',updateAvailable=ok&&reason==='UPDATE_AVAILABLE';
 var offline=!!(signed&&a.offline),ago=a&&a.verifiedAt?Date.now()-a.verifiedAt:0,offlineText=offline&&a.verifiedAt?'Offline · verified '+hours(ago)+' ago':'';
 if(updateRequired){label='UPDATE REQUIRED';detail='This plugin version is no longer supported. Update to v'+(minV||latest||'latest')+' or newer'+(latest&&latest!==minV?' (latest v'+latest+')':'')+': '+url;accountLabel='UPDATE REQUIRED · v'+(minV||latest||'latest')+'+';}
 else if(ok){if(offlineText){detail=offlineText+'. Reconnect within '+hours(a.graceRemainingMs)+' to keep access.';accountLabel=life?'LIFETIME · '+offlineText.toUpperCase():'';}if(updateAvailable)detail+=' Update available'+(latest?' v'+latest:'')+': '+url;}
 else if(signed&&offline&&ent.allowed===true){label='ONLINE VERIFICATION REQUIRED';detail=(a.verifiedAt?'Offline · last verified '+hours(ago)+' ago. ':'Offline. ')+'Offline access lasts 72 h after the last verification. Connect to the internet to continue.';}
 else if(signed&&ent.license_status==='expired'){label='TRIAL EXPIRED';detail='Your trial has ended. Buy Lifetime to continue.';}
 return {mode:mode,canUse:ok,label:label,detail:detail,accountLabel:accountLabel,offline:offline,verifiedAt:a&&a.verifiedAt||0,updateRequired:updateRequired,updateAvailable:updateAvailable,minimumVersion:minV,latestVersion:latest,updateUrl:url,reason:reason,deviceId:getDeviceId(),trialEndsAt:ent.trial_expires_at?Date.parse(ent.trial_expires_at):0,version:'2.3.11.13-public-v19',purchaseLabel:'Account managed online'};}
function digest(text){var a=2166136261,b=5381;text=String(text||'');for(var i=0;i<text.length;i++){a=(a^text.charCodeAt(i));a=(a+(a<<1)+(a<<4)+(a<<7)+(a<<8)+(a<<24))|0;b=((b*33)^text.charCodeAt(i))|0;}return String(text.length)+':'+String(a)+':'+String(b);}
function hostSession(){var a=account();if(!a||!a.signedIn||!a.canUse)return {ok:false,expires:0,proof:''};var expires=Math.floor(Date.now()+120000),tier=a.entitlement&&a.entitlement.license_status==='lifetime'?'lifetime':'';return {ok:true,expires:expires,tier:tier,proof:digest('RPROJECT-LICENSE-2.1.12|'+expires+'|'+(tier?'lifetime|':'')+'host-gate-v1')};}
function disabled(){return {valid:false,reason:'Manual/offline license activation is disabled. Sign in online.'};}
global.RPLicense={status:status,deviceId:getDeviceId,hostSession:hostSession,verify:disabled,install:disabled,clear:function(){return status();},config:function(){return {version:'2.3.11.13-public-v19'};},openPurchase:function(){return false;}};
}(window));
