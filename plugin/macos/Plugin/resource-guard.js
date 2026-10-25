/* Read-only cross-platform pressure sampler. No media, account data or network calls. */
(function(root){
'use strict';
var last=null,lastAt=0,inflight=null,stage='',rows=[],cleanupCount=0;
function profile(){
 try{var n=root.cep_node,os=n.require('os'),p=n.require('process'),bytes=Number(os.totalmem());var low=p.platform==='darwin'&&bytes>0&&bytes<=12*1073741824;return {lowMemory:low,threads:low?1:2,hardwareFrames:!low,batchDelay:low?250:40,visionBudget:low?24:240};}catch(e){return {lowMemory:false,threads:2,hardwareFrames:true,batchDelay:40,visionBudget:240};}
}
function macAvailable(output){
 var text=String(output||''),page=text.match(/page size of (\d+) bytes/),size=page?Number(page[1]):0;
 if(!(size>0))return null;
 function pages(name){var m=text.match(new RegExp('^'+name+':\\s*(\\d+)\\.?','m'));return m?Number(m[1]):null;}
 var free=pages('Pages free'),inactive=pages('Pages inactive'),speculative=pages('Pages speculative');
 if(free===null||inactive===null||speculative===null)return null;
 // Inactive/speculative pages are reclaimable. Purgeable pages overlap other
 // categories; do not count them twice. This is an estimate, not GPU VRAM.
 return (free+inactive+speculative)*size/1048576;
}
function classify(x){
 if(x.platform==='darwin'){
  var mb=Number(x.available),total=Number(x.limit),appBytes=Number(x.premiere);
  // v2.3.11.11: macOS keeps free/inactive pages low on purpose (file cache, compressor), so a low page
  // count is not a reason to pause. Only the kernel's own memory-pressure level 4 (critical) pauses a job;
  // warn (2) or low reclaimable pages only reduce batch size.
  var pressure=Number(x.pressure),hasPressure=pressure===1||pressure===2||pressure===4;
  if(x.available===null||x.available===undefined||!isFinite(mb)||mb<0||!(total>0)||!isFinite(appBytes))return {available:hasPressure,critical:pressure===4,slow:profile().lowMemory||pressure>=2,pressure:hasPressure?pressure:null,label:hasPressure?'macOS memory pressure '+(pressure===4?'critical':pressure===2?'warning':'normal'):'macOS memory reading unavailable'};
  return {available:true,critical:pressure===4,slow:profile().lowMemory||pressure>=2||mb<1280,pressure:hasPressure?pressure:null,premiere:appBytes,limit:total,freeMB:mb,label:'macOS memory pressure '+(!hasPressure?'unknown':pressure===4?'critical':pressure===2?'warning':'normal')+' · reclaimable ~'+Math.round(mb)+' MiB; Premiere '+(appBytes/1073741824).toFixed(1)+' GiB'+(profile().lowMemory?' · Low Memory mode':'')};
 }
 if(x.limit===undefined||x.commit===undefined||x.available===undefined||x.premiere===undefined)return {available:false,critical:false,slow:false,label:'Memory reading unavailable'};
 var limit=Number(x.limit),commit=Number(x.commit),available=Number(x.available),premiere=Number(x.premiere),valid=limit>0&&commit>=0&&available>=0&&isFinite(premiere);
 if(!valid)return {available:false,critical:false,slow:false,label:'Memory reading unavailable'};
 var ratio=commit/limit,remaining=(limit-commit)/1073741824;
 return {available:true,critical:ratio>=.90||remaining<3||available<1024,slow:ratio>=.75||premiere>=16*1073741824||available<3072,commit:commit,limit:limit,premiere:premiere,freeMB:available,label:'System commit '+Math.round(ratio*100)+'%; Premiere '+(premiere/1073741824).toFixed(1)+' GiB'};
}
function save(){try{var n=root.cep_node,fs=n.require('fs'),path=n.require('path'),proc=n.require('process'),os=n.require('os'),dir=proc.platform==='darwin'?path.join(os.homedir(),'Library','Application Support','RProjectMulticamAI'):path.join(proc.env.LOCALAPPDATA||os.homedir(),'RProjectMulticamAI');if(!fs.existsSync(dir))fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'memory-diagnostics.json'),JSON.stringify({build:'2.3.11.13',samples:rows}),'utf8');}catch(e){}}
function check(){
 if(inflight)return inflight;
 if(last&&Date.now()-lastAt<5000)return Promise.resolve(last);
 var n=root.cep_node;if(!n)return Promise.resolve(classify({}));
 var proc=n.require('process'),os=n.require('os');
 if(proc.platform==='darwin'){
  inflight=new Promise(function(resolve){
   function finish(x){last=classify(x);lastAt=Date.now();try{var el=root.document&&root.document.getElementById('memoryInfo');if(el)el.textContent=last.label+(last.critical?' - stopped before next batch':last.slow?' - reduced batch size':'');}catch(ignore){}rows.push({time:new Date().toISOString(),stage:stage,reading:last});if(rows.length>120)rows.shift();save();resolve(last);}
   try{var total=Number(os.totalmem()),cp=n.require('child_process');cp.execFile('/usr/bin/vm_stat',[],{encoding:'utf8',timeout:8000,maxBuffer:16384},function(vmErr,vmOut){var available=vmErr?null:macAvailable(vmOut);cp.execFile('/usr/sbin/sysctl',['-n','kern.memorystatus_vm_pressure_level'],{encoding:'utf8',timeout:5000,maxBuffer:1024},function(pErr,pOut){var pressure=pErr?null:parseInt(String(pOut||'').trim(),10);cp.execFile('/bin/ps',['-axo','rss=,comm='],{encoding:'utf8',timeout:8000,maxBuffer:1024*1024},function(err,out){var premiere=0;if(!err){String(out||'').split(/\r?\n/).forEach(function(line){var m=line.match(/^\s*(\d+)\s+(.+)$/);if(m&&/Adobe Premiere Pro/.test(m[2]))premiere+=Number(m[1])*1024;});}finish({platform:'darwin',limit:total,available:available,pressure:isFinite(pressure)?pressure:null,premiere:premiere});});});});}catch(e){finish({});}
  }).then(function(x){inflight=null;return x;});return inflight;
 }
 if(proc.platform!=='win32')return Promise.resolve(classify({}));
 inflight=new Promise(function(resolve){
  var script="$ErrorActionPreference='Stop'; $m=Get-CimInstance Win32_PerfFormattedData_PerfOS_Memory; $p=Get-Process -Name 'Adobe Premiere Pro' -ErrorAction SilentlyContinue; $sum=($p|Measure-Object -Property PrivateMemorySize64 -Sum).Sum; [pscustomobject]@{commit=$m.CommittedBytes;limit=$m.CommitLimit;available=$m.AvailableMBytes;premiere=[double]$sum}|ConvertTo-Json -Compress";
  function finish(x){last=classify(x);lastAt=Date.now();try{var el=root.document&&root.document.getElementById('memoryInfo');if(el)el.textContent=last.label+(last.critical?' - stopped before next batch':last.slow?' - reduced batch size':'');}catch(ignore){}rows.push({time:new Date().toISOString(),stage:stage,reading:last});if(rows.length>120)rows.shift();save();resolve(last);}
  try{n.require('child_process').execFile('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{windowsHide:true,timeout:10000,maxBuffer:8192},function(err,out){if(err)return finish({});try{finish(JSON.parse(String(out).replace(/^\uFEFF/,'')));}catch(e){finish({});}});}catch(e){finish({});}
 }).then(function(x){inflight=null;return x;});return inflight;
}
function cleanup(state,reason){
 var killed=false,aborted=false;
 try{if(state&&state.process){var p=state.process;state.process=null;if(p&&p.exitCode===null&&!p.killed){try{p.stdout&&p.stdout.removeAllListeners&&p.stdout.removeAllListeners();}catch(e){}try{p.stderr&&p.stderr.removeAllListeners&&p.stderr.removeAllListeners();}catch(e){}try{p.kill();killed=true;}catch(e){}}}}catch(e){}
 try{if(state&&state.request&&typeof state.request.abort==='function'){state.request.abort();aborted=true;}if(state)state.request=null;}catch(e){}
 try{if(root.gc&&typeof root.gc==='function')root.gc();}catch(e){}
 try{if(root.cep_node&&root.cep_node.global&&typeof root.cep_node.global.gc==='function')root.cep_node.global.gc();}catch(e){}
 cleanupCount++;rows.push({time:new Date().toISOString(),stage:'resource-cleanup',reading:{reason:String(reason||'job-finished'),processKilled:killed,requestAborted:aborted,count:cleanupCount}});if(rows.length>120)rows.shift();save();
 return {ok:true,processKilled:killed,requestAborted:aborted,count:cleanupCount};
}
async function preflight(state,label){
 if(state&&state.cancelled)throw Error('Analysis stopped.');stage=String(label||'analysis');var reading=await check();
 if(state&&state.cancelled)throw Error('Analysis stopped.');
 if(reading.critical){var err=Error('Low memory: stopped before '+stage+'. Save the project, close other heavy apps and retry. '+reading.label);err.code='RP_LOW_MEMORY';throw err;}
 return reading;
}
root.RPResourceGuard={check:check,classify:classify,profile:profile,macAvailable:macAvailable,preflight:preflight,cleanup:cleanup,observe:function(r){if(r&&r.phase)stage=String(r.phase);}};
})(window);
