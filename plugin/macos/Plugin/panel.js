(function(){
'use strict';
var cs,busy=false,pending=false,stopRequested=false,job=null,ready=false,lastInfo=null,lastReply=Date.now(),started=0,activeTool='multi';
var analysisState=null,suggestion=null,uploadIndex=0,pendingSeq=0;
// v2.3.11.5: generous host ceilings. A long DJ set (80+ min, thousands of clips) or a Premiere autosave
// can block ExtendScript for tens of seconds; a short timeout only produced false failures.
var HOST_TIMEOUT_MS=60000,HOST_STEP_TIMEOUT_MS=120000;
function hostTimeout(base,units,perUnitMs){return Math.min(900000,Math.round(Math.max(base,base+(Number(units)||0)*(Number(perUnitMs)||0))));}
var bestDropCache=null;
var aiPlan=null,autoDirector=false;
var restoredCameraSelection=null;
var licenseState=null;
var PODCAST_ENABLED=false;
var RESUME_KEY='rp.multicam.resume.v230';
var LEGACY_RESUME_KEY=['rp.multicamResume.','off','line.v206'].join('');
var MASTER_MUSIC_MAP_KEY='rp.masterMusicMap.v18.multifeature.public';
var RESUME_SCHEMA=5;
var RESUME_FILE_NAME='multicam-resume-v3.json';
function resumeRequire(name){if(window.cep_node&&window.cep_node.require)return window.cep_node.require(name);if(typeof require==='function')return require(name);throw Error('Node bridge unavailable.');}
function resumeFilePath(){try{var path=resumeRequire('path'),os=resumeRequire('os'),proc=resumeRequire('process');return proc.platform==='win32'?path.join(proc.env.LOCALAPPDATA||path.join(os.homedir(),'AppData','Local'),'RProjectMulticamAI',RESUME_FILE_NAME):path.join(os.homedir(),'Library','Application Support','RProjectMulticamAI',RESUME_FILE_NAME);}catch(e){return '';}}
function readPersistentResume(){try{var fp=resumeFilePath(),fs=resumeRequire('fs');if(!fp||!fs.existsSync(fp))return null;return JSON.parse(fs.readFileSync(fp,'utf8'));}catch(e){return null;}}
function writePersistentResume(x){try{var fp=resumeFilePath();if(!fp||!x)return false;var fs=resumeRequire('fs'),path=resumeRequire('path'),dir=path.dirname(fp);if(!fs.existsSync(dir))fs.mkdirSync(dir,{recursive:true});var tmp=fp+'.tmp';fs.writeFileSync(tmp,JSON.stringify(x),'utf8');fs.renameSync(tmp,fp);return true;}catch(e){return false;}}
function clearPersistentResume(){try{var fp=resumeFilePath(),fs=resumeRequire('fs');if(fp&&fs.existsSync(fp))fs.unlinkSync(fp);}catch(e){throw Error('Could not clear saved job: '+e.message);}}

var DYNAMIC_CAMERA_ARCHITECTURE=true;
var masterMusicMapMemory=null;
function musicMapKey(a1){return String(a1&&a1.signature||'')+'|'+String(Number(a1&&a1.duration||0).toFixed(3))+'|music-v18-multifeature-public';}
function stripMusicMap(result,a1){
 var x={version:4,key:musicMapKey(a1),createdAt:Date.now(),result:{}};var allow=['points','meta','beats','beatMeta','music','dropSeries','onsetSeries','fingerprint','tempo','bpm','tempoConfidence','tempoSpread','tempoSamples','beatInterval','beatCount','tempoMap','musicGrid','pacing','structure','musicV12','excludedDropTimes','dropFeatureCache','onlineReviewCache','hybridAI','dropSensitivity','bestDropWindow','beatFirst'];
 for(var i=0;i<allow.length;i++)if(result&&result[allow[i]]!==undefined)x.result[allow[i]]=result[allow[i]];
 // raw_energy is consumed only inside the audio decoder; do not persist it per energy sample.
 if(Array.isArray(x.result.music))x.result.music=x.result.music.map(function(m){if(!m||m.raw_energy===undefined)return m;var y={},k;for(k in m)if(k!=='raw_energy')y[k]=m[k];return y;});
 x.result.snapshot=a1;return x;
}
function musicMapFile(){var base=resumeFilePath();if(!base)return '';var path=resumeRequire('path');return path.join(path.dirname(base),'master-music-map-v18-multifeature-public.json');}
// v2.3.11.5: a 2 h set produces a ~50+ MB map. It lives only in the cache folder next to the resume
// file (never localStorage: quota errors + slow panel start), is capped, and is written asynchronously
// once per burst of saves instead of being stringified 2-3 times on the UI thread.
var MUSIC_MAP_MAX_BYTES=96*1048576,musicMapTimer=null,musicMapLatest=null,musicMapWriteSeq=0;
function persistMusicMap(x){musicMapLatest=x;if(musicMapTimer)window.clearTimeout(musicMapTimer);musicMapTimer=window.setTimeout(function(){musicMapTimer=null;var y=musicMapLatest;musicMapLatest=null;if(y)writeMusicMapNow(y);},1500);}
function writeMusicMapNow(x){
 var fs,fp,text,seq=++musicMapWriteSeq;try{fs=resumeRequire('fs');fp=musicMapFile();if(!fp)return false;text=JSON.stringify(x);}catch(e){log('Disk music cache unavailable: '+e.message);return false;}
 if(text.length>MUSIC_MAP_MAX_BYTES){log('Music map cache skipped: '+Math.round(text.length/1048576)+' MB exceeds the '+Math.round(MUSIC_MAP_MAX_BYTES/1048576)+' MB cache limit. It stays in memory for this session.');try{if(fs.existsSync(fp))fs.unlinkSync(fp);}catch(e){}return false;}
 try{var path=resumeRequire('path'),tmp=fp+'.'+seq+'.tmp';fs.mkdirSync(path.dirname(fp),{recursive:true});
  fs.writeFile(tmp,text,'utf8',function(err){if(err||seq!==musicMapWriteSeq){try{fs.unlink(tmp,function(){});}catch(e){}if(err)log('Disk music cache unavailable: '+err.message);return;}fs.rename(tmp,fp,function(renameErr){if(renameErr){try{fs.unlink(tmp,function(){});}catch(e){}log('Disk music cache unavailable: '+renameErr.message);}});});
 }catch(e){log('Disk music cache unavailable: '+e.message);return false;}return true;
}
function readMusicMap(){try{var fp=musicMapFile();if(!fp)return null;var fs=resumeRequire('fs');if(fs.statSync(fp).size>MUSIC_MAP_MAX_BYTES)return null;return JSON.parse(fs.readFileSync(fp,'utf8'));}catch(e){return null;}}
function dropLegacyMusicMapStorage(){try{if(window.localStorage&&window.localStorage.getItem(MASTER_MUSIC_MAP_KEY)!==null)window.localStorage.removeItem(MASTER_MUSIC_MAP_KEY);}catch(e){}}
function saveMasterMusicMap(result,a1){
 if(!result||!a1||!a1.signature)return result;var x=stripMusicMap(result,a1);masterMusicMapMemory=x;persistMusicMap(x);
 log('Master Music Map locked for current A1 · '+(result.tempo||'?')+' BPM · '+(result.structure&&result.structure.drop_count||0)+' drops.');return result;
}
function loadMasterMusicMap(a1){
 var key=musicMapKey(a1),x=masterMusicMapMemory&&masterMusicMapMemory.key===key?masterMusicMapMemory:musicMapLatest&&musicMapLatest.key===key?musicMapLatest:readMusicMap();
 if(!x||x.version!==4||x.key!==key||!x.result||!x.result.beats||!x.result.beats.length)return null;
 if(!window.RPAudio.fresh(a1,x.result.fingerprint))return null;x.result.musicV10=x.result.musicV12;x.result.masterMusicMapV12=x.result.musicV12;x.result.masterMusicMapV10=x.result.musicV12;x.result.snapshot=a1;masterMusicMapMemory=x;return x.result;
}
function invalidateMasterMusicMap(a1){var x=masterMusicMapMemory;if(x&&a1&&x.key===musicMapKey(a1))return;masterMusicMapMemory=null;dropLegacyMusicMapStorage();}
function el(id){return document.getElementById(id);}
function log(t){el('log').textContent=(el('log').textContent+'\n'+t).slice(-5000);}
function toolPrefix(tool){return tool==='zoom'?'zoom':tool==='drop'?'drop':tool==='podcast'?'podcast':'multi';}
function setActiveTool(tool){activeTool=tool||'multi';}
function renderToolState(tool,text,kind){
 var p=toolPrefix(tool),st=el(p+'State'),badge=el(p+'Badge');if(st)st.textContent=text||'';
 if(badge){kind=kind||'ready';badge.className='badge '+kind;badge.textContent=kind==='running'?'RUNNING':kind==='success'?'SUCCESS':kind==='warning'?'WARNING':kind==='error'?'ERROR':'READY';}
}
function state(t,error,kind){
 if(error&&window.RPCompact)window.RPCompact.error(t);el('state').textContent=t;el('state').className=error?'error':'';
 if(!kind){if(error)kind='error';else if(busy)kind='running';else if(/complete|ready|finished|queued|success/i.test(String(t)))kind='success';else kind='ready';}
 renderToolState(activeTool,t,kind);
}
function progressFor(tool,value,max,count){
 var p=toolPrefix(tool),pr=el(p+'Progress');if(pr){pr.max=max||1;pr.value=value||0;}if(count!==undefined&&el(p+'Count'))el(p+'Count').textContent=count;
 el('progress').max=max||1;el('progress').value=value||0;if(count!==undefined)el('count').textContent=count;
}
function heartbeatFor(tool,text){var p=toolPrefix(tool);if(el(p+'Heartbeat'))el(p+'Heartbeat').textContent=text||'';el('heartbeat').textContent=text||'';}
function musicAnalysisStage(stage,p,detail){
 var labels={1:'ANALYZE MUSIC · Stage 1/3 — Local Beat / BPM / Drop Scan',2:'ANALYZE MUSIC · Stage 2/3 — Online AI Candidate Review',3:'ANALYZE MUSIC · Stage 3/3 — Finalizing Music Map'};
 var ranges={1:[0,.72],2:[.72,.95],3:[.95,1]},r=ranges[stage]||[0,1],q=Math.max(0,Math.min(1,Number(p)||0)),overall=r[0]+(r[1]-r[0])*q,pct=Math.round(overall*100);
 state(labels[stage]||'ANALYZE MUSIC',false,'running');
 progressFor('multi',pct,100,(detail||'Working…')+' · '+pct+'% overall');
}
function setToolStops(){['multi','zoom','drop'].forEach(function(t){var b=el(t+'Stop');if(b)b.disabled=!busy||stopRequested||activeTool!==t;});if(el('podcastStop'))el('podcastStop').disabled=true;}

function licenseCanUse(){return !!(window.RPAccountAuth&&window.RPAccountAuth.canUse());}
function renderLicense(){
 try{licenseState=window.RPLicense?window.RPLicense.status():{mode:'expired',canUse:false,label:'LICENSE ERROR',detail:'License module is unavailable.',deviceId:''};}
 catch(e){licenseState={mode:'expired',canUse:false,label:'LICENSE ERROR',detail:e.message,deviceId:''};}
 var mode=licenseState.mode||'expired',kind=mode==='lifetime'?'success':mode==='trial'?'warning':'error',hero=el('licenseHero');
 if(hero)hero.className='licensehero '+(mode==='lifetime'?'active':mode==='trial'?'trial':'expired');
 if(el('licenseHeadline'))el('licenseHeadline').textContent=licenseState.label||'LICENSE';
 if(el('licenseHeroDetail'))el('licenseHeroDetail').textContent=licenseState.detail||'';
 ['licenseTopBadge','licenseBadge'].forEach(function(id){var b=el(id);if(b){b.className='badge '+kind;b.textContent=mode==='lifetime'?'ACTIVE':mode==='trial'?'TRIAL':'EXPIRED';}});
 if(mode==='lifetime'){
  if(el('licenseHeadline'))el('licenseHeadline').textContent='ACCOUNT ACTIVE';
  if(el('licenseTopBadge')){el('licenseTopBadge').className='badge success';el('licenseTopBadge').textContent='LIFETIME';}
  if(el('licenseHeroDetail'))el('licenseHeroDetail').textContent=licenseState.offline||licenseState.updateAvailable?licenseState.detail:'Lifetime license active.';
 }
 return licenseState;
}
function requireEntitlement(){
 renderLicense();
 if(licenseCanUse())return true;
 state('Online account verification is required to continue.',true,'error');
 controls();return false;
}
function copyText(text){
 try{var t=document.createElement('textarea');t.value=String(text||'');t.style.position='fixed';t.style.opacity='0';document.body.appendChild(t);t.select();document.execCommand('copy');document.body.removeChild(t);return true;}catch(e){return false;}
}

function resumeDigest(text){var a=2166136261,b=5381;text=String(text||'');for(var i=0;i<text.length;i++){a=(a^text.charCodeAt(i));a=(a+(a<<1)+(a<<4)+(a<<7)+(a<<8)+(a<<24))|0;b=((b*33)^text.charCodeAt(i))|0;}return String(text.length)+':'+String(a)+':'+String(b);}
function cameraMediaSignatureFromSnapshot(snap,enabled){
 try{var rows=[],wanted={};(enabled||[]).forEach(function(x){wanted[Number(x)]=true;});var tracks=snap&&snap.tracks||[];for(var i=0;i<tracks.length;i++){var tr=tracks[i],ti=Number(tr.index);if(!wanted[ti])continue;var seen={},files=[];for(var c=0;c<(tr.clips||[]).length;c++){var f=String(tr.clips[c].file||'').replace(/\\/g,'/');if(f&&resumeRequire('process').platform==='win32')f=f.toLowerCase();if(f&&!seen[f]){seen[f]=1;files.push(f);}}files.sort();rows.push(ti+'='+files.join('|'));}rows.sort();return 'CAMV1:'+resumeDigest(rows.join('||'));}catch(e){return '';}
}
function validResumeCheckpoint(x){return !!(x&&Array.isArray(x.points)&&x.points.length>0&&x.points.length<=100000&&Array.isArray(x.choices)&&x.choices.length===(x.kind==='cut'?0:x.points.length+1)&&x.a1Signature&&x.projectPath&&(x.version===2||x.version===3||x.version===4||x.version===RESUME_SCHEMA));}
function loadResumeCheckpoint(){
 var disk=readPersistentResume(),mirror=null;
 try{if(window.localStorage)mirror=JSON.parse(window.localStorage.getItem(RESUME_KEY)||'null');}catch(e){}
 var x=validResumeCheckpoint(disk)?disk:null;
 if(validResumeCheckpoint(mirror)&&(!x||Number(mirror.updatedAt||0)>Number(x.updatedAt||0)))x=mirror;
 if(!x)return null;
 if(x.version!==RESUME_SCHEMA)x.version=RESUME_SCHEMA;
 return x;
}
function writeResumeCheckpoint(x){
 if(!x)return;x.version=RESUME_SCHEMA;x.updatedAt=Date.now();
 // Atomic disk checkpoint first; localStorage is only a compatibility mirror.
 var saved=writePersistentResume(x);
 try{if(window.localStorage){window.localStorage.setItem(RESUME_KEY,JSON.stringify(x));saved=true;}}catch(e){}
 if(!saved)throw Error('Checkpoint could not be saved. Check free disk space and permissions before continuing.');
 renderResumePanel();
}
function clearResumeCheckpoint(){clearPersistentResume();try{if(window.localStorage){window.localStorage.removeItem(RESUME_KEY);window.localStorage.removeItem(LEGACY_RESUME_KEY);}}catch(e){}renderResumePanel();}
function stageResumeCheckpoint(kind){
 if(!aiPlan||!aiPlan.snapshot||!aiPlan.snapshot.points)return;
 var snap=aiPlan.snapshot;
 var enabled=(aiPlan.enabledCameras||collectEnabledCameras()).slice(0); writeResumeCheckpoint({minimumShotBeats:4,version:RESUME_SCHEMA,kind:kind||'delete',structurePolicyVersion:1,structurePolicy:aiPlan.structurePolicy,maxHoldBeats:8,tempoMap:aiPlan.musicAnalysis&&aiPlan.musicAnalysis.beat_first&&aiPlan.musicAnalysis.beat_first.tempo_map||[],estimatedBpm:aiPlan.musicAnalysis&&aiPlan.musicAnalysis.estimated_bpm||0,status:'prepared',phase:'cut',projectPath:String(snap.projectPath||''),sequenceID:String(snap.sequenceID||''),sequenceName:lastInfo&&lastInfo.name?lastInfo.name:'Active Sequence',duration:Number(snap.duration)||0,frame:Number(snap.frame)||0,a1Signature:String(snap.a1Signature||''),cameraMediaSignature:cameraMediaSignatureFromSnapshot(snap,enabled),points:snap.points.slice(0),choices:aiPlan.choices.map(function(c){return Number(c.camera);}),enabledTracks:enabled,point:0,track:0,verifyPoint:0,prepScene:0,task:0,cuts:0,removed:0,skipped:0,done:0,total:snap.points.length,liveJobId:'',buildOrigin:'2.3.11.4',checkpointStore:'persistent-file',createdAt:Date.now(),updatedAt:Date.now()});
}
var resumeFlushTime=0,resumeFlushPhase='',resumeFlushId='';
function syncResumeCheckpoint(r){
 if(!r||r.uiKind==='podcast'||['delete','angle','cut'].indexOf(String(r.kind||''))<0)return;
 if(r.status==='running'&&r.phase!=='delete'&&r.phase!=='angle'&&r.id===resumeFlushId&&r.phase===resumeFlushPhase&&Date.now()-resumeFlushTime<500)return;
 var x=loadResumeCheckpoint();if(!x)return;
 if(r.projectPath&&String(r.projectPath)!==String(x.projectPath))return;
 if(r.seqID&&String(r.seqID)!==String(x.sequenceID))return;
 x.liveJobId=String(r.id||x.liveJobId||'');x.status=String(r.status||x.status||'');x.phase=String(r.phase||x.phase||'cut');
 if(r.point!==undefined)x.point=Number(r.point)||0;if(r.track!==undefined)x.track=Number(r.track)||0;if(r.verifyPoint!==undefined)x.verifyPoint=Number(r.verifyPoint)||0;if(r.prepScene!==undefined)x.prepScene=Number(r.prepScene)||0;if(r.task!==undefined)x.task=Number(r.task)||0;if(r.tracks&&r.tracks.length)x.enabledTracks=r.tracks.slice(0);
 if(r.cameraMediaSignature)x.cameraMediaSignature=r.cameraMediaSignature;
 if(r.lastRazor)x.lastRazor=r.lastRazor;if(r.message)x.message=String(r.message);
 if(r.cuts!==undefined)x.cuts=Number(r.cuts)||0;if(r.removed!==undefined)x.removed=Number(r.removed)||0;if(r.skipped!==undefined)x.skipped=Number(r.skipped)||0;
 if(r.done!==undefined)x.done=Number(r.done)||0;if(r.total!==undefined)x.total=Number(r.total)||0;
 if(r.status==='done'){clearResumeCheckpoint();return;}try{writeResumeCheckpoint(x);resumeFlushTime=Date.now();resumeFlushPhase=r.phase;resumeFlushId=r.id;}catch(e){stopRequested=true;if(!pending&&r.id)invoke('rp_stop('+quote(r.id)+')',function(){});throw e;}
}
function resumeLabel(x){
 if(!x)return '';
 var stage=x.phase==='delete'?'cleanup / remove unused':x.phase==='angle'?'camera switching':x.phase==='verify'?'boundary verification':x.phase==='prepare'?'preparing cleanup':'cutting';
 var progress='';if(x.phase==='cut')progress=(x.point||0)+' / '+(x.points?x.points.length:0)+' edit points';else progress=(x.done||0)+' / '+(x.total||0)+(x.phase==='verify'?' edit points':x.phase==='prepare'?' scenes':' pieces');
 return '<strong>Saved Multicam Job:</strong> '+String(x.sequenceName||'Sequence').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')+'<br>Stage: '+stage+' · '+progress+'<br>'+(x.cuts||0)+' cuts · '+(x.removed||0)+' pieces removed<br><small>Saved '+new Date(x.updatedAt||x.createdAt||Date.now()).toLocaleString()+'</small>';
}
function renderResumePanel(){
 var box=el('menuResume');if(!box)return;var x=loadResumeCheckpoint();box.style.display=x?'block':'none';if(!x)return;
 if(el('resumeInfo'))el('resumeInfo').innerHTML=resumeLabel(x);
 if(el('resumeBadge')){var k=x.status==='error'?'error':'warning';el('resumeBadge').className='badge '+k;el('resumeBadge').textContent=x.phase==='delete'?'CLEANUP':'RESUME';}
 if(el('resumeRun'))el('resumeRun').disabled=busy||pending||!ready||!licenseCanUse();
 // v2.3.11.5: "Continue Cleanup Only" was only enabled in the cleanup phase, where it ran exactly the same
 // host resume as Continue. One button resumes whatever stage was saved (cut -> cleanup).
 if(el('resumeCleanup')){el('resumeCleanup').style.display='none';el('resumeCleanup').disabled=true;}
 if(el('resumeDiscard'))el('resumeDiscard').disabled=busy||pending;
}
async function resumeSavedMulticam(cleanupOnly){
 if(busy||pending||!ready)return;if(!requireEntitlement())return;var x=loadResumeCheckpoint();if(!x){renderResumePanel();return;}
 setActiveTool('multi');busy=true;stopRequested=false;started=Date.now();lastReply=started;analysisState={cancelled:false};controls();
 try{
  if(x.structurePolicyVersion!==1)throw Error('This saved job predates the build-up/drop camera rule. Generate a new plan on a project copy.');window.RPDirector.validateStructure((x.choices||[]).map(function(camera){return {camera:camera};}),x.structurePolicy);
  if(x.minimumShotBeats!==4)throw Error('This saved job predates the 4-beat minimum. Generate a new plan on a project copy.');
  if(x.maxHoldBeats!==8)throw Error('This saved job predates the fixed 8-beat rule. Generate a new plan on a project copy before continuing.');var savedBounds=[0].concat(x.points||[]).concat([x.duration]),savedIntervals=[];for(var si=1;si<savedBounds.length;si++)savedIntervals.push({start:savedBounds[si-1],end:savedBounds[si]});window.RPBeatFirst.validateHold((x.choices||[]).map(function(camera){return {camera:camera};}),savedIntervals,{estimated_bpm:x.estimatedBpm,beat_first:{tempo_map:x.tempoMap||[]}});
  window.RPDirector.validateMinimumPhysicalTransitions((x.choices||[]).map(function(camera){return {camera:camera};}),savedIntervals,{estimated_bpm:x.estimatedBpm,beat_first:{tempo_map:x.tempoMap||[]}});
  state(x.phase==='delete'?'Restoring saved cleanup job…':'Restoring saved Multicam job…',false,'running');
  var r=null;
  if(x.liveJobId){try{r=await call('rp_resume('+quote(x.liveJobId)+')',HOST_STEP_TIMEOUT_MS);}catch(liveErr){r=null;}}
  if(!r||!r.id){
   var phase=String(x.phase||'cut');
   r=await call('rp_resumeSaved('+quote(x.projectPath||'')+','+quote(x.sequenceID||'')+','+quote(x.a1Signature||'')+','+quote((x.points||[]).join(','))+','+quote((x.choices||[]).join(','))+','+quote(phase)+','+(Number(x.point)||0)+','+(Number(x.track)||0)+','+(Number(x.cuts)||0)+','+(Number(x.removed)||0)+','+(Number(x.skipped)||0)+','+(Number(x.verifyPoint)||0)+','+(Number(x.prepScene)||0)+','+(Number(x.task)||0)+','+quote(((x.enabledTracks&&x.enabledTracks.length)?x.enabledTracks:collectEnabledCameras()).join(','))+','+quote(x.cameraMediaSignature||'')+','+(Number(x.duration)||0)+','+quote(x.kind||'delete')+')',hostTimeout(120000,(x.points||[]).length,40));
  }
  if(r.seqID){x.sequenceID=String(r.seqID);x.liveJobId=String(r.id||'');writeResumeCheckpoint(x);}
  job=r;syncResumeCheckpoint(r);
  while(r.status==='running'){
   if(analysisState.cancelled){r=await call('rp_stop('+quote(r.id)+')',10000);job=r;syncResumeCheckpoint(r);break;}
   r=await call('rp_step('+quote(r.id)+')',HOST_STEP_TIMEOUT_MS);job=r;syncResumeCheckpoint(r);updateResumeProgressOnly(r);
  }
  if(r.status==='done'){clearResumeCheckpoint();state('Continued Multicam job complete.',false,'success');log('Resumed Multicam complete: '+(r.cuts||0)+' cuts, '+(r.removed||0)+' pieces removed.');}
  else if(r.status==='stopped'){state(r.message||'Resume stopped. Checkpoint kept.',false,'warning');}
  else throw Error(r.message||'Could not continue the saved Multicam job.');
 }catch(e){var resumeMsg=e.message;if(/different (sequence|Premiere project)/.test(resumeMsg))resumeMsg+=' Saved job: "'+String(x.sequenceName||'Sequence')+'"'+(x.projectPath?' in '+String(x.projectPath):'')+'.';state(resumeMsg,true,'error');log('Resume: '+resumeMsg);}
 finally{releaseJobResources(analysisState,'resume-finished',true);analysisState=null;busy=false;job=null;controls();renderResumePanel();}
}
function updateResumeProgressOnly(r){
 if(!r||!r.total)return;var pct=Math.floor((r.done||0)/Math.max(1,r.total)*100),unit=r.phase==='delete'?'pieces':r.phase==='angle'?'camera pieces':'edit points';progressFor('multi',r.done||0,r.total,(r.done||0).toLocaleString()+' / '+r.total.toLocaleString()+' '+unit+' · '+pct+'% · '+(r.cuts||0)+' cuts · '+(r.removed||0)+' pieces removed · stage '+r.phase);state(r.message||'Continuing Multicam…',false,'running');
}

var SETUP_KEY='rp.lastSetup.agent.v210';

function dropSensitivity(){var x=el('dropSensitivity');return x?String(x.value||'balanced'):'balanced';}
function dropPreBeats(){var x=el('dropPreBeats');return Math.max(8,Math.min(64,Number(x&&x.value)||24));}
function dropPostBeats(){var x=el('dropPostBeats');return Math.max(8,Math.min(64,Number(x&&x.value)||32));}
function selectedPacingCadences(){var out=[];[2,4,6,8].forEach(function(n){var x=el('pacing'+n);if(x&&x.checked)out.push(n);});return out.length?out:[4,6,8];}
function pacingSelectionText(){return selectedPacingCadences().join(' / ')+' beat'+(selectedPacingCadences().length===1?'':'s');}
function updatePacingSummary(){var values=selectedPacingCadences(),x=el('pacingSummary');if(x)x.textContent=values.join(' / ')+' beat'+(values.length===1?'':'s');[2,4,6,8].forEach(function(n){var box=el('pacing'+n);if(box&&box.parentNode)box.parentNode.className='pacingToggle'+(box.checked?'':' off');});}
function constrainPacingToSelection(pacing){pacing=pacing||{segments:[],config:{}};var allowed=selectedPacingCadences().slice().sort(function(a,b){return a-b;}),fast=allowed[0],slow=allowed[allowed.length-1];function nearest(target){target=Number(target)||6;var best=allowed[0],dist=Math.abs(best-target);for(var i=1;i<allowed.length;i++){var d=Math.abs(allowed[i]-target);if(d<dist||(d===dist&&allowed[i]<best)){best=allowed[i];dist=d;}}return best;}var seg=(pacing.segments||[]).map(function(src){var x={},k;for(k in src)x[k]=src[k];var reason=String(x.reason||'').toLowerCase(),target=Number(x.beats_per_cut)||6;if(/drop|pre-drop|high-energy|build-up/.test(reason))target=fast;else if(/breakdown|intro|outro|calm|low/.test(reason))target=slow;x.beats_per_cut=nearest(target);x.max_hold_beats=8;return x;});var cfg={};for(var key in (pacing.config||{}))cfg[key]=pacing.config[key];cfg.allowedCadences=allowed;cfg.minCadence=fast;cfg.maxCadence=slow;cfg.base=nearest(6);cfg.explicitCadence=allowed.length===1;cfg.energyAdaptive=allowed.length>1;cfg.userSelectedCadence=true;cfg.softPreference=false;cfg.maxHoldBeats=8;return {summary:'Auto Music Map V14 · selected pacing '+allowed.join('/')+' beat · selected cut intervals',segments:seg,config:cfg};}
function musicOptions(){return {sensitivity:dropSensitivity(),preBeats:dropPreBeats(),postBeats:dropPostBeats(),confidenceThreshold:el('miThreshold')&&el('miThreshold').value!==''?Number(el('miThreshold').value):null,minSpacingBeats:Number(el('miSpacing')&&el('miSpacing').value)||64,cutsBefore:3,cutsAfter:4};}
window.RPCompactRulesChanged=function(){if(busy)return;aiPlan=null;clearBestDropCache('Music rules changed. Click Best Drops to refresh.');if(suggestion){enrichMusicMap(suggestion,suggestion.snapshot.duration);showMusic(suggestion);saveMasterMusicMap(suggestion,suggestion.snapshot);}};
function enrichMusicMap(result,duration){aiPlan=null;var engine=window.RPMusicV12||window.RPMusicV10;if(!engine||!engine.enrich)throw Error('Auto Music Map V14 engine is unavailable. Reinstall this build.');engine.enrich(result,duration,musicOptions());window.RPBeatFirst.enrich(result,duration);return result;}

async function prepareMusicMap(result,duration){
 result=enrichMusicMap(result,duration);
 if(window.RPOnlineMusicAI){
  var onlineSettings=window.RPOnlineMusicAI.settings();
  musicAnalysisStage(2,0,onlineSettings.mode==='off'?'Online AI is OFF · local analysis only':!onlineSettings.hasKey?'No API key · local analysis only':'Checking candidate batches for online review…');
  onlineMessage('Reviewing music candidates when API access is available…');
  await window.RPOnlineMusicAI.refine(result,duration,analysisState,function(p,message){onlineMessage(message);musicAnalysisStage(2,p,String(message||'').replace(/^Online AI:\s*/i,''));});
  if(analysisState&&analysisState.cancelled)throw Error('Analysis stopped.');
  musicAnalysisStage(3,.15,'Merging reviewed candidates with local structure rules…');
  result=enrichMusicMap(result,duration);
 }
 musicAnalysisStage(3,.8,'Validating BPM, beats, structure and main drops…');
 updateOnlineStatus(result);return result;
}
function onlineMessage(text){var x=el('onlineStatus');if(x)x.textContent=text;}
function updateOnlineStatus(result){
 if(!window.RPOnlineMusicAI)return;var s=window.RPOnlineMusicAI.settings(),h=result&&result.hybridAI,prefix=s.mode==='off'?'OFF · local only':!s.hasKey?'AUTO · no API key · local only':'AUTO · key from '+s.keySource;
 if(h){if(h.used)prefix+=' · '+(h.status==='cached'?'cached review':'online reviewed')+' '+h.reviewed+'/'+h.total+' eligible candidates · '+h.model+(h.usage?' · cached/run usage '+(h.usage.total_tokens||0)+' tokens':'');else if(h.status==='fallback')prefix+=' · local fallback: '+h.reason+(h.cooldown?' (temporary cooldown)':'');else if(h.status==='no_candidates')prefix+=' · no eligible candidates to review';}
 if(s.warning)prefix+=' · '+s.warning;onlineMessage(prefix);
}
function bindOnlineSettings(){
 if(!window.RPOnlineMusicAI||!el('onlineSave'))return;var s=window.RPOnlineMusicAI.settings();el('onlineMode').value=s.mode;var modelSelect=el('onlineModel');if(!Array.prototype.some.call(modelSelect.options,function(o){return o.value===s.model;})){var savedOption=document.createElement('option');savedOption.value=s.model;savedOption.textContent=s.model+' (saved model)';modelSelect.appendChild(savedOption);}modelSelect.value=s.model;el('onlineBudget').value=String(s.maxRequests);el('onlineRemember').checked=s.remembered;updateOnlineStatus(suggestion);
 function changed(){aiPlan=null;clearBestDropCache('Online settings changed. Analyze Music or Best Drops to refresh.');if(suggestion){suggestion=enrichMusicMap(suggestion,suggestion.snapshot.duration);suggestion.hybridAI=null;showMusic(suggestion);saveMasterMusicMap(suggestion,suggestion.snapshot);}updateOnlineStatus(suggestion);controls();}
 el('onlineSave').onclick=function(){if(busy)return;try{window.RPOnlineMusicAI.save({mode:el('onlineMode').value,key:el('onlineKey').value,remember:el('onlineRemember').checked,model:el('onlineModel').value,maxRequests:Number(el('onlineBudget').value)});el('onlineKey').value='';changed();}catch(e){onlineMessage('Settings not saved: '+(e.code||'unavailable'));}};
 el('onlineClear').onclick=function(){if(busy)return;window.RPOnlineMusicAI.clearKey();el('onlineKey').value='';el('onlineMode').value='off';el('onlineRemember').checked=false;changed();};
}

var LEGACY_SETUP_KEY=['rp.lastSetup.','off','line.v1'].join('');
function musicContext(result){
 if(!result)return null;
 var pacing=result.pacing||null;
 var structure=result.structure||null;return {music_v12:result.musicV12||null,estimated_bpm:result.tempo||result.bpm||null,bpm_confidence:result.tempoConfidence||'low',bpm_spread:result.tempoSpread==null?null:result.tempoSpread,tempo_samples:result.tempoSamples||0,beat_count:result.beatCount||0,approx_beat_interval_seconds:result.beatInterval||null,edit_point_count:result.points?result.points.length:0,energy_samples:result.music?result.music.length:0,structure_drop_count:structure?structure.drop_count||0:0,structure_build_up_count:structure?structure.build_up_count||0:0,structure_summary:structure?structure.summary:null,structure_events:structure&&Array.isArray(structure.events)?structure.events:null,structure_zones:structure&&Array.isArray(structure.zones)?structure.zones:null,music_intelligence:structure&&structure.intelligence?structure.intelligence:null,music_v4:result.musicV4||null,music_v5:result.musicV5||null,music_v6:result.musicV6||null,music_v11:result.musicV11||result.masterMusicMapV11||null,music_v10:result.musicV11||result.musicV10||result.masterMusicMapV11||result.masterMusicMapV10||null,music_v8:result.musicV8||result.masterMusicMapV8||null,beat_first:result.beatFirst||null,pacing_summary:pacing?pacing.summary:null,pacing_segments:pacing?pacing.segments:null,pacing_capped:pacing?!!pacing.capped:false,uncapped_edit_points:pacing?pacing.uncapped_points:null};
}
function musicLabel(result){
 var m=musicContext(result);if(!m)return 'Music analysis: not analyzed yet.';
 var base='Music analysis: '+(m.estimated_bpm?m.estimated_bpm+' BPM ('+m.bpm_confidence+' confidence)':'BPM unclear')+' · '+m.beat_count+' beats detected'+(m.structure_drop_count?' · '+m.structure_build_up_count+' build-ups · '+m.structure_drop_count+' drops':' · no strong build-up/drop transitions detected')+(result.musicV12?' · Auto Music Map V14':result.musicV11?' · Auto Music Map V14':result.musicV10?' · Auto Music Map V10':result.musicV8?' · Music Intelligence V8 Master Map':result.musicV6?' · Music Intelligence V7 Long-Set Adaptive':result.musicV5?' · Music Intelligence V5':'');
 if(result.beatFirst)base+=' · full-A1 local tempo · '+result.beatFirst.sections.length+' rhythm regions (genre estimates)';if(!result.pacing)return base+' · selected cut pacing '+pacingSelectionText()+' is ready to be generated from the music map.';
 var cadences=[],holds=[],segments=result.pacing.segments||[];segments.forEach(function(x){if(cadences.indexOf(x.beats_per_cut)<0)cadences.push(x.beats_per_cut);if(holds.indexOf(x.max_hold_beats)<0)holds.push(x.max_hold_beats);});
 return base+' · '+m.edit_point_count+' AI-paced edit points'+(cadences.length?' · '+cadences.join('/')+' beat cadence':'')+(holds.length?' · max hold '+holds.join('/')+' beats':'')+(m.pacing_capped?' · long-set safety cap applied':'');
}
function showMusic(result){
 var scope=result.snapshot&&result.snapshot.range;if(scope)el('timeline').textContent=(result.snapshot.name||'Sequence')+' · '+(scope.selected?'IN–OUT '+scope.start.toFixed(2)+'–'+scope.end.toFixed(2)+' s':'Full sequence');var box=el('musicInfo');if(box)box.textContent=musicLabel(result);if(window.RPCompact)window.RPCompact.summary(result);renderDropReview(result);updateOnlineStatus(result);}
function renderDropReview(result){
 var box=el('mainDropReview');if(!box)return;box.textContent='';var map=result&&result.musicV12;
 if(!map)return;var rows=map.automatic_drops||[],excluded=result.excludedDropTimes||[];
 var note=document.createElement('small');note.textContent=rows.length+' automatic drops; '+map.drop_count+' selected. Scores are heuristic, not calibrated probabilities. Uncheck a drop to exclude it from Multicam and Best Drops.';box.appendChild(note);
 rows.forEach(function(c){var label=document.createElement('label'),input=document.createElement('input'),key=String(Math.round(c.time*1000)/1000);input.type='checkbox';input.checked=excluded.indexOf(key)<0;input.disabled=busy;input.setAttribute('data-drop-review','1');label.appendChild(input);label.appendChild(document.createTextNode(' '+musicClock(c.time)+' · score '+c.confidence_score+'/100'+(c.online_decision?' · AI '+c.online_decision+' (DSP '+c.local_confidence_score+')':'')));box.appendChild(label);
 input.onchange=function(){if(busy){input.checked=!input.checked;return;}result.excludedDropTimes=(result.excludedDropTimes||[]).filter(function(t){return t!==key;});if(!input.checked)result.excludedDropTimes.push(key);aiPlan=null;clearBestDropCache('Drop selection changed. Refresh Best Drops; audio analysis will be reused.');suggestion=enrichMusicMap(result,result.snapshot.duration);saveMasterMusicMap(suggestion,result.snapshot);showMusic(suggestion);controls();};});
}
function musicClock(sec){sec=Math.max(0,Number(sec)||0);var m=Math.floor(sec/60),s=Math.floor(sec%60);return (m<10?'0':'')+m+':'+(s<10?'0':'')+s;}
function structurePreview(result,maxItems){var events=result&&result.structure&&Array.isArray(result.structure.events)?result.structure.events:[];if(!events.length)return '';maxItems=Math.max(1,Number(maxItems)||10);var shown=events.slice(0,maxItems).map(function(e,i){return '#'+(i+1)+' Build-up '+musicClock(e.build_start)+'–'+musicClock(e.drop_time)+' → Drop '+musicClock(e.drop_time)+(e.confidence?' · '+e.confidence:'');});return shown.join('\n')+(events.length>maxItems?'\n… '+(events.length-maxItems)+' more structure events across A1':'');}
function renderPodcastPeople(){var count=Number(el('podcastPeople')&&el('podcastPeople').value)||2;if(el('podSpeaker3Row'))el('podSpeaker3Row').style.display=count===3?'flex':'none';}
function parseCameraRoleEntries(text){var src=String(text||'').replace(/\r\n?/g,'\n').replace(/;/g,'\n'),lines=src.split('\n'),out=[],used={};for(var i=0;i<lines.length;i++){var line=String(lines[i]||'').trim();if(!line)continue;var legacy=line.match(/^\s*[Vv]\s*(\d{1,2})\s*(?:[:=\-–—]\s*)?(.*?)\s*$/),role,number,index;if(legacy){number=Math.max(1,Number(legacy[1]));index=number-1;role=String(legacy[2]||'').replace(/^[:=\-–—]\s*/,'').trim();}else{number=out.length+1;while(used[number])number++;index=number-1;role=line.replace(/^\s*(?:camera|cam|angle)\s*\d*\s*[:=\-–—]?\s*/i,'').trim();}if(used[number])continue;used[number]=true;if(!role)role='Camera '+number;out.push({number:number,index:index,role:role});}return out;}
function htmlEscape(text){return String(text||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function currentCameraToggleState(){var state={},box=el('cameraToggles');if(!box)return state;var inputs=box.querySelectorAll('input[data-camera]');for(var i=0;i<inputs.length;i++)state[String(Number(inputs[i].getAttribute('data-camera'))+1)]=!!inputs[i].checked;return state;}
function refreshDirectionCameraSelects(entries,preferredPre,preferredDrop){entries=entries||parseCameraRoleEntries(el('aiRoles')?el('aiRoles').value:'');var sel=el('dropCamera');if(!sel)return;var keep=preferredDrop!=null?String(preferredDrop):String(sel.value||'auto'),html=['<option value="auto">AUTO · Music Map V14</option>'];for(var i=0;i<entries.length;i++)html.push('<option value="'+entries[i].index+'">V'+entries[i].number+' · '+htmlEscape(entries[i].role)+'</option>');sel.innerHTML=html.join('');var found=false;for(i=0;i<sel.options.length;i++)if(sel.options[i].value===keep){found=true;break;}sel.value=found?keep:'auto';updateDropCameraSummary();}
function selectedDropCamera(){var x=el('dropCamera');if(!x||x.value==='auto'||x.value==='')return null;var n=Number(x.value);return isFinite(n)&&n>=0&&n===Math.floor(n)?n:null;}
function dropCameraSelectionText(){var n=selectedDropCamera(),entries=parseCameraRoleEntries(el('aiRoles')?el('aiRoles').value:'');if(n==null)return 'AUTO';for(var i=0;i<entries.length;i++)if(entries[i].index===n)return 'V'+entries[i].number+' · '+entries[i].role;return 'V'+(n+1);}
function updateDropCameraSummary(){var x=el('dropCameraSummary');if(x)x.textContent=dropCameraSelectionText();}
function renderCameraToggles(preferred){var entries=parseCameraRoleEntries(el('aiRoles')?el('aiRoles').value:''),box=el('cameraToggles'),summary=el('cameraRoleSummary');if(!box)return entries;var old=currentCameraToggleState(),saved=preferred||restoredCameraSelection||{},html=[],active=0;for(var i=0;i<entries.length;i++){var e=entries[i],key=String(e.number),checked=old.hasOwnProperty(key)?old[key]:saved.hasOwnProperty(key)?!!saved[key]:true;if(checked)active++;var title=htmlEscape('Camera '+e.number+' · '+e.role),roleText=htmlEscape(e.role);html.push('<label class="cameraToggle'+(checked?'':' off')+'" title="'+title+'"><input type="checkbox" data-camera="'+e.index+'" '+(checked?'checked':'')+'><span>Camera '+e.number+' · '+roleText+'</span></label>');}box.innerHTML=html.join('');var inputs=box.querySelectorAll('input[data-camera]');for(i=0;i<inputs.length;i++)inputs[i].onchange=function(){var label=this.parentNode;if(label)label.className='cameraToggle'+(this.checked?'':' off');renderCameraRoleSummary();updateDropCameraSummary();aiPlan=null;saveSetup();controls();};renderCameraRoleSummary();refreshDirectionCameraSelects(entries);restoredCameraSelection=null;return entries;}
function renderCameraRoleSummary(){var entries=parseCameraRoleEntries(el('aiRoles')?el('aiRoles').value:''),active=collectEnabledCameras().length,summary=el('cameraRoleSummary');if(summary)summary.innerHTML='<b>'+entries.length+' camera'+(entries.length===1?'':'s')+' detected</b> from Camera Roles · '+active+' enabled.';}
function collectEnabledCameras(){var out=[],box=el('cameraToggles');if(!box)return out;var inputs=box.querySelectorAll('input[data-camera]');for(var i=0;i<inputs.length;i++)if(inputs[i].checked)out.push(Number(inputs[i].getAttribute('data-camera')));return out;}
function cameraSelectionForSave(){var state={},entries=parseCameraRoleEntries(el('aiRoles')?el('aiRoles').value:''),enabled=collectEnabledCameras();for(var i=0;i<entries.length;i++)state[String(entries[i].number)]=enabled.indexOf(entries[i].index)>=0;return state;}
function saveSetup(){
 try{if(!window.localStorage)return;window.localStorage.setItem(SETUP_KEY,JSON.stringify({roles:el('aiRoles').value,vision:!!el('aiVision').checked,budget:el('aiBudget').value,model:'R Project Auto Music Map V14',zoomMin:el('zoomMin').value,zoomMax:el('zoomMax').value,dropRenderCount:el('dropRenderCount').value,pacingCadences:selectedPacingCadences(),dropCamera:el('dropCamera')?el('dropCamera').value:'auto',cameraSelection:cameraSelectionForSave(),podcastPeople:el('podcastPeople').value,podName1:el('podName1').value,podName2:el('podName2').value,podName3:el('podName3').value,podCam1:el('podCam1').value,podCam2:el('podCam2').value,podCam3:el('podCam3').value,podMic1:el('podMic1').value,podMic2:el('podMic2').value,podMic3:el('podMic3').value,podWideCam:el('podWideCam').value,podMinShot:el('podMinShot').value}));var x=el('setupStatus');if(x)x.textContent='Camera setup saved automatically. Auto Music Map controls cut timing.';}catch(e){}
}
function restoreSetup(){
 try{if(!window.localStorage){updatePacingSummary();renderCameraToggles();return;}var raw=window.localStorage.getItem(SETUP_KEY)||window.localStorage.getItem(LEGACY_SETUP_KEY)||window.localStorage.getItem('rp.lastSetup.v2');if(!raw){updatePacingSummary();renderCameraToggles();return;}var v=JSON.parse(raw)||{};if(typeof v.roles==='string')el('aiRoles').value=v.roles;if(typeof v.vision==='boolean')el('aiVision').checked=v.vision;if(['60','120','240'].indexOf(String(v.budget))>=0)el('aiBudget').value=String(v.budget);if(typeof v.model==='string'&&v.model)el('aiModel').value=v.model;if(isFinite(Number(v.zoomMin))&&Number(v.zoomMin)>0)el('zoomMin').value=String(v.zoomMin);if(isFinite(Number(v.zoomMax))&&Number(v.zoomMax)>0)el('zoomMax').value=String(v.zoomMax);if(isFinite(Number(v.dropRenderCount))&&Number(v.dropRenderCount)>=1&&Number(v.dropRenderCount)<=100)el('dropRenderCount').value=String(Math.round(Number(v.dropRenderCount)));if(Array.isArray(v.pacingCadences)&&v.pacingCadences.length){[2,4,6,8].forEach(function(n){var b=el('pacing'+n);if(b)b.checked=v.pacingCadences.indexOf(n)>=0||v.pacingCadences.indexOf(String(n))>=0;});if(!selectedPacingCadences().length){el('pacing4').checked=true;el('pacing6').checked=true;el('pacing8').checked=true;}}updatePacingSummary();restoredCameraSelection=v.cameraSelection&&typeof v.cameraSelection==='object'?v.cameraSelection:null;renderCameraToggles(restoredCameraSelection);refreshDirectionCameraSelects(parseCameraRoleEntries(el('aiRoles')?el('aiRoles').value:''),null,v.dropCamera!==undefined?v.dropCamera:'auto');updateDropCameraSummary();if(['2','3'].indexOf(String(v.podcastPeople))>=0)el('podcastPeople').value=String(v.podcastPeople);['podName1','podName2','podName3','podCam1','podCam2','podCam3','podMic1','podMic2','podMic3','podWideCam','podMinShot'].forEach(function(k){if(v[k]!==undefined&&v[k]!==null)el(k).value=String(v[k]);});renderPodcastPeople();var x=el('setupStatus');if(x)x.textContent='Restored camera setup. Auto Music Map controls cut timing.';}catch(e){updatePacingSummary();renderCameraToggles();}
}
function bindSetupMemory(){
 ['zoomMin','zoomMax','dropRenderCount','podName1','podName2','podName3','podCam1','podCam2','podCam3','podMic1','podMic2','podMic3','podWideCam','podMinShot'].forEach(function(id){el(id).oninput=saveSetup;});var roleRefresh=function(){renderCameraToggles();saveSetup();};el('aiRoles').oninput=roleRefresh;el('aiRoles').onchange=roleRefresh;el('aiRoles').onkeyup=roleRefresh;['aiVision','aiBudget','aiModel'].forEach(function(id){el(id).onchange=saveSetup;});if(el('dropCamera'))el('dropCamera').onchange=function(){aiPlan=null;updateDropCameraSummary();saveSetup();controls();};[2,4,6,8].forEach(function(n){var box=el('pacing'+n);if(box)box.onchange=function(){var values=[2,4,6,8].filter(function(v){var b=el('pacing'+v);return b&&b.checked;});if(!values.length){this.checked=true;state('Keep at least one pacing option enabled.',false,'warning');}aiPlan=null;updatePacingSummary();saveSetup();controls();};});updatePacingSummary();el('podcastPeople').onchange=function(){renderPodcastPeople();saveSetup();};
}
function controls(){
 document.querySelectorAll("[data-drop-review],#miThreshold,#miSpacing,#dropSensitivity,#dropPreBeats,#dropPostBeats,#onlineMode,#onlineKey,#onlineRemember,#onlineModel,#onlineBudget,#onlineSave,#onlineClear").forEach(function(x){x.disabled=busy;});
 if(window.RPCompact)window.RPCompact.running(busy,toolPrefix(activeTool));['dropSensitivity','dropPreBeats','dropPostBeats','miSpacing'].forEach(function(id){if(el(id))el(id).disabled=busy;});el('compactDropReview').style.display=bestDropCache?'block':'none';
 var entitled=licenseCanUse();
 ['cut','angle','delete'].forEach(function(id){el(id).disabled=busy||!ready||!entitled||!lastInfo||!lastInfo.manual;});
 el('analyzeA1').disabled=busy||!ready||!entitled;el('applyA1').disabled=busy||!ready||!entitled||!suggestion||!suggestion.points||!suggestion.points.length;el('chooseFF').disabled=busy;if(el('chooseAME'))el('chooseAME').disabled=busy;if(el('resetAME'))el('resetAME').disabled=busy;
 ['aiRoles','aiKey','aiModel','aiVision','aiBudget','pacing2','pacing4','pacing6','pacing8','dropCamera','zoomMin','zoomMax','podcastPeople','podName1','podName2','podName3','podCam1','podCam2','podCam3','podMic1','podMic2','podMic3','podWideCam','podMinShot'].forEach(function(id){if(el(id))el(id).disabled=busy||!ready;});
 if(el('dropRenderCount'))el('dropRenderCount').disabled=busy||!ready||!bestDropCache;
 var camInputs=el('cameraToggles')?el('cameraToggles').querySelectorAll('input[data-camera]'):[];for(var ci=0;ci<camInputs.length;ci++)camInputs[ci].disabled=busy||!ready;
 ['aiPlan','directorRun','aiMarkerRun','aiApply','aiDelete','aiExport','zoomRun','bestDropsAnalyze','podcastRun'].forEach(function(id){if(el(id))el(id).disabled=busy||!ready||!entitled;});
 if(el('bestDropsRender'))el('bestDropsRender').disabled=busy||!ready||!entitled||!bestDropCache;
 if(el('podcastRun'))el('podcastRun').disabled=true;if(el('podcastBadge')){el('podcastBadge').className='badge warning';el('podcastBadge').textContent='COMING SOON';}
 el('aiPlan').disabled=busy||!ready||!entitled||!suggestion||!suggestion.beats||!suggestion.beats.length;
 el('directorRun').disabled=busy||!ready||!entitled;
 ['aiApply','aiDelete','aiExport'].forEach(function(id){el(id).disabled=busy||!ready||!entitled||!aiPlan;});
 el('stop').disabled=!busy||stopRequested;setToolStops();
 renderResumePanel();
}

function hostAuthorizedCode(code){
 var safe=/^\s*(rp_getActiveInfo|rp_ping|rp_state|rp_stop)\s*\(/.test(String(code||''));if(safe)return code;
 var sess=null;try{sess=window.RPLicense&&window.RPLicense.hostSession?window.RPLicense.hostSession():null;}catch(e){}
 if(!sess||!sess.ok){
  // A job that already started under a valid session may finish (the host accepts this only for the
  // running job's own step/upload calls). Every new job, plan or analysis still requires a session.
  if(busy&&/^\s*rp_(step|a1Upload)\(/.test(String(code||'')))return code;
  return "rp_licenseDenied()";
 }
 return "(function(){var __a=rp_authorize("+Math.floor(sess.expires)+","+JSON.stringify(sess.proof)+");if(!__a.ok)return rp_encode(__a);return "+code+";})()";
}
function invoke(code,cb,timeoutMs){
 var guard=window.RPResourceGuard;
 if(!guard||!/^\s*rp_step\(/.test(code)||pending)return invokeHost(code,cb,timeoutMs);
 // Own the host slot while sampling: Stop cannot enqueue a competing request.
 // v2.3.11.5: the callback runs exactly once and the slot is released on every failure path.
 var delivered=false,reply=function(r){if(delivered)return;delivered=true;cb(r);},sample;
 pending=true;
 try{guard.observe(job);sample=guard.check();}catch(guardError){sample=Promise.reject(guardError);}
 Promise.resolve(sample).then(function(reading){
  pending=false;reading=reading||{};
  var match=/rp_step\((.*)\)/.exec(code),id=match?match[1]:'';
  if(stopRequested||(analysisState&&analysisState.cancelled)||reading.critical){
   return invokeHost('rp_stop('+id+')',function(r){
    if(reading.critical){r.warning=true;r.message='Paused for low memory. Save the project, close other heavy apps, then use Continue Multicam. '+reading.label;}
    reply(r);
   },timeoutMs);
  }
  invokeHost(reading.slow?code.replace(/\)\s*$/,',true)'):code,reply,timeoutMs);
 },function(){pending=false;invokeHost(code,reply,timeoutMs);}).then(null,function(e){if(!delivered){pending=false;reply({ok:false,status:'error',message:'Host call failed: '+(e&&e.message||e)});}});
}
function invokeHost(code,cb,timeoutMs){
 if(pending){cb({ok:false,status:'error',message:'Premiere is still processing the previous request.'});return;}
 code=hostAuthorizedCode(code);
 // Each request owns a ticket. Timeout/error always release the slot; a late reply from a timed-out
 // request can never clear the flag of a newer request (the old code left pending=true until restart).
 var waitMs=Number(timeoutMs)||HOST_TIMEOUT_MS,ticket=++pendingSeq;pending=true;var finished=false,timeout=null;
 function release(){if(pendingSeq===ticket)pending=false;}
 function timeoutError(){
  if(finished)return;finished=true;release();lastReply=Date.now();
  try{cb({ok:false,status:'error',timeout:true,message:'Premiere did not respond within '+Math.round(waitMs/1000)+' seconds. Stop, save the project and restart Premiere before retrying.'});}
  finally{try{controls();}catch(uiError){}}
 }if(window.clearTimeout&&window.setTimeout)timeout=window.setTimeout(timeoutError,waitMs);
 try{cs.evalScript(code,function(raw){
  if(finished){lastReply=Date.now();return;}finished=true;if(window.clearTimeout)window.clearTimeout(timeout);release();lastReply=Date.now();var r;
  try{if(!raw||raw==='EvalScript error.')throw Error('Host script did not respond. Close Premiere and reinstall this package.');r=JSON.parse(raw);}
  catch(e){r={ok:false,status:'error',message:e.message+' Response: '+String(raw).slice(0,180)};}
  cb(r);
 });}catch(e){if(!finished){finished=true;if(window.clearTimeout)window.clearTimeout(timeout);release();cb({ok:false,status:'error',message:e.message});}}
}
function estimate(){
 if(!lastInfo)return;
 el('estimate').textContent='No timeline markers required. A1 beat boundaries stay internal to the plugin.'+(lastInfo.manual?' '+lastInfo.manual+' existing manual markers are left untouched.':'');
}
function refresh(){
 if(busy||pending)return;
 invoke('rp_getActiveInfo()',function(r){
  ready=r.ok&&r.version==='2.3.11.4';lastInfo=r.ok?r:null;
  if(ready&&r.pendingID){
   // A Premiere host job can outlive/recover from a panel reload. Resume polling it
   // instead of automatically stopping it and leaving thousands of partial cuts.
   busy=true;stopRequested=false;started=Date.now();lastReply=started;controls();
   invoke('rp_state()',update);return;
  }
  el('timeline').textContent=r.name?r.name+' · '+r.duration.toFixed(2)+' seconds':'Open an active sequence in Premiere.';
  if(!ready)state(r.message||('Host version mismatch (panel 2.3.11.4 / host '+String(r&&r.version||'unknown')+'). Close Premiere completely, reinstall this build, then reopen Premiere.'),true);
  else if(el('state').textContent==='Connecting…')state('Ready');
  estimate();controls();
 });
}
function update(r){
 if(r.id)job=r;try{syncResumeCheckpoint(r);}catch(storageError){busy=false;stopRequested=true;if(job&&!pending)invoke('rp_stop('+quote(job.id)+')',function(){});state(storageError.message,true);controls();return;}
 if(r.uiKind==='podcast')setActiveTool('podcast');else if(r.kind==='zoom')setActiveTool('zoom');else if(r.kind==='best15')setActiveTool('drop');
 if(typeof r.total==='number'){
  var pct=Math.floor(r.done/Math.max(1,r.total)*100),text;
  if(r.kind==='zoom')text=r.done.toLocaleString()+' / '+r.total.toLocaleString()+' footage clips · '+pct+'% · '+(r.changed||0)+' animated · '+(r.skipped||0)+' skipped';
  else {
   var unit=r.phase==='delete'?'pieces':(r.phase==='angle'?'camera pieces':'edit points');
   text=r.done.toLocaleString()+' / '+r.total.toLocaleString()+' '+unit+' · '+pct+'% · '+(r.cuts||0)+' cuts · '+(r.removed||0)+' pieces removed · stage '+r.phase;
  }
  progressFor(activeTool,r.done,r.total||1,text);
 }
 if(!r.ok||r.status!=='running'){
  releaseJobResources(analysisState,'host-job-finished',false);
  busy=false;controls();
  var kind=!r.ok||r.status==='error'?'error':(r.status==='stopped'||r.warning?'warning':'success');
  state(r.message||'Process finished',kind==='error',kind);
  if(r.kind==='zoom'&&r.zoomErrors&&r.zoomErrors.length){log('Random Zoom diagnostics: '+r.zoomErrors.map(function(x){return 'V'+x.track+' '+x.clip+': '+x.message;}).join(' | '));}
  log((r.message||'Process finished')+(r.id?(r.kind==='zoom'?' | '+(r.changed||0)+' zoom animations ('+(r.zoomIn||0)+' in / '+(r.zoomOut||0)+' out), '+(r.skipped||0)+' skipped.':' | '+(r.cuts||0)+' cut, '+(r.removed||0)+' pieces removed.') :''));
  heartbeatFor(activeTool,'Elapsed time: '+Math.round((Date.now()-started)/1000)+' seconds.');return;
 }
 state(r.message||'Processing',false,'running');
 var resourceProfile=window.RPResourceGuard&&window.RPResourceGuard.profile?window.RPResourceGuard.profile():null;
 window.setTimeout(next,resourceProfile?resourceProfile.batchDelay:40);
}
function next(){
 if(!busy||pending||!job)return;
 if(!stopRequested&&job.kind==='a1'&&job.phase==='upload'){
  var part=suggestion.points.slice(uploadIndex,uploadIndex+100);uploadIndex+=part.length;
  invoke('rp_a1Upload('+JSON.stringify(job.id)+','+JSON.stringify(part.join(','))+')',update);return;
 }
 invoke((stopRequested?'rp_stop(':'rp_step(')+JSON.stringify(job.id)+')',update,HOST_STEP_TIMEOUT_MS);
}
function start(kind){
 setActiveTool('multi');
 if(busy||pending||!ready)return;
 if(!lastInfo||!lastInfo.manual){state('Add manual sequence markers first.',true);return;}
 busy=true;stopRequested=false;job=null;started=Date.now();lastReply=started;controls();
 state('Starting '+({cut:'Auto Cut',angle:'Switch Angle',delete:'Cut + Angle + Remove unused clips'}[kind])+'…');
 progressFor('multi',0,1,'Reading active timeline…');
 window.setTimeout(function(){invoke('rp_begin('+JSON.stringify(kind)+')',update);},50);
}
['cut','angle','delete'].forEach(function(id){el(id).onclick=function(){start(id);};});
function requestStop(){
 if(!busy)return;stopRequested=true;controls();state('Stopping after the current step…',false,'running');
 if(analysisState){analysisState.cancelled=true;if(analysisState.process)analysisState.process.kill();if(analysisState.request)analysisState.request.destroy();/* The active async loop owns the next host call and will stop at its cancellation check. */return;}
 if(!pending&&job)next();
}
el('stop').onclick=requestStop;el('multiStop').onclick=requestStop;el('zoomStop').onclick=requestStop;el('dropStop').onclick=requestStop;el('podcastStop').onclick=requestStop;


function call(code,timeoutMs){return new Promise(function(resolve,reject){invoke(code,function(r){try{if(r.ok){if(r.status==='running')window.setTimeout(function(){resolve(r);},Math.max(40,Number(r.waitMs)||0));else resolve(r);}else{if(r.id){job=r;syncResumeCheckpoint(r);}reject(Error(r.message||'Premiere did not respond'));}}catch(callbackError){reject(callbackError);}},timeoutMs);});}
function quote(text){return JSON.stringify(text).replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');}
function internalSnapshotCall(result){return 'rp_getAIInternal('+quote(result.snapshot.signature)+','+quote(result.points.join(','))+')';}
async function applySuggestionDirect(result){
 var r=await call('rp_a1DirectApply('+quote(result.snapshot.signature)+','+quote(result.points.join(','))+')');
 aiProgress(.5,'Legacy marker mode ready');
 while(r.status==='running'){
  r=await call('rp_step('+quote(r.id)+')',HOST_STEP_TIMEOUT_MS);
  if(r.total)aiProgress(r.done/Math.max(1,r.total),'Applying legacy markers');
 }
 if(r.status!=='done')throw Error(r.message||'Could not apply A1 markers.');
}
async function makeAIPlan(previous,base,scale){
 base=base||0;scale=scale==null?1:scale;
 if(!suggestion||!suggestion.beats||!suggestion.beats.length)throw Error('No clear A1 beats detected. Analyze A1 again.');
 if(!window.RPAudio.fresh(suggestion.snapshot,suggestion.fingerprint))throw Error('A1 audio changed. Analyze again.');
 suggestion=await prepareMusicMap(suggestion,suggestion.snapshot.duration);saveMasterMusicMap(suggestion,suggestion.snapshot);
 var music=suggestion.music||[],roleEntries=parseCameraRoleEntries(el('aiRoles').value),enabledCameras=collectEnabledCameras();
 if(!roleEntries.length)throw Error('Enter Camera Roles first, one role per line (for example: Master Wide, Crowd Reaction, DJ Close-Up). Camera count is dynamic and is not tied to V1–V6.');
 if(!enabledCameras.length)throw Error('Enable at least one camera in Camera Selection.');
 var pacing=await window.RPDirector.pace({key:'agent-ai',model:'R Project Auto Music Map V14',music:music,musicAnalysis:musicContext(suggestion),duration:suggestion.snapshot.duration},analysisState,function(p,message){aiProgress(base+scale*.18*p,message);});
 pacing=constrainPacingToSelection(pacing);
 window.RPAudio.applyPacing(suggestion,pacing,suggestion.snapshot.duration,6000);showMusic(suggestion);
 if(!suggestion.points.length)throw Error('Auto Music Map produced no usable beat-aligned edit points. Try a clearer A1 music track.');
 if(suggestion.pacing&&suggestion.pacing.capped)log('Long-set safety: '+suggestion.pacing.uncapped_points+' requested edit points were reduced to '+suggestion.points.length+' to keep the plan stable.');
 var snapshot=await call(internalSnapshotCall(suggestion),hostTimeout(60000,suggestion.points.length,40));
 var availableCameraMap={};(snapshot.tracks||[]).forEach(function(t){availableCameraMap[Number(t.index)]=true;});var requestedCameras=enabledCameras.slice(0),unavailableCameras=requestedCameras.filter(function(c){return !availableCameraMap[Number(c)];});enabledCameras=requestedCameras.filter(function(c){return !!availableCameraMap[Number(c)];});
 if(!enabledCameras.length)throw Error('None of the enabled Camera Selection tracks has usable footage. Check Camera Roles / Camera Selection and make sure at least one selected V-track is unlocked, enabled and contains clips.');
 if(unavailableCameras.length)log('Camera Selection auto-skip: '+unavailableCameras.map(function(c){return 'V'+(Number(c)+1);}).join(', ')+' is missing, empty, locked or disabled in this sequence. Multicam will continue with '+enabledCameras.map(function(c){return 'V'+(Number(c)+1);}).join(', ')+'.');
 var result=await window.RPDirector.run(snapshot,{key:'agent-ai',model:'R Project Auto Music Map V14',roles:el('aiRoles').value,enabledCameras:enabledCameras,dropCamera:selectedDropCamera(),vision:el('aiVision').checked,budget:Number(el('aiBudget').value),ffmpeg:el('ffmpeg').value,music:music,musicAnalysis:musicContext(suggestion)},analysisState,function(p,message){aiProgress(base+scale*(.18+.82*p),message);});
 if(unavailableCameras.length)result.summaries.unshift('Camera Selection Auto-Skip: '+unavailableCameras.map(function(c){return 'V'+(Number(c)+1);}).join(', ')+' unavailable; continued safely with '+enabledCameras.map(function(c){return 'V'+(Number(c)+1);}).join(', ')+'.');
 var current=await call('rp_validateAIContext('+quote(snapshot.sequenceID)+','+quote(snapshot.projectPath||'')+','+quote(snapshot.a1Signature||'')+','+Number(snapshot.duration||0)+')',HOST_TIMEOUT_MS);if(!current.contextValid)throw Error(current.message||'Timeline or A1 changed while generating the plan.');
 result.snapshot=snapshot;result.pacing=suggestion.pacing;aiPlan=result;
 el('aiResult').textContent='Camera Roles: '+roleEntries.length+' detected · '+enabledCameras.length+' enabled ('+enabledCameras.map(function(c){return 'Camera '+(c+1);}).join(', ')+') · Main Drop Camera: '+dropCameraSelectionText()+'\n'+musicLabel(suggestion)+'\nPacing: '+(suggestion.pacing.summary||'Auto Music Map '+pacingSelectionText()+' pacing')+'\n'+result.choices.length+' interval · '+result.images+' AI Vision frame samples · '+result.failedImages+' failed samples · '+(music.length?'with A1 energy data':'without A1 energy data')+(result.holdGuardChanges?' · '+result.holdGuardChanges+' long holds corrected':'')+'\n'+result.summaries.join('\n')+'\n\n'+result.choices.map(function(c){var it=snapshot.intervals[c.id];return it.start.toFixed(2)+'–'+it.end.toFixed(2)+'s → '+(c.camera<0?'Empty':'V'+(c.camera+1))+' ['+c.confidence+'] '+c.reason;}).join('\n');
 return result;
}
el('chooseFF').onclick=function(){
 if(busy||pending)return;
 pending=true;
 try{cs.evalScript("(function(){var f=File.openDialog('Choose FFmpeg executable');return f?encodeURIComponent(f.fsName):'';})()",function(r){
  pending=false;lastReply=Date.now();
  if(r&&r!=='EvalScript error.')try{el('ffmpeg').value=decodeURIComponent(r);localStorage.setItem('rp.ffmpeg',el('ffmpeg').value);}catch(e){log(e.message);}
 });}catch(e){pending=false;log('FFmpeg picker failed: '+e.message);}
};
var autoAMEPreset='';
var AME_PRESET_KEY='rp.amePreset.agent.v208';
var LEGACY_AME_PRESET_KEY=['rp.amePreset.','off','line.v2'].join('');
function sequenceExportLabel(spec){
 spec=spec||{};var parts=['H.264 Match Source'];
 if(spec.width&&spec.height)parts.push(spec.width+'×'+spec.height);
 if(spec.fps)parts.push(Number(spec.fps).toFixed(Math.abs(spec.fps-Math.round(spec.fps))<.01?0:2)+' fps');
 if(spec.audioSampleRate)parts.push(Math.round(spec.audioSampleRate/1000)+' kHz');
 return parts.join(' · ');
}
function amePresetName(path){var s=String(path||'').replace(/\\/g,'/'),parts=s.split('/');return parts[parts.length-1]||s;}
function showAMEPreset(message){var x=el('amePresetInfo');if(x)x.innerHTML='<strong>Best Drop Export:</strong> '+message;}
function saveAMEPreset(path){
 autoAMEPreset=String(path||'');
 try{if(autoAMEPreset)localStorage.setItem(AME_PRESET_KEY,autoAMEPreset);else localStorage.removeItem(AME_PRESET_KEY);}catch(e){}
 if(autoAMEPreset)showAMEPreset('Saved H.264 preset: '+amePresetName(autoAMEPreset)+'. Future Best Drop exports will use it automatically.');
 else showAMEPreset('Auto Detect enabled. The plugin will search Adobe Media Encoder / Premiere preset folders on the next export.');
}
function loadAMEPreset(){
 if(autoAMEPreset)return autoAMEPreset;
 try{autoAMEPreset=localStorage.getItem(AME_PRESET_KEY)||localStorage.getItem(LEGACY_AME_PRESET_KEY)||'';}catch(e){autoAMEPreset='';}
 if(autoAMEPreset)showAMEPreset('Saved H.264 preset: '+amePresetName(autoAMEPreset)+'.');
 return autoAMEPreset;
}
function chooseAMEPresetDialog(){
 return new Promise(function(resolve){
  var script="(function(){try{var start=Folder.myDocuments;var ame=new Folder(Folder.myDocuments.fsName+'/Adobe/Adobe Media Encoder');if(ame.exists)start=ame;var f=start.openDlg('Choose an Adobe Media Encoder H.264 .epr preset');return f?encodeURIComponent(f.fsName):'';}catch(e){return '';}})()";
  cs.evalScript(script,function(raw){lastReply=Date.now();if(!raw||raw==='EvalScript error.')return resolve('');try{resolve(decodeURIComponent(raw));}catch(e){resolve('');}});
 });
}
async function validateAMEPreset(path){
 if(!path)throw Error('No H.264 preset selected.');
 var resolved=await call('rp_best15ResolvePreset('+quote(path)+')',20000);
 saveAMEPreset(resolved.preset);
 return resolved;
}
async function resolveAutoAMEPreset(forceDialog){
 var fs=window.cep_node.require('fs'),remembered=loadAMEPreset();
 if(!forceDialog&&remembered){
  try{if(fs.existsSync(remembered))return await validateAMEPreset(remembered);saveAMEPreset('');}catch(savedError){log('Saved export preset is no longer valid: '+savedError.message);saveAMEPreset('');}
 }
 if(!forceDialog){
  if(!window.RPAME||!window.RPAME.findMatchSourcePresets)throw Error('Automatic Media Encoder preset finder is unavailable. Reinstall this plugin build.');
  state('Best Drops: searching Adobe H.264 presets on this computer…',false,'running');
  var scan=window.RPAME.findMatchSourcePresetsAsync?await window.RPAME.findMatchSourcePresetsAsync({shouldStop:function(){return !!(analysisState&&analysisState.cancelled);}}):window.RPAME.findMatchSourcePresets(),all=[],seen={};
  (scan.candidates||[]).concat(scan.fallback||[]).forEach(function(p){var k=String(p).toLowerCase();if(!seen[k]){seen[k]=1;all.push(p);}});
  if(all.length){
   try{
    var shortlist=all.slice(0,120).join('\n');
    var resolved=await call('rp_best15ResolvePreset('+quote(shortlist)+')',45000);
    saveAMEPreset(resolved.preset);
    log('Best Drops auto export: '+sequenceExportLabel(resolved.sequence)+' · '+resolved.preset+' · scanned '+scan.scanned+' Adobe files.');
    return resolved;
   }catch(autoError){log('Auto preset validation failed: '+autoError.message);}
  }else log('Auto preset finder scanned '+scan.scanned+' Adobe files but found no usable H.264 .epr candidate.');
 }
 state('Best Drops: Adobe preset location is different on this Mac/PC. Choose an H.264 .epr preset once…',false,'warning');
 var picked=await chooseAMEPresetDialog();
 if(!picked)throw Error('H.264 export preset was not selected. Open Adobe Media Encoder, create or reveal an H.264 preset, then choose its .epr file once in Settings.');
 if(!/\.epr$/i.test(picked))throw Error('The selected file is not an Adobe .epr export preset. Choose an H.264 .epr preset.');
 var manual=await validateAMEPreset(picked);
 log('Best Drops manual export preset saved: '+manual.preset);
 return manual;
}
if(el('chooseAME'))el('chooseAME').onclick=async function(){
 if(busy||pending)return;
 try{var r=await resolveAutoAMEPreset(true);showAMEPreset('Saved H.264 preset: '+amePresetName(r.preset)+' · '+sequenceExportLabel(r.sequence)+'.');state('H.264 export preset saved. Best Drops is ready.',false,'success');}
 catch(e){state(e.message,true,'error');log(e.message);}
};
if(el('resetAME'))el('resetAME').onclick=function(){if(busy||pending)return;saveAMEPreset('');state('H.264 export preset reset. Auto Detect will run on the next Best Drop export.',false,'ready');};
loadAMEPreset();
el('analyzeA1').onclick=async function(){
 if(busy||pending||!ready)return;if(!requireEntitlement())return;
 busy=true;stopRequested=false;job=null;suggestion=null;clearBestDropCache('Best Drop analysis not run yet.');started=Date.now();analysisState={cancelled:false,process:null};controls();
 musicAnalysisStage(1,0,'Reading active A1 track…');el('preview').textContent='Analyzing A1 beats and BPM. No timeline markers will be created.';
 try{
  var snapshot=await call('rp_getA1()');
  var result=await window.RPAudio.run(snapshot,el('ffmpeg').value,analysisState,function(p,message){musicAnalysisStage(1,p,message||'Analyzing A1 audio…');});
  if(analysisState.cancelled)throw Error('Analysis stopped.');
  result=await prepareMusicMap(result,snapshot.duration);
  var current=await call('rp_getA1()');if(current.signature!==snapshot.signature)throw Error('A1 or sequence changed. Analyze again.');
  musicAnalysisStage(3,1,'Music Map ready.');result.snapshot=snapshot;saveMasterMusicMap(result,snapshot);suggestion=result;showMusic(result);
  var summary=(result.beats?result.beats.length:0)+' beat candidates'+(result.tempo?' · estimated dominant tempo '+result.tempo+' BPM · '+result.tempoConfidence+' confidence':'')+(result.beatCount?' · '+result.beatCount+' beats detected':'');
  el('preview').textContent=summary+(result.structure&&result.structure.drop_count?' · '+result.structure.build_up_count+' build-ups · '+result.structure.drop_count+' drops':'')+'\nAgent AI scanned the complete A1 track and built a music-structure map. Pacing has not been generated yet; Auto Music Map V14 will decide camera timing from the detected music structure; the selected '+pacingSelectionText()+' values are preferences only.'+(result.structure&&result.structure.drop_count?'\n\nDetected A1 structure:\n'+structurePreview(result,14):'');
  state(result.beats&&result.beats.length?'Music analysis ready. Selected pacing: '+pacingSelectionText()+'.':'Beats are unclear. Try clearer music.',false,result.beats&&result.beats.length?'success':'warning');log(summary);
 }catch(e){suggestion=null;state(e.message,true);log(e.message);}
 finally{releaseJobResources(analysisState,'analysis-finished',false);analysisState=null;busy=false;controls();}
};
el('applyA1').onclick=function(){
 if(busy||pending||!ready||!suggestion||!suggestion.points.length)return;if(!requireEntitlement())return;
 try{if(!window.RPAudio.fresh(suggestion.snapshot,suggestion.fingerprint))throw Error('Audio changed. Analyze again.');}
 catch(e){suggestion=null;controls();state(e.message,true);return;}
 busy=true;stopRequested=false;job=null;uploadIndex=0;started=Date.now();controls();
 state('Applying approved marker suggestions…');
 window.setTimeout(function(){invoke('rp_a1Begin('+quote(suggestion.snapshot.signature)+','+suggestion.points.length+')',update);},50);
};
try{el('ffmpeg').value=localStorage.getItem('rp.ffmpeg')||'';}catch(e){}
function aiProgress(p,message){state(message,false,'running');progressFor(activeTool,Math.floor(p*100),100,Math.floor(p*100)+'% · '+message);}
function releaseJobResources(st,reason,releaseHeavy){
 try{if(window.RPResourceGuard&&window.RPResourceGuard.cleanup)window.RPResourceGuard.cleanup(st,reason||'job-finished');}catch(e){log('Resource cleanup warning: '+e.message);}
 if(releaseHeavy){suggestion=null;aiPlan=null;masterMusicMapMemory=null;}
 try{if(window.cep_node&&window.cep_node.global&&typeof window.cep_node.global.gc==='function')window.cep_node.global.gc();}catch(e){}
}
el('aiPlan').onclick=async function(){
 setActiveTool('multi');
 if(busy||pending||!ready||!suggestion||!suggestion.beats||!suggestion.beats.length)return;if(!requireEntitlement())return;
 var previous=aiPlan;aiPlan=null;busy=true;stopRequested=false;job=null;started=Date.now();analysisState={cancelled:false,process:null,request:null};controls();
 state('Auto Music Map is building camera decision timing from the music map…');el('aiResult').textContent='No timeline changes yet.';
 try{
  await makeAIPlan(previous,0,1);if(analysisState.cancelled)throw Error('Agent AI Director stopped.');
  state('Agent AI plan ready. Review pacing and camera choices, then apply.',false,'success');log('Agent AI Director finished: '+aiPlan.choices.length+' intervals from Auto Music Map pacing; '+aiPlan.images+' images.');
 }catch(e){state(e.message,true);log(e.message);}
 finally{releaseJobResources(analysisState,'analysis-finished',false);analysisState=null;busy=false;controls();}
};
el('directorRun').onclick=async function(){
 setActiveTool('multi');
 if(busy||pending||!ready)return;if(!requireEntitlement())return;
 busy=true;stopRequested=false;job=null;suggestion=null;aiPlan=null;clearBestDropCache('Best Drop analysis not run yet.');started=Date.now();analysisState={cancelled:false,process:null,request:null};controls();
 el('preview').textContent='Agent AI Director is scanning the complete A1 track for beat, BPM, energy, build-ups and drops…';el('aiResult').textContent='Preparing automatic music-driven pacing and camera plan…';state('Agent AI Director: reading A1…');
 try{
  var a1=await call('rp_getA1()');
  var result=loadMasterMusicMap(a1),reusedMaster=!!result;
  if(result){result=await prepareMusicMap(result,a1.duration);result.snapshot=a1;saveMasterMusicMap(result,a1);aiProgress(.35,'Master Music Map · reusing locked A1 analysis');}
  else{
   result=await window.RPAudio.run(a1,el('ffmpeg').value,analysisState,function(p,message){aiProgress(p*.35,message);});
   if(!result.beats||!result.beats.length)throw Error('No clear A1 beats detected. Use clearer music.');
   result=await prepareMusicMap(result,a1.duration);result.snapshot=a1;saveMasterMusicMap(result,a1);
  }
  if(!result.beats||!result.beats.length)throw Error('No clear A1 beats detected. Use clearer music.');
  result.snapshot=a1;suggestion=result;showMusic(result);saveSetup();
  if(analysisState.cancelled)throw Error('Agent AI Director stopped.');
  state('Auto Music Map: translating the music structure into camera decisions…');
  await makeAIPlan(null,.35,.25);
  el('preview').textContent=suggestion.points.length+' AI-paced internal edit points'+(result.tempo?' · '+result.tempo+' BPM · '+result.tempoConfidence+' confidence':'')+(result.beatCount?' · '+result.beatCount+' beats detected':'')+(result.structure&&result.structure.drop_count?' · '+result.structure.build_up_count+' build-ups · '+result.structure.drop_count+' drops':'')+'.\nAgent AI analyzed A1 within the active processing range. Pacing is derived automatically from beat/BPM, energy, breakdowns, build-ups, spectral change and validated drop impacts. Main drops are selected from precomputed candidates using confidence, structural evidence, minimum spacing and conservative long-gap fill. Validated drops switch angle and restart the selected beat count. Camera choice is automatic, role-aware and limited to enabled Camera Selection tracks. The final pre-drop and exact drop are forced to different covered cameras when possible. Selected 2/4/6/8 values determine camera decision intervals. Physical razor cuts are created only when the winning camera changes; same-camera decisions stay continuous. Max Hold Guard still prefers an alternate covered camera when available. No sequence markers were created.';
  // v2.3.11.2: destructive cleanup is forbidden if a long set produced an implausibly sparse plan.
  var bi49=Number(result.beatInterval)||0,minCad49=result.pacing&&Number(result.pacing.min_cut_beats)||4;
  var expectedCuts49=result.beatFirst?Math.floor((result.musicGrid||[]).length/Math.max(4,minCad49)):(bi49>0?Math.floor(Number(a1.duration||0)/(bi49*Math.max(4,minCad49))):0);
  if(expectedCuts49>40&&suggestion.points.length<Math.min(40,expectedCuts49*.12))throw Error('Full-length pacing verification failed: the edit plan does not cover the complete A1 duration. Cleanup cancelled; no camera clips were deleted.');
  state('Plan ready. Applying cuts inside the processing range and safely removing unused camera pieces…');log('Agent AI Director analysis complete: '+suggestion.points.length+' automatic music-driven edit points and '+aiPlan.choices.length+' intervals.'+(result.fullLengthBeatGrid&&result.fullLengthBeatGrid.reconstructed?' Full-length beat grid reconstructed: '+result.fullLengthBeatGrid.grid_beats+' beats.':''));
  autoDirector=true;await applyAI('delete',.60,.40);autoDirector=false;
 }catch(e){autoDirector=false;suggestion=null;aiPlan=null;state(e.message,true);log(e.message);}
 finally{releaseJobResources(analysisState,'full-multicam-finished',true);analysisState=null;busy=false;controls();}
};
el('zoomRun').onclick=function(){
 if(busy||pending||!ready)return;if(!requireEntitlement())return;
 setActiveTool('zoom');
 var zoomMin=Number(el('zoomMin').value),zoomMax=Number(el('zoomMax').value);
 if(!isFinite(zoomMin)||!isFinite(zoomMax)||zoomMin<=0||zoomMax<=zoomMin||zoomMax>1000){state('Enter a valid Zoom range: minimum must be above 0 and maximum must be greater than minimum (up to 1000%).',true,'error');return;}
 saveSetup();
 busy=true;stopRequested=false;job=null;started=Date.now();lastReply=started;controls();
 state('Scanning active footage for Random Zoom '+zoomMin+'% / '+zoomMax+'%…',false,'running');progressFor('zoom',0,1,'Preparing Scale '+zoomMin+'% / '+zoomMax+'% keyframes…');
 window.setTimeout(function(){invoke('rp_zoomBegin('+zoomMin+','+zoomMax+')',update);},50);
};

function dropClock(t){
 t=Math.max(0,Math.round(Number(t)||0));var h=Math.floor(t/3600),m=Math.floor((t%3600)/60),s=t%60;function p(v){return v<10?'0'+v:String(v);}return (h?p(h)+':':'')+p(m)+':'+p(s);
}
function clearBestDropCache(message){
 bestDropCache=null;if(el('dropRenderCount')){el('dropRenderCount').disabled=true;el('dropRenderCount').max='100';}
 if(el('dropRenderControls'))el('dropRenderControls').style.display='none';if(el('bestDropsRender')){el('bestDropsRender').disabled=true;el('bestDropsRender').style.display='none';}
 if(message&&el('dropResult'))el('dropResult').textContent=message;
}
function bestDropBeatInterval(result){var beat=Number(result&&result.beatInterval)||0;if(!(beat>0)){var bpm=Number(result&&result.tempo)||0;if(bpm>0)beat=60/bpm;}return beat>0?beat:0;}
function bestDropListText(cache){
 var w=cache&&cache.windows||[],limit=Math.min(w.length,100),rows=[];
 rows.push('ANALYSIS COMPLETE');
 rows.push('Detected structure drops: '+cache.structureCount);
 rows.push('Valid renderable Best Drops: '+w.length);
 rows.push('Sensitivity: '+String(cache.sensitivity||'balanced').toUpperCase());
 rows.push('Window: exactly '+cache.preBeats+' beats BEFORE + exactly '+cache.postBeats+' beats AFTER main drop.');
 rows.push('Type how many top-ranked drops you want to render (1–'+Math.min(100,w.length)+').');
 rows.push('');
 for(var i=0;i<limit;i++){var x=w[i];rows.push('#'+(i+1)+' · drop '+dropClock(x.drop_time)+' · '+cache.preBeats+' beats before + '+cache.postBeats+' beats after · '+x.confidence+' · score '+Number(x.score||0).toFixed(1));}
 if(w.length>limit)rows.push('… '+(w.length-limit)+' more valid drops.');
 return rows.join('\n');
}
async function analyzeBestDrops(){
 if(busy||pending||!ready)return;if(!requireEntitlement())return;
 setActiveTool('drop');clearBestDropCache();
 busy=true;stopRequested=false;job=null;started=Date.now();analysisState={cancelled:false,process:null,request:null};controls();
 el('dropResult').textContent='Analyzing the complete A1 track. Rendering will stay disabled until analysis is finished.';el('dropInfo').innerHTML='<strong>Analyzing A1…</strong> Counting valid main-drop windows before you choose how many to render.';state('Best Drops: analyzing A1 music…',false,'running');
 try{
  var a1=await call('rp_getA1()'),result=null,reused=false;
  if(suggestion&&suggestion.snapshot&&suggestion.snapshot.signature===a1.signature&&window.RPAudio.fresh(a1,suggestion.fingerprint)&&suggestion.beats&&suggestion.beats.length){result=suggestion;reused=true;aiProgress(.45,'Best Drops · reusing current A1 analysis');}
  else{result=loadMasterMusicMap(a1);if(result){reused=true;suggestion=result;aiProgress(.45,'Best Drops · reusing locked Master Music Map');}else result=await window.RPAudio.run(a1,el('ffmpeg').value,analysisState,function(p,message){aiProgress(p*.58,'Best Drops · '+message);});}
  if(analysisState.cancelled)throw Error('Best Drop analysis stopped.');
  if(!result.beats||!result.beats.length)throw Error('No clear A1 beat grid was detected. Best Drop analysis needs a clearer music track.');
  
  result=await prepareMusicMap(result,a1.duration);result.snapshot=a1;saveMasterMusicMap(result,a1);suggestion=result;showMusic(result);var beat=bestDropBeatInterval(result);if(!(beat>0))throw Error('Best Drops could not resolve a stable BPM/beat interval. Use a clearer A1 music track.');
  var sensitivity=dropSensitivity(),preBeats=dropPreBeats(),postBeats=dropPostBeats();var dropEngine=window.RPMusicV12||window.RPMusicV10;if(!dropEngine||!dropEngine.candidates)throw Error('Auto Music Map V14 drop engine is unavailable. Reinstall this build.');var candidates=dropEngine.candidates(result,a1.duration,100);if(!candidates.length)throw Error('No valid drop candidates passed '+sensitivity.toUpperCase()+' sensitivity for the selected '+preBeats+'/'+postBeats+' beat window.');
  aiProgress(.62,'Best Drops · ranking '+candidates.length+' valid candidates…');
  var ranked={selections:candidates.map(function(c){return {candidate_id:c.id,reason:'Auto Music Map confidence '+c.confidence_score+'%'};})};
  if(analysisState.cancelled)throw Error('Best Drop analysis stopped.');
  var windows=dropEngine.windows(result,ranked.selections,candidates,a1.duration,a1.frame);if(!windows.length)throw Error('No valid Best Drop windows remained after beat-grid validation for '+preBeats+' beats before and '+postBeats+' beats after.');
  bestDropCache={signature:a1.signature,a1:a1,result:result,candidates:candidates,ranked:ranked,windows:windows,beatInterval:beat,sensitivity:sensitivity,preBeats:preBeats,postBeats:postBeats,structureCount:result.structure&&result.structure.drop_count?result.structure.drop_count:0,reused:reused,createdAt:Date.now()};
  var maxRender=Math.min(100,windows.length),input=el('dropRenderCount');input.max=String(maxRender);var current=Math.round(Number(input.value)||5);if(current<1)current=1;if(current>maxRender)current=maxRender;input.value=String(current);input.disabled=false;if(el('dropRenderControls'))el('dropRenderControls').style.display='block';if(el('bestDropsRender'))el('bestDropsRender').style.display='block';
  el('dropInfo').innerHTML='<strong>Analysis complete:</strong> '+windows.length+' valid Best Drops found'+(result.tempo?' at '+result.tempo+' BPM':'')+'. '+sensitivity.toUpperCase()+' sensitivity · '+preBeats+' beats before / '+postBeats+' after. Choose 1–'+maxRender+' to render. '+(reused?'Existing A1 analysis was reused; no second audio scan was needed.':'A1 was analyzed once and is cached for rendering.');
  el('dropResult').textContent=bestDropListText(bestDropCache);aiProgress(1,'Best Drops analysis complete · '+windows.length+' valid drops found');state('Best Drops analysis complete. Choose how many to render.',false,'success');
 }catch(e){clearBestDropCache('Best Drop analysis failed: '+e.message);state(e.message,true,'error');log(e.message);}
 finally{releaseJobResources(analysisState,'job-finished',false);analysisState=null;job=null;busy=false;controls();}
}
async function renderBestDrops(){
 if(busy||pending||!ready||!bestDropCache)return;if(!requireEntitlement())return;
 setActiveTool('drop');var maxRender=Math.min(100,bestDropCache.windows.length),requested=Math.round(Number(el('dropRenderCount').value));
 if(!isFinite(requested)||requested<1||requested>maxRender){state('Enter a render count between 1 and '+maxRender+' after analysis.',true,'error');return;}saveSetup();
 busy=true;stopRequested=false;job=null;started=Date.now();analysisState={cancelled:false,process:null,request:null};controls();
 try{
  var currentA1=await call('rp_getA1()');if(currentA1.signature!==bestDropCache.signature||!window.RPAudio.fresh(currentA1,bestDropCache.result.fingerprint)){clearBestDropCache('A1 or the sequence changed. Run Analyze Best Drops again.');throw Error('A1 or the sequence changed after Best Drop analysis. Analyze again before rendering.');}
  var windows=bestDropCache.windows.slice(0,requested);el('dropInfo').innerHTML='<strong>Rendering '+requested+' of '+bestDropCache.windows.length+' analyzed drops.</strong> No A1 re-analysis is being performed.';
  aiProgress(.08,'Best Drops · resolving H.264 export preset…');var exportSetup=await resolveAutoAMEPreset();
  var csv=windows.map(function(w){return [w.start,w.drop_time,w.end,bestDropCache.beatInterval,w.pre_beats,w.post_beats].join('|');}).join(',');
  aiProgress(.12,'Best Drops · launching Media Encoder and preparing exports…');
  var r=await call('rp_best15Begin('+quote(bestDropCache.signature)+','+quote(csv)+','+quote(exportSetup.preset)+')',HOST_STEP_TIMEOUT_MS);job=r;
  while(r.status==='running'){
   if(analysisState.cancelled){try{await call('rp_stop('+quote(r.id)+')',10000);}catch(stopError){}throw Error('Best Drop export stopped. Any already queued exports remain in Media Encoder.');}
   aiProgress(.12+.87*(r.done/Math.max(1,r.total)),'Best Drops · creating and queueing '+Math.min(r.done+1,r.total)+' / '+r.total);r=await call('rp_step('+quote(r.id)+')',HOST_STEP_TIMEOUT_MS);job=r;
  }
  if(r.status!=='done')throw Error(r.message||'Best Drop export queue failed.');
  aiProgress(1,'Best Drops queued to Adobe Media Encoder');el('dropInfo').innerHTML='<strong>Queued:</strong> '+r.queued+' / '+requested+' selected drops are rendering in Adobe Media Encoder.<br>'+r.outputFolder;
  el('dropResult').textContent=bestDropListText(bestDropCache)+'\n\nEXPORT QUEUED\n'+(r.outputs||[]).map(function(o){return '#'+o.rank+' → '+o.file;}).join('\n')+'\n\nOutput folder: '+r.outputFolder;
  state('Best Drops complete: '+r.queued+' contents sent to Media Encoder.',false,'success');log('Best Drops queued '+r.queued+' exports to '+r.outputFolder);
 }catch(e){state(e.message,true,'error');log(e.message);}
 finally{releaseJobResources(analysisState,'job-finished',false);analysisState=null;job=null;busy=false;controls();}
}
if(el('bestDropsAnalyze'))el('bestDropsAnalyze').onclick=analyzeBestDrops;
if(el('bestDropsRender'))el('bestDropsRender').onclick=renderBestDrops;

function podcastMappings(){
 var count=Number(el('podcastPeople').value)||2,parts=[],cams={},mics={};
 for(var i=1;i<=count;i++){
  var name=String(el('podName'+i).value||('Speaker '+i)).trim(),cam=Math.round(Number(el('podCam'+i).value)),mic=Math.round(Number(el('podMic'+i).value));
  if(!isFinite(cam)||cam<1)throw Error('Choose a valid Camera V for '+name+'.');if(!isFinite(mic)||mic<1)throw Error('Choose a valid Mic A for '+name+'.');
  if(cams[cam])throw Error('Each podcaster must use a different camera. V'+cam+' is assigned more than once.');if(mics[mic])throw Error('Each podcaster must use a different microphone track. A'+mic+' is assigned more than once.');
  cams[cam]=true;mics[mic]=true;parts.push({name:name,camera:cam-1,mic:mic-1,cameraLabel:'V'+cam,micLabel:'A'+mic});
 }
 return parts;
}
el('podcastRun').onclick=async function(){
 if(!PODCAST_ENABLED){if(el('menuPodcast'))el('menuPodcast').open=true;return;}
 setActiveTool('podcast');if(busy||pending||!ready)return;if(!requireEntitlement())return;
 var parts,wide,minShot;
 try{parts=podcastMappings();wide=Math.round(Number(el('podWideCam').value)||0);minShot=Number(el('podMinShot').value)||1.5;if(wide<0)throw Error('Wide / Master Camera must be 0 or a valid V track number.');if(wide>0){for(var wi=0;wi<parts.length;wi++)if(parts[wi].camera===wide-1)throw Error('Wide / Master camera must be different from the individual speaker cameras.');}if(!(minShot>=.5&&minShot<=10))throw Error('Minimum shot length must be between 0.5 and 10 seconds.');}
 catch(mapErr){state(mapErr.message,true,'error');return;}
 saveSetup();busy=true;stopRequested=false;job=null;started=Date.now();analysisState={cancelled:false,process:null,request:null};controls();
 progressFor('podcast',0,1,'Preparing podcast microphones…');el('podcastResult').textContent='Agent AI is analyzing microphone activity and identifying the active speaker…';state('Podcast AI: reading mapped microphone tracks…',false,'running');
 try{
  var trackCsv=parts.map(function(p){return p.mic+1;}).join(','),snap=await call('rp_podcastSnapshot('+quote(trackCsv)+')',20000);
  for(var p=0;p<parts.length;p++){if(parts[p].camera>=snap.videoTrackCount)throw Error(parts[p].cameraLabel+' does not exist in this sequence.');}
  if(wide>snap.videoTrackCount)throw Error('Wide / Master V'+wide+' does not exist in this sequence.');
  var plan=await window.RPPodcast.run(snap,parts,{ffmpeg:el('ffmpeg').value,wideCamera:wide>0?wide-1:-1,minShot:minShot},analysisState,function(x,message){progressFor('podcast',x,.65,Math.round(x/.65*100)+'% · '+message);state(message,false,'running');});
  if(analysisState.cancelled)throw Error('Podcast AI stopped.');
  var rows=[];for(var si=0;si<parts.length;si++)rows.push(parts[si].name+' · '+parts[si].cameraLabel+' / '+parts[si].micLabel+' · '+Math.round(plan.speakingSeconds[si])+'s selected');
  el('podcastResult').textContent='Podcast AI speaker plan: '+plan.segments.length+' camera sections\n'+rows.join('\n')+(wide>0?'\nWide/Master: V'+wide+' for overlap / long silence':'\nNo Wide/Master fallback')+'\n\n'+plan.segments.slice(0,80).map(function(seg){var who=seg.speaker>=0?parts[seg.speaker].name:(seg.speaker===-2?'Overlap / Wide':'Silence / Wide');return seg.start.toFixed(1)+'–'+seg.end.toFixed(1)+'s → V'+(seg.camera+1)+' · '+who;}).join('\n')+(plan.segments.length>80?'\n… '+(plan.segments.length-80)+' more sections':'');
  progressFor('podcast',.66,1,'Speaker plan ready · starting timeline edit…');state('Podcast AI: applying speaker camera plan…',false,'running');
  var cameraCsv=parts.map(function(x){return x.camera;});if(wide>0)cameraCsv.push(wide-1);var r=await call('rp_podcastBegin('+quote(plan.points.join(','))+','+quote(plan.choices.join(','))+','+quote(cameraCsv.join(','))+')',30000);job=r;
  while(r.status==='running'){
   if(analysisState.cancelled){r=await call('rp_stop('+quote(r.id)+')',10000);job=r;break;}
   r=await call('rp_step('+quote(r.id)+')',HOST_STEP_TIMEOUT_MS);job=r;
   var frac=r.total?r.done/Math.max(1,r.total):0;progressFor('podcast',.66+.34*frac,1,(r.done||0).toLocaleString()+' / '+(r.total||0).toLocaleString()+' '+(r.phase==='delete'?'pieces':'edit points')+' · '+(r.cuts||0)+' cuts · '+(r.removed||0)+' removed');
  }
  if(r.status==='done'){progressFor('podcast',1,1,'Complete · '+(r.cuts||0)+' cuts · '+(r.removed||0)+' unused pieces removed');state('Podcast AI complete: active speakers matched to their cameras.',false,'success');log('Podcast AI complete: '+(r.cuts||0)+' cuts, '+(r.removed||0)+' pieces removed.');}
  else if(r.status==='stopped')state(r.message||'Podcast AI stopped. Partial results remain.',false,'warning');else throw Error(r.message||'Podcast AI timeline edit failed.');
 }catch(e){state(e.message,true,'error');log('Podcast AI: '+e.message);}
 finally{releaseJobResources(analysisState,'podcast-finished',false);analysisState=null;job=null;busy=false;controls();heartbeatFor('podcast','Elapsed time: '+Math.round((Date.now()-started)/1000)+' seconds.');}
};

el('aiMarkerRun').onclick=async function(){
 setActiveTool('multi');
 if(busy||pending||!ready)return;if(!requireEntitlement())return;
 busy=true;stopRequested=false;job=null;suggestion=null;started=Date.now();analysisState={cancelled:false,process:null,request:null};controls();
 el('preview').textContent='Reading A1…';state('Analyzing A1 music…');
 try{
  var a1=await call('rp_getA1()');
  var result=loadMasterMusicMap(a1)||await window.RPAudio.run(a1,el('ffmpeg').value,analysisState,function(p,message){aiProgress(p,message);});if(analysisState.cancelled)throw Error('Analysis stopped.');result=await prepareMusicMap(result,a1.duration);saveMasterMusicMap(result,a1);
  if(!result.beats||!result.beats.length)throw Error('No clear A1 beats detected.');
  result.snapshot=a1;suggestion=result;showMusic(result);
  el('preview').textContent=result.beats.length+' beat candidates detected from A1'+(result.tempo?' · '+result.tempo+' BPM · '+result.tempoConfidence+' confidence':'')+(result.beatCount?' · '+result.beatCount+' beats detected':'')+'\nNo timeline markers were created. Click Generate / Revise Plan and the Auto Music Director will choose actual cut intervals from the music structure, beat/BPM and energy.';
  state('Music analysis ready. Selected pacing: '+pacingSelectionText()+'.',false,'success');log('A1 analysis complete: '+result.beats.length+' beat candidates.');
 }catch(e){state(e.message,true);log(e.message);}
 finally{releaseJobResources(analysisState,'analysis-finished',false);analysisState=null;busy=false;controls();}
};
async function applyAI(kind,progressBase,progressSpan){
 if((busy&&!autoDirector)||pending||!ready||!aiPlan)return;if(!requireEntitlement())return;
 busy=true;stopRequested=false;job=null;started=Date.now();analysisState={cancelled:false};progressBase=isFinite(Number(progressBase))?Number(progressBase):0;progressSpan=isFinite(Number(progressSpan))?Number(progressSpan):1;var applyProgress=function(p,m){aiProgress(progressBase+progressSpan*Math.max(0,Math.min(1,Number(p)||0)),m);};controls();state('Validating Agent AI camera plan…');
 try{
  if(!window.RPDirector.fresh(aiPlan.snapshot,aiPlan.fingerprint))throw Error('Camera media changed. Generate a new plan.');
  window.RPBeatFirst.validateHold(aiPlan.choices,aiPlan.snapshot.intervals,aiPlan.musicAnalysis||musicContext(suggestion));
  window.RPDirector.validateStructure(aiPlan.choices,aiPlan.structurePolicy);
  window.RPDirector.validateMinimumPhysicalTransitions(aiPlan.choices,aiPlan.snapshot.intervals,aiPlan.musicAnalysis||musicContext(suggestion));
  stageResumeCheckpoint(kind);
  state('Camera plan saved. Starting single-pass Premiere timeline edit…',false,'running');applyProgress(.015,'Camera plan checkpoint saved · single-pass apply');
  await call('rp_aiStage('+quote(aiPlan.snapshot.signature)+','+quote(aiPlan.snapshot.a1Signature)+','+quote(aiPlan.snapshot.points.join(','))+','+quote((aiPlan.enabledCameras||collectEnabledCameras()).join(','))+')',hostTimeout(180000,aiPlan.snapshot.points.length,60));
  for(var i=0;i<aiPlan.choices.length;i+=100){
   if(analysisState.cancelled)throw Error('Application cancelled before cutting.');
   await call('rp_aiUpload('+quote(aiPlan.choices.slice(i,i+100).map(function(c){return c.camera;}).join(','))+')',HOST_TIMEOUT_MS);
   applyProgress(.10*((i+Math.min(100,aiPlan.choices.length-i))/aiPlan.choices.length),'Preparing camera choices');
  }
  if(analysisState.cancelled)throw Error('Application cancelled before cutting.');
  // rp_aiApply clones the sequence as a backup before editing: allow time for very long sets.
  var r=await call('rp_aiApply('+quote(kind)+')',hostTimeout(180000,aiPlan.snapshot.points.length,20));job=r;syncResumeCheckpoint(r);
  if(autoDirector){
   while(r.status==='running'){
    if(analysisState.cancelled){r=await call('rp_stop('+quote(r.id)+')');job=r;syncResumeCheckpoint(r);throw Error('Agent AI Director stopped.');}
    r=await call('rp_step('+quote(r.id)+')',HOST_STEP_TIMEOUT_MS);job=r;syncResumeCheckpoint(r);
    if(r.total)updateResumeProgressOnly(r);
   }
   if(r.status!=='done')throw Error(r.message||'Agent AI cut failed.');
   clearResumeCheckpoint();state('Agent AI Director complete: winner cameras preserved and unused camera pieces removed safely.',false,'success');
   log('Full live set complete: '+(r.cuts||0)+' cuts · '+(r.removed||0)+' unused camera pieces removed · winners protected.');
   analysisState=null;aiPlan=null;busy=false;controls();
  }else{analysisState=null;aiPlan=null;update(r);}
 }catch(e){analysisState=null;busy=false;state(e.message,true);log(e.message);controls();}
}
if(el('resumeRun'))el('resumeRun').onclick=function(){resumeSavedMulticam(false);};
if(el('resumeCleanup'))el('resumeCleanup').onclick=function(){resumeSavedMulticam(false);};
if(el('resumeDiscard'))el('resumeDiscard').onclick=function(){if(window.confirm&&!window.confirm('Discard the saved Multicam checkpoint? This does not undo timeline changes already made.'))return;clearResumeCheckpoint();state('Saved Multicam checkpoint discarded. Timeline changes were not undone.',false,'warning');};
el('aiApply').onclick=function(){setActiveTool('multi');applyAI('angle');};
el('aiDelete').onclick=function(){setActiveTool('multi');applyAI('delete');};
el('aiExport').onclick=function(){
 if(busy||pending||!aiPlan)return;
 var report={version:'2.3.11.4-public-v18',engine:aiPlan.model,instructions:'Automatic music-driven editing; no prompt',selectedPacing:selectedPacingCadences(),dropCamera:selectedDropCamera()==null?'auto':'V'+(selectedDropCamera()+1),cameraRoles:aiPlan.roles,enabledCameras:aiPlan.enabledCameras||collectEnabledCameras(),musicAnalysis:aiPlan.musicAnalysis||musicContext(suggestion),pacing:aiPlan.pacing||suggestion&&suggestion.pacing||null,images:aiPlan.images,summary:aiPlan.summaries,choices:aiPlan.choices.map(function(c){var it=aiPlan.snapshot.intervals[c.id];return {start:it.start,end:it.end,camera:c.camera<0?null:'V'+(c.camera+1),confidence:c.confidence,reason:c.reason};})};
 pending=true;
 try{cs.evalScript("(function(){var f=File.saveDialog('Save Agent AI Director plan as JSON');return f?encodeURIComponent(f.fsName):'';})()",function(raw){
  pending=false;lastReply=Date.now();
  if(!raw)return;
  try{if(raw==='EvalScript error.')throw Error('Save dialog failed.');var file=decodeURIComponent(raw);if(!/\.json$/i.test(file))file+='.json';window.cep_node.require('fs').writeFileSync(file,JSON.stringify(report,null,2),'utf8');log('Agent AI plan exported.');}
  catch(e){state('Export failed: '+e.message,true);}
 });}catch(e){pending=false;state('Export failed: '+e.message,true);}
};

function formatTrialRemaining(ms){
 if(ms===null)return 'LIFETIME · ACTIVE';
 ms=Math.max(0,Number(ms)||0);var d=Math.floor(ms/86400000),h=Math.floor((ms%86400000)/3600000),m=Math.floor((ms%3600000)/60000);
 return ms>0?'TRIAL · '+d+'d '+h+'h '+m+'m remaining':'TRIAL EXPIRED';
}
function renderAccount(){
 var persistStatus=window.RPAccountAuth&&window.RPAccountAuth.status();if(el("accountStorageWarning")){el("accountStorageWarning").textContent=persistStatus&&persistStatus.storageWarning||"";el("accountStorageWarning").style.display=persistStatus&&persistStatus.storageWarning?"block":"none";}
 var a=window.RPAccountAuth?window.RPAccountAuth.status():{signedIn:false,busy:false,canUse:false,remainingMs:0};
 var gate=el('authGate'),bar=el('accountBar'),pr=a.profile||{};
 if(gate)gate.className='authgate'+(a.signedIn?' hidden':'');
 if(bar)bar.style.display=a.signedIn?'flex':'none';
 if(el('accountBarEmail'))el('accountBarEmail').textContent=a.signedIn?(a.email||'Signed-in Supabase account'):'Not signed in';
 if(el('accountBarTrial')){var ls=window.RPLicense&&window.RPLicense.status(),trialText=a.signedIn?(ls&&ls.accountLabel||formatTrialRemaining(a.remainingMs)):'SIGN IN REQUIRED';if(a.signedIn&&a.canUse&&a.remainingMs!==null&&a.remainingMs>0&&a.remainingMs<=259200000)trialText+=' · Lifetime US$200 available';el('accountBarTrial').textContent=trialText;}
 var lifetime=pr.license_status==='lifetime'||(a.entitlement&&a.entitlement.license_status==='lifetime');['accountBuyLifetime','accountCheckPayment'].forEach(function(id){var b=el(id);if(b)b.style.display=(a.signedIn&&!lifetime)?'':'none';});if(el('accountBarLogout'))el('accountBarLogout').style.display=a.signedIn?'':'none';
 if(el('gateLogin'))el('gateLogin').disabled=!!a.busy;if(el('gateResend'))el('gateResend').disabled=!!a.busy;if(el('gateForgot'))el('gateForgot').disabled=!!a.busy;
 if(el('gateCreate'))el('gateCreate').disabled=!!a.busy;if(el('gateGoogle'))el('gateGoogle').disabled=!!a.busy;if(el('gateYahoo'))el('gateYahoo').disabled=!!a.busy;
 if(el('gateCancelGoogle'))el('gateCancelGoogle').style.display=a.oauthPending?'':'none';
 if(a.signedIn&&!a.canUse&&pr.license_status==='expired')accountMessage('Your 7-day trial has expired. New-user Lifetime access is US$200 one-time.',true);
 controls();
}
function accountMessage(t,err){var g=el('gateMessage'),b=el('accountBarMessage');if(g){g.textContent=t;g.className='authstatus'+(err?' error':'');}if(b){b.textContent=t;b.className='accountmsg'+(err?' error':'');}}
function bindAccountUI(){
 if(!window.RPAccountAuth)return accountMessage('Account security module unavailable.',true);
 window.RPAccountAuth.onChange(renderAccount);
 el('gateForgot').onclick=async function(){var email=el('gateEmail').value.trim();if(!email)return accountMessage('Enter your email first, then press Forgot password.',true);accountMessage('Sending password reset email…');try{await window.RPAccountAuth.forgotPassword(email);accountMessage('Password reset email sent. Check your inbox and spam folder. After changing the password, return here and Sign In.');}catch(e){accountMessage(e.message,true);}};
 el('gateResend').onclick=async function(){var email=el('gateEmail').value.trim();accountMessage('Requesting confirmation email…');try{await window.RPAccountAuth.resendConfirmation(email);accountMessage('If this account still needs confirmation, check your inbox and spam folder. Already confirmed? Use Sign In.');}catch(e){accountMessage(window.RPAccountAuth.friendly(e),true);}};
 el('gateLogin').onclick=async function(){var email=el('gateEmail').value.trim(),pw=el('gatePassword').value;if(!email||!pw)return accountMessage('Enter your email and password.',true);accountMessage('Verifying account…');try{await window.RPAccountAuth.signIn(email,pw);renderAccount();var saved=window.RPAccountAuth.status();accountMessage(saved.storageWarning||'Access verified. Login saved for the next Premiere launch.',!!saved.storageWarning);}catch(e){accountMessage('Sign in failed: '+e.message,true);}};
 el('gateGoogle').onclick=async function(){accountMessage('Complete Google sign-in in your browser. Keep Premiere open; login will return here automatically.');try{await window.RPAccountAuth.social('google');renderAccount();var a=window.RPAccountAuth.status();accountMessage(a.storageWarning||(a.canUse?'Google login verified. Login saved for your next Premiere launch.':a.entitlement&&a.entitlement.reason==='UPDATE_REQUIRED'?'Google login verified. Update the plugin to continue.':'Google login verified. Your account does not currently have active plugin access.'),!a.canUse||!!a.storageWarning);}catch(e){accountMessage(e.message,true);}};
 el('gateCancelGoogle').onclick=function(){window.RPAccountAuth.cancelSocial();accountMessage('Google sign-in cancelled. You can retry or use email login.');};
 el('gateYahoo').onclick=async function(){accountMessage('Checking Yahoo sign-in…');try{await window.RPAccountAuth.social('yahoo');accountMessage('Complete Yahoo sign-in in the browser.');}catch(e){accountMessage(e.message,true);}};
 el('gateCreate').onclick=async function(){var email=el('gateEmail').value.trim(),pw=el('gatePassword').value;if(!email||pw.length<8)return accountMessage('Enter a valid email and password (minimum 8 characters).',true);var w=window.RPAccountAuth.signupWait?window.RPAccountAuth.signupWait():0;if(w>0)return accountMessage('Please wait '+Math.ceil(w/1000)+' seconds before requesting another verification email.',true);accountMessage('Creating trial account… Please click only once.');try{var r=await window.RPAccountAuth.signUp(email,pw);if(r&&r.signedIn){accountMessage('Verified. Trial activated on this device.');renderAccount();}else accountMessage('Verification sent. Open the email once, confirm it, then return and press Sign In. If you already created this account earlier, press Sign In now.');}catch(e){accountMessage(e.message,true);}};
 var paymentBusy=false;
 async function buyLifetime(){if(paymentBusy)return;var a=window.RPAccountAuth.status();if(!a.signedIn)return accountMessage('Sign in first, then press Buy Lifetime.',true);paymentBusy=true;var button=el('accountBuyLifetime');if(button)button.disabled=true;accountMessage('Creating Midtrans checkout…');try{var data=await window.RPAccountAuth.createLifetimeCheckout();var amount='IDR '+Number(data.gross_amount_idr).toLocaleString();if(!window.confirm('Lifetime license: US$'+data.display_price_usd+'\nPay '+amount+' through Midtrans?\nReview the payment methods in your browser before paying.'))return accountMessage('Checkout is ready. Payment has not been made.');if(!window.RPAccountAuth.openExternalUrl(data.checkout_url))throw Error('Could not open checkout. Please use Buy Lifetime on r-multicam.pages.dev.');accountMessage('Midtrans checkout opened for '+amount+'. After paying, press Check Payment. If no payment methods are available, contact support.');}catch(e){accountMessage('Checkout failed: '+e.message,true);}finally{paymentBusy=false;if(button)button.disabled=false;}}
 async function checkPayment(){if(paymentBusy)return;paymentBusy=true;accountMessage('Checking payment with Midtrans…');try{var result=await window.RPAccountAuth.reconcileLifetimePayment();renderAccount();var a=window.RPAccountAuth.status();if(a.entitlement&&a.entitlement.license_status==='lifetime')accountMessage('Lifetime Access is ACTIVE.');else accountMessage(result.status==='no_order'?'No payment order was found. Use Buy Lifetime to open checkout.':'No completed payment was verified yet. Check again after payment.');}catch(e){accountMessage('Payment check failed: '+e.message,true);}finally{paymentBusy=false;}}
 if(el('accountBuyLifetime'))el('accountBuyLifetime').onclick=buyLifetime;if(el('accountCheckPayment'))el('accountCheckPayment').onclick=checkPayment;
 el('accountBarLogout').onclick=function(){window.RPAccountAuth.signOut();accountMessage('Signed out. Plugin access is locked.');renderAccount();};
 window.RPAccountAuth.restore().then(function(){
 renderAccount();
 var a=window.RPAccountAuth.status();
 if(a.storageWarning)accountMessage(a.storageWarning,true);else if(a.signedIn&&a.canUse)accountMessage('Login restored automatically.');else if(!a.signedIn)accountMessage('Please sign in. Session status: '+a.restoreDiagnostic);
 else if(a.signedIn&&!a.canUse&&a.entitlement&&a.entitlement.license_status==='expired')accountMessage('Your 7-day trial has expired. New-user Lifetime access is US$200 one-time.',true);
});
 window.setInterval(renderAccount,30000);
 window.setInterval(function(){
  if(window.RPAccountAuth&&window.RPAccountAuth.status().signedIn){
   window.RPAccountAuth.refreshEntitlement().then(function(){renderAccount();}).catch(function(e){renderAccount();if(e&&e.code==='SESSION_REPLACED')accountMessage('Signed out: Your account was signed in on another device. Only one device can use this account at a time.',true);});
  }
 },60000);
 window.setInterval(function(){if(window.RPAccountAuth&&window.RPAccountAuth.status().signedIn)window.RPAccountAuth.heartbeat().catch(function(e){renderAccount();if(e&&e.code==='SESSION_REPLACED')accountMessage('Signed out: Your account was signed in on another device. Only one device can use this account at a time.',true);});},300000);
}

function renderHardwareInfo(){
 try{var os=window.cep_node.require('os'),proc=window.cep_node.require('process'),cpus=os.cpus?os.cpus():[],cpu=cpus&&cpus.length?cpus[0].model:'CPU',platform=proc.platform==='darwin'?'macOS':proc.platform==='win32'?'Windows':proc.platform,arch=proc.arch;var profile=window.RPResourceGuard&&window.RPResourceGuard.profile?window.RPResourceGuard.profile():null;var x=el('hardwareInfo');if(x)x.textContent='Agent AI Engine: '+platform+' · '+arch+' · '+cpu+' · '+(profile&&profile.lowMemory?'Low Memory mode: CPU frame decoding, 24 visual samples maximum, small timeline batches.':'Optional frame decoding uses hardware acceleration with CPU fallback.')+' Beat/BPM/drop timing is unchanged.';}catch(e){}
}

bootPremiereBridge();
try{renderLicense();}catch(e){state('UI init warning: '+e.message,true,'warning');}
try{bindAccountUI();}catch(e){state('Account UI warning: '+e.message,true,'warning');}
renderHardwareInfo();
dropLegacyMusicMapStorage();bindOnlineSettings();restoreSetup();bindSetupMemory();renderCameraToggles(restoredCameraSelection);renderResumePanel();
if(window.addEventListener)window.addEventListener('beforeunload',function(){
 saveSetup();el('aiKey').value='';if(el('onlineKey'))el('onlineKey').value='';if(analysisState){analysisState.cancelled=true;if(analysisState.process)analysisState.process.kill();if(analysisState.request)analysisState.request.destroy();}
});
window.setInterval(function(){
 if(busy){var wait=Math.floor((Date.now()-lastReply)/1000),hb='Running '+Math.floor((Date.now()-started)/1000)+' seconds'+(pending?' · waiting for Premiere '+wait+' seconds':'');if(pending&&wait>15)hb+=' · slow response; do not click again';heartbeatFor(activeTool,hb);}
},500);
renderToolState('multi','Ready.','ready');renderToolState('zoom','Ready.','ready');renderToolState('drop','Ready.','ready');
function bootPremiereBridge(){
 try{
  el('timeline').textContent='Connecting to Premiere · initializing CEP…';
  cs=new CSInterface();
  if(!window.__adobe_cep__||typeof window.__adobe_cep__.evalScript!=='function')throw Error('Adobe CEP evalScript API is unavailable.');
  var extPath='';try{extPath=cs.getSystemPath(SystemPath.EXTENSION)||'';}catch(pathErr){state('CEP path error: '+pathErr.message,true,'error');}
  var hostPath=(extPath?extPath.replace(/\\/g,'/')+'/jsx/host.jsx':'').replace(/'/g,"\\'");
  function probe(attempt){
   el('timeline').textContent='Connecting to Premiere · bridge probe '+attempt+'/3…';
   if(attempt>3){el('timeline').textContent='Premiere bridge failed';state('Premiere host could not start. Close Premiere completely, reopen it, then reopen this panel.',true);controls();return;}
   cs.evalScript("(typeof rp_ping==='function'?rp_ping():'__RP_HOST_MISSING__')",function(raw){
    lastReply=Date.now();
    if(raw&&raw!=='EvalScript error.'&&raw!=='__RP_HOST_MISSING__'){
     el('timeline').textContent='Premiere bridge connected · reading sequence…';
     renderLicense();refresh();window.setInterval(refresh,3000);window.setInterval(function(){renderLicense();controls();},60000);return;
    }
    if(!hostPath){el('timeline').textContent='Premiere bridge unavailable';state('Could not locate the extension host script.',true);return;}
    el('timeline').textContent='Starting Premiere bridge…';
    cs.evalScript("(function(){try{$.evalFile('"+hostPath+"');return (typeof rp_ping==='function'?rp_ping():'__RP_HOST_LOAD_FAILED__');}catch(e){return '__RP_HOST_ERROR__:'+e.toString();}})()",function(loadRaw){
      lastReply=Date.now();
      if(loadRaw&&loadRaw!=='EvalScript error.'&&loadRaw.indexOf('__RP_HOST_')!==0){renderLicense();refresh();window.setInterval(refresh,3000);window.setInterval(function(){renderLicense();controls();},60000);}
      else if(attempt<3)window.setTimeout(function(){probe(attempt+1);},500);
      else{el('timeline').textContent='Premiere bridge failed';state('Premiere host load failed: '+String(loadRaw||'no response'),true);controls();}
    });
   });
  }
  probe(1);
 }catch(e){el('timeline').textContent='Premiere bridge unavailable';state('CEP bridge unavailable: '+e.message,true);}
}
}());
