/* Sync to Master Music (lifetime license): pick cameras from bins and/or video tracks, sync every clip to the
   A1 master with RPSync, review, then build a NEW synced sequence through the host (rp_syncBegin/rp_syncStep).
   A source whose clips have video but no audio is a drone: once the cameras with audio are synced, RPDroneSync
   places its clips from their camera clock ([CLOCK]) and groups them into flights for one-click correction.
   The planning core (planCameras/analyze/buildRows/reportCsv) has no DOM so it can be tested outside Premiere. */
(function(root){
'use strict';
var S=function(){return root.RPSync;},DS=function(){return root.RPDroneSync;};
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
function base(f){return String(f||'').replace(/^.*[\\/]/,'');}
/** Remembered drone clock offsets: {key: {offset, at}} in the plugin data folder (same place as step timing). */
function learnedFile(){var n=root.cep_node;if(!n)return null;var path=n.require('path'),os=n.require('os'),proc=n.require('process');
 return proc.platform==='darwin'?path.join(os.homedir(),'Library','Application Support','RProjectMulticamAI','drone-offsets.json'):path.join(proc.env.LOCALAPPDATA||os.homedir(),'RProjectMulticamAI','drone-offsets.json');}
function loadLearned(strict){
 var f=learnedFile();if(!f)return {};var fs=root.cep_node.require('fs');if(!fs.existsSync(f))return {};
 try{var d=JSON.parse(fs.readFileSync(f,'utf8'));if(d&&typeof d==='object'&&!Array.isArray(d))return d;throw Error('not an object');}
 catch(e){if(strict){try{fs.renameSync(f,f+'.bad-'+Date.now());}catch(e2){}}return {};}
}
/** One offset per shoot day under each key ({offset, at, shots: {day: {offset, at}}}). The top-level offset/at mirror the
    newest shoot day, which is what builds before per-day memory read. offset null forgets that day (or the whole key when
    no day is given or none is left). */
function saveLearned(key,offset,day,refName){
 var f=learnedFile();if(!f||!key)return false;var fs=root.cep_node.require('fs'),path=root.cep_node.require('path'),d=loadLearned(true); // an unreadable file is kept aside, not overwritten
 var e=d[key]&&typeof d[key]==='object'?d[key]:{},shots=e.shots&&typeof e.shots==='object'?e.shots:{},v=null;
 if(offset!==null){v={offset:Math.round(Number(offset)*1000)/1000,at:new Date().toISOString()};if(day)shots[day]=v;}else if(day)delete shots[day];
 var days=Object.keys(shots).sort(),top=days.length?shots[days[days.length-1]]:v;
 if(!top||(offset===null&&!day))delete d[key];else{d[key]={offset:top.offset,at:top.at,shots:shots};var rn=refName||e.refName;if(rn)d[key].refName=String(rn);}
 fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f+'.tmp',JSON.stringify(d,null,1),'utf8');
 try{fs.renameSync(f+'.tmp',f);}catch(e){try{fs.unlinkSync(f);fs.renameSync(f+'.tmp',f);}catch(e2){try{fs.unlinkSync(f+'.tmp');}catch(e3){}throw e2;}}
 return true;
}
function norm(f){var s=String(f||'').replace(/\\/g,'/');return /^[a-z]:\//i.test(s)?s.toLowerCase():s;}
function check(state){if(state&&state.cancelled)throw Error('Sync stopped.');}

/**
 * Decode the master and every camera clip, sync each camera. progress(p 0..1, message).
 * deps (tests only): {probe, decode} replace RPSync.probe / RPSync.decodeEnvelope.
 */
/* Read-ahead jobs stop as soon as analyze ends, whether it finished, failed or was cancelled. */
async function analyze(sources,cameras,ffmpeg,state,progress,deps){var ctl={stopped:false};try{return await analyzeRun(sources,cameras,ffmpeg,state,progress,deps,ctl);}finally{ctl.stopped=true;}}
async function analyzeRun(sources,cameras,ffmpeg,state,progress,deps,ctl){
 deps=deps||{};progress=progress||function(){};state=state||{};
 var R=S(),probe=deps.probe||R.probe,decode=deps.decode||R.decodeEnvelope,seq=sources.sequence,frame=Number(seq.frame);
 var total=cameras.reduce(function(n,c){return n+c.clips.length;},0)+(seq.a1||[]).length,done=0;
 function tick(msg){progress(Math.min(.98,done/Math.max(1,total)),msg);}
 // Read-ahead: the FFmpeg probe/decode jobs run one at a time in the original order (one reader: parallel readers
 // made a hard disk ~1.5x slower) but no longer wait for the sync work below, so the next camera decodes while the
 // previous one is matched. At most AHEAD jobs are held ahead of use (memory). Same jobs, same order, same results.
 var AHEAD=6,jobs=[],started=0,used=0,chain=Promise.resolve(),probes={};
 function pump(){while(started<jobs.length&&started<used+AHEAD){var j=jobs[started++];j.promise=chain=chain.then(j.run,j.run);j.promise.catch(function(){});}}
 function take(i){used=i+1;pump();return jobs[i].promise;}
 function add(run){jobs.push({run:function(){if(state.cancelled||ctl.stopped)throw Error('Sync stopped.');return run();}});}
 function probeOnce(file){return probes[file]||(probes[file]=Promise.resolve(probe(ffmpeg,file,state)).then(null,function(e){delete probes[file];throw e;}));}
 seq.a1.forEach(function(c1){add(function(){return decode(ffmpeg,c1.file,c1.input,c1.end-c1.start,state);});});
 cameras.forEach(function(cam){cam.clips.forEach(function(c){add(function(){return probeOnce(c.file).then(function(p){
  var sourceIn=Number(c.sourceIn)||0,sourceOut=c.sourceOut==null||c.sourceOut>p.duration?p.duration:c.sourceOut,len=sourceOut-sourceIn;
  if(!(len>frame)||!p.hasAudio)return {p:p};var ex=R.excerptFor(len);
  return Promise.resolve(decode(ffmpeg,c.file,sourceIn+ex.excerptStart,ex.excerptSeconds,state)).then(function(env){
   if(!(len>LONG_CLIP))return {p:p,env:env};var endStart=sourceIn+len-ex.excerptSeconds-Math.min(30,len*.05);
   return Promise.resolve(decode(ffmpeg,c.file,endStart,ex.excerptSeconds,state)).then(function(endEnv){return {p:p,env:env,endEnv:endEnv,endStart:endStart};});}).then(null,function(e){if(state.cancelled)throw e;return {p:p,error:e};});});});});});
 // 1. Master on the sequence timeline, from the A1 clips as placed (In point + timeline start).
 var parts=[],jobAt=0;
 for(var a=0;a<seq.a1.length;a++){check(state);var c1=seq.a1[a];tick('Reading the A1 master '+(a+1)+'/'+seq.a1.length);parts.push({start:c1.start,env:await take(jobAt++)});done++;}
 var master=R.prepareMaster(R.masterFromClips(parts,Number(seq.duration))),results=[];
 // 2. Cameras.
 for(var k=0;k<cameras.length;k++){
  var cam=cameras[k],clips=[],rows=[],silent=[],make='',model='',serial='';
  for(var i=0;i<cam.clips.length;i++){
   check(state);var c=cam.clips[i],row={camera:k+1,cameraName:cam.name,nodeId:c.nodeId,name:c.name,file:c.file,sourceIn:Number(c.sourceIn)||0,sourceOut:c.sourceOut,status:'excluded',reason:''};rows.push(row);
   tick('Syncing '+cam.name+': '+c.name);
   try{
    var got=await take(jobAt++),p=got.p;if(!make&&p.make)make=p.make;if(!model&&p.model)model=p.model;if(!serial&&p.serial)serial=p.serial;
    if(row.sourceOut==null||row.sourceOut>p.duration)row.sourceOut=p.duration;
    if(got.error)throw got.error;
    var len=row.sourceOut-row.sourceIn;
    if(!(len>frame)){row.reason='clip is empty';done++;continue;}
    if(!p.hasAudio){row.reason='no audio to sync';if(p.hasVideo!==false)silent.push({row:row,id:String(i),name:c.name,fileName:base(c.file),created:p.created,sourceIn:row.sourceIn,duration:row.sourceOut});done++;continue;}
    var ex=R.excerptFor(len),entry={id:String(i),name:c.name,fileName:base(c.file),duration:len,mediaDuration:p.duration,sourceIn:row.sourceIn,created:p.created,excerptStart:row.sourceIn+ex.excerptStart,env:got.env};
    if(len>LONG_CLIP){entry.endExcerptStart=got.endStart;entry.endEnv=got.endEnv;}
    clips.push(entry);row.entry=i;
   }catch(e){if(state.cancelled)throw e;row.reason=String(e.message||e);}
   done++;
  }
  check(state);
  // Only silent clips (a drone): placed from its camera clock after every camera with audio is synced.
  if(!clips.length&&silent.length){results.push({camera:k+1,name:cam.name,kind:cam.kind,drone:true,make:make,model:model,serial:serial,silent:silent,rows:rows});continue;}
  var res=deps.sync?deps.sync(master,clips,{frame:frame}):await R.syncCameraAsync(master,clips,{frame:frame},state),byId={};res.clips.forEach(function(r){byId[r.id]=r;});
  rows.forEach(function(row){
   if(row.entry===undefined)return;var r=byId[String(row.entry)];delete row.entry;if(!r)return;
   row.status=r.status;row.offset=r.offset;row.confidence=r.confidence;row.method=r.method;row.reason=r.reason||'';row.drift=r.drift;
   if(row.offset!=null)row.start=Math.round((row.offset+row.sourceIn)*1e6)/1e6;
  });
  results.push({camera:k+1,name:cam.name,kind:cam.kind,clockAnchored:res.anchor!=null,anchor:res.anchor,make:make,model:model,serial:serial,zone:DS()?DS().deviceZone(clips):null,placed:rows.filter(function(r){return r.status==='placed';}).length,rows:rows});
 }
 planDrones(results,Number(seq.duration),frame,deps.learned||loadLearned());
 progress(1,'Sync analysis complete');
 return {sequenceName:seq.name,sequenceID:seq.id||'',a1Signature:seq.a1Signature||'',frame:frame,cameras:results};
}
/** Drone cameras: bridge their camera clock through the audio-synced cameras (RPDroneSync.planDrone). */
function planDrones(results,musicDuration,frame,learned){
 var D=DS(),clocked=results.filter(function(c){return !c.drone;}).map(function(c){return {name:c.name,make:c.make,model:c.model,serial:c.serial,anchor:c.anchor==null?NaN:c.anchor,zone:c.zone,placed:c.placed};});
 // Two drones of one model whose files carry no serial would share one remembered offset: tell them apart by name.
 var models={};results.forEach(function(c){if(c.drone&&!c.serial&&(c.model||c.make)){var m=c.model||c.make;models[m]=(models[m]||0)+1;}});
 results.forEach(function(cam){
  if(!cam.drone)return;var silent=cam.silent;delete cam.silent;
  if(!D){cam.warnings=['Drone sync module is missing.'];return;}
  var plan=D.planDrone({name:cam.name,make:cam.make,model:cam.model,serial:cam.serial,sameModel:!cam.serial&&models[cam.model||cam.make]>1,clips:silent.map(function(x){return {id:x.id,name:x.name,fileName:x.fileName,created:x.created,sourceIn:x.sourceIn,duration:x.duration};})},clocked,{musicDuration:musicDuration,frame:frame,learned:learned||{}}),byId={};
  plan.clips.forEach(function(p){byId[p.id]=p;});
  silent.forEach(function(x){var p=byId[x.id],row=x.row;if(!p)return;row.flight=p.flight;row.method='clock';row.reason=p.reason||'';
   if(p.status==='placed'){row.status='placed';row.confidence='clock';row.start=Math.round((p.start+row.sourceIn)*1e6)/1e6;}else row.status='excluded';});
  cam.reference=plan.reference;cam.flights=plan.flights;cam.warnings=plan.reference?plan.warnings:bridgeHint(D,cam,results,learned||{});cam.key=plan.key;cam.shootDay=plan.shootDay||'';cam.learned=plan.learned;
 });
}
/** No camera clock to bridge a drone from: say which camera to tick. The drone memory knows the camera (model and
    serial, plus its source name once a correction was saved) this drone was bridged through before. */
function bridgeHint(D,cam,results,learned){
 var probe=D.offsetKey?D.offsetKey({name:cam.name,make:cam.make,model:cam.model,serial:cam.serial},{model:''}):'',cut=probe.indexOf(' -> '),prefix=cut>=0?probe.slice(0,cut+4):'',best=null;
 if(prefix)Object.keys(learned).forEach(function(k){var e=learned[k];if(k.indexOf(prefix)===0&&e&&(!best||String(e.at||'')>String(best.at||'')))best={ref:k.slice(prefix.length),at:e.at,refName:e.refName||''};});
 var tail=' It has to sync by audio (placed, not only review); then click 2. Analyze sync again.';
 if(!best)return ['No camera clock to bridge from: tick at least one camera with clear audio of the music.'+tail];
 var m=/^(.*?)(?: #(.+))?$/.exec(best.ref),model=m[1],serial=m[2]||'',short=serial?' #'+serial.slice(0,8):'';
 var same=results.filter(function(c){return !c.drone&&(c.model||c.make)===model&&(!serial||!c.serial||c.serial===serial);});
 if(same.length)return ['No camera clock to bridge from: '+same.map(function(c){return '"'+c.name+'"';}).join(', ')+' is the camera this drone was bridged through before ('+model+short+'), but none of its clips synced by audio with a trusted clock (review only). Tick a bin of that camera with clear audio of the music, or another audio-synced camera.'+tail];
 return ['No camera clock to bridge from: tick '+(best.refName?'"'+best.refName+'" ('+model+short+')':'the '+model+short+' camera')+' - this drone was bridged through it before.'+tail];
}
/** Sources that look like a drone (or were remembered as one) but are not ticked. */
function untickedDrones(sources,picked,learned){
 if(!sources)return [];var on={},out=[],re=/drone|fpv|mavic|avata|phantom|inspire|air ?[23]s?|mini ?[2-5]/i;
 (picked||[]).forEach(function(p){on[p.kind+':'+p.key]=true;});
 var known=Object.keys(learned||{}).map(function(k){var x=/^source "(.*)" -> /.exec(k);return x?x[1].toLowerCase():null;}).filter(Boolean);
 (sources.bins||[]).forEach(function(b){if(!b.items||!b.items.length||on['bin:'+b.path])return;var nm=String(b.path).split('/').pop();if(re.test(nm)||known.indexOf(nm.toLowerCase())>=0)out.push('Bin "'+nm+'" ('+b.items.length+' clip'+(b.items.length===1?'':'s')+') looks like drone footage but is not ticked, so it is not synced. Tick it and click 2. Analyze sync again.');});
 (sources.tracks||[]).forEach(function(t){if(!t.clips||!t.clips.length||on['track:'+t.index]||!t.name||!re.test(t.name))return;out.push('Track "'+t.name+'" (V'+(t.index+1)+') looks like drone footage but is not ticked, so it is not synced.');});
 return out;
}
/** Host plan rows: placed -> camera track (h|m, c = drone by camera clock); review with a position -> review lane (r). Others stay in the report. */
function buildRows(analysis){
 var rows=[];
 analysis.cameras.forEach(function(cam){cam.rows.forEach(function(r){
  if(r.start==null)return;
  if(r.status==='placed')rows.push([cam.camera,r.nodeId,r.sourceIn,r.sourceOut,r.start,r.confidence==='high'?'h':r.confidence==='clock'?'c':'m']);
  else if(r.status==='review')rows.push([0,r.nodeId,r.sourceIn,r.sourceOut,r.start,'r']);
 });});
 return rows.map(function(x){return x.map(function(v){return typeof v==='number'?String(Math.round(v*1e6)/1e6):String(v);}).join(',');}).join(';');
}
function summary(analysis){
 var s={placed:0,check:0,clock:0,review:0,unplaced:0,excluded:0};
 analysis.cameras.forEach(function(cam){cam.rows.forEach(function(r){
  if(r.status==='placed'){s.placed++;if(r.confidence==='clock')s.clock++;else if(r.confidence!=='high')s.check++;}
  else if(r.status==='review'){if(r.start!=null)s.review++;else s.unplaced++;}
  else s.excluded++;
 });});
 return s;
}
function reportCsv(analysis){
 // Quote fields with separators/newlines; neutralise leading = + - @ so spreadsheet apps never run a clip name as a formula.
 var esc=function(v){v=v==null?'':String(v);if(/^[=+\-@\t\r]/.test(v)&&!/^-?\d/.test(v))v="'"+v;return /[",\r\n]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v;};
 var lines=[['camera','clip','status','confidence','method','timeline_start_s','source_in_s','source_out_s','drift_s','reason','file','flight'].join(',')];
 analysis.cameras.forEach(function(cam){cam.rows.forEach(function(r){
  var status=r.status==='placed'&&r.confidence==='clock'?'placed [CLOCK]':r.status==='placed'&&r.confidence!=='high'?'placed [CHECK]':r.status==='review'&&r.start==null?'not placed':r.status;
  lines.push([cam.name,r.name,status,r.confidence,r.method,r.start,r.sourceIn,r.sourceOut,r.drift,r.reason,r.file,r.flight==null||r.flight<0?'':r.flight+1].map(esc).join(','));
 });});
 return lines.join('\r\n')+'\r\n';
}

// ---------------------------------------------------------------- panel (DOM)
// panel.js keeps its state in a closure and exposes window.RPPanel; everything below goes through it.
var ui={sources:null,analysis:null,state:null,jobId:null,built:null};
function $(id){return document.getElementById(id);}
function P(){return root.RPPanel;}
function isLifetime(){try{return !!(P()&&P().licenseCanUse()&&root.RPLicense&&root.RPLicense.status().mode==='lifetime');}catch(e){return false;}}
function host(code,timeoutMs){return new Promise(function(resolve,reject){P().invokeHost(code,function(r){if(r&&r.ok!==false)resolve(r);else reject(Error(r&&r.message||'Premiere did not answer.'));},timeoutMs);});}
function setState(text,kind){P().setActiveTool('sync');P().state(text,kind==='error',kind);}
function progress(p,msg){P().progressFor('sync',Math.round(p*100),100,Math.round(p*100)+'% · '+msg);}
function controls(){
 var life=isLifetime(),busy=!!(P()&&P().isBusy());
 if($('syncLocked'))$('syncLocked').style.display=life?'none':'block';
 // Offer the purchase only while the account's Buy Lifetime button is offered (online checkout open).
 if($('syncBuyLifetime')){var buy=$('accountBuyLifetime');$('syncBuyLifetime').style.display=buy&&buy.style.display!=='none'?'':'none';}
 if($('syncScan'))$('syncScan').disabled=busy||!life;
 if($('syncAnalyze'))$('syncAnalyze').disabled=busy||!life||!ui.sources;
 if($('syncBuild'))$('syncBuild').disabled=busy||!life||!ui.analysis;
 if($('syncReport'))$('syncReport').disabled=busy||!ui.analysis;
 if($('syncStop'))$('syncStop').disabled=!(busy&&P().activeTool()==='sync'&&ui.state&&!ui.state.cancelled);
 var dronebtn=$('syncDrone')?$('syncDrone').querySelectorAll('button,select'):[];for(var b=0;b<dronebtn.length;b++)dronebtn[b].disabled=busy||!life||!ui.built;
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
 var s=summary(a),lines=['Synced '+a.cameras.length+' camera'+(a.cameras.length===1?'':'s')+':'],miss=untickedDrones(ui.sources,ui.picked,loadLearned());
 miss.forEach(function(w){lines.push('! '+w);});
 a.cameras.forEach(function(c){var n={placed:0,review:0,excluded:0};c.rows.forEach(function(r){n[r.status==='placed'?'placed':r.status==='review'?'review':'excluded']++;});
  if(c.drone){lines.push('· '+c.name+' (drone, no audio'+(c.reference?'; camera clock bridged through '+c.reference:'')+'): '+n.placed+' placed [CLOCK], '+n.excluded+' excluded'+(c.flights&&c.flights.length?' · '+c.flights.length+' flight'+(c.flights.length===1?'':'s'):''));if(c.learned)lines.push('  remembered drone clock offset '+(c.learned.offset>=0?'+':'')+c.learned.offset.toFixed(2)+' s'+(c.learned.day?' (from the '+c.learned.day+' shoot'+(c.learned.day!==c.shootDay?', nearest to this one':'')+')':c.learned.at?' (saved '+String(c.learned.at).slice(0,10)+')':'')+' applied');(c.warnings||[]).forEach(function(w){lines.push('  ! '+w);});return;}
  lines.push('· '+c.name+(c.clockAnchored?' (camera clock used)':' (no trusted camera clock)')+': '+n.placed+' placed, '+n.review+' review, '+n.excluded+' excluded');});
 lines.push('');lines.push('On camera tracks: '+s.placed+(s.check?' ('+s.check+' marked [CHECK], quick look)':'')+(s.clock?' · drone [CLOCK]: '+s.clock+' (about ±0.5 s; correct one clip per flight after building)':''));
 lines.push('Review track: '+s.review+(s.unplaced?' · not placed (no position at all): '+s.unplaced:'')+' · excluded: '+s.excluded);
 lines.push('Build creates a NEW sequence; the current one is not changed.');
 $('syncResult').textContent=lines.join('\n');
}
function begin(){ui.state={cancelled:false,process:null};P().setActiveTool('sync');P().setBusy(true);P().controls();}
function end(){ui.state=null;P().setBusy(false);P().controls();}
async function scan(){
 if(!P()||P().isBusy()||!isLifetime())return;begin();
 try{setState('Reading the sequence and bins…','running');ui.sources=await host('rp_syncSources()',60000);ui.analysis=null;ui.built=null;renderDrones();renderSources(ui.sources);$('syncResult').textContent='Tick one source per camera, name it, then Analyze.';setState('Sources loaded.','success');}
 catch(e){setState(e.message,'error');}
 finally{end();}
}
async function analyzeClick(){
 if(!P()||P().isBusy()||!isLifetime()||!ui.sources)return;
 ui.picked=selection();var cams=planCameras(ui.sources,ui.picked);if(!cams.length){setState('Tick at least one camera source.','error');return;}
 ui.built=null;renderDrones();begin();
 try{
  // The sources (and the A1 master) were read at Find camera sources: make sure that is still the open sequence.
  var now=await host('rp_syncActive()',30000);
  if(String(now.sequenceID)!==String(ui.sources.sequence.id)||String(now.a1Signature)!==String(ui.sources.sequence.a1Signature))throw Error('The open sequence or its A1 master changed since 1. Find camera sources (now "'+now.name+'"). Click 1. Find camera sources again, then Analyze.');
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
  var r=await host('rp_syncBegin('+P().quote(ui.analysis.sequenceName+' - Synced')+','+ui.analysis.cameras.length+','+P().quote(rows)+','+P().quote(ui.analysis.sequenceID||'')+','+P().quote(ui.analysis.a1Signature||'')+')',180000);
  ui.jobId=r.id;
  while(r.status==='running'){
   progress(r.total?r.done/r.total:0,r.message||'Placing camera clips');setState(r.message||'Placing camera clips','running');
   if(ui.state.cancelled){r=await host('rp_syncStop('+P().quote(ui.jobId)+')',30000);break;}
   r=await host('rp_syncStep('+P().quote(ui.jobId)+')',30000);
  }
  if(r.status==='done'){progress(1,r.message);setState(r.message,'success');ui.built=builtDrones(ui.analysis,r.sequenceID);renderDrones();}else setState(r.message||'Sync stopped.',r.status==='stopped'?'warning':'error');
 }catch(e){
  // The host job must not stay "running" after a failed call (timeout, busy bridge): stop it so a new sync can start.
  if(ui.jobId){try{await host('rp_syncStop('+P().quote(ui.jobId)+')',30000);}catch(stopError){}}
  setState(e.message+(ui.jobId&&!/original sequence is unchanged/.test(e.message)?' The synced sequence is incomplete: delete it and build again. The original sequence is unchanged.':''),'error');
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
// ---------------------------------------------------------------- drone flight correction (after a build)
/** Flights of every drone camera that was placed, with each clip's current timeline start (kept up to date). */
/** Every drone camera that was placed, with each clip's planned and current position of its file time 0 ("zero")
    and where it sits. A drone has one clock, so one correction moves all of its clips (all flights). */
function builtDrones(analysis,sequenceID){
 var drones=[];
 (analysis&&analysis.cameras||[]).forEach(function(cam){if(!cam.drone)return;var clips=[];
  cam.rows.forEach(function(r){if(r.status!=='placed'||r.confidence!=='clock')return;var zero=Math.round((r.start-r.sourceIn)*1e6)/1e6;clips.push({nodeId:r.nodeId,name:r.name,flight:r.flight,start:Math.max(0,r.start),zero:zero,planZero:zero});});
  if(clips.length)drones.push({camera:cam.camera,track:cam.camera,cameraName:cam.name,reference:cam.reference||'',key:cam.key||'',shootDay:cam.shootDay||'',learnedDay:cam.learned?cam.learned.day||'':null,learnedOffset:cam.learned?Number(cam.learned.offset)||0:0,flights:(cam.flights||[]).filter(function(f){return f.placed;}).length,clips:clips});});
 return drones.length?{sequenceID:String(sequenceID||''),frame:Number(analysis.frame)||0.04,drones:drones}:null;
}
function clock(t){t=Math.max(0,Math.round(t));var h=Math.floor(t/3600),m=Math.floor(t/60)%60,s=t%60;return (h?h+':':'')+(h&&m<10?'0':'')+m+':'+(s<10?'0':'')+s;}
function renderDrones(){
 var box=$('syncDrone'),sel=$('syncFlight');if(!box||!sel)return;
 if(!ui.built){box.style.display='none';return;}
 var keep=sel.value;sel.textContent='';
 ui.built.drones.forEach(function(d,i){var o=document.createElement('option');o.value=String(i);var first=Math.min.apply(null,d.clips.map(function(c){return c.start;}));
  o.textContent=d.cameraName+' · '+d.clips.length+' clip'+(d.clips.length===1?'':'s')+(d.flights>1?' · '+d.flights+' flights':'')+' from '+clock(first);sel.appendChild(o);});
 if(keep&&sel.querySelector('option[value="'+keep+'"]'))sel.value=keep;box.style.display='block';controls();
}
function droneInfo(text){if($('syncDroneInfo'))$('syncDroneInfo').textContent=text;}
/** Move every clip of drone d except `skip`: by `delta`, or (correction != null) to planned position + correction, which
    stays right even after an Undo in Premiere. The host returns where each clip really sits afterwards. */
async function shiftDrone(d,delta,skip,correction){
 var list=d.clips.filter(function(c){return c!==skip;});if(!list.length)return {moved:0,delta:0};
 var spec=list.map(function(c){return c.nodeId+'@'+c.zero+(correction==null?'':'@'+Math.round((c.planZero+correction)*1e6)/1e6);}).join(',');
 var r=await host('rp_syncShiftDrone('+P().quote(ui.built.sequenceID)+','+Number(d.track)+','+P().quote(spec)+','+Number(delta||0)+')',60000);
 list.forEach(function(c,i){var x=r.clips&&r.clips[i];c.onTrack=!!x;if(!x)return;c.start=Number(x.start);c.zero=Math.round((Number(x.start)-Number(x.inPoint))*1e6)/1e6;});return r;
}
function missingNote(r){return r&&r.missing?' '+r.missing+' drone clip'+(r.missing===1?' is':'s are')+' no longer on the track and '+(r.missing===1?'was':'were')+' skipped.':'';}
/** Remember the drone's total clock correction (against the camera it was bridged through) for the next analysis. */
function remember(d,clip){
 if(!d.key)return ' (Not remembered: the reference camera model is unknown.)';var total=Math.round((d.learnedOffset+(clip.zero-clip.planZero))*1000)/1000;
 try{return saveLearned(d.key,total,d.shootDay,d.reference)?' Remembered for this drone'+(d.shootDay?' (shoot '+d.shootDay+')':'')+': '+(total>=0?'+':'')+total.toFixed(2)+' s (used on the next Analyze).':'';}catch(e){return ' (Could not remember the offset: '+e.message+')';}
}
async function useSelected(){
 if(!ui.built||!P()||P().isBusy()||!isLifetime())return;begin();
 try{
  var s=await host('rp_syncSelected()',30000);
  if(String(s.sequenceID)!==ui.built.sequenceID)throw Error('Open the synced sequence and select the drone clip you moved.');
  // The same file can appear twice: take the piece of that file whose recorded start is nearest to the selection.
  var hit=null;ui.built.drones.forEach(function(d,i){if(Number(d.track)!==Number(s.track))return;d.clips.forEach(function(c){if(c.nodeId!==String(s.nodeId))return;var dd=Math.abs(c.start-Number(s.start));if(!hit||dd<hit.dist)hit={d:d,i:i,c:c,dist:dd};});});
  if(!hit)throw Error('The selected clip is not a [CLOCK] drone clip of this synced sequence.');
  // Sync lives in where the file's time 0 sits (start - In): a move, a slip or a head trim all count.
  // The correction is measured against the plan, so the other clips go to planned + correction wherever they are now.
  var zero=Number(s.start)-Number(s.inPoint),corr=zero-hit.c.planZero;
  var r=await shiftDrone(hit.d,0,hit.c,corr);hit.c.zero=zero;hit.c.start=Number(s.start);$('syncFlight').value=String(hit.i);renderDrones();
  var msg=hit.d.cameraName+': '+(r.moved||0)+' other clip'+(r.moved===1?'':'s')+' placed '+(corr>=0?'+':'')+corr.toFixed(2)+' s from the camera-clock plan, following '+hit.c.name+'.'+missingNote(r)+remember(hit.d,hit.c);
  droneInfo(msg);setState(msg,'success');
 }catch(e){setState(e.message,'error');droneInfo(e.message);}
 finally{end();}
}
async function nudge(step){
 if(!ui.built||!P()||P().isBusy()||!isLifetime())return;var d=ui.built.drones[Number($('syncFlight').value)||0];if(!d)return;
 var delta=step==='f'?ui.built.frame:step==='-f'?-ui.built.frame:Number(step);begin();
 try{var r=await shiftDrone(d,delta,null);renderDrones();var msg=d.cameraName+' moved '+(Number(r.delta)>=0?'+':'')+Number(r.delta||0).toFixed(2)+' s ('+(r.moved||0)+' clips).'+missingNote(r)+remember(d,d.clips.filter(function(c){return c.onTrack!==false;})[0]||d.clips[0]);droneInfo(msg);setState(msg,'success');}
 catch(e){setState(e.message,'error');droneInfo(e.message);}
 finally{end();}
}
function forget(){
 if(!ui.built)return;var d=ui.built.drones[Number($('syncFlight').value)||0];if(!d||!d.key)return;
 try{saveLearned(d.key,null,d.learnedDay!==null&&d.learnedDay!==undefined?d.learnedDay:d.shootDay);var msg='Remembered offset for '+d.cameraName+' removed; the next Analyze uses the camera clock only (a new correction here is remembered again).';droneInfo(msg);setState(msg,'success');}catch(e){setState('Could not remove the offset: '+e.message,'error');}
}
function stop(){if(ui.state){ui.state.cancelled=true;if(ui.state.process)try{ui.state.process.kill();}catch(e){}}if(P())P().setStopRequested(true);controls();}
function wire(){
 if(!$('menuSync'))return;
 $('syncScan').onclick=scan;$('syncAnalyze').onclick=analyzeClick;$('syncBuild').onclick=build;$('syncReport').onclick=saveReport;$('syncStop').onclick=stop;
 if($('syncDroneUse'))$('syncDroneUse').onclick=useSelected;if($('syncDroneForget'))$('syncDroneForget').onclick=forget;
 var nb=$('syncDrone')?$('syncDrone').querySelectorAll('button[data-nudge]'):[];for(var i=0;i<nb.length;i++)nb[i].onclick=(function(v){return function(){nudge(v);};})(nb[i].getAttribute('data-nudge'));
 if($('syncBuyLifetime'))$('syncBuyLifetime').onclick=function(){if($('accountBuyLifetime'))$('accountBuyLifetime').click();};
 controls();
}
root.RPSyncUI={untickedDrones:untickedDrones,bridgeHint:bridgeHint,saveLearned:saveLearned,planCameras:planCameras,analyze:analyze,buildRows:buildRows,summary:summary,reportCsv:reportCsv,builtDrones:builtDrones,useSelected:useSelected,nudge:nudge,forget:forget,loadLearned:loadLearned,_ui:ui,controls:controls,isLifetime:isLifetime,stop:stop};
if(typeof document!=='undefined'){if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',wire);else wire();}
if(typeof module!=='undefined'&&module.exports)module.exports=root.RPSyncUI;
}(typeof window!=='undefined'?window:globalThis));
