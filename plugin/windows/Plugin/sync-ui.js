/* Sync to Master Music (lifetime license): pick cameras from bins and/or video tracks, sync every clip to the
   A1 master with RPSync, review, then build a NEW synced sequence through the host (rp_syncBegin/rp_syncStep).
   The planning core (planCameras/analyze/buildRows/reportCsv) has no DOM so it can be tested outside Premiere. */
(function(root){
'use strict';
var S=function(){return root.RPSync;};
var LONG_CLIP=600; // seconds: clips longer than this also get an end excerpt for the drift check

// ---------------------------------------------------------------- planning core (no DOM)
/** selection: [{kind:'bin'|'track', key: bin path or track index, name}] -> cameras with clips to sync. */
function planCameras(sources,selection){
 var cams=[];
 (selection||[]).forEach(function(sel){
  var clips=[];
  if(sel.kind==='bin'){var bin=(sources.bins||[]).filter(function(b){return b.path===sel.key;})[0];if(!bin)return;bin.items.forEach(function(it){clips.push({nodeId:it.nodeId,name:it.name,file:it.file,sourceIn:0,sourceOut:null});});}
  else{var tr=(sources.tracks||[]).filter(function(t){return String(t.index)===String(sel.key);})[0];if(!tr)return;tr.clips.forEach(function(c){clips.push({nodeId:c.nodeId,name:c.name,file:c.file,sourceIn:c.inPoint,sourceOut:c.outPoint});});}
  if(clips.length)cams.push({name:String(sel.name||sel.key),kind:sel.kind,clips:clips});
 });
 // The A1 master itself is never a camera clip.
 var master={};(sources.sequence&&sources.sequence.a1||[]).forEach(function(c){master[norm(c.file)]=true;});
 cams.forEach(function(cam){cam.clips=cam.clips.filter(function(c){return !master[norm(c.file)];});});
 return cams.filter(function(c){return c.clips.length;});
}
function norm(f){var s=String(f||'').replace(/\\/g,'/');return /^[a-z]:\//i.test(s)?s.toLowerCase():s;}
function check(state){if(state&&state.cancelled)throw Error('Sync stopped.');}

/**
 * Decode the master and every camera clip, sync each camera. progress(p 0..1, message).
 * deps (tests only): {probe, decode} replace RPSync.probe / RPSync.decodeEnvelope.
 */
async function analyze(sources,cameras,ffmpeg,state,progress,deps){
 deps=deps||{};progress=progress||function(){};state=state||{};
 var R=S(),probe=deps.probe||R.probe,decode=deps.decode||R.decodeEnvelope,seq=sources.sequence,frame=Number(seq.frame);
 var total=cameras.reduce(function(n,c){return n+c.clips.length;},0)+(seq.a1||[]).length,done=0;
 function tick(msg){progress(Math.min(.98,done/Math.max(1,total)),msg);}
 // 1. Master on the sequence timeline, from the A1 clips as placed (In point + timeline start).
 var parts=[];
 for(var a=0;a<seq.a1.length;a++){check(state);var c1=seq.a1[a];tick('Reading the A1 master '+(a+1)+'/'+seq.a1.length);parts.push({start:c1.start,env:await decode(ffmpeg,c1.file,c1.input,c1.end-c1.start,state)});done++;}
 var master=R.prepareMaster(R.masterFromClips(parts,Number(seq.duration))),probes={},results=[];
 // 2. Cameras.
 for(var k=0;k<cameras.length;k++){
  var cam=cameras[k],clips=[],rows=[];
  for(var i=0;i<cam.clips.length;i++){
   check(state);var c=cam.clips[i],row={camera:k+1,cameraName:cam.name,nodeId:c.nodeId,name:c.name,file:c.file,sourceIn:Number(c.sourceIn)||0,sourceOut:c.sourceOut,status:'excluded',reason:''};rows.push(row);
   tick('Syncing '+cam.name+': '+c.name);
   try{
    var p=probes[c.file]||(probes[c.file]=await probe(ffmpeg,c.file,state));
    if(row.sourceOut==null||row.sourceOut>p.duration)row.sourceOut=p.duration;
    var len=row.sourceOut-row.sourceIn;
    if(!(len>frame)){row.reason='clip is empty';done++;continue;}
    if(!p.hasAudio){row.reason='no audio to sync';done++;continue;}
    var ex=R.excerptFor(len),entry={id:String(i),name:c.name,duration:len,sourceIn:row.sourceIn,created:p.created,excerptStart:row.sourceIn+ex.excerptStart,env:await decode(ffmpeg,c.file,row.sourceIn+ex.excerptStart,ex.excerptSeconds,state)};
    if(len>LONG_CLIP){var endStart=row.sourceIn+len-ex.excerptSeconds-Math.min(30,len*.05);entry.endExcerptStart=endStart;entry.endEnv=await decode(ffmpeg,c.file,endStart,ex.excerptSeconds,state);}
    clips.push(entry);row.entry=i;
   }catch(e){if(state.cancelled)throw e;row.reason=String(e.message||e);}
   done++;
  }
  check(state);
  var res=deps.sync?deps.sync(master,clips,{frame:frame}):await R.syncCameraAsync(master,clips,{frame:frame},state),byId={};res.clips.forEach(function(r){byId[r.id]=r;});
  rows.forEach(function(row){
   if(row.entry===undefined)return;var r=byId[String(row.entry)];delete row.entry;if(!r)return;
   row.status=r.status;row.offset=r.offset;row.confidence=r.confidence;row.method=r.method;row.reason=r.reason||'';row.drift=r.drift;
   if(row.offset!=null)row.start=Math.round((row.offset+row.sourceIn)*1e6)/1e6;
  });
  results.push({camera:k+1,name:cam.name,kind:cam.kind,clockAnchored:res.anchor!=null,rows:rows});
 }
 progress(1,'Sync analysis complete');
 return {sequenceName:seq.name,frame:frame,cameras:results};
}
/** Host plan rows: placed -> camera track (h|m); review with a position -> review lane (r). Others stay in the report. */
function buildRows(analysis){
 var rows=[];
 analysis.cameras.forEach(function(cam){cam.rows.forEach(function(r){
  if(r.start==null)return;
  if(r.status==='placed')rows.push([cam.camera,r.nodeId,r.sourceIn,r.sourceOut,r.start,r.confidence==='high'?'h':'m']);
  else if(r.status==='review')rows.push([0,r.nodeId,r.sourceIn,r.sourceOut,r.start,'r']);
 });});
 return rows.map(function(x){return x.map(function(v){return typeof v==='number'?String(Math.round(v*1e6)/1e6):String(v);}).join(',');}).join(';');
}
function summary(analysis){
 var s={placed:0,check:0,review:0,unplaced:0,excluded:0};
 analysis.cameras.forEach(function(cam){cam.rows.forEach(function(r){
  if(r.status==='placed'){s.placed++;if(r.confidence!=='high')s.check++;}
  else if(r.status==='review'){if(r.start!=null)s.review++;else s.unplaced++;}
  else s.excluded++;
 });});
 return s;
}
function reportCsv(analysis){
 // Quote fields with separators/newlines; neutralise leading = + - @ so spreadsheet apps never run a clip name as a formula.
 var esc=function(v){v=v==null?'':String(v);if(/^[=+\-@\t\r]/.test(v)&&!/^-?\d/.test(v))v="'"+v;return /[",\r\n]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v;};
 var lines=[['camera','clip','status','confidence','method','timeline_start_s','source_in_s','source_out_s','drift_s','reason','file'].join(',')];
 analysis.cameras.forEach(function(cam){cam.rows.forEach(function(r){
  var status=r.status==='placed'&&r.confidence!=='high'?'placed [CHECK]':r.status==='review'&&r.start==null?'not placed':r.status;
  lines.push([cam.name,r.name,status,r.confidence,r.method,r.start,r.sourceIn,r.sourceOut,r.drift,r.reason,r.file].map(esc).join(','));
 });});
 return lines.join('\r\n')+'\r\n';
}

// ---------------------------------------------------------------- panel (DOM)
// panel.js keeps its state in a closure and exposes window.RPPanel; everything below goes through it.
var ui={sources:null,analysis:null,state:null,jobId:null};
function $(id){return document.getElementById(id);}
function P(){return root.RPPanel;}
function isLifetime(){try{return !!(P()&&P().licenseCanUse()&&root.RPLicense&&root.RPLicense.status().mode==='lifetime');}catch(e){return false;}}
function host(code,timeoutMs){return new Promise(function(resolve,reject){P().invokeHost(code,function(r){if(r&&r.ok!==false)resolve(r);else reject(Error(r&&r.message||'Premiere did not answer.'));},timeoutMs);});}
function setState(text,kind){P().setActiveTool('sync');P().state(text,kind==='error',kind);}
function progress(p,msg){P().progressFor('sync',Math.round(p*100),100,Math.round(p*100)+'% · '+msg);}
function controls(){
 var life=isLifetime(),busy=!!(P()&&P().isBusy());
 if($('syncLocked'))$('syncLocked').style.display=life?'none':'block';
 if($('syncScan'))$('syncScan').disabled=busy||!life;
 if($('syncAnalyze'))$('syncAnalyze').disabled=busy||!life||!ui.sources;
 if($('syncBuild'))$('syncBuild').disabled=busy||!life||!ui.analysis;
 if($('syncReport'))$('syncReport').disabled=busy||!ui.analysis;
 if($('syncStop'))$('syncStop').disabled=!(busy&&P().activeTool()==='sync'&&ui.state&&!ui.state.cancelled);
 var inputs=$('syncSources')?$('syncSources').querySelectorAll('input'):[];for(var i=0;i<inputs.length;i++)inputs[i].disabled=busy;
}
function renderSources(src){
 var box=$('syncSources');box.textContent='';
 function row(kind,key,label,count,defName){
  var line=document.createElement('div');line.className='syncsource';
  var cb=document.createElement('input');cb.type='checkbox';cb.dataset.kind=kind;cb.dataset.key=String(key);
  var name=document.createElement('input');name.type='text';name.value=defName;name.dataset.role='name';name.title='Camera name';
  var info=document.createElement('span');info.textContent=label+' · '+count+' clip'+(count===1?'':'s');
  line.appendChild(cb);line.appendChild(name);line.appendChild(info);box.appendChild(line);
 }
 var title=function(t){var h=document.createElement('strong');h.textContent=t;box.appendChild(h);};
 var tracks=src.tracks.filter(function(t){return t.clips.length;}),bins=src.bins.filter(function(b){return b.items.length;});
 if(tracks.length){title('Video tracks (clips placed roughly, one camera per track)');tracks.forEach(function(t){row('track',t.index,'V'+(t.index+1),t.clips.length,t.name||('V'+(t.index+1)));});}
 if(bins.length){title('Bins (one bin per camera)');bins.forEach(function(b){row('bin',b.path,b.path,b.items.length,b.path.split('/').pop());});}
 if(!tracks.length&&!bins.length)box.textContent='No camera clips found in the video tracks or bins.';
}
function selection(){
 var out=[],lines=$('syncSources').querySelectorAll('.syncsource');
 for(var i=0;i<lines.length;i++){var cb=lines[i].querySelector('input[type=checkbox]'),nm=lines[i].querySelector('input[data-role=name]');if(cb.checked)out.push({kind:cb.dataset.kind,key:cb.dataset.key,name:(nm.value||'').trim()||cb.dataset.key});}
 return out;
}
function showResult(a){
 var s=summary(a),lines=['Synced '+a.cameras.length+' camera'+(a.cameras.length===1?'':'s')+':'];
 a.cameras.forEach(function(c){var n={placed:0,review:0,excluded:0};c.rows.forEach(function(r){n[r.status==='placed'?'placed':r.status==='review'?'review':'excluded']++;});lines.push('· '+c.name+(c.clockAnchored?' (camera clock used)':' (no trusted camera clock)')+': '+n.placed+' placed, '+n.review+' review, '+n.excluded+' excluded');});
 lines.push('');lines.push('On camera tracks: '+s.placed+(s.check?' ('+s.check+' marked [CHECK], quick look)':''));
 lines.push('Review track: '+s.review+(s.unplaced?' · not placed (no position at all): '+s.unplaced:'')+' · excluded: '+s.excluded);
 lines.push('Build creates a NEW sequence; the current one is not changed.');
 $('syncResult').textContent=lines.join('\n');
}
function begin(){ui.state={cancelled:false,process:null};P().setActiveTool('sync');P().setBusy(true);P().controls();}
function end(){ui.state=null;P().setBusy(false);P().controls();}
async function scan(){
 if(!P()||P().isBusy()||!isLifetime())return;begin();
 try{setState('Reading the sequence and bins…','running');ui.sources=await host('rp_syncSources()',60000);ui.analysis=null;renderSources(ui.sources);$('syncResult').textContent='Tick one source per camera, name it, then Analyze.';setState('Sources loaded.','success');}
 catch(e){setState(e.message,'error');}
 finally{end();}
}
async function analyzeClick(){
 if(!P()||P().isBusy()||!isLifetime()||!ui.sources)return;
 var cams=planCameras(ui.sources,selection());if(!cams.length){setState('Tick at least one camera source.','error');return;}
 begin();
 try{
  var ffmpeg=root.RPAudio.executable(P().ffmpegPath());
  ui.analysis=await analyze(ui.sources,cams,ffmpeg,ui.state,function(p,m){setState(m,'running');progress(p,m);});
  showResult(ui.analysis);setState('Sync analysis ready. Review, then build the synced sequence.','success');
 }catch(e){ui.analysis=null;setState(e.message,'error');}
 finally{end();}
}
async function build(){
 if(!P()||P().isBusy()||!isLifetime()||!ui.analysis)return;
 var rows=buildRows(ui.analysis);if(!rows){setState('Nothing to place: every clip was excluded.','error');return;}
 begin();
 try{
  var r=await host('rp_syncBegin('+P().quote(ui.analysis.sequenceName+' - Synced')+','+ui.analysis.cameras.length+','+P().quote(rows)+')',180000);
  ui.jobId=r.id;
  while(r.status==='running'){
   progress(r.total?r.done/r.total:0,r.message||'Placing camera clips');setState(r.message||'Placing camera clips','running');
   if(ui.state.cancelled){r=await host('rp_syncStop('+P().quote(ui.jobId)+')',30000);break;}
   r=await host('rp_syncStep('+P().quote(ui.jobId)+')',30000);
  }
  if(r.status==='done'){progress(1,r.message);setState(r.message,'success');}else setState(r.message||'Sync stopped.',r.status==='stopped'?'warning':'error');
 }catch(e){
  // The host job must not stay "running" after a failed call (timeout, busy bridge): stop it so a new sync can start.
  if(ui.jobId){try{await host('rp_syncStop('+P().quote(ui.jobId)+')',30000);}catch(stopError){}}
  setState(e.message+(ui.jobId?' The synced sequence is incomplete: delete it and build again. The original sequence is unchanged.':''),'error');
 }
 finally{ui.jobId=null;end();}
}
function saveReport(){
 if(!ui.analysis)return;
 try{
  var fs=root.cep_node.require('fs'),path=root.cep_node.require('path'),os=root.cep_node.require('os'),now=new Date(),pad=function(n){return (n<10?'0':'')+n;};
  var stamp=now.getFullYear()+pad(now.getMonth()+1)+pad(now.getDate())+'-'+pad(now.getHours())+pad(now.getMinutes())+pad(now.getSeconds());
  var dir=ui.sources&&ui.sources.projectPath?path.dirname(ui.sources.projectPath):os.homedir(),file=path.join(dir,String(ui.analysis.sequenceName).replace(/[\\/:*?"<>|]/g,'_')+' - sync report '+stamp+'.csv');
  fs.writeFileSync(file,'﻿'+reportCsv(ui.analysis),{encoding:'utf8',flag:'wx'});setState('Sync report saved: '+file,'success');
 }catch(e){setState('Could not save the report: '+e.message,'error');}
}
function stop(){if(ui.state){ui.state.cancelled=true;if(ui.state.process)try{ui.state.process.kill();}catch(e){}}if(P())P().setStopRequested(true);controls();}
function wire(){
 if(!$('menuSync'))return;
 $('syncScan').onclick=scan;$('syncAnalyze').onclick=analyzeClick;$('syncBuild').onclick=build;$('syncReport').onclick=saveReport;$('syncStop').onclick=stop;
 if($('syncBuyLifetime'))$('syncBuyLifetime').onclick=function(){if($('accountBuyLifetime'))$('accountBuyLifetime').click();};
 controls();
}
root.RPSyncUI={planCameras:planCameras,analyze:analyze,buildRows:buildRows,summary:summary,reportCsv:reportCsv,controls:controls,isLifetime:isLifetime,stop:stop};
if(typeof document!=='undefined'){if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',wire);else wire();}
if(typeof module!=='undefined'&&module.exports)module.exports=root.RPSyncUI;
}(typeof window!=='undefined'?window:globalThis));
