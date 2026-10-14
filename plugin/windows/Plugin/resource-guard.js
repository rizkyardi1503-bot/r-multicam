/* Read-only Windows pressure sampler. No media, account data or network calls. */
(function(root){
'use strict';
var last=null,lastAt=0,inflight=null,stage='',rows=[],cleanupCount=0;
function classify(x){
 if(x.limit===undefined||x.commit===undefined||x.available===undefined||x.premiere===undefined)return {available:false,critical:false,slow:false,label:'Memory reading unavailable'};
 var limit=Number(x.limit),commit=Number(x.commit),available=Number(x.available),premiere=Number(x.premiere),valid=limit>0&&commit>=0&&available>=0&&isFinite(premiere);
 if(!valid)return {available:false,critical:false,slow:false,label:'Memory reading unavailable'};
 var ratio=commit/limit,remaining=(limit-commit)/1073741824;
 return {available:true,critical:ratio>=.90||remaining<3||available<1024,slow:ratio>=.75||premiere>=16*1073741824||available<3072,commit:commit,limit:limit,premiere:premiere,freeMB:available,label:'System commit '+Math.round(ratio*100)+'%; Premiere '+(premiere/1073741824).toFixed(1)+' GiB'};
}
function save(){try{var n=root.cep_node,fs=n.require('fs'),path=n.require('path'),proc=n.require('process'),dir=path.join(proc.env.LOCALAPPDATA||n.require('os').homedir(),'RProjectMulticamAI');if(!fs.existsSync(dir))fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'memory-diagnostics.json'),JSON.stringify({build:'2.3.11.3',samples:rows}),'utf8');}catch(e){}}
function check(){
 if(inflight)return inflight;
 if(last&&Date.now()-lastAt<5000)return Promise.resolve(last);
 var n=root.cep_node;if(!n)return Promise.resolve(classify({}));
 var proc=n.require('process');if(proc.platform!=='win32')return Promise.resolve(classify({}));
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
root.RPResourceGuard={check:check,classify:classify,cleanup:cleanup,observe:function(r){if(r&&r.phase)stage=String(r.phase);}};
})(window);
