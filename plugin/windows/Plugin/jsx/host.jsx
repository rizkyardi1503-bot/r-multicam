/* ES3 ExtendScript. v2.3.11.9 single-pass low-memory timeline engine. */
var rp_job=null;
var RP_LOW_MEMORY=true;
var rp_stepRanges=null;
function rp_gc(){try{rp_stepRanges=null;if(typeof $!=='undefined'&&$.gc)$.gc();}catch(e){}}
function rp_encode(v){
 if(v===undefined||v===null)return 'null';
 if(typeof v==='string')return '"'+v.replace(/\\/g,'\\\\').replace(/"/g,'\\"').replace(/[\u0000-\u001f\u2028\u2029]/g,function(c){return '\\u'+('0000'+c.charCodeAt(0).toString(16)).slice(-4);})+'"';
 if(typeof v==='number')return isFinite(v)?String(v):'null';
 if(typeof v==='boolean')return String(v);
 var a=[],k;if(v instanceof Array){for(k=0;k<v.length;k++)a.push(rp_encode(v[k]));return '['+a.join(',')+']';}for(k in v)if(v.hasOwnProperty(k))a.push(rp_encode(k)+':'+rp_encode(v[k]));return '{'+a.join(',')+'}';
}
var rp_license_until=0,rp_license_tier='';
// A lifetime session carries its tier in the proof; a session without it is a trial session (same proof as before).
function rp_licenseProof(expires,tier){return rp_digest('RPROJECT-LICENSE-2.1.12|'+String(expires)+'|'+(tier==='lifetime'?'lifetime|':'')+'host-gate-v1');}
function rp_authorize(expires,proof,tier){
 try{var now=new Date().getTime(),x=Number(expires);if(!isFinite(x)||x<=now||x>now+180000)throw Error('Online account session is invalid or expired.');if(String(proof)!==rp_licenseProof(Math.floor(x),tier))throw Error('Online account session proof is invalid.');rp_license_until=Math.floor(x);rp_license_tier=tier==='lifetime'?'lifetime':'trial';return {ok:true,expires:rp_license_until};}
 catch(e){rp_license_until=0;rp_license_tier='';return {ok:false,status:'error',code:'ACCOUNT_ACCESS_REQUIRED',message:'Online account verification is required to continue.'};}
}
function rp_licenseDenied(){return rp_encode({ok:false,status:'error',code:'ACCOUNT_ACCESS_REQUIRED',message:'Online account verification is required to continue using R Project Multicam AI.'});}
function rp_requireLicense(){if(!(rp_license_until>new Date().getTime()))throw Error('Online account verification is required to continue using R Project Multicam AI.');}
function rp_seconds(t){
 if(t===undefined||t===null)return 0;
 if(typeof t==='object'&&t.seconds!==undefined)return Number(t.seconds);
 return Number(t)/254016000000;
}
function rp_duration(s){
 var end=rp_seconds(s.end),groups=[s.videoTracks,s.audioTracks],g,t,c;
 if(isFinite(end)&&end>0)return end;
 end=0;for(g=0;g<groups.length;g++)if(groups[g])for(t=0;t<groups[g].numTracks;t++){
  var clips=groups[g][t].clips;for(c=0;c<clips.numItems;c++)end=Math.max(end,rp_seconds(clips[c].end));
 }return end;
}

function rp_seqDuration(s){ return rp_duration(s); }
function rp_frame(s){ var tb=Number(s.timebase); if(!isFinite(tb)||tb<=0)throw Error('Cannot read sequence frame rate.');return tb/254016000000; }
function rp_manual(s){
 var out=[],ignored=0,m=s.markers.getFirstMarker(),frame=Number(s.timebase)/254016000000,d=rp_duration(s),seen={},guard=0,previous=null;
 if(!(frame>0))throw Error('Cannot read frame rate.');
 while(m){
  if(guard++>5000)throw Error('Too many sequence markers or invalid marker iteration. Reduce markers and retry.');
  var name=String(m.name||''),comment=String(m.comments||'');
  var auto=/^RPROJECT_AUTO_BEAT/.test(comment)||comment==='R Project Multicam AI'||/^(BEAT|AUTO CUT) \d+$/.test(name);
  var t=rp_seconds(m.start),f=Math.round(t/frame);
  if(auto)ignored++;
  else if(t>0&&t<d&&f>0&&f*frame<d&&!seen['f'+f]){seen['f'+f]=true;out.push(f*frame);}
  var next=s.markers.getNextMarker(m);if(next===m)break;m=next;
 }
 out.sort(function(a,b){return a-b;});return {points:out,ignored:ignored,signature:out.join('|')};
}
function rp_getActiveInfo(){
 try{var s=app.project.activeSequence,marks={points:[],ignored:0};if(s){try{marks=rp_manual(s);}catch(me){marks={points:[],ignored:0};}}
 return rp_encode({ok:true,version:'2.3.11.9',name:s?s.name:'',duration:s?rp_duration(s):0,manual:marks.points.length,ignored:marks.ignored,pendingID:rp_job&&rp_job.status==='running'?rp_job.id:'',pendingKind:rp_job&&rp_job.status==='running'?rp_job.kind:'',pendingPhase:rp_job&&rp_job.status==='running'?rp_job.phase:'',syncPendingID:rp_syncBusy()?rp_syncJob.id:''});}
 catch(e){return rp_encode({ok:false,message:String(e)});}
}
function rp_ping(){
 try{return rp_encode({ok:true,version:'2.3.11.9',host:'R Project Multicam',sequence:!!(app&&app.project&&app.project.activeSequence)});}
 catch(e){return rp_encode({ok:false,message:'ExtendScript host is not ready: '+String(e)});}
}
function rp_state(){
 var j=rp_job;if(!j)return rp_encode({ok:false,status:'error',message:'No active job.'});return rp_encode({ok:j.status!=='error',id:j.id,status:j.status,kind:j.kind,name:j.name,
 phase:j.phase,done:j.done,total:j.total,point:j.point||0,track:j.track||0,verifyPoint:j.verifyPoint||0,prepScene:j.prepScene||0,task:j.task||0,tracks:j.tracks||[],seqID:j.seqID||'',projectPath:j.projectPath||'',created:j.created||0,cuts:j.cuts,changed:j.changed,removed:j.removed,skipped:j.skipped,
 waitMs:Math.max(0,(j.waitUntil||0)-new Date().getTime()),cameraMediaSignature:j.cameraMediaSignature||'',lastRazor:j.lastRazor||null,verifyTrack:j.verifyTrack||0,uiKind:j.uiKind||'',queued:j.queued||0,outputFolder:j.outputFolder||'',outputs:j.outputs||[],zoomIn:j.zoomIn||0,zoomOut:j.zoomOut||0,zoomErrors:j.zoomErrors||[],warning:!!j.warning,timing:j.timing||null,message:j.message});
}
function rp_coverage(track,a,b,eps){
 var cursor=a,any=false,rows=rp_nearRanges(track,a,b,eps);
 for(var c=0;c<rows.length;c++){var l=rows[c].a,r=rows[c].b;
  if(l<b-eps&&r>a+eps)any=true;
  if(l<=cursor+eps&&r>cursor)cursor=r;
 }
 return {full:cursor>=b-eps,any:any};
}
var rp_ai_relaxed=false,rp_ai_choices=null;
function rp_plan(s,tracks,bounds,eps){
 var out=[],prev=-1,i,v;
 for(i=0;i<bounds.length-1;i++){
  var candidates=[],any=false;
  for(v=0;v<tracks.length;v++){
   var cover=rp_coverage(s.videoTracks[tracks[v]],bounds[i],bounds[i+1],eps);
   if(cover.full)candidates.push(tracks[v]);if(cover.any)any=true;
  }
  if(!candidates.length){
   if(any&&!rp_ai_relaxed)throw Error('No single camera covers interval '+bounds[i].toFixed(2)+'–'+bounds[i+1].toFixed(2)+'s. Add manual markers at footage boundaries.');
   out.push(-1);continue;
  }
  var chosen=candidates[0];
  for(v=0;v<candidates.length;v++)if(candidates[v]>prev){chosen=candidates[v];break;}
  out.push(chosen);prev=chosen;
 }return out;
}
function rp_ranges(track){
 var i,key='';if(rp_stepRanges){for(i=0;i<rp_stepRanges.length;i++)if(rp_stepRanges[i].track===track)return rp_stepRanges[i].rows;}
 var rows=[],clips=track.clips;for(i=0;i<clips.numItems;i++){var x=clips[i],a=rp_seconds(x.start),b=rp_seconds(x.end);if(!isFinite(a)||!isFinite(b)||b<a)throw Error('Invalid clip timing.');rows.push({a:a,b:b,index:i});}
 rows.sort(function(a,b){return a.a-b.a||a.b-b.b;});var max=-Infinity;for(i=0;i<rows.length;i++){max=Math.max(max,rows[i].b);rows[i].maxEnd=max;}
 if(rp_stepRanges)rp_stepRanges.push({track:track,rows:rows});return rows;
}
function rp_nearRanges(track,a,b,eps){
 var rows=rp_ranges(track),lo=0,hi=rows.length;while(lo<hi){var m=Math.floor((lo+hi)/2);if(rows[m].maxEnd<a-eps)lo=m+1;else hi=m;}
 var out=[];for(var i=lo;i<rows.length&&rows[i].a<=b+eps;i++)if(rows[i].b>=a-eps)out.push(rows[i]);return out;
}
function rp_invalidateRange(track){if(!rp_stepRanges)return;for(var i=rp_stepRanges.length-1;i>=0;i--)if(rp_stepRanges[i].track===track)rp_stepRanges.splice(i,1);}
function rp_requiredTracksAtBoundary(j,p){
 // v2.3.11.2 V82-FAST PHYSICAL CUT CORE:
 // Music-map edit points are CAMERA DECISION boundaries, not mandatory razors on every selected track.
 // Match the efficient v2.3.10.82 behavior: for AI angle/delete jobs, razor only the outgoing and incoming
 // winner tracks when the visible camera actually changes. Same-camera decisions stay physically continuous.
 // Preserve/cut-only jobs still bound every selected track because they do not have a winner map.
 if(j.kind==='cut'||!j.winners||j.winners.length!==j.points.length+1)return j.tracks.slice(0);
 var a=j.winners[p],b=j.winners[p+1],out=[],seen={},i;
 // -1 means preserve the whole scene; every track must be bounded at that edge.
 if(a<0||b<0)return j.tracks.slice(0);
 // Same camera continues: no artificial physical cut.
 if(a===b)return out;
 for(i=0;i<2;i++){var t=i===0?a:b;if(t>=0&&!seen['v'+t]){seen['v'+t]=true;out.push(t);}}
 return out;
}
function rp_cutBatch(j,start){
 var required=rp_requiredTracksAtBoundary(j,j.point),batch=j.cutBatch;
 if(!batch||batch.point!==j.point)batch=j.cutBatch={point:j.point,done:[],attempts:[],required:required};
 var count=0,issued=0,complete=true,time=j.points[j.point],s=app.project.activeSequence;
 // Same-camera decision boundary: no physical cut is required.
 if(!required.length){j.point++;j.done=j.point;j.track=0;j.cutBatch=null;j.skipped++;return {ops:1,waiting:false};}
 for(var v=0;v<required.length;v++){
  if(batch.done[v])continue;
  if(new Date().getTime()-start>=75){complete=false;break;}
  var ti=required[v],tr=s.videoTracks[ti];count++;j.track=v;
  if(rp_boundaryNeedsCut(tr,time,j.frame,ti)){
   if((batch.attempts[v]||0)>=2)throw Error('Razor not confirmed on V'+(ti+1)+' @ '+time.toFixed(3)+'s after 2 attempts. Cleanup has not started.');
   rp_razorAt(j,ti,time);batch.attempts[v]=(batch.attempts[v]||0)+1;issued++;complete=false;
  }else{batch.done[v]=true;if(batch.attempts[v])j.cuts++;else j.skipped++;}
 }
 if(complete){j.point++;j.done=j.point;j.track=0;j.cutBatch=null;}
 else j.message='Camera transition cut at '+time.toFixed(3)+'s';
 return {ops:Math.max(1,count),waiting:issued>0||!complete};
}

function rp_boundaryEpsilon(frame){return Math.max(frame/10,0.000001);}
function rp_trackCrossesBoundary(track,time,frame,trackIndex){
 if(rp_job&&rp_job.phase==='cut'&&trackIndex!==undefined){
  // Forward cursor is only a cutting hint, never deletion evidence. The independent
  // live verification pass below checks every required transition before cleanup.
  var e=rp_boundaryEpsilon(frame),key='v'+trackIndex,cursors=rp_job.cutCursors||(rp_job.cutCursors={}),cursor=cursors[key]||0;
  cursor=Math.min(cursor,track.clips.numItems);
  for(var k=cursor;k<track.clips.numItems;k++){
   var clip=track.clips[k],a=rp_seconds(clip.start),b=rp_seconds(clip.end);
   if(!isFinite(a)||!isFinite(b)||b<a)throw Error('Invalid clip timing.');
   if(k===cursor&&b<=time+e){cursor=k+1;cursors[key]=cursor;}
   // Track clips are ordered by start: once one starts at/after the boundary none later can cross it.
   if(a+e>=time)break;
   if(b-e>time)return true;
  }
  return false;
 }
 var eps=rp_boundaryEpsilon(frame),rows=rp_nearRanges(track,time,time,eps);
 for(var c=0;c<rows.length;c++)if(rows[c].a+eps<time&&rows[c].b-eps>time)return true;
 return false;
}
function rp_boundaryHasEdge(track,time,frame){
 var c,eps=rp_boundaryEpsilon(frame);
 for(c=0;c<track.clips.numItems;c++)if(Math.abs(rp_seconds(track.clips[c].start)-time)<=eps||Math.abs(rp_seconds(track.clips[c].end)-time)<=eps)return true;
 return false;
}
function rp_boundaryNeedsCut(track,time,frame,trackIndex){return rp_trackCrossesBoundary(track,time,frame,trackIndex);}
function rp_razorFormat(frame){var fps=1/frame,formats=[[24,100],[25,101],[30000/1001,103],[30,104],[50,105],[60000/1001,107],[60,108],[24000/1001,110],[48,113]],k;for(k=0;k<formats.length;k++)if(Math.abs(fps-formats[k][0])<0.005)return formats[k][1];return null;}
function rp_razorAt(j,index,time){
 var s=app.project.activeSequence,tr=s.videoTracks[index];
 if((tr.isLocked&&tr.isLocked())||(tr.isMuted&&tr.isMuted()))throw Error('Camera V'+(index+1)+' is locked or muted.');
 // Use integer frame ticks; the UI may display frames or feet instead of timecode.
 var frameTime=new Time();frameTime.ticks=String(s.timebase);
 var fps=1/j.frame,formats=[[24,100],[25,101],[30000/1001,103],[30,104],[50,105],[60000/1001,107],[60,108],[24000/1001,110],[48,113]],format=null,k;
 for(k=0;k<formats.length;k++)if(Math.abs(fps-formats[k][0])<0.005){format=formats[k][1];break;}
 if(format===null)throw Error('Unsupported razor frame rate '+fps+'. No cleanup performed.');
 if(Number(s.videoDisplayFormat)===102&&format===103)format=102;if(Number(s.videoDisplayFormat)===106&&format===107)format=106;
 var stamp=new Time();stamp.ticks=String(Math.round(time/j.frame)*Number(s.timebase));
 var tc=stamp.getFormatted(frameTime,format);
 // Premiere can return non-canonical SMPTE separators (for example 00;03;07;06).
 // QE razor expects HH:MM:SS:FF or HH:MM:SS;FF, so normalize only separators, never timing.
 var tm=String(tc||'').match(/^(\d+)[;:](\d{2})[;:](\d{2})[;:](\d{2})$/);
 if(tm){var drop=(format===102||format===106);tc=tm[1]+':'+tm[2]+':'+tm[3]+(drop?';':':')+tm[4];}
 if(!/^\d+:\d{2}:\d{2}[:;]\d{2}$/.test(tc))throw Error('Invalid razor timecode: '+tc);
 var q=qe.project.getActiveSequence();if(!q||!q.getVideoTrackAt(index))throw Error('QE camera track unavailable.');
 j.lastRazor={sequenceZeroPoint:String(s.zeroPoint||'0'),track:index,time:time,frame:Math.round(time/j.frame),timecode:tc,fps:fps,display:Number(s.videoDisplayFormat)};
 q.getVideoTrackAt(index).razor(tc);rp_invalidateRange(tr);j.waitUntil=new Date().getTime()+20;
}
function rp_clipIdentity(x){
 var file='',node='',input=rp_seconds(x.inPoint),output=rp_seconds(x.outPoint),speed=1;
 try{file=String(x.projectItem.getMediaPath());node=String(x.nodeId||'');if(x.getSpeed)speed=Number(x.getSpeed());}catch(e){}
 return node+'|'+file+'|'+input+'|'+output+'|'+speed;
}
function rp_resolveTask(s,task,frame){
 var tr=s.videoTracks[task.track],eps=rp_boundaryEpsilon(frame),c,found=null;
 // Numeric hints avoid rebuilding the entire track for every deletion. Always
 // confirm timing AND source identity on the live clip before trusting the hint.
 if(rp_job&&rp_job.liveCounts&&tr.clips.numItems!==rp_job.liveCounts['v'+task.track])throw Error('Camera clip count changed. Resume to rebuild the map.');
 var hint=task.clipIndex,removed=0,tree=rp_job&&rp_job.removalTrees&&rp_job.removalTrees['v'+task.track];
 if(typeof hint==='number'){
  for(var f=hint;tree&&f>0;f-=f&-f)removed+=tree[f]||0;
  var at=hint-removed,fast=at>=0&&at<tr.clips.numItems?tr.clips[at]:null;
  if(fast&&Math.abs(rp_seconds(fast.start)-task.start)<=eps&&Math.abs(rp_seconds(fast.end)-task.end)<=eps&&rp_clipIdentity(fast)===task.identity)return fast;
 }
 var candidates=rp_nearRanges(tr,task.start,task.end,eps);for(c=0;c<candidates.length;c++){
  var x=tr.clips[candidates[c].index];if(Math.abs(rp_seconds(x.start)-task.start)<=eps&&Math.abs(rp_seconds(x.end)-task.end)<=eps){
   if(found)throw Error('Ambiguous camera piece. Cleanup stopped.');if(task.identity&&rp_clipIdentity(x)!==task.identity)throw Error('Camera media or source timing changed. Resume to rebuild the map.');found=x;
  }
 }
 return found;
}
function rp_startJob(kind,points,sourceSignature,boundaryMode,a1Signature,choices,relaxed,trackOverride,allowEmptyTracks,knownCameraSignature){
 if((rp_job&&rp_job.status==='running')||rp_syncBusy())throw Error('A process is active. Click Stop first.');
 var s=app.project.activeSequence;if(!s)throw Error('No active sequence.');
 if(kind!=='cut'&&kind!=='angle'&&kind!=='delete')throw Error('Unknown process type.');
 if(!points||!points.length)throw Error('No edit points are available.');
 var duration=rp_duration(s),frame=rp_frame(s),tracks=[],v;
 if(!isFinite(duration)||duration<=0)throw Error('Invalid sequence duration.');
 if(rp_razorFormat(frame)===null)throw Error('Sequence frame rate '+Math.round(100/frame)/100+' fps is not supported yet. Use 23.976, 24, 25, 29.97, 30, 48, 50, 59.94 or 60 fps. No edits were made.');
 points=rp_parseInternalPoints(points.join(','),frame,duration);
 var processingRange=boundaryMode==='internal'?rp_processingRange(s):null;
 var wanted={},useOverride=trackOverride&&trackOverride.length,skippedSelected=[],requestedSeen={};
 if(useOverride)for(v=0;v<trackOverride.length;v++){var requestedTrack=Number(trackOverride[v]);if(!isFinite(requestedTrack)||requestedTrack!==Math.floor(requestedTrack)||requestedTrack<0)continue;wanted['v'+requestedTrack]=true;requestedSeen['v'+requestedTrack]=false;}
 for(v=0;v<s.videoTracks.numTracks;v++){
  var tr=s.videoTracks[v];
  if(useOverride&&!wanted['v'+v])continue;
  if(useOverride)requestedSeen['v'+v]=true;
  if(tr.isLocked&&tr.isLocked()){
   if(useOverride)skippedSelected.push('V'+(v+1)+' locked');
   continue;
  }
  // v2.3.11.2: Camera Selection is a preference, not a destructive precondition.
  // Unavailable/empty selected tracks are skipped; usable selected cameras continue.
  // Never unmute: the AI snapshot excludes muted tracks, so an unmuted track could never win
  // and every piece of it would be deleted. A muted track is skipped and left untouched.
  if(tr.isMuted&&tr.isMuted()){
   if(useOverride)skippedSelected.push('V'+(v+1)+' Track Output OFF');
   continue;
  }
  if(tr.clips.numItems||allowEmptyTracks)tracks.push(v);
  else if(useOverride)skippedSelected.push('V'+(v+1)+' empty');
 }
 if(useOverride)for(var requestedKey in requestedSeen)if(requestedSeen.hasOwnProperty(requestedKey)&&requestedSeen[requestedKey]===false)skippedSelected.push('V'+(Number(requestedKey.substring(1))+1)+' missing');
 if(!tracks.length)throw Error('No usable camera tracks. Enable at least one unlocked camera track with footage.');
 if(kind==='delete'&&(typeof s.getSelection!=='function'||typeof s.unlinkSelection!=='function'))throw Error('Video unlink API is unavailable; audio cannot be protected.');
 var bounds=[0].concat(points).concat([duration]);
 var winners=kind==='cut'?[]:(choices&&choices.length?choices.slice(0):rp_plan(s,tracks,bounds,frame/4)),trackSet={},degradedWinners=0;
 for(v=0;v<tracks.length;v++)trackSet['v'+tracks[v]]=true;
 if(processingRange)rp_validateRangePlan(points,bounds,winners,processingRange,frame);
 if(kind!=='cut'){
  if(winners.length!==bounds.length-1)throw Error('Camera plan length mismatch.');
  for(v=0;v<winners.length;v++){
   var w=Number(winners[v]);
   if(!isFinite(w)||Math.floor(w)!==w)throw Error('Camera plan contains an invalid winner.');
   if(w!==-1&&!trackSet['v'+w]){winners[v]=-1;degradedWinners++;continue;}
   // Full scene coverage is validated in bounded prepare steps before any deletion.
  }
 }
 app.enableQE();
 if(typeof qe==='undefined')throw Error('QE is unavailable.');
 var q=qe.project.getActiveSequence();
 if(!q||typeof q.getVideoTrackAt!=='function')throw Error('getVideoTrackAt API is unavailable.');
 for(v=0;v<tracks.length;v++)if(typeof q.getVideoTrackAt(tracks[v]).razor!=='function')throw Error('razor API is unavailable.');
 rp_job={id:String(new Date().getTime()),status:'running',kind:kind,seq:s,seqID:String(s.sequenceID),projectPath:String(app.project.path),
  name:s.name,duration:duration,frame:frame,frameTime:s.getSettings().videoFrameRate,display:s.videoDisplayFormat,aiRelaxed:!!relaxed,
  processingRange:processingRange,points:points,signature:sourceSignature||points.join('|'),boundaryMode:boundaryMode||'markers',a1Signature:a1Signature||'',bounds:bounds,winners:winners,aiChoices:choices||null,expectedCuts:null,cameraMediaSignature:knownCameraSignature||rp_cameraMediaSignature(s,tracks),phase:'cut',done:0,total:points.length,
  point:0,track:0,tracks:tracks,cuts:0,changed:0,removed:0,skipped:0,tasks:[],task:0,cameraWarning:(skippedSelected.length?('Auto-skipped '+skippedSelected.join(', ')+'. '):'')+(degradedWinners?degradedWinners+' scene'+(degradedWinners===1?'':'s')+' with an unavailable planned winner will be preserved unchanged.':''),warning:!!(skippedSelected.length||degradedWinners),message:'Starting cut at '+points.length+' edit points'+(skippedSelected.length?' · skipped unavailable '+skippedSelected.join(', '):'')};
 return rp_state();
}
function rp_begin(kind){
 try{
  var s=app.project.activeSequence;if(!s)throw Error('No active sequence.');
  var marks=rp_manual(s);
  if(!marks.points.length)throw Error('No manual markers in the timeline. Cut, Switch Angle and Delete are disabled.');
  return rp_startJob(kind,marks.points,marks.signature,'markers','',rp_ai_choices,rp_ai_relaxed);
 }catch(e){return rp_encode({ok:false,status:'error',message:String(e)});}
}

/* AI choices are staged as numbers, never evaluated as code. */
var rp_ai_pending=null;
function rp_digest(text){
 var a=2166136261,b=5381;for(var i=0;i<text.length;i++){a=(a^text.charCodeAt(i));a=(a+(a<<1)+(a<<4)+(a<<7)+(a<<8)+(a<<24))|0;b=((b*33)^text.charCodeAt(i))|0;}
 return String(text.length)+':'+String(a)+':'+String(b);
}
function rp_parseInternalPoints(csv,frame,duration){
 var list=String(csv).split(','),out=[],prev=-1,i,t,snap;
 for(i=0;i<list.length;i++){
  t=Number(list[i]);snap=Math.round(t/frame)*frame;
  if(!list[i].length||!isFinite(t)||!(snap>0&&snap<duration)||snap<=prev)throw Error('Internal edit points must be ordered, unique and inside the sequence.');
  out.push(snap);prev=snap;
 }
 if(!out.length)throw Error('No internal edit points were provided.');
 if(out.length>100000)throw Error('Maximum 100,000 internal edit points per AI plan. The AI pacing plan is too dense for this sequence.');
 return out;
}
/* v2.3.11.9 Keep Clips registry: camera pieces disabled by an Apply · Keep Clips job stay
   available for re-planning; pieces the user disabled are still treated as unavailable. */
var rp_pluginDisabled={};
function rp_pdRecord(seqID,track,clip){
 var k='s'+String(seqID)+'|v'+Number(track),list=rp_pluginDisabled[k]||(rp_pluginDisabled[k]={rows:[],sorted:true}),f='';if(list.rows.length>=200000)return;
 try{f=String(clip.projectItem.getMediaPath());}catch(e){}var a=rp_seconds(clip.start),last=list.rows.length?list.rows[list.rows.length-1]:null;
 if(last&&a<last.a)list.sorted=false;list.rows.push({a:a,b:rp_seconds(clip.end),f:f});
}
function rp_pdOwned(seqID,track,a,b,file,tol){
 var list=rp_pluginDisabled['s'+String(seqID)+'|v'+Number(track)];if(!list||!list.rows.length)return false;var rows=list.rows,lo=0,hi=rows.length,i,n=0;
 if(!list.sorted){rows.sort(function(x,y){return x.a-y.a;});list.sorted=true;}
 while(lo<hi){var m=Math.floor((lo+hi)/2);if(rows[m].a<=a+tol)lo=m+1;else hi=m;}
 for(i=lo-1;i>=0&&n<64;i--,n++)if(rows[i].b>=b-tol&&rows[i].f===String(file||''))return true;
 return false;
}
function rp_mergeCameraCoverage(clips,tol){
 var ranges=[],out=[],i;for(i=0;i<clips.length;i++){var c=clips[i];if(!c.disabled&&isFinite(c.start)&&isFinite(c.end)&&c.end>c.start)ranges.push({start:c.start,end:c.end});}
 ranges.sort(function(a,b){return a.start-b.start||a.end-b.end;});
 for(i=0;i<ranges.length;i++){var last=out.length?out[out.length-1]:null;if(last&&ranges[i].start<=last.end+tol)last.end=Math.max(last.end,ranges[i].end);else out.push(ranges[i]);}return out;
}
function rp_buildAISnapshot(points,a1Signature,boundaryMode){
 var s=app.project.activeSequence;if(!s)throw Error('Open a sequence first.');
 var frame=Number(s.timebase)/254016000000,d=rp_duration(s),bounds=[0].concat(points).concat([d]),tracks=[],intervals=[],cameraDiagnostics=[],v,c,i,processingRange=boundaryMode==='internal'?rp_processingRange(s):null;
 if(bounds.length>100002)throw Error('Maximum 100,000 edit points per AI plan. The AI pacing plan is too dense for this sequence.');
 for(v=0;v<s.videoTracks.numTracks;v++){
  var tr=s.videoTracks[v],locked=!!(tr.isLocked&&tr.isLocked()),muted=!!(tr.isMuted&&tr.isMuted());cameraDiagnostics.push({index:v,locked:locked,muted:muted,clipCount:tr.clips.numItems});if(locked||muted||!tr.clips.numItems)continue;
  var clips=[];
  for(c=0;c<tr.clips.numItems;c++){
   var item=tr.clips[c],file='',supported=false,pi=item.projectItem;
   try{file=pi.getMediaPath();supported=!!file&&!(pi.isSequence&&pi.isSequence())&&!(pi.isOffline&&pi.isOffline())&&!(item.isSpeedReversed&&item.isSpeedReversed())&&(!item.getSpeed||Math.abs(Number(item.getSpeed())-1)<0.0001);}catch(e){}
   var cs0=rp_seconds(item.start),ce0=rp_seconds(item.end),pluginOff=!!item.disabled&&rp_pdOwned(s.sequenceID,v,cs0,ce0,file,frame/4);
   clips.push({start:cs0,end:ce0,input:rp_seconds(item.inPoint),file:file,supported:supported,disabled:!!item.disabled&&!pluginOff,pluginDisabled:pluginOff});
  }
  tracks.push({index:v,clips:clips,coverageRanges:rp_mergeCameraCoverage(clips,frame/4)});
 }
 if(!tracks.length)throw Error('No unlocked camera tracks.');
 for(i=0;i<bounds.length-1;i++){
  var candidates=[],coverageNotes=[];
  for(v=0;v<tracks.length;v++){
   var cached=tracks[v].coverageRanges,full=false,tol=frame/4;
   for(c=0;c<cached.length;c++){var cc=cached[c];if(cc.start<=bounds[i]+tol&&cc.end>=bounds[i+1]-tol){full=true;break;}}
   coverageNotes.push('V'+(tracks[v].index+1)+': '+(full?'covered':'gap or disabled clips'));
   if(full)candidates.push(tracks[v].index);
  }
  for(v=0;v<cameraDiagnostics.length;v++){var cd=cameraDiagnostics[v];if(cd.locked||cd.muted||!cd.clipCount)coverageNotes.push('V'+(cd.index+1)+': '+(cd.locked?'locked':cd.muted?'muted':'empty'));}
  if(processingRange&&(bounds[i]<processingRange.start-frame/4||bounds[i+1]>processingRange.end+frame/4)){candidates=[];coverageNotes=['Outside In/Out: preserve existing clips'];}
  intervals.push({id:i,start:bounds[i],end:bounds[i+1],candidates:candidates,coverageNotes:coverageNotes});
 }
 var data={sequenceID:String(s.sequenceID),projectPath:String(app.project.path),duration:d,frame:frame,tracks:tracks,intervals:intervals,points:points,a1Signature:a1Signature||'',boundaryMode:boundaryMode||'markers'};
 data.signature=rp_digest(rp_encode(data));return data;
}
function rp_aiSnapshot(){
 var s=app.project.activeSequence;if(!s)throw Error('Open a sequence first.');
 var marks=rp_manual(s);if(!marks.points.length)throw Error('Add manual markers first.');
 var a1='';try{a1=rp_a1Snapshot().signature;}catch(audioError){}
 return rp_buildAISnapshot(marks.points,a1,'markers');
}
function rp_aiInternalSnapshot(a1Signature,csv){
 var a1=rp_a1Snapshot();if(a1.signature!==a1Signature)throw Error('A1 or sequence changed. Analyze the music again.');
 var points=rp_parseInternalPoints(csv,a1.frame,a1.duration);
 var range=rp_processingRange(app.project.activeSequence),pe=a1.frame/4;
 if(range.selected){var inside=[],pi;for(pi=0;pi<points.length;pi++)if(points[pi]>range.start+pe&&points[pi]<range.end-pe)inside.push(points[pi]);points=inside;if(range.start>pe)points.unshift(range.start);if(range.end<a1.duration-pe)points.push(range.end);if(!points.length)throw Error('No music cuts fall inside the sequence In/Out. Widen In/Out or clear it.');}
 return rp_buildAISnapshot(points,a1.signature,'internal');
}
function rp_getAI(){try{var d=rp_aiSnapshot();d.ok=true;return rp_encode(d);}catch(e){return rp_encode({ok:false,message:String(e)});}}
function rp_getAIInternal(a1Signature,csv){try{var d=rp_aiInternalSnapshot(a1Signature,csv);d.ok=true;return rp_encode(d);}catch(e){return rp_encode({ok:false,message:String(e)});}}
function rp_validateAIContext(sequenceID,projectPath,a1Signature,duration){try{var s=app.project.activeSequence;if(!s)throw Error('Open the original sequence first.');if(String(s.sequenceID)!==String(sequenceID))throw Error('Active sequence changed.');if(String(projectPath||'')&&String(app.project.path)!==String(projectPath))throw Error('Project changed.');var a1=rp_a1Snapshot();if(String(a1.signature)!==String(a1Signature))throw Error('A1 changed.');var d=rp_seqDuration(s);var frame=rp_frame(s);if(Math.abs(Number(d)-Number(duration||0))>Math.max(frame*2,.08))throw Error('Sequence duration changed.');return rp_encode({ok:true,contextValid:true,sequenceID:String(s.sequenceID),duration:d});}catch(e){return rp_encode({ok:false,contextValid:false,message:String(e)});}}
function rp_aiStage(signature,a1Signature,csv,enabledCsv){
 try{
  if((rp_job&&rp_job.status==='running')||rp_syncBusy())throw Error('A process is already active.');
  var internal=arguments.length>1&&String(a1Signature||'').length>0;
  var d=internal?rp_aiInternalSnapshot(a1Signature,csv):rp_aiSnapshot();
  // v2.3.11.2 PLAN-STAGE FIX:
  // Auto Music Map passes its exact beat-aligned edit points back in csv and rp_aiInternalSnapshot
  // already verifies A1, sequence duration/frame base, and rebuilds LIVE camera coverage. The old
  // full-snapshot digest compared non-essential clip metadata byte-for-byte and could change across
  // normal Premiere API reads, causing a false "Timeline or edit points changed" error.
  // Keep the strict legacy snapshot check only for manual-marker mode. Internal plans use the
  // freshly rebuilt live snapshot below; rp_aiUpload still validates every chosen camera against
  // current interval coverage before any destructive edit starts.
  if(!internal&&d.signature!==signature)throw Error('Timeline or markers changed. Generate a new AI plan.');
  var enabled=[],parts=String(enabledCsv||'').split(','),seen={};
  for(var ei=0;ei<parts.length;ei++){if(!parts[ei].length)continue;var et=Number(parts[ei]);if(!isFinite(et)||et!==Math.floor(et)||et<0||et>=app.project.activeSequence.videoTracks.numTracks)throw Error('Invalid enabled camera track.');if(!seen['v'+et]){seen['v'+et]=true;enabled.push(et);}}
  if(!enabled.length)throw Error('No cameras enabled in Camera Selection.');
  rp_ai_pending={signature:d.signature,choices:[],intervals:d.intervals,points:d.points,a1Signature:d.a1Signature,boundaryMode:d.boundaryMode,enabledTracks:enabled,sequenceID:d.sequenceID,projectPath:d.projectPath,duration:d.duration,frame:d.frame,cameraMediaSignature:rp_snapshotCameraMediaSignature(d.tracks,enabled)};return rp_encode({ok:true});
 }catch(e){rp_ai_pending=null;return rp_encode({ok:false,message:String(e)});}
}
function rp_aiUpload(csv){
 try{
  var p=rp_ai_pending;if(!p)throw Error('AI plan has not been staged.');
  var list=String(csv).split(','),values=[],i;
  for(i=0;i<list.length;i++){
   var n=Number(list[i]),interval=p.intervals[p.choices.length+i];
   if(!list[i].length||!isFinite(n)||n!==Math.floor(n)||!interval)throw Error('Invalid AI choice.');
   var allowed=n===-1; // -1 means leave this interval untouched when no enabled camera has coverage.
   for(var k=0;k<interval.candidates.length;k++)if(n===interval.candidates[k]){for(var en=0;en<p.enabledTracks.length;en++)if(n===p.enabledTracks[en])allowed=true;}
   if(!allowed)throw Error('AI selected an unavailable camera for this interval.');values.push(n);
  }
  p.choices=p.choices.concat(values);return rp_encode({ok:true,staged:p.choices.length});
 }catch(e){rp_ai_pending=null;return rp_encode({ok:false,message:String(e)});}
}
function rp_aiApply(kind,noBackup){
 try{
  if((rp_job&&rp_job.status==='running')||rp_syncBusy())throw Error('A process is already active.');
  var p=rp_ai_pending;if(!p)throw Error('AI plan has not been staged.');
  if(kind!=='angle'&&kind!=='delete')throw Error('Unknown AI action.');
  if(p.choices.length!==p.intervals.length)throw Error('AI plan is incomplete.');
  // v2.3.11.2 SINGLE-PASS APPLY: rp_aiStage already performed the full live camera/coverage snapshot.
  // Do not rebuild the entire snapshot again here. Only verify cheap context + A1 + camera-media identity.
  var live=app.project.activeSequence;if(!live)throw Error('Open the original sequence first.');
  if(String(live.sequenceID)!==String(p.sequenceID)||String(app.project.path)!==String(p.projectPath))throw Error('Project or active sequence changed. Generate a new AI plan.');
  if(Math.abs(rp_duration(live)-Number(p.duration||0))>Math.max(rp_frame(live)*2,.08)||Math.abs(rp_frame(live)-Number(p.frame||0))>.00000001)throw Error('Sequence duration or frame rate changed. Generate a new AI plan.');
  if(String(rp_a1Snapshot().signature)!==String(p.a1Signature))throw Error('A1 changed. Analyze the music again.');
  if(rp_razorFormat(rp_frame(live))===null)throw Error('Sequence frame rate '+Math.round(100/rp_frame(live))/100+' fps is not supported yet. Use 23.976, 24, 25, 29.97, 30, 48, 50, 59.94 or 60 fps. No edits were made.');
  // The backup copy is optional (panel setting): on long sets a full sequence copy adds memory pressure in Premiere.
  var backupMade=false,backupSkipped=String(noBackup)==='1';if(!backupSkipped){try{live.clone();backupMade=true;var back=app.project.activeSequence;if(!back||String(back.sequenceID)!==String(p.sequenceID))app.project.openSequence(String(p.sequenceID));}catch(be){}}
  if(!app.project.activeSequence||String(app.project.activeSequence.sequenceID)!==String(p.sequenceID))throw Error('Could not return to the original sequence after backup. No edits were made.');
  var result=rp_startJob(kind,p.points,p.boundaryMode==='markers'?p.points.join('|'):p.signature,p.boundaryMode,p.a1Signature,p.choices,true,p.enabledTracks,false,p.cameraMediaSignature);
  if(rp_job&&rp_job.status==='running'){rp_job.winners=p.choices;rp_job.message='Applying AI camera plan'+(backupMade?' · backup copy saved in the project':backupSkipped?' · no backup copy (turned off)':' · backup copy could not be created');result=rp_state();}
  rp_ai_pending=null;return result;
 }catch(e){rp_ai_pending=null;return rp_encode({ok:false,message:String(e)});}
}

function rp_cameraMediaSignature(s,tracks){
 var rows=[],vi,c;
 for(vi=0;vi<tracks.length;vi++){
  var ti=tracks[vi],tr=s.videoTracks[ti],seen={},files=[];
  for(c=0;c<tr.clips.numItems;c++){
   var pi=tr.clips[c].projectItem,f='';try{f=pi&&pi.getMediaPath?pi.getMediaPath():'';}catch(e){f='';}
   if(f){f=String(f).replace(/\\/g,'/');if($.os&&String($.os).toLowerCase().indexOf('windows')>=0)f=f.toLowerCase();if(!seen[f]){seen[f]=1;files.push(f);}}
  }
  files.sort();rows.push(String(ti)+'='+files.join('|'));
 }
 rows.sort();return 'CAMV1:'+rp_digest(rows.join('||'));
}
function rp_snapshotCameraMediaSignature(snapshotTracks,enabled){
 var rows=[],wanted={},i,c;for(i=0;i<enabled.length;i++)wanted['v'+Number(enabled[i])]=true;
 for(i=0;i<snapshotTracks.length;i++){
  var tr=snapshotTracks[i],ti=Number(tr.index);if(!wanted['v'+ti])continue;var seen={},files=[];
  for(c=0;c<tr.clips.length;c++){var f=String(tr.clips[c].file||'');if(f){f=f.replace(/\\/g,'/');if($.os&&String($.os).toLowerCase().indexOf('windows')>=0)f=f.toLowerCase();}if(f&&!seen[f]){seen[f]=1;files.push(f);}}
  files.sort();rows.push(String(ti)+'='+files.join('|'));
 }
 rows.sort();return 'CAMV1:'+rp_digest(rows.join('||'));
}

function rp_parseChoices(csv,expected){
 var list=String(csv||'').split(','),out=[],i,n;if(!csv&&expected===0)return out;
 for(i=0;i<list.length;i++){n=Number(list[i]);if(!list[i].length||!isFinite(n)||n!==Math.floor(n))throw Error('Saved camera choice is invalid.');out.push(n);}
 if(expected!==undefined&&out.length!==expected)throw Error('Saved camera plan length does not match the edit intervals.');return out;
}
function rp_resume(id){
 try{
  if(!rp_job||String(rp_job.id)!==String(id))throw Error('The in-memory Multicam job is no longer available. Use the saved checkpoint instead.');
  if(rp_job.kind!=='delete'&&rp_job.kind!=='angle'&&rp_job.kind!=='cut')throw Error('This process cannot be resumed as Multicam.');
  var s=app.project.activeSequence;if(!s||String(s.sequenceID)!==String(rp_job.seqID)||String(app.project.path)!==String(rp_job.projectPath))throw Error('Open the original project and sequence before continuing.');
  if(rp_job.boundaryMode==='internal'&&rp_a1Snapshot().signature!==rp_job.a1Signature)throw Error('A1 changed after the job stopped. Restore the original A1 before continuing.');
  if(rp_job.status==='done')return rp_state();
  if(rp_job.cameraMediaSignature&&rp_cameraMediaSignature(s,rp_job.tracks)!==rp_job.cameraMediaSignature)throw Error('Camera media changed after stopping.');
  if(Math.abs(rp_duration(s)-rp_job.duration)>rp_boundaryEpsilon(rp_job.frame)||Math.abs(rp_frame(s)-rp_job.frame)>0.00000001)throw Error('Sequence duration or frame rate changed.');
  rp_job.seq=s;rp_job.cutPending=null;rp_job.tasks=[];rp_job.status='running';rp_job.warning=!!rp_job.cameraWarning;if(rp_job.point<rp_job.points.length){rp_job.phase='cut';rp_job.done=rp_job.point;rp_job.total=rp_job.points.length;rp_job.message='Resuming cutting from the saved position.';}else if(rp_job.kind==='cut'){rp_job.status='done';rp_job.message='Cutting complete.';}else{rp_beginPrepare(rp_job);}rp_gc();return rp_state();
 }catch(e){rp_gc();return rp_encode({ok:false,status:'error',message:String(e)});}
}
function rp_resumeSaved(projectPath,sequenceID,a1Signature,pointsCsv,choicesCsv,phase,point,track,cuts,removed,skipped,verifyPoint,prepScene,task,enabledCsv,cameraMediaSignature,savedDuration,savedKind){
 var previousJob=rp_job;
 try{
  if(rp_job&&rp_job.status==='running')throw Error('Another process is already active.');
  var s=app.project.activeSequence;if(!s)throw Error('Open the sequence you want to continue.');
  if(String(app.project.path)!==String(projectPath))throw Error('This checkpoint belongs to a different Premiere project. Open the saved project first.');
  // v2.3.11.9: a checkpoint is bound to the sequence it was started in. A backup clone has the same
  // A1 and camera media, so media identity alone could resume cuts/deletes in the wrong sequence.
  if(String(sequenceID||'')&&String(s.sequenceID)!==String(sequenceID))throw Error('This saved job belongs to a different sequence. Open the sequence the job was started in, then continue. Nothing was changed.');
  var a1=rp_a1Snapshot();if(String(a1.signature)!==String(a1Signature))throw Error('A1 does not match the saved job. Resume stopped before any timeline change.');
  var duration=rp_seqDuration(s),frame=rp_frame(s),tol=Math.max(frame*2,.08);
  if(savedDuration&&Math.abs(Number(duration)-Number(savedDuration))>tol)throw Error('Sequence duration does not match the saved job. Resume stopped safely.');
  var points=rp_parseInternalPoints(pointsCsv,a1.frame,a1.duration),choices=rp_parseChoices(choicesCsv,String(savedKind)==='cut'?0:points.length+1),enabled=[],parts=String(enabledCsv||'').split(','),seen={},ei;
  // A stopped delete job may already have emptied a camera track: keep it so the camera signature still matches.
  for(ei=0;ei<parts.length;ei++){if(!parts[ei].length)continue;var et=Number(parts[ei]);if(!isFinite(et)||et!==Math.floor(et)||et<0||seen['v'+et])continue;seen['v'+et]=true;if(et>=s.videoTracks.numTracks)continue;var etr=s.videoTracks[et];if(!etr||(etr.isLocked&&etr.isLocked())||(etr.isMuted&&etr.isMuted())||(!etr.clips.numItems&&!(Number(removed)>0)))continue;enabled.push(et);}
  if(!enabled.length)throw Error('Saved camera selection has no usable footage in this sequence. Enable at least one unlocked camera track and generate a new plan.');
  var currentCamSig=rp_cameraMediaSignature(s,enabled),savedCamSig=String(cameraMediaSignature||'');
  if(!savedCamSig&&String(s.sequenceID)!==String(sequenceID))throw Error('Legacy checkpoint has no camera identity. Open the original sequence.');
  if(savedCamSig&&currentCamSig!==savedCamSig)throw Error('Camera media does not match the saved job. Resume stopped before any delete operation.');
  var restoredKind=String(savedKind||'delete');
  rp_startJob(restoredKind,points,'resume-checkpoint','internal',a1.signature,choices,true,enabled,Number(removed)>0);
  var j=rp_job;j.aiChoices=choices;j.cuts=Math.max(0,Number(cuts)||0);j.removed=Math.max(0,Number(removed)||0);j.skipped=Math.max(0,Number(skipped)||0);
  // v2.3.11.2: resume from the saved cut position without a full post-cut verification pass.
  j.point=Math.max(0,Math.min(points.length,Number(point)||0));
  if(j.point<points.length){j.phase='cut';j.done=j.point;j.total=points.length;j.message='Saved plan restored. Resuming cutting.';}
  else if(j.kind==='cut'){j.status='done';j.message='Cutting complete.';}
  else{rp_beginPrepare(j);}
  rp_gc();return rp_state();
 }catch(e){rp_gc();rp_job=previousJob;return rp_encode({ok:false,status:'error',message:String(e)});}
}
function rp_prepareTrack(j,trackListIndex){
 var s=app.project.activeSequence,ti=j.tracks[trackListIndex],tr=s.videoTracks[ti],eps=rp_boundaryEpsilon(j.frame);
 var cursor=j.prepClip||0,stop=Math.min(tr.clips.numItems,cursor+32);
 for(var c=cursor;c<stop;c++){
  var clip=tr.clips[c],a=rp_seconds(clip.start),b=rp_seconds(clip.end);if(!(b>a+eps))continue;
  if(j.processingRange){var scope=j.processingRange;if(b<=scope.start+eps||a>=scope.end-eps)continue;if(a<scope.start-eps||b>scope.end+eps)throw Error('Clip crosses unverified In/Out boundary. Cleanup stopped.');}
  var lo=0,hi=j.winners.length;
  while(lo<hi){var m=Math.floor((lo+hi)/2);if(j.bounds[m+1]<=a+eps)lo=m+1;else hi=m;}
  var first=lo,last=lo,keep=null;
  while(last<j.winners.length&&j.bounds[last]<b-eps){
   var w=j.winners[last],visible=w<0||ti===w;
   if(keep!==null&&visible!==keep)throw Error('Camera piece crosses an unverified winner transition. Cleanup stopped.');
   keep=visible;last++;
  }
  if(first===last)continue;
  if(clip.disabled&&j.winners[first]<0)continue;
  var task={identity:rp_clipIdentity(clip),clipIndex:c,track:ti,keep:keep,start:a,end:b,interval:first,lastInterval:last-1,winner:j.winners[first],scopeStart:a,scopeEnd:b};
  j.tasks.push(task);
  var mk=rp_mediaKey(ti,clip);j.mediaCounts[mk]=(j.mediaCounts[mk]||0)+1;
 }
 j.prepClip=stop;
 if(stop>=tr.clips.numItems){j.prepClip=0;j.trackSizes['v'+ti]=tr.clips.numItems;j.liveCounts['v'+ti]=tr.clips.numItems;return true;}
 return false;
}
function rp_beginPrepare(j){
 j.phase='prepare';j.prepScene=j.winners.length;j.prepTrack=0;j.prepClip=0;j.tasks=[];j.mediaCounts={};j.trackSizes={};j.liveCounts={};j.removalTrees={};j.task=0;j.done=0;j.total=j.tracks.length;
 j.message='Transition cuts complete. Building compact cleanup map.';
}
function rp_mediaKey(track,clip){var f='';try{f=String(clip.projectItem.getMediaPath());}catch(e){}return 'v'+track+'|'+f;}
function rp_finishPrepare(j){
 // Compact keep/loser tasks were built once in bounded prepare batches.
 j.cameraMediaSignature=rp_cameraMediaSignature(app.project.activeSequence,j.tracks);
 // No stale clip objects are stored. Every delete re-resolves by track/start/end.
 // Reverse loser order only after preparation; winner tasks remain harmless guards.
 j.tasks.sort(function(a,b){if(a.keep!==b.keep)return a.keep?-1:1;if(!a.keep&&j.kind==='delete'){if(a.start!==b.start)return b.start-a.start;return b.track-a.track;}return a.start-b.start;});
 j.phase=j.kind==='angle'?'angle':'delete';j.done=0;j.total=j.tasks.length;j.task=0;
 j.message=j.kind==='delete'?'Protected cleanup map ready. Removing unused camera pieces in batches.':'Camera map ready.';
}
/* v2.3.11.9 batch cleanup: losers are resolved and guarded first, the whole batch is selected and unlinked with ONE
   unlinkSelection, then each piece is re-resolved (identity checked) and removed. One selection save/restore per batch
   instead of per piece: on long sets the per-piece select/unlink/restore round trip dominated cleanup time. */
var RP_DELETE_BATCH=12;
function rp_now(){return new Date().getTime();}
function rp_newTiming(){return {steps:0,stepMs:0,checks:0,cut:0,prepare:0,keep:0,resolve:0,unlink:0,remove:0,verify:0,gc:0,batches:0,batchPieces:0,lastStepMs:0,lastOps:0,lastPhase:''};}
function rp_deleteBatch(j,s,maxTasks,T,deadline){
 var batch=[],i,k,t0,selected=[],removedIds={},unlinked=0,removedHere=0,cap=Math.max(1,Math.min(RP_DELETE_BATCH,maxTasks));
 // 1. Resolve and guard consecutive loser tasks. Nothing on the timeline changes in this pass.
 for(i=j.task;i<j.tasks.length&&batch.length<cap;i++){
  if(batch.length&&deadline&&rp_now()>=deadline)break;
  var task=j.tasks[i];if(task.keep)break;
  var tr=s.videoTracks[task.track];
  if((tr.isLocked&&tr.isLocked())||(tr.isMuted&&tr.isMuted()))throw Error('Track locked or muted while switching or removing clips.');
  // Final winner guard: the selected camera for this interval can never be deleted.
  if((task.winner!==undefined?task.winner:(task.interval>=0?j.winners[task.interval]:-999))===task.track){batch.push({task:task,skip:true});continue;}
  t0=rp_now();var target=rp_resolveTask(s,task,j.frame);T.resolve+=rp_now()-t0;
  if(!target)throw Error('Camera piece changed before cleanup. Resume to rebuild the map.');
  // Keep the destructive invariants: every covered interval must have a real, available, different winner.
  for(var si=task.interval;si<=task.lastInterval;si++){
   var winner=j.winners[si];if(winner<0||winner===task.track)throw Error('Preserved scene cannot be deleted.');
   var wt=s.videoTracks[winner];if(!wt||(wt.isLocked&&wt.isLocked())||(wt.isMuted&&wt.isMuted()))throw Error('Winner track unavailable. Cleanup stopped.');
  }
  batch.push({task:task,target:target,node:String(target.nodeId)});
 }
 var targets=[];for(i=0;i<batch.length;i++)if(!batch[i].skip)targets.push(batch[i].target);
 try{
  // 2. Unlink the batch's video from its camera audio in one call; audio is never removed.
  if(targets.length){
   t0=rp_now();selected=s.getSelection()||[];
   for(k=0;k<selected.length;k++){try{selected[k].setSelected(false,false);}catch(deselectError){}}
   var want={};for(k=0;k<targets.length;k++){targets[k].setSelected(true,false);want[String(targets[k].nodeId)]=true;}
   var only=s.getSelection()||[],isolated=only.length===targets.length;
   for(k=0;isolated&&k<only.length;k++)if(!want[String(only[k].nodeId)])isolated=false;
   if(!isolated)throw Error('Could not isolate video selection; audio protected.');
   s.unlinkSelection();unlinked=targets.length;
   for(k=0;k<targets.length;k++){try{targets[k].setSelected(false,false);}catch(clearError){}}
   T.unlink+=rp_now()-t0;T.batches++;T.batchPieces+=targets.length;
  }
  // 3. Remove each piece. Never trust a stale clip object after earlier removals: re-resolve the exact loser
  //    by protected track + start/end + source identity immediately before deletion.
  for(i=0;i<batch.length;i++){
   var b=batch[i],tk2=b.task;
   if(b.skip){j.skipped++;j.message='Winner protection blocked an unsafe delete.';}
   else{
    var tr2=s.videoTracks[tk2.track];t0=rp_now();var live=rp_resolveAfterUnlink(s,tk2,j.frame,b.node);T.resolve+=rp_now()-t0;
    if(!live)throw Error('Camera piece changed before cleanup. Resume to rebuild the map.');
    var n=tr2.clips.numItems,mkey=rp_mediaKey(tk2.track,live);
    t0=rp_now();var liveNode=String(live.nodeId);live.remove(false,false);T.remove+=rp_now()-t0;rp_invalidateRange(tr2);removedIds[b.node]=true;removedIds[liveNode]=true;removedHere++;
    t0=rp_now();var confirmed=app.project.activeSequence.videoTracks[tk2.track].clips.numItems<n;T.verify+=rp_now()-t0;
    if(!confirmed)throw Error('Removal was not confirmed. Resume to inspect the live timeline.');
    j.removed++;j.liveCounts['v'+tk2.track]--;
    var tkey='v'+tk2.track,tree=j.removalTrees[tkey]||(j.removalTrees[tkey]={});
    for(var fi=tk2.clipIndex+1;fi<=j.trackSizes[tkey];fi+=fi&-fi)tree[fi]=(tree[fi]||0)+1;
    if(j.mediaCounts){j.mediaCounts[mkey]--;if(j.mediaCounts[mkey]===0)j.cameraMediaSignature=rp_cameraMediaSignature(app.project.activeSequence,j.tracks);}
   }
   j.task++;j.done++;
  }
 }catch(e){
  var left=unlinked-removedHere;
  if(left>0)throw Error(String(e&&e.message||e)+' '+left+' unused camera piece'+(left===1?' was':'s were')+' unlinked from camera audio but not removed yet; Continue removes them (camera audio is untouched).');
  throw e;
 }finally{
  // Clear the batch targets, then one restore of the user's selection per batch; removed pieces are skipped.
  for(k=0;k<targets.length;k++){try{if(!removedIds[String(targets[k].nodeId)])targets[k].setSelected(false,false);}catch(clearError){}}
  for(k=0;k<selected.length;k++){try{if(!removedIds[String(selected[k].nodeId)])selected[k].setSelected(true,false);}catch(selectionError){}}
 }
 return batch.length;
}
// After unlinkSelection the exact piece is re-resolved before deletion. If a Premiere build renumbers nodeId on unlink,
// accept only the single piece on the same track with the same start/end, media, In/Out and speed.
function rp_resolveAfterUnlink(s,task,frame,node){
 var live=null;try{live=rp_resolveTask(s,task,frame);}catch(strictError){live=null;}
 if(live&&String(live.nodeId)===node)return live;
 var loose={track:task.track,start:task.start,end:task.end,clipIndex:task.clipIndex,identity:null},x=rp_resolveTask(s,loose,frame);
 if(!x)return null;
 var tail=function(id){var p=String(id||'').split('|');p.shift();return p.join('|');};
 return tail(rp_clipIdentity(x))===tail(task.identity)?x:null;
}
function rp_removeVideo(s,clip){
 var selected=s.getSelection(),i;
 try{
  for(i=0;i<selected.length;i++)selected[i].setSelected(false,false);
  clip.setSelected(true,false);var only=s.getSelection();if(only.length!==1||String(only[0].nodeId)!==String(clip.nodeId))throw Error('Could not isolate video selection; audio protected.');s.unlinkSelection();clip.setSelected(false,false);
  clip.remove(false,false); // no ripple, no alignment; audio is unlinked first
 }finally{
  for(i=0;i<selected.length;i++)if(selected[i]!==clip){try{selected[i].setSelected(true,false);}catch(selectionError){}}
 }
}

/* Podcast AI: analyze isolated microphone tracks and apply a speaker-to-camera plan. */
var rp_podcast_enabled=false;
function rp_podcastSnapshot(trackCsv){
 if(!rp_podcast_enabled)return rp_encode({ok:false,message:'Podcast AI Director is coming soon.'});
 try{
  var s=app.project.activeSequence;if(!s)throw Error('Open a sequence first.');
  var parts=String(trackCsv||'').split(','),seen={},requested=[],i,c;
  for(i=0;i<parts.length;i++){
   var one=Number(parts[i]);if(!parts[i].length||!isFinite(one)||one!==Math.floor(one)||one<1||one>s.audioTracks.numTracks)throw Error('Invalid podcast microphone track A'+parts[i]+'.');
   if(seen['a'+one])throw Error('Each podcaster must use a different microphone track.');seen['a'+one]=true;requested.push(one-1);
  }
  if(requested.length<2||requested.length>3)throw Error('Podcast AI requires 2 or 3 microphone tracks.');
  var duration=rp_duration(s),tracks=[];
  for(i=0;i<requested.length;i++){
   var ai=requested[i],tr=s.audioTracks[ai],clips=[];
   for(c=0;c<tr.clips.numItems;c++){
    var item=tr.clips[c];if(item.disabled)continue;var pi=item.projectItem;
    if(!pi||(pi.isSequence&&pi.isSequence()))throw Error('A'+(ai+1)+' contains a nested sequence. Use direct microphone audio or render that microphone to WAV.');
    if(pi.isOffline&&pi.isOffline())throw Error('Microphone media unavailable on A'+(ai+1)+': '+item.name);
    if(item.getSpeed&&Math.abs(Number(item.getSpeed())-1)>0.0001)throw Error('A'+(ai+1)+' has speed changes. Render that microphone to WAV first.');
    if(item.isSpeedReversed&&item.isSpeedReversed())throw Error('Reversed microphone audio is unsupported on A'+(ai+1)+'.');
    var file=pi.getMediaPath(),start=rp_seconds(item.start),end=rp_seconds(item.end),input=rp_seconds(item.inPoint);if(!file)throw Error('Cannot read microphone media path on A'+(ai+1)+'.');
    var trim=Math.max(0,-start);input+=trim;start=Math.max(0,start);end=Math.min(duration,end);if(end<=start)continue;if(input<0||!isFinite(input))throw Error('Invalid microphone In point on A'+(ai+1)+'.');
    var stableFile=String(file||'').replace(/\\/g,'/');if($.os&&String($.os).toLowerCase().indexOf('windows')>=0)stableFile=stableFile.toLowerCase();
  clips.push({file:stableFile,start:Math.round(start*1000)/1000,end:Math.round(end*1000)/1000,input:Math.round(input*1000)/1000});
   }
   clips.sort(function(a,b){return a.start-b.start;});if(!clips.length)throw Error('A'+(ai+1)+' is empty or all microphone clips are disabled.');
   for(c=1;c<clips.length;c++)if(clips[c].start<clips[c-1].end-0.001)throw Error('Microphone clips overlap on A'+(ai+1)+'. Render that microphone track to WAV first.');
   tracks.push({index:ai,clips:clips});
  }
  return rp_encode({ok:true,sequenceID:String(s.sequenceID),projectPath:String(app.project.path),name:s.name,duration:duration,frame:Number(s.timebase)/254016000000,audioTracks:tracks,videoTrackCount:s.videoTracks.numTracks});
 }catch(e){return rp_encode({ok:false,message:String(e)});}
}
function rp_podcastBegin(pointsCsv,choicesCsv,cameraCsv){
 if(!rp_podcast_enabled)return rp_encode({ok:false,status:'error',message:'Podcast AI Director is coming soon.'});
 try{
  if((rp_job&&rp_job.status==='running')||rp_syncBusy())throw Error('A process is already active. Click Stop first.');
  var s=app.project.activeSequence;if(!s)throw Error('Open the podcast sequence first.');
  var frame=Number(s.timebase)/254016000000,duration=rp_duration(s),points=[];
  if(String(pointsCsv||'').length)points=rp_parseInternalPoints(pointsCsv,frame,duration);
  var choices=rp_parseChoices(choicesCsv,points.length+1),v,rawCams=String(cameraCsv||'').split(','),cameraTracks=[],seenCams={};
  for(var ci=0;ci<rawCams.length;ci++){var cv=Number(rawCams[ci]);if(!rawCams[ci].length||!isFinite(cv)||cv!==Math.floor(cv)||cv<0||cv>=s.videoTracks.numTracks)throw Error('Invalid Podcast camera track.');if(!seenCams['v'+cv]){seenCams['v'+cv]=true;cameraTracks.push(cv);}}
  if(cameraTracks.length<2)throw Error('Podcast AI needs at least two mapped camera tracks.');
  if(!points.length){var mid=Math.round((duration/2)/frame)*frame;if(!(mid>0&&mid<duration))throw Error('Podcast sequence is too short to edit.');points=[mid];choices=[choices[0],choices[0]];}
  var snap=rp_buildAISnapshot(points,'','podcast'),adjusted=0;
  for(var i=0;i<snap.intervals.length;i++){
   var allowedCandidates=[];for(v=0;v<snap.intervals[i].candidates.length;v++)if(seenCams['v'+snap.intervals[i].candidates[v]])allowedCandidates.push(snap.intervals[i].candidates[v]);
   var choice=choices[i],allowed=false;for(v=0;v<allowedCandidates.length;v++)if(allowedCandidates[v]===choice){allowed=true;break;}
   if(!allowed){if(!allowedCandidates.length)choices[i]=-1;else{choices[i]=allowedCandidates[0];adjusted++;}}
  }
  var result=rp_startJob('delete',points,'podcast-speaker-plan','podcast','',choices,true);
  if(rp_job&&rp_job.status==='running'){rp_job.uiKind='podcast';rp_job.tracks=cameraTracks;rp_job.winners=choices;rp_job.aiChoices=choices;rp_job.message='Podcast AI: cutting to the active speaker';result=rp_state();}
  return result;
 }catch(e){return rp_encode({ok:false,status:'error',message:String(e)});}
}

/* Independent Random Zoom pass. Every compatible active clip gets user-defined Scale endpoints. */
function rp_zoomScalarValue(param){
 try{var v=Number(param.getValue());return isFinite(v)?v:null;}catch(e){return null;}
}
function rp_zoomScaleParam(clip){
 var comps=clip.components,c,p,comp,props,dn,match,name,candidate=null;
 if(!comps)return null;
 // Preferred path: locate the intrinsic Motion component by matchName/displayName.
 for(c=0;c<comps.numItems;c++){
  comp=comps[c];match=String(comp.matchName||'');name=String(comp.displayName||'').toLowerCase();
  if(match==='AE.ADBE Motion'||match==='ADBE Motion'||name==='motion'||name==='gerakan'){
   props=comp.properties;if(!props)continue;
   for(p=0;p<props.numItems;p++){
    dn=String(props[p].displayName||'').toLowerCase();
    if(dn==='scale'||dn==='skala'||dn.indexOf('scale')>=0||dn.indexOf('skala')>=0)return props[p];
   }
   // Premiere's intrinsic Motion > Scale is commonly properties[1].
   if(props.numItems>1){candidate=props[1];if(rp_zoomScalarValue(candidate)!==null)return candidate;}
  }
 }
 // Localization-safe scan: find a keyframeable scalar parameter explicitly named Scale/Skala.
 for(c=0;c<comps.numItems;c++){
  comp=comps[c];props=comp&&comp.properties;if(!props)continue;
  for(p=0;p<props.numItems;p++){
   dn=String(props[p].displayName||'').toLowerCase();
   if(dn==='scale'||dn==='skala'||dn.indexOf('scale')>=0||dn.indexOf('skala')>=0){
    candidate=props[p];if(rp_zoomScalarValue(candidate)!==null)return candidate;
   }
  }
 }
 // Final compatibility fallback used by Adobe's classic PProPanel examples.
 try{candidate=comps[1].properties[1];if(candidate&&rp_zoomScalarValue(candidate)!==null)return candidate;}catch(fallbackError){}
 return null;
}
function rp_zoomIsFootage(clip){
 try{
  if(!clip||clip.disabled)return false;
  var pi=clip.projectItem;if(!pi)return false;
  if(pi.isSequence&&pi.isSequence())return false;
  if(pi.isOffline&&pi.isOffline())return false;
  var path=String(pi.getMediaPath?pi.getMediaPath():'');if(!path)return false;
  if(/\.(mogrt|prproj|aep)$/i.test(path))return false;
  return true;
 }catch(e){return false;}
}
function rp_zoomValueMatches(scale,seconds,value){
 var got=null,t=new Time();t.seconds=Number(seconds);
 try{got=Number(scale.getValueAtKey(Number(seconds)));}catch(e1){try{got=Number(scale.getValueAtKey(t));}catch(e2){got=null;}}
 return got!==null&&isFinite(got)&&Math.abs(got-Number(value))<0.05;
}
function rp_zoomSetKey(scale,seconds,value){
 var sec=Number(seconds),result=null,accepted=false,t=new Time();t.seconds=sec;
 // Adobe's ExtendScript implementation is inconsistent across Premiere versions:
 // numeric seconds work reliably on many builds, while some builds prefer a Time object.
 // addKey may also throw "Unknown error" even when the key was actually created.
 try{scale.addKey(sec);}catch(addNumError){try{scale.addKey(t);}catch(addTimeError){}}
 try{result=scale.setValueAtKey(sec,Number(value),true);accepted=(result===0||result===true||result===undefined);}catch(setNumError){
  try{result=scale.setValueAtKey(t,Number(value),true);accepted=(result===0||result===true||result===undefined);}catch(setTimeError){accepted=false;}
 }
 // Do not trust the return value alone; verify the actual key value when Premiere exposes it.
 if(!rp_zoomValueMatches(scale,sec,value)&&!accepted)throw Error('Premiere rejected Motion > Scale keyframe value '+value+'%.');
 // Force standard linear interpolation. No Bezier / Ease In / Ease Out is added by Random Zoom.
 try{scale.setInterpolationTypeAtKey(sec,0,1);}catch(interpNumError){try{scale.setInterpolationTypeAtKey(t,0,1);}catch(interpTimeError){}}
}
function rp_zoomApplyTask(j,task){
 var clip=task.clip||rp_resolveTask(app.project.activeSequence,task,j.frame);if(!clip)throw Error("Zoom footage changed. Start a new Zoom job.");var scale=rp_zoomScaleParam(clip);
 if(!scale)throw Error('Motion > Scale parameter was not found.');
 try{if(scale.areKeyframesSupported&&scale.areKeyframesSupported()!==true)throw Error('Motion > Scale does not support keyframes on this clip.');}catch(keySupportError){if(String(keySupportError).indexOf('does not support')>=0)throw keySupportError;}
 var inSec=rp_seconds(clip.inPoint),outSec=rp_seconds(clip.outPoint);if(!(outSec>inSec))throw Error('Invalid clip source In/Out time.');
 var frame=(j.frame>0?j.frame:1/30),visibleEnd=outSec-frame;
 if(!(visibleEnd>inSec))visibleEnd=outSec;
 var removeA=new Time(),removeB=new Time();removeA.seconds=inSec;removeB.seconds=outSec;
 try{if(scale.isTimeVarying&&scale.isTimeVarying())scale.removeKeyRange(removeA,removeB);}catch(removeError){try{scale.removeKeyRange(inSec,outSec);}catch(removeError2){}}
 try{if(!scale.isTimeVarying||!scale.isTimeVarying())scale.setTimeVarying(true);}catch(varyError){throw Error('Could not enable Scale animation. '+String(varyError));}
 if(task.direction>0){rp_zoomSetKey(scale,inSec,j.zoomMin);rp_zoomSetKey(scale,visibleEnd,j.zoomMax);}
 else{rp_zoomSetKey(scale,inSec,j.zoomMax);rp_zoomSetKey(scale,visibleEnd,j.zoomMin);}
 // Verify that Premiere now exposes at least two keys. Some builds silently ignore failed writes.
 try{var keys=scale.getKeys();if(!keys||keys===0||keys.length<2)throw Error('Premiere did not create the two Scale keyframes.');}catch(verifyError){
  if(String(verifyError).indexOf('two Scale keyframes')>=0)throw verifyError;
 }
 return true;
}
function rp_zoomRecordError(j,err,task){
 var msg=String(err&&err.message?err.message:err).replace(/^Error:\s*/,'');
 if(!j.zoomErrorMap)j.zoomErrorMap={};j.zoomErrorMap[msg]=(j.zoomErrorMap[msg]||0)+1;
 if(!j.zoomErrors)j.zoomErrors=[];
 if(j.zoomErrors.length<5)j.zoomErrors.push({message:msg,clip:String(task&&(task.name||task.clip&&task.clip.name)||'clip'),track:task?task.track+1:0});
}
function rp_zoomTopError(j){
 var best='',count=0,k;if(!j.zoomErrorMap)return '';
 for(k in j.zoomErrorMap)if(j.zoomErrorMap.hasOwnProperty(k)&&j.zoomErrorMap[k]>count){best=k;count=j.zoomErrorMap[k];}
 return best?(best+' ('+count+' clips)'):'';
}
function rp_zoomBegin(minScale,maxScale){
 try{
  if((rp_job&&rp_job.status==='running')||rp_syncBusy())throw Error('A process is already active. Click Stop first.');
  minScale=Number(minScale);maxScale=Number(maxScale);if(!isFinite(minScale)||!isFinite(maxScale)||minScale<=0||maxScale<=minScale||maxScale>1000)throw Error('Invalid Zoom range. Minimum must be above 0 and maximum must be greater than minimum, up to 1000%.');
  var s=app.project.activeSequence;if(!s)throw Error('No active sequence.');
  var tasks=[],v,c,tr,clip,locked=0,muted=0,ineligible=0;
  for(v=0;v<s.videoTracks.numTracks;v++){
   tr=s.videoTracks[v];if(tr.isLocked&&tr.isLocked()){locked++;continue;}if(tr.isMuted&&tr.isMuted()){muted++;continue;}
   for(c=0;c<tr.clips.numItems;c++){
    clip=tr.clips[c];if(!rp_zoomIsFootage(clip)){ineligible++;continue;}
    tasks.push({identity:rp_clipIdentity(clip),clipIndex:c,name:String(clip.name||'clip'),track:v,start:rp_seconds(clip.start),end:rp_seconds(clip.end),direction:Math.random()<0.5?-1:1});
   }
  }
  if(!tasks.length)throw Error('No compatible enabled footage found. Unlock/unmute a video track and use normal file-backed video clips.');
  tasks.sort(function(a,b){return a.start===b.start?a.track-b.track:a.start-b.start;});
  var frame=Number(s.timebase)/254016000000;if(!(frame>0))frame=1/30;
  rp_job={id:String(new Date().getTime()),status:'running',kind:'zoom',phase:'zoom',seq:s,seqID:String(s.sequenceID),projectPath:String(app.project.path),name:s.name,frame:frame,
   tasks:tasks,task:0,done:0,total:tasks.length,created:0,cuts:0,changed:0,removed:0,skipped:0,zoomIn:0,zoomOut:0,zoomErrors:[],zoomErrorMap:{},warning:false,zoomMin:minScale,zoomMax:maxScale,
   scanLocked:locked,scanMuted:muted,scanIneligible:ineligible,message:'Applying Random Zoom '+minScale+'% / '+maxScale+'% to '+tasks.length+' footage clips'};
  rp_gc();return rp_state();
 }catch(e){rp_gc();return rp_encode({ok:false,status:'error',message:String(e)});}
}
function rp_zoomStep(id){
 var j=rp_job;if(!j||j.id!==id||j.kind!=='zoom')return rp_encode({ok:false,status:'error',message:'Random Zoom process not found.'});
 if(j.status!=='running')return rp_state();
 try{
  var active=app.project.activeSequence;if(!active||String(active.sequenceID)!==j.seqID||String(app.project.path)!==j.projectPath)throw Error('Sequence changed. Random Zoom stopped.');
  var start=new Date().getTime(),ops=0;
  while(j.task<j.tasks.length&&ops<4&&new Date().getTime()-start<180){
   var task=j.tasks[j.task];
   try{if(rp_zoomApplyTask(j,task)){j.changed++;if(task.direction>0)j.zoomIn++;else j.zoomOut++;}else j.skipped++;}catch(clipError){j.skipped++;rp_zoomRecordError(j,clipError,task);}
   j.task++;j.done=j.task;ops++;
  }
  if(j.task>=j.tasks.length){
   var top=rp_zoomTopError(j);
   if(j.changed===0){j.status='error';j.message='Random Zoom failed: 0 / '+j.total+' clips animated.'+(top?' Most common reason: '+top+'.':'');}
   else{j.status='done';j.warning=j.skipped>0;j.message='Random Zoom '+(j.warning?'finished with warnings':'complete')+': '+j.changed+' / '+j.total+' clips animated ('+j.zoomIn+' zoom in / '+j.zoomOut+' zoom out), '+j.skipped+' skipped.'+(top?' Most common skip: '+top+'.':'');}
  }else j.message='Random Zoom: '+j.done+' / '+j.total+' footage clips processed';
 }catch(e){j.status='error';j.message=String(e);}
 if(j.status!=='running'){j.tasks=[];j.seq=null;}rp_gc();return rp_state();
}
function rp_best15SafeName(text){return String(text||'Best Drop').replace(/[\\\/:*?\"<>|]/g,'_').replace(/^\s+|\s+$/g,'').slice(0,80)||'Best Drop';}
function rp_best15TimeLabel(seconds){
 var n=Math.max(0,Math.round(Number(seconds)||0)),h=Math.floor(n/3600),m=Math.floor((n%3600)/60),s=n%60;
 function pad(v){return v<10?'0'+v:String(v);}return pad(h)+'h'+pad(m)+'m'+pad(s)+'s';
}
function rp_best15Bin(){
 var root=app.project.rootItem,name='R Project Best Music Drops',i,item;
 try{for(i=0;i<root.children.numItems;i++){item=root.children[i];if(item&&String(item.name)===name&&item.children)return item;}}catch(e){}
 try{root.createBin(name);}catch(createError){}
 try{for(i=0;i<root.children.numItems;i++){item=root.children[i];if(item&&String(item.name)===name&&item.children)return item;}}catch(scanError){}
 return null;
}
function rp_best15Restore(j){
 if(!j||!j.seq)return;
 try{j.seq.setInPoint(j.originalIn);}catch(e){}
 try{j.seq.setOutPoint(j.originalOut);}catch(e2){}
}
function rp_best15Unique(folder,base,ext){
 var clean=rp_best15SafeName(base),path=folder.fsName+'/'+clean+'.'+ext,n=2;
 while(new File(path).exists&&n<1000){path=folder.fsName+'/'+clean+'_'+n+'.'+ext;n++;}
 return path;
}
function rp_best15SequenceSpec(seq){
 var st=null,width=0,height=0,fps=0,audio=0;
 try{st=seq.getSettings();}catch(e){}
 try{width=Number(st.videoFrameWidth||st.frameSizeHorizontal||0);}catch(e1){}
 try{height=Number(st.videoFrameHeight||st.frameSizeVertical||0);}catch(e2){}
 try{var frame=Number(seq.timebase)/254016000000;if(frame>0)fps=1/frame;}catch(e3){}
 try{if(!(fps>0)&&st&&st.videoFrameRate){var ft=rp_seconds(st.videoFrameRate);if(ft>0)fps=1/ft;}}catch(e4){}
 try{audio=Number(st.audioSampleRate||0);if(!(audio>1000&&audio<384000))audio=0;}catch(e5){}
 return {width:width,height:height,fps:fps,audioSampleRate:audio};
}
function rp_best15ResolvePreset(lines){
 try{
  var seq=app.project.activeSequence;if(!seq)throw Error('Open the sequence you want to export.');
  var list=String(lines||'').split(/\r?\n/),i,file,ext;
  for(i=0;i<list.length;i++){
   if(!list[i])continue;file=new File(list[i]);if(!file.exists||!/\.epr$/i.test(file.name))continue;
   try{ext=String(seq.getExportFileExtension(file.fsName)||'').replace(/^\./,'').toLowerCase();}catch(probeError){ext='';}
   if(ext==='mp4')return rp_encode({ok:true,preset:file.fsName,extension:ext,sequence:rp_best15SequenceSpec(seq)});
  }
  throw Error('Premiere could not validate an installed H.264 Match Source preset. Repair or reinstall Adobe Media Encoder standard presets.');
 }catch(e){return rp_encode({ok:false,status:'error',message:String(e)});}
}
function rp_best15Begin(signature,csv,presetPath){
 try{
  if((rp_job&&rp_job.status==='running')||rp_syncBusy())throw Error('A process is already active. Click Stop first.');
  var a1=rp_a1Snapshot();if(a1.signature!==String(signature))throw Error('A1 or the sequence changed. Run Best Drops again.');
  var seq=app.project.activeSequence;if(!seq)throw Error('Open the sequence you want to export.');
  var projectPath=String(app.project.path||'');if(!projectPath)throw Error('Save the Premiere project before Best Drop export.');
  var projectFile=new File(projectPath);if(!projectFile.exists)throw Error('The Premiere project file cannot be found. Save the project first.');
  var preset=new File(String(presetPath||''));if(!preset.exists||!/\.epr$/i.test(preset.name))throw Error('Automatic H.264 Match Source preset is unavailable. Repair Adobe Media Encoder standard presets.');
  var ext=String(seq.getExportFileExtension(preset.fsName)||'').replace(/^\./,'').toLowerCase();if(ext!=='mp4')throw Error('Automatic export preset did not resolve to H.264 MP4. Repair Adobe Media Encoder standard presets.');
  var parts=String(csv||'').split(','),windows=[];
  if(!parts.length||parts.length>100)throw Error('Best Drop export list must contain 1 to 100 ranges.');
  for(var i=0;i<parts.length;i++){
   var v=parts[i].split('|');if(v.length!==4&&v.length!==6)throw Error('Invalid Best Drop export range.');
   var start=Number(v[0]),drop=Number(v[1]),end=Number(v[2]),beat=Number(v[3]);
   if(!isFinite(start)||!isFinite(drop)||!isFinite(end)||!isFinite(beat)||!(beat>0)||start<0||!(start<drop&&drop<end)||end>a1.duration+.05||start<a1.range.start-a1.frame/4||end>a1.range.end+a1.frame/4)throw Error('A Best Drop export range is outside the sequence.');
   var beforeBeats=(drop-start)/beat,afterBeats=(end-drop)/beat;
   if(v.length===6){
    // Drop windows are counted on the measured grid, including local tempo changes.
    beforeBeats=Number(v[4]);afterBeats=Number(v[5]);
    if(!isFinite(beforeBeats)||!isFinite(afterBeats)||beforeBeats%1!==0||afterBeats%1!==0||beforeBeats<8||beforeBeats>64||afterBeats<8||afterBeats>64)throw Error('Invalid beat window counts. Re-analyze Best Drops.');
    if((drop-start)/beforeBeats<.23||(drop-start)/beforeBeats>1.55||(end-drop)/afterBeats<.23||(end-drop)/afterBeats>1.55)throw Error('Best Drop window tempo is outside the supported 40–240 BPM range.');
   }else if(beforeBeats<23.45||beforeBeats>24.55||afterBeats<31.45||afterBeats>32.55)throw Error('Legacy Best Drop windows require 24/32 beats. Re-analyze Best Drops.');
   windows.push({start:start,drop:drop,end:end,beatInterval:beat,preBeats:beforeBeats,postBeats:afterBeats});
  }
  var folder=new Folder(projectFile.parent.fsName+'/Best Music Drops');if(!folder.exists&&!folder.create())throw Error('Could not create Best Music Drops beside the project.');
  var inPoint=Number(seq.getInPoint()),outPoint=Number(seq.getOutPoint());if(!isFinite(inPoint))inPoint=0;if(!isFinite(outPoint)||outPoint<=0)outPoint=rp_duration(seq);
  app.encoder.launchEncoder();
  rp_job={id:String(new Date().getTime()),status:'running',kind:'best15',phase:'subsequence+queue',seq:seq,seqID:String(seq.sequenceID),projectPath:projectPath,name:seq.name,
   a1Signature:a1.signature,windows:windows,preset:preset.fsName,extension:ext,outputFolder:folder.fsName,bin:rp_best15Bin(),originalIn:inPoint,originalOut:outPoint,
   done:0,total:windows.length,created:0,queued:0,cuts:0,changed:0,removed:0,skipped:0,outputs:[],message:'Creating Best Drop 1 / '+windows.length};
  rp_gc();return rp_state();
 }catch(e){rp_gc();return rp_encode({ok:false,status:'error',message:String(e)});}
}
function rp_best15Step(id){
 var j=rp_job;if(!j||j.id!==id||j.kind!=='best15')return rp_encode({ok:false,message:'Best Drop process not found.'});
 if(j.status!=='running')return rp_state();
 try{
  if(String(app.project.path)!==j.projectPath)throw Error('Project changed during Best Drop export.');
  if(j.done>=j.total){rp_best15Restore(j);app.encoder.startBatch();j.status='done';j.phase='encoding';j.message=j.queued+' Best Drop exports sent to Adobe Media Encoder.';return rp_state();}
  var w=j.windows[j.done],rank=j.done+1;
  j.seq.setInPoint(w.start);j.seq.setOutPoint(w.end);
  var sub=null;try{sub=j.seq.createSubsequence(true);}finally{rp_best15Restore(j);}
  if(!sub)throw Error('Could not create Best Drop subsequence '+rank+'.');
  var title='Best Drop '+(rank<10?'0':'')+rank+' - '+rp_best15TimeLabel(w.drop);
  try{sub.name=title;}catch(nameError){}
  try{if(sub.projectItem){sub.projectItem.name=title;if(j.bin&&sub.projectItem.moveBin)sub.projectItem.moveBin(j.bin);}}catch(binError){}
  var output=rp_best15Unique(new Folder(j.outputFolder),title,j.extension);
  var jobID=app.encoder.encodeSequence(sub,output,j.preset,0,0);
  if(!jobID||String(jobID)==='0')throw Error('Media Encoder did not accept Best Drop '+rank+'. Check the Adobe Media Encoder installation and standard H.264 presets.');
  j.outputs.push({rank:rank,start:w.start,drop:w.drop,end:w.end,preBeats:w.preBeats,postBeats:w.postBeats,sequence:title,file:output,jobID:String(jobID)});j.done++;j.created++;j.queued++;
  if(j.done>=j.total){rp_best15Restore(j);app.encoder.startBatch();j.status='done';j.phase='encoding';j.message=j.queued+' Best Drop exports sent to Adobe Media Encoder.';}
  else j.message='Creating Best Drop '+(j.done+1)+' / '+j.total;
 }catch(e){rp_best15Restore(j);j.status='error';j.message=String(e);}
 return rp_state();
}
function rp_step(id,light){
 if(!rp_job||rp_job.id!==id)return rp_encode({ok:false,message:'Process not found.'});
 var j=rp_job;if(j.status!=='running')return rp_state();
 if(j.kind==='a1')return rp_a1Step(id);
 if(j.kind==='zoom')return rp_zoomStep(id);
 if(j.kind==='best15')return rp_best15Step(id);
 var stepStart=rp_now(),T=j.timing||(j.timing=rp_newTiming()),phaseAt=0,ops=0;
 try{
  var active=app.project.activeSequence;
  if(!active||String(active.sequenceID)!==j.seqID||String(app.project.path)!==j.projectPath)throw Error('Sequence changed. Process stopped.');
  if(Math.abs(rp_frame(active)-j.frame)>0.00000001||Math.abs(rp_duration(active)-j.duration)>rp_boundaryEpsilon(j.frame))throw Error('Sequence duration or frame rate changed.');
  if(j.boundaryMode==='markers'){if(rp_manual(active).signature!==j.signature)throw Error('Manual markers changed or removed. Process stopped.');}
  else if(j.boundaryMode==='internal'&&rp_a1Snapshot().signature!==j.a1Signature)throw Error('A1 changed during processing. Process stopped.');
  if(j.waitUntil&&new Date().getTime()<j.waitUntil)return rp_state();
  var start=new Date().getTime(),cleanup=j.phase!=='cut'&&j.phase!=='prepare',limit=light?2:j.phase==='prepare'?48:j.phase==='cut'?16:j.kind==='delete'?24:12,budget=cleanup&&!light?1200:90;rp_stepRanges=[];
  T.checks+=start-stepStart;
  while(j.status==='running'&&ops<limit&&new Date().getTime()-start<budget){
   phaseAt=rp_now();
   if(j.phase==='cut'){
    if(j.point>=j.points.length){
     // v2.3.11.2 FAST FINISH: cut correctness is guarded while each cut is applied.
     // Do not scan every boundary again after a long-set cut pass.
     if(j.kind==='cut'){j.status='done';j.message='Cutting complete.';break;}
     rp_beginPrepare(j);break;
    }
    var batchResult=rp_cutBatch(j,start);ops+=batchResult.ops;T.cut+=rp_now()-phaseAt;if(batchResult.waiting)break;

   }else if(j.phase==='prepare'){
    if(j.prepTrack<j.tracks.length){if(rp_prepareTrack(j,j.prepTrack))j.prepTrack++;j.done=j.prepTrack;ops++;j.message='Building compact cleanup map · camera '+j.prepTrack+' / '+j.tracks.length;T.prepare+=rp_now()-phaseAt;continue;}
    rp_finishPrepare(j);T.prepare+=rp_now()-phaseAt;break;
   }else{
    if(j.task>=j.tasks.length){j.status='done';break;}
    var task=j.tasks[j.task],liveCleanup=app.project.activeSequence,tr=liveCleanup.videoTracks[task.track];
    if((tr.isLocked&&tr.isLocked())||(tr.isMuted&&tr.isMuted()))throw Error('Track locked or muted while switching or removing clips.');
    if(task.keep||j.kind==='angle'){
     var currentClip=rp_resolveTask(liveCleanup,task,j.frame);
     if(!currentClip)throw Error('Camera piece changed before switching. Resume to rebuild the map.');
     if(Boolean(currentClip.disabled)!==!task.keep){currentClip.disabled=!task.keep;if(!task.keep)rp_pdRecord(j.seqID,task.track,currentClip);}
     if(Boolean(currentClip.disabled)!==!task.keep)throw Error('Camera change was not confirmed.');
     j.changed++;T.keep+=rp_now()-phaseAt;
    }else{
     // Losers are removed in guarded batches (one unlink per batch); the batch advances j.task/j.done itself.
     ops+=rp_deleteBatch(j,liveCleanup,limit-ops,T,start+budget);continue;
    }
    j.task++;j.done++;ops++;
   }
  }
  if(j.status==='done')j.message=j.cameraWarning?('Done with camera warning: '+j.cameraWarning):'Done';
 }catch(e){

  j.status='error';j.message=String(e)+' [stage '+String(j.phase)+', point '+String(j.point)+', track '+String(j.track)+']';
 }
 // $.gc() on a large ExtendScript heap is not free: run it at most every 2 s while the job runs, always at the end.
 rp_stepRanges=null;var gcAt=rp_now();if(j.status!=='running'||gcAt-(j.lastGcAt||0)>=2000){rp_gc();j.lastGcAt=rp_now();T.gc+=j.lastGcAt-gcAt;}
 T.steps++;T.lastStepMs=rp_now()-stepStart;T.stepMs+=T.lastStepMs;T.lastOps=ops;T.lastPhase=String(j.phase);
 if(j.status!=='running'){j.tasks=[];j.removalTrees=null;j.mediaCounts=null;j.seq=null;}return rp_state();
}
function rp_stop(id){
 if(!rp_job||rp_job.id!==id)return rp_encode({ok:false,message:'Process not found.'});
 if(rp_job.status==='running'){if(rp_job.kind==='best15')rp_best15Restore(rp_job);rp_job.status='stopped';rp_job.warning=true;rp_job.message='Stopped. Partial results remain.';}
 rp_gc();rp_job.tasks=[];rp_job.removalTrees=null;rp_job.mediaCounts=null;rp_job.seq=null;return rp_state();
}

/* A1 source snapshot. Does not render Premiere effects or audio transitions. */
function rp_processingRange(s){
 var duration=rp_duration(s),frame=rp_frame(s),a=Number(s.getInPoint()),b=Number(s.getOutPoint());
 if(!isFinite(a)||!isFinite(b))throw Error('Cannot read sequence In/Out. Clear or reset sequence marks.');
 if(a<0)a=0;if(b<0)b=duration;
 a=Math.max(0,Math.round(a/frame)*frame);b=Math.min(duration,Math.round(b/frame)*frame);
 if(!(b>a)||a>=duration)throw Error('Invalid sequence In/Out range. Set In before Out.');
 return {start:a,end:b,selected:a>frame/4||b<duration-frame/4};
}
function rp_validateRangePlan(points,bounds,winners,range,frame){
 var eps=frame/4,i,hasIn=false,hasOut=false;for(i=0;i<points.length;i++){if(Math.abs(points[i]-range.start)<eps)hasIn=true;if(Math.abs(points[i]-range.end)<eps)hasOut=true;}
 for(i=0;i<points.length;i++)if(points[i]<range.start-eps||points[i]>range.end+eps)throw Error('Edit point outside sequence In/Out. Rebuild the plan.');
 if(range.start>eps&&!hasIn)throw Error('Missing Mark In boundary. Rebuild the plan.');
 if(range.end<bounds[bounds.length-1]-eps&&!hasOut)throw Error('Missing Mark Out boundary. Rebuild the plan.');
 for(i=0;i<winners.length;i++)if(bounds[i]<range.start-eps||bounds[i+1]>range.end+eps)winners[i]=-1;
}
function rp_a1Snapshot(){
 var s=app.project.activeSequence;if(!s)throw Error('No active sequence.');
 if(!s.audioTracks.numTracks)throw Error('No audio track A1. Put the music mix on A1 (the first audio track).');
 // Music analysis always scans the complete A1 timeline. Sequence In/Out marks
 // remain export/edit controls and must not silently truncate beat/drop analysis.
 var a1=s.audioTracks[0],clips=[],duration=rp_duration(s),range={start:0,end:0,selected:false},c;range.end=duration;
 if(a1.isMuted&&a1.isMuted())throw Error('A1 is muted. Unmute it first.');
 for(c=0;c<a1.clips.numItems;c++){
  var item=a1.clips[c];if(item.disabled||rp_seconds(item.end)<=range.start||rp_seconds(item.start)>=range.end)continue;
  var pi=item.projectItem;
  if(!pi||(pi.isSequence&&pi.isSequence()))throw Error('A1 contains a nested sequence. Use a direct WAV/MP3 file or render A1 to WAV.');
  if(pi.isOffline&&pi.isOffline())throw Error('A1 media unavailable: '+item.name);
  if(item.getSpeed&&Math.abs(Number(item.getSpeed())-1)>0.0001)throw Error('A1 has speed changes. Render A1 to WAV first.');
  if(item.isSpeedReversed&&item.isSpeedReversed())throw Error('Reversed A1 audio is unsupported. Render it to WAV first.');
  var file=pi.getMediaPath(),start=rp_seconds(item.start),end=rp_seconds(item.end),input=rp_seconds(item.inPoint);
  if(!file)throw Error('Cannot read A1 media path: '+item.name);
  var trim=Math.max(0,range.start-start);input+=trim;start=Math.max(range.start,start);end=Math.min(range.end,end);
  if(end<=start)continue;
  if(input<0||!isFinite(input))throw Error('Invalid audio In point.');
  var stableFile=String(file||'').replace(/\\/g,'/');if($.os&&String($.os).toLowerCase().indexOf('windows')>=0)stableFile=stableFile.toLowerCase();
  clips.push({file:stableFile,start:Math.round(start*1000)/1000,end:Math.round(end*1000)/1000,input:Math.round(input*1000)/1000});
 }
 clips.sort(function(a,b){return a.start-b.start;});
 if(!clips.length)throw Error('A1 is empty or all A1 clips are disabled. The plugin reads the music only from A1 (the first audio track): move or enable the music mix on A1.');
 for(c=1;c<clips.length;c++)if(clips[c].start<clips[c-1].end-0.001)throw Error('A1 clips overlap. Render the A1 mix to WAV for accurate analysis.');
 var data={sequenceID:String(s.sequenceID),projectPath:String(app.project.path),duration:duration,frame:Number(s.timebase)/254016000000,range:range,clips:clips};
 // v2.2.7 reliability: A1 identity must survive video-only multicam razor/delete operations.
 // Fingerprint only the actual A1 media/timing plus audio-relevant frame base; sequence metadata is informational.
 var a1Identity={range:range,frame:Math.round(Number(data.frame)*1000000)/1000000,clips:clips};
 data.signature='A1R112:'+rp_digest(rp_encode(a1Identity));data.name=s.name;return data;
}
function rp_getA1(){
 try{var data=rp_a1Snapshot();data.ok=true;return rp_encode(data);}
 catch(e){return rp_encode({ok:false,message:String(e)});}
}
function rp_a1Begin(signature,total){
 try{
  if(rp_syncBusy())throw Error('Sync Cameras to Music is running. Wait for it to finish or click Stop.');
  if(rp_job&&rp_job.status==='running'){
   if(rp_job.kind==='a1'){rp_job.status='stopped';rp_job.message='Previous marker process reset.';}
   else throw Error('A process is already active.');
  }
  var data=rp_a1Snapshot();if(data.signature!==signature)throw Error('A1 or sequence changed. Analyze again.');
  total=Number(total);if(!isFinite(total)||total<1||total!==Math.floor(total))throw Error('Marker suggestions are empty or invalid.');
  var s=app.project.activeSequence;
  rp_job={id:String(new Date().getTime()),status:'running',kind:'a1',phase:'upload',seq:s,name:s.name,
   snapshot:signature,frame:data.frame,duration:data.duration,points:[],expected:total,done:0,total:total,
   created:0,cuts:0,changed:0,removed:0,skipped:0,message:'Preparing approved marker suggestions'};
  rp_gc();return rp_state();
 }catch(e){rp_gc();return rp_encode({ok:false,status:'error',message:String(e)});}
}
function rp_a1Upload(id,csv){
 try{
  var j=rp_job;if(!j||j.id!==id||j.kind!=='a1'||j.status!=='running')throw Error('Marker upload is inactive. The process ID may have changed.');
  // A repeated callback can arrive after the final chunk already advanced to apply.
  // Treat it as an idempotent acknowledgement instead of failing the whole director run.
  if(j.phase==='apply')return rp_state();
  if(j.phase!=='upload')throw Error('Marker upload already completed: '+String(j.phase));
  var list=String(csv).split(','),i,values=[],prev=j.points.length?j.points[j.points.length-1]:-1;
  for(i=0;i<list.length;i++){
   var t=Number(list[i]),snap=Math.round(t/j.frame)*j.frame;
   if(!list[i].length||!isFinite(t)||!(snap>0&&snap<j.duration)||snap<=prev)throw Error('Markers must be ordered, unique and inside the sequence.');
   values.push(snap);prev=snap;
  }
  if(j.points.length+values.length>j.expected)throw Error('Marker suggestion count mismatch.');
  j.points=j.points.concat(values);j.done=j.points.length;
  if(j.points.length===j.expected){j.phase='apply';j.done=0;j.message='Applying approved A1 markers';}
  rp_gc();return rp_state();
 }catch(e){rp_gc();if(rp_job&&rp_job.id===id){rp_job.status='error';rp_job.message=String(e);return rp_state();}return rp_encode({ok:false,status:'error',message:String(e)});}
}
function rp_a1DirectApply(signature,csv){
 try{
  if(rp_syncBusy())throw Error('Sync Cameras to Music is running. Wait for it to finish or click Stop.');
  if(rp_job&&rp_job.status==='running'){
   if(rp_job.kind==='a1'){rp_job.status='stopped';rp_job.message='Previous marker process reset.';}
   else throw Error('A process is already active.');
  }
  var data=rp_a1Snapshot();if(data.signature!==signature)throw Error('A1 or sequence changed. Analyze again.');
  var list=String(csv).split(','),points=[],prev=-1,i,t,snap;
  for(i=0;i<list.length;i++){
   t=Number(list[i]);snap=Math.round(t/data.frame)*data.frame;
   if(!list[i].length||!isFinite(t)||!(snap>0&&snap<data.duration)||snap<=prev)throw Error('AI markers are invalid or out of order.');
   points.push(snap);prev=snap;
  }
  if(!points.length)throw Error('No AI markers to apply.');
  var seq=app.project.activeSequence;
  rp_job={id:String(new Date().getTime()),status:'running',kind:'a1',phase:'apply',seq:seq,name:seq.name,
   snapshot:signature,frame:data.frame,duration:data.duration,points:points,expected:points.length,done:0,total:points.length,
   created:0,cuts:0,changed:0,removed:0,skipped:0,message:'Applying AI markers directly'};
  rp_gc();return rp_state();
 }catch(e){rp_gc();return rp_encode({ok:false,status:'error',message:String(e)});}
}
function rp_a1Step(id){
 var j=rp_job;if(!j||j.id!==id)return rp_encode({ok:false,message:'Process not found.'});
 if(j.status!=='running')return rp_state();
 try{
  if(j.phase!=='apply')throw Error('Marker suggestion list is incomplete.');
  if(rp_a1Snapshot().signature!==j.snapshot)throw Error('A1 or sequence changed. Marker process stopped.');
  var existing={},m=j.seq.markers.getFirstMarker();
  var eligible=rp_manual(j.seq).points;
  for(var ei=0;ei<eligible.length;ei++)existing['f'+Math.round(eligible[ei]/j.frame)]=true;
  var now=new Date().getTime(),n=0;
  while(j.done<j.total&&n<20&&new Date().getTime()-now<150){
   var t=j.points[j.done],key='f'+Math.round(t/j.frame);
   if(existing[key])j.skipped++;
   else{
    m=j.seq.markers.createMarker(t);if(!m)throw Error('Could not create A1 marker.');
    // Explicitly approved by user; eligible for downstream editing.
    m.name='EDIT A1 '+(j.done+1);m.comments='RPROJECT_A1_APPROVED';
    j.created++;existing[key]=true;
   }
   j.done++;n++;
  }
  if(j.done===j.total){j.status='done';j.message='A1 markers applied. Auto Cut is ready.';}
 }catch(e){j.status='error';j.message=String(e);}
 return rp_state();
}

/* Sync to Master Music: builds a NEW sequence (clone of the active one) with every camera clip at the position
   the panel's audio sync found. The original sequence is never edited.
   Layout: A1 keeps the master music; V1 stays empty because overwriteClip puts a clip's audio on the audio track
   with the same index as its video track, so camera k goes on V(k+1) and its (muted) audio on A(k+1), never A1.
   Uncertain clips go on a muted Review track on top; medium-confidence clips get a check label. */
var rp_syncJob=null;
function rp_syncBusy(){return !!(rp_syncJob&&rp_syncJob.status==='running');}
// Master identity for sync: the A1 clips and frame base only. rp_a1Snapshot's signature also covers the
// sequence duration, which legitimately grows when a camera keeps rolling after the music ends.
function rp_syncA1Key(){var a=rp_a1Snapshot();return 'SYNCA1:'+rp_digest(rp_encode({frame:Math.round(Number(a.frame)*1000000)/1000000,clips:a.clips}));}
function rp_syncSequenceById(id){for(var k=0;k<app.project.sequences.numSequences;k++){var q=app.project.sequences[k];if(String(q.sequenceID)===String(id))return q;}return null;}
var RP_SYNC_LABEL_CHECK=7,RP_SYNC_LABEL_REVIEW=6,RP_SYNC_LABEL_CLOCK=3; // Premiere label indices: 7 Mango (check), 6 Rose (review), 3 Lavender (drone clock)
function rp_syncProjectItems(root,depth,path,bins,wanted,found){
 if(depth>12)return;
 for(var i=0;i<root.children.numItems;i++){
  var it=root.children[i];if(!it)continue;
  if(it.type===2){rp_syncProjectItems(it,depth+1,path?path+'/'+it.name:it.name,bins,wanted,found);continue;}
  if(wanted&&wanted.hasOwnProperty(String(it.nodeId)))found[String(it.nodeId)]=it;
  if(!bins)continue;
  var file='';try{if(it.isSequence&&it.isSequence())continue;if(it.isOffline&&it.isOffline())continue;file=it.getMediaPath();}catch(e){continue;}
  if(!file)continue;
  var key=path||'(root)';if(!bins.hasOwnProperty(key))bins[key]=[];if(bins[key].length<2000)bins[key].push({nodeId:String(it.nodeId),name:String(it.name),file:String(file)});
 }
}
/** Everything the panel needs to choose cameras: the active sequence (A1 master, video tracks) and every bin. */
function rp_syncSources(){
 try{
  var s=app.project.activeSequence;if(!s)throw Error('Open the sequence with the master music on A1 first.');
  var a1=rp_a1Snapshot(),tracks=[],v,c,binMap={},bins=[],k;
  for(v=0;v<s.videoTracks.numTracks;v++){
   var tr=s.videoTracks[v],clips=[];
   for(c=0;c<tr.clips.numItems;c++){var it=tr.clips[c],pi=it.projectItem,file='';try{file=pi?pi.getMediaPath():'';}catch(e){file='';}if(!file||(pi.isSequence&&pi.isSequence()))continue;
    clips.push({nodeId:String(pi.nodeId),name:String(it.name),file:String(file),start:rp_seconds(it.start),end:rp_seconds(it.end),inPoint:rp_seconds(it.inPoint),outPoint:rp_seconds(it.outPoint)});}
   tracks.push({index:v,name:String(tr.name||('V'+(v+1))),clips:clips});
  }
  rp_syncProjectItems(app.project.rootItem,0,'',binMap,null,null);
  for(k in binMap)if(binMap.hasOwnProperty(k))bins.push({path:k,items:binMap[k]});
  return rp_encode({ok:true,projectPath:String(app.project.path),sequence:{id:String(s.sequenceID),name:String(s.name),frame:a1.frame,duration:a1.duration,a1:a1.clips,a1Signature:a1.signature},tracks:tracks,bins:bins});
 }catch(e){return rp_encode({ok:false,message:String(e)});}
}
/** Project-item In/Out for a placement. Premiere converts seconds to its tick clock and rounds DOWN to a whole frame, and
    the conversion can land a hair under an exact frame boundary (155.100 s became 155.067 s at 30 fps). 1 ms above the
    boundary always lands on the intended frame, whether Premiere floors or rounds; In and Out move together. */
function rp_syncSetMarks(item,inSec,outSec){var e=0.001;item.setInPoint(Number(inSec)+e,4);item.setOutPoint(Number(outSec)+e,4);}
function rp_syncTime(seconds){var t=new Time();t.ticks=String(Math.round(Number(seconds)*254016000000));return t;}
/** rowsCsv rows "camera,nodeId,sourceIn,sourceOut,start,flag" joined by ';'. camera 1..n (0 = review); flag h|m|r|c (c = drone placed by its camera clock). */
function rp_syncParseRows(rowsCsv,cameraCount,frame){
 var rows=[],parts=String(rowsCsv||'').split(';'),i;
 for(i=0;i<parts.length;i++){
  if(!parts[i].length)continue;var f=parts[i].split(',');if(f.length!==6)throw Error('Invalid sync plan row '+(i+1)+'.');
  var cam=Number(f[0]),node=String(f[1]),a=Number(f[2]),b=Number(f[3]),start=Number(f[4]),flag=String(f[5]);
  if(!(cam>=0&&cam<=cameraCount&&cam===Math.floor(cam)))throw Error('Invalid camera in sync plan row '+(i+1)+'.');
  if(!/^[A-Za-z0-9._:-]{1,64}$/.test(node))throw Error('Invalid project item in sync plan row '+(i+1)+'.');
  if(!isFinite(a)||!isFinite(b)||!isFinite(start)||b<=a||a<0)throw Error('Invalid timing in sync plan row '+(i+1)+'.');
  if(flag!=='h'&&flag!=='m'&&flag!=='r'&&flag!=='c')throw Error('Invalid confidence in sync plan row '+(i+1)+'.');
  // A clip that starts before the music is trimmed at the head; times are frame-exact.
  if(start<0){a-=start;start=0;}if(b-a<frame/2)continue;
  // Premiere rounds a project item's In/Out to whole frames: put the source In/Out on the frame grid (never
  // earlier/later than planned), then place at the timeline frame nearest to where that source frame belongs.
  // The sync error stays within half a frame, as before.
  var offset=start-a,a1=Math.ceil(a/frame-1e-6)*frame,b1=Math.floor(b/frame+1e-6)*frame,s1=Math.round((a1+offset)/frame)*frame;
  if(s1<0){a1+=frame;s1+=frame;}if(b1-a1<frame/2)continue;
  rows.push({camera:cam,nodeId:node,sourceIn:Math.round(a1*1e6)/1e6,sourceOut:Math.round(b1*1e6)/1e6,start:Math.round(s1*1e6)/1e6,flag:flag});
 }
 if(!rows.length)throw Error('The sync plan has no clips to place.');
 // Review clips from different cameras can overlap in time and overwriteClip would cut one with the other:
 // give each one the first review lane that is free at its start.
 var review=[],laneEnd=[],r,lane;for(i=0;i<rows.length;i++)if(rows[i].camera===0)review.push(rows[i]);
 review.sort(function(x,y){return x.start-y.start;});
 for(i=0;i<review.length;i++){r=review[i];for(lane=0;lane<laneEnd.length;lane++)if(laneEnd[lane]<=r.start+frame/4)break;laneEnd[lane]=r.start+(r.sourceOut-r.sourceIn)+frame;r.lane=lane;}
 rows.reviewLanes=laneEnd.length;
 return rows;
}
function rp_syncEnsureTracks(s,videoNeeded,audioNeeded){
 var addV=videoNeeded-s.videoTracks.numTracks,addA=audioNeeded-s.audioTracks.numTracks;if(addV<=0&&addA<=0)return;
 app.enableQE();var q=qe.project.getActiveSequence();if(!q)throw Error('Could not add tracks to the synced sequence.');
 if(addV>0)q.addTracks(addV,s.videoTracks.numTracks,0,1,s.audioTracks.numTracks,0,0);
 s=app.project.activeSequence;
 if(addA>0)q.addTracks(0,s.videoTracks.numTracks,addA,1,s.audioTracks.numTracks,0,0);
 s=app.project.activeSequence;
 if(s.videoTracks.numTracks<videoNeeded||s.audioTracks.numTracks<audioNeeded)throw Error('Premiere did not add the tracks the synced sequence needs ('+videoNeeded+' video, '+audioNeeded+' audio).');
}
function rp_syncClearTrack(tr){for(var c=tr.clips.numItems-1;c>=0;c--)tr.clips[c].remove(false,false);if(tr.clips.numItems)throw Error('Could not clear a track in the synced sequence.');}
function rp_syncBegin(name,cameraCount,rowsCsv,expectSequenceID,expectA1){
 var copy=null,originalID='';
 try{
  if(rp_syncBusy())throw Error('A sync is already running.');
  if(rp_job&&rp_job.status==='running')throw Error('A process is already active. Click Stop first.');
  var s=app.project.activeSequence;if(!s)throw Error('Open the sequence with the master music on A1 first.');
  var a1=rp_a1Snapshot(),a1Key=rp_syncA1Key(),frame=Number(a1.frame),cams=Number(cameraCount);
  // The plan only fits the sequence (and A1 master) it was analyzed on.
  if(expectSequenceID&&String(s.sequenceID)!==String(expectSequenceID))throw Error('The open sequence is not the one that was analyzed. Open that sequence, or click 1. Find camera sources and 2. Analyze sync again here.');
  if(expectA1&&String(a1.signature)!==String(expectA1))throw Error('A1 (the master music) changed since the analysis. Click 1. Find camera sources and 2. Analyze sync again.');
  if(!(cams>=1&&cams<=60&&cams===Math.floor(cams)))throw Error('Choose between 1 and 60 cameras.');
  var rows=rp_syncParseRows(rowsCsv,cams,frame),i,lanes=rows.reviewLanes||0,wanted={},found={};
  for(i=0;i<rows.length;i++)wanted[rows[i].nodeId]=true;
  rp_syncProjectItems(app.project.rootItem,0,'',null,wanted,found);
  for(i=0;i<rows.length;i++)if(!found.hasOwnProperty(rows[i].nodeId))throw Error('A camera clip is no longer in the project. Refresh the sources and sync again.');
  // Clone: the copy keeps the sequence settings and the A1 master; the original is never touched.
  originalID=String(s.sequenceID);var before={},k;for(k=0;k<app.project.sequences.numSequences;k++)before[String(app.project.sequences[k].sequenceID)]=true;
  s.clone(); // some builds return nothing even on success: the new sequence is found below
  for(k=0;k<app.project.sequences.numSequences;k++){var q=app.project.sequences[k];if(!before.hasOwnProperty(String(q.sequenceID))){copy=q;break;}}
  if(!copy)throw Error('Premiere did not create the sequence copy.');
  copy.name=String(name||(s.name+' - Synced'));app.project.openSequence(String(copy.sequenceID));
  var live=app.project.activeSequence;if(!live||String(live.sequenceID)!==String(copy.sequenceID))throw Error('Could not open the synced sequence.');
  // Camera k -> V(k+1)/A(k+1); review lanes on the top tracks.
  var reviewTrack=lanes?cams+1:-1,videoNeeded=1+cams+lanes;
  rp_syncEnsureTracks(live,videoNeeded,videoNeeded);live=app.project.activeSequence;
  for(i=0;i<live.videoTracks.numTracks;i++)rp_syncClearTrack(live.videoTracks[i]);
  for(i=1;i<live.audioTracks.numTracks;i++)rp_syncClearTrack(live.audioTracks[i]);
  if(rp_syncA1Key()!==a1Key)throw Error('The A1 master changed while preparing the synced sequence.');
  var a1Locked=false;try{a1Locked=!!live.audioTracks[0].isLocked();live.audioTracks[0].setLocked(1);}catch(lockError){}
  rp_syncJob={id:'sync'+new Date().getTime(),status:'running',licensed:true,licensedAt:new Date().getTime(),originalID:originalID,sequenceID:String(copy.sequenceID),sequenceName:String(copy.name),
   a1Key:a1Key,a1WasLocked:a1Locked,frame:frame,rows:rows,items:found,next:0,placed:0,checks:0,review:0,clock:0,reviewTrack:reviewTrack,reviewLanes:lanes,cameraCount:cams,message:'Placing camera clips'};
  return rp_syncState();
 }catch(e){
  // Never leave a half-built copy behind: delete it and go back to the original sequence.
  if(copy){try{app.project.openSequence(originalID);}catch(openError){}try{app.project.deleteSequence(copy);}catch(deleteError){}}
  return rp_encode({ok:false,status:'error',message:String(e)});
 }
}
function rp_syncState(){var j=rp_syncJob;if(!j)return rp_encode({ok:true,status:'idle'});return rp_encode({ok:j.status!=='error',status:j.status,id:j.id,sequenceID:j.sequenceID,sequenceName:j.sequenceName,done:j.next,total:j.rows.length,placed:j.placed,checks:j.checks,review:j.review,clock:j.clock||0,message:j.message});}
function rp_syncFindPlaced(tr,nodeId,start,frame){for(var c=0;c<tr.clips.numItems;c++){var it=tr.clips[c];if(Math.abs(rp_seconds(it.start)-start)<=frame/4&&it.projectItem&&String(it.projectItem.nodeId)===nodeId)return it;}return null;}
// Put a project item's In/Out back exactly: clear it, and only set it again if the cleared value differs
// (so a clip that had no marks does not suddenly show In/Out marks in the Source Monitor).
function rp_syncRestoreMark(item,which,old){
 if(!old)return;
 try{
  if(typeof item['clear'+which+'Point']==='function'){item['clear'+which+'Point'](4);var now=item['get'+which+'Point'](4);if(now&&String(now.ticks)===String(old.ticks))return;}
  item['set'+which+'Point'](Number(old.seconds),4);
 }catch(restoreError){}
}
/** Frame duration of a clip's own media (seconds), or `fallback` when Premiere cannot tell (stills, audio, old versions). */
function rp_syncMediaFrame(item,fallback){try{var fi=item.getFootageInterpretation(),r=fi&&Number(fi.frameRate);if(r>1&&r<1000)return 1/r;}catch(e){}return fallback;}
function rp_syncPlace(j,row){
 var s=app.project.activeSequence,item=j.items[row.nodeId],track=row.camera===0?j.reviewTrack+row.lane:row.camera,tr=s.videoTracks[track];
 // Mixed frame rates (e.g. 25 fps media in a 29.97 sequence): Premiere starts a clip on the media's own frames and
 // reports its In rounded to sequence frames. Put In/Out on the media grid and the start where that source frame
 // belongs, so the sync stays within half a timeline frame; the In read back may then differ by one timeline frame.
 var f=j.frame,mf=rp_syncMediaFrame(item,f),mixed=Math.abs(mf-f)>1e-6,sIn=row.sourceIn,sOut=row.sourceOut,start=row.start;
 if(mixed){var zero=row.start-row.sourceIn,a2=Math.ceil(row.sourceIn/mf-1e-6)*mf,b2=Math.floor(row.sourceOut/mf+1e-6)*mf;
  if(b2-a2>=f/2){sIn=a2;sOut=b2;start=Math.max(0,Math.round((a2+zero)/f)*f);}}
 if(!tr)throw Error('Synced sequence track V'+(track+1)+' is missing.');
 // Place exactly sourceIn..sourceOut: set the project item's In/Out for the overwrite, then restore them.
 var oldIn=null,oldOut=null;try{oldIn=item.getInPoint(4);oldOut=item.getOutPoint(4);}catch(e){}
 try{
  rp_syncSetMarks(item,sIn,sOut);
  tr.overwriteClip(item,rp_syncTime(start));
 }finally{rp_syncRestoreMark(item,'In',oldIn);rp_syncRestoreMark(item,'Out',oldOut);}
 var placed=rp_syncFindPlaced(tr,row.nodeId,start,f);
 if(!placed)throw Error('Premiere did not place '+item.name+' at '+start.toFixed(3)+' s.');
 // The placed piece must start at the planned source In (that is what keeps it in sync). Premiere may include the
 // Out frame (+1 frame), and it ends the clip at the last video frame, which can be up to a second earlier than the
 // container length FFmpeg reports (audio running longer): a shorter tail does not move the sync.
 var gotIn=rp_seconds(placed.inPoint),gotLen=rp_seconds(placed.end)-rp_seconds(placed.start),wantLen=sOut-sIn,fmt=function(v){return (Math.abs(v)<5e-4?0:v).toFixed(3);};
 if(Math.abs(gotIn-sIn)>(mixed?f*1.01:f/2)||gotLen<wantLen-Math.max(1,f*2)||gotLen>wantLen+Math.max(f,mf)*1.5)throw Error('Premiere placed '+item.name+' with a different In/Out than planned (In '+fmt(gotIn)+' s, planned '+fmt(sIn)+' s; length '+fmt(gotLen)+' s, planned '+fmt(wantLen)+' s).');
 if(row.flag!=='h')rp_syncTag(placed,row.flag);
 if(row.flag==='r')j.review++;else if(row.flag==='m')j.checks++;else if(row.flag==='c')j.clock++;
 j.placed++;
}
// On every exit (done, error, stop), on the synced sequence itself: camera audio muted, review lanes switched off
// so Run Multicam ignores them, and A1's lock state restored. Returns false if a review lane could not be switched off.
function rp_syncSecure(j){
 var s=rp_syncSequenceById(j.sequenceID),i,ok=true;if(!s)return true;
 for(i=1;i<s.audioTracks.numTracks;i++){try{s.audioTracks[i].setMute(1);}catch(e){}}
 for(i=0;i<j.reviewLanes;i++){var tr=s.videoTracks[j.reviewTrack+i];try{tr.setMute(1);}catch(e){}try{if(!tr.isMuted())ok=false;}catch(e2){ok=false;}}
 try{s.audioTracks[0].setLocked(j.a1WasLocked?1:0);}catch(e){}
 return ok;
}
function rp_syncFinish(j){
 var reviewOff=rp_syncSecure(j);
 j.status='done';j.message='Synced sequence ready: '+j.placed+' clips placed'+(j.checks?', '+j.checks+' marked [CHECK]':'')+(j.clock?', '+j.clock+' drone clips placed by camera clock [CLOCK]':'')+(j.review?', '+j.review+' on the muted Review track':'')+'.'+(reviewOff?'':' Switch off the Review tracks (eye icon) before Run Multicam.');
}
function rp_syncStep(id){
 var j=rp_syncJob;if(!j||String(j.id)!==String(id))return rp_encode({ok:false,status:'error',message:'No sync job to continue.'});
 if(j.status!=='running')return rp_syncState();
 try{
  var s=app.project.activeSequence;if(!s||String(s.sequenceID)!==j.sequenceID)throw Error('Keep the synced sequence open until placing finishes.');
  var t0=new Date().getTime();
  while(j.next<j.rows.length&&new Date().getTime()-t0<1200){
   rp_syncPlace(j,j.rows[j.next]);j.next++;
   // The master music must never change: stop at the first sign of it.
   if(j.next%8===0||j.next===j.rows.length){if(rp_syncA1Key()!==j.a1Key)throw Error('A1 master music changed while placing clips. Stopped; delete the synced sequence. The original sequence is unchanged.');}
  }
  j.message='Placing camera clips '+j.next+' / '+j.rows.length;
  if(j.next===j.rows.length)rp_syncFinish(j);
 }catch(e){j.status='error';j.message=String(e)+(/original sequence is unchanged/.test(String(e))?'':' The synced sequence "'+j.sequenceName+'" is incomplete: delete it and sync again. The original sequence is unchanged.');try{rp_syncSecure(j);}catch(secureError){}}
 return rp_syncState();
}
function rp_syncTag(placed,flag){
 var tag=flag==='r'?'[REVIEW] ':flag==='c'?'[CLOCK] ':'[CHECK] ';try{if(String(placed.name).indexOf(tag)!==0)placed.name=tag+placed.name;}catch(nameError){}
 try{placed.setColorLabel(flag==='r'?RP_SYNC_LABEL_REVIEW:flag==='c'?RP_SYNC_LABEL_CLOCK:RP_SYNC_LABEL_CHECK);}catch(labelError){}
}
/** The open sequence and its A1 master fingerprint (the panel checks it before analyzing and building). */
function rp_syncActive(){try{var s=app.project.activeSequence;if(!s)throw Error('Open the sequence with the master music on A1 first.');var a1=rp_a1Snapshot();return rp_encode({ok:true,sequenceID:String(s.sequenceID),name:String(s.name),a1Signature:a1.signature});}catch(e){return rp_encode({ok:false,message:String(e)});}}
/** The one video clip selected in the active sequence: track, project item and position (drone flight correction). */
function rp_syncSelected(){
 try{
  var s=app.project.activeSequence;if(!s)throw Error('Open the synced sequence first.');
  var found=[],v,c,tr,it;
  for(v=0;v<s.videoTracks.numTracks;v++){tr=s.videoTracks[v];for(c=0;c<tr.clips.numItems;c++){it=tr.clips[c];var on=false;try{on=!!it.isSelected();}catch(e){}if(on)found.push({track:v,nodeId:String(it.projectItem?it.projectItem.nodeId:''),start:rp_seconds(it.start),inPoint:rp_seconds(it.inPoint),name:String(it.name)});}}
  if(found.length!==1)throw Error(found.length?'Select only one drone clip.':'Select the drone clip you moved into place.');
  var x=found[0];return rp_encode({ok:true,sequenceID:String(s.sequenceID),track:x.track,nodeId:x.nodeId,start:x.start,inPoint:x.inPoint,name:x.name});
 }catch(e){return rp_encode({ok:false,message:String(e)});}
}
/** Move drone clips on one track of the synced sequence. clipsCsv lists "nodeId@zero" or "nodeId@zero@target": zero is where
    the panel believes the file's time 0 sits (start - In; it only picks the right piece when a file is used twice),
    target is an absolute new file-zero position. Without targets every clip moves by `delta` from where it really is.
    Everything is checked before the timeline changes (clip still there, nothing overlapped that is not moving). A clip
    pushed before 00:00 is trimmed at the head instead (as the build does); one that would disappear is refused.
    Each clip is re-placed with its source range, name and label. If Premiere fails half way, the clips not yet moved
    go back where they were. Returns the new start and In of every moved clip, in the order given. */
function rp_syncShiftDrone(sequenceID,track,clipsCsv,delta){
 var tr=null,frame=0;
 // Declared outside the try block (function declarations inside blocks are not ES3).
 function put(m,start,inP,len){
   var item=m.item,oldIn=null,oldOut=null;try{oldIn=item.getInPoint(4);oldOut=item.getOutPoint(4);}catch(e){}
   try{rp_syncSetMarks(item,inP,inP+len);tr.overwriteClip(item,rp_syncTime(start));}
   finally{rp_syncRestoreMark(item,'In',oldIn);rp_syncRestoreMark(item,'Out',oldOut);}
   var placed=rp_syncFindPlaced(tr,m.node,start,frame);if(!placed)return null;
   // Premiere may include the Out frame: keep the length, so repeated nudges never grow a clip.
   if(rp_seconds(placed.end)-rp_seconds(placed.start)>len+frame/2){try{placed.end=rp_syncTime(start+len);}catch(e){}}
   try{placed.name=m.name;}catch(e){}
   var lab=m.label!==null&&m.label!==undefined?m.label:(/^\[CLOCK\] /.test(m.name)?RP_SYNC_LABEL_CLOCK:null);if(lab!==null){try{placed.setColorLabel(lab);}catch(e){}}
   return placed;
  }
 try{
  if(rp_syncBusy()||(rp_job&&rp_job.status==='running'))throw Error('A process is already active. Click Stop first.');
  var s=app.project.activeSequence;if(!s||String(s.sequenceID)!==String(sequenceID))throw Error('Open the synced sequence to correct its drone clips.');
  var tn=Number(track);tr=s.videoTracks[tn];if(!tr)throw Error('Drone track V'+(tn+1)+' is missing.');
  frame=Number(s.timebase)/254016000000;if(!(frame>0))frame=1/25;
  var d=Math.round(Number(delta)/frame)*frame;if(!isFinite(d))throw Error('Invalid shift.');
  var asks=[],parts=String(clipsCsv||'').split(','),i,c,k;
  for(i=0;i<parts.length;i++){var at=parts[i].split('@');if((at.length===2||at.length===3)&&/^[A-Za-z0-9._:-]{1,64}$/.test(at[0])&&isFinite(Number(at[1]))&&(at.length===2||isFinite(Number(at[2]))))asks.push({i:asks.length,node:at[0],zero:Number(at[1]),target:at.length===3?Number(at[2]):null});}
  if(!asks.length)throw Error('No drone clips to move.');
  // Match every requested clip to one piece on the track: same project item, nearest file-zero position (start - In).
  // A head trim (a neighbour dragged over it) or an Undo since the last move does not change which piece it is.
  var pieces=[];for(c=0;c<tr.clips.numItems;c++){var it=tr.clips[c];pieces.push({index:c,clip:it,node:String(it.projectItem?it.projectItem.nodeId:''),item:it.projectItem,start:rp_seconds(it.start),end:rp_seconds(it.end),inP:rp_seconds(it.inPoint),name:String(it.name),taken:false});}
  var moving=[],missing=0;
  for(i=0;i<asks.length;i++){var best=null,bd=0;for(k=0;k<pieces.length;k++){var pc=pieces[k];if(pc.taken||pc.node!==asks[i].node)continue;var dist=Math.abs((pc.start-pc.inP)-asks[i].zero);if(!best||dist<bd){best=pc;bd=dist;}}
   // A clip the user deleted (or the host never placed) is skipped; the others stay correctable.
   if(!best){missing++;continue;}best.taken=true;best.ask=asks[i];moving.push(best);}
  if(!moving.length)throw Error('The drone clips are no longer on V'+(tn+1)+'. Build the synced sequence again.');
  // Each clip's own move: to its target, or by delta. Snapped to the frame grid.
  var any=false;for(i=0;i<moving.length;i++){var mv=moving[i],want=mv.ask.target===null?d:mv.ask.target-(mv.start-mv.inP);mv.d=Math.round(want/frame)*frame;if(Math.abs(mv.d)>=frame/4)any=true;}
  if(!any){var same=[];for(i=0;i<asks.length;i++)same.push(null);for(i=0;i<moving.length;i++)same[moving[i].ask.i]={start:moving[i].start,inPoint:moving[i].inP};return rp_encode({ok:true,moved:0,missing:missing,delta:0,clips:same});}
  // Plan: new start, In and length for every moving clip; check against the clips that stay.
  for(i=0;i<moving.length;i++){var m=moving[i],len=m.end-m.start;m.label=null;try{m.label=m.clip.getColorLabel();}catch(e){}
   m.ns=m.start+m.d;m.nIn=m.inP;m.nLen=len;
   if(m.ns<0){m.nIn=Math.round((m.inP-m.ns)/frame)*frame;m.nLen=len-(m.nIn-m.inP);m.ns=0;if(m.nLen<frame)throw Error(m.name+' would move entirely before the start of the sequence.');}
   for(k=0;k<pieces.length;k++){var st=pieces[k];if(st.taken)continue;if(Math.min(m.ns+m.nLen,st.end)-Math.max(m.ns,st.start)>frame/4)throw Error(m.name+' would overlap '+st.name+' on V'+(tn+1)+'.');}}
  // Clips moving to different targets must not land on each other either.
  for(i=0;i<moving.length;i++)for(k=i+1;k<moving.length;k++){var ma=moving[i],mb=moving[k];if(Math.min(ma.ns+ma.nLen,mb.ns+mb.nLen)-Math.max(ma.ns,mb.ns)>frame/4)throw Error(ma.name+' would overlap '+mb.name+' on V'+(tn+1)+'.');}
  // Remove from the end of the track backwards, re-reading each clip by index (no stale references after a removal).
  var order=moving.slice().sort(function(x,y){return y.index-x.index;});
  for(i=0;i<order.length;i++){var live=tr.clips[order[i].index];if(!live||String(live.projectItem?live.projectItem.nodeId:'')!==order[i].node)throw Error('The drone track changed while moving clips. Use Undo (Ctrl/Cmd+Z) to go back.');live.remove(false,false);}
  var out=[],done=0,failed=null;for(i=0;i<asks.length;i++)out.push(null);
  for(i=0;i<moving.length;i++){m=moving[i];var placed=null;try{placed=put(m,m.ns,m.nIn,m.nLen);}catch(e){placed=null;}
   if(!placed){failed=m;break;}out[m.ask.i]={start:rp_seconds(placed.start),inPoint:rp_seconds(placed.inPoint)};done++;}
  if(failed){
   // Put the clips that were not moved yet back where they were; report what happened.
   for(k=i;k<moving.length;k++){try{put(moving[k],moving[k].start,moving[k].inP,moving[k].end-moving[k].start);}catch(e){}}
   throw Error('Premiere did not place '+failed.name+'. '+done+' of '+moving.length+' drone clips moved; the rest were put back. Use Undo (Ctrl/Cmd+Z) to undo the moved ones, then Build again.');
  }
  return rp_encode({ok:true,moved:done,missing:missing,delta:Math.round(d*1e6)/1e6,clips:out});
 }catch(e){return rp_encode({ok:false,message:String(e)});}
}
function rp_syncStop(id){var j=rp_syncJob;if(j&&String(j.id)===String(id)&&j.status==='running'){j.status='stopped';j.message='Sync stopped after '+j.placed+' clips. Delete the synced sequence or run sync again.';try{rp_syncSecure(j);}catch(e){}}return rp_syncState();}
function rp_syncGuardStep(fn){return function(id){try{var j=rp_syncJob;if(!(j&&j.licensed&&j.status==='running'&&String(j.id)===String(id)&&new Date().getTime()-Number(j.licensedAt||0)<86400000))rp_requireLicense();return fn.apply(this,arguments);}catch(e){return rp_encode({ok:false,status:'error',code:'ACCOUNT_ACCESS_REQUIRED',message:String(e)});}};}

/* Commercial host gate: public entry points refuse work without a short-lived licensed session. */
// Sync to Master Music (cameras, drone, FPV) is a lifetime-only feature: trial sessions are refused here too.
function rp_guardLifetime(fn){return function(){try{rp_requireLicense();if(rp_license_tier!=='lifetime')return rp_encode({ok:false,status:'error',code:'LIFETIME_REQUIRED',message:'Sync Cameras to Music is available with the lifetime license only.'});return fn.apply(this,arguments);}catch(e){return rp_encode({ok:false,status:'error',code:'ACCOUNT_ACCESS_REQUIRED',message:String(e)});}};}
function rp_guardLicensed(fn){return function(){try{rp_requireLicense();var out=fn.apply(this,arguments);if(rp_job&&rp_job.status==='running'){rp_job.licensed=true;rp_job.licensedAt=new Date().getTime();}return out;}catch(e){return rp_encode({ok:false,status:'error',code:'ACCOUNT_ACCESS_REQUIRED',message:String(e)});}};}
/* v2.3.11.9: a job started under a valid session may run to completion (its own step/upload calls only)
   if the trial/session ends mid-job. Every new job, plan, resume or analysis still needs a live session. */
function rp_jobContinuation(id){var j=rp_job;return !!(j&&j.licensed&&j.status==='running'&&String(j.id)===String(id)&&new Date().getTime()-Number(j.licensedAt||0)<86400000);}
function rp_guardJob(fn){return function(id){try{if(!rp_jobContinuation(id))rp_requireLicense();return fn.apply(this,arguments);}catch(e){return rp_encode({ok:false,status:'error',code:'ACCOUNT_ACCESS_REQUIRED',message:String(e)});}};}
rp_begin=rp_guardLicensed(rp_begin);
rp_getAI=rp_guardLicensed(rp_getAI);
rp_getAIInternal=rp_guardLicensed(rp_getAIInternal);
rp_aiStage=rp_guardLicensed(rp_aiStage);
rp_aiUpload=rp_guardLicensed(rp_aiUpload);
rp_aiApply=rp_guardLicensed(rp_aiApply);
rp_resume=rp_guardLicensed(rp_resume);
rp_resumeSaved=rp_guardLicensed(rp_resumeSaved);
rp_podcastSnapshot=rp_guardLicensed(rp_podcastSnapshot);
rp_podcastBegin=rp_guardLicensed(rp_podcastBegin);
rp_zoomBegin=rp_guardLicensed(rp_zoomBegin);
rp_zoomStep=rp_guardJob(rp_zoomStep);
rp_best15ResolvePreset=rp_guardLicensed(rp_best15ResolvePreset);
rp_best15Begin=rp_guardLicensed(rp_best15Begin);
rp_best15Step=rp_guardJob(rp_best15Step);
rp_step=rp_guardJob(rp_step);
rp_getA1=rp_guardLicensed(rp_getA1);
rp_a1Begin=rp_guardLicensed(rp_a1Begin);
rp_a1Upload=rp_guardJob(rp_a1Upload);
rp_a1DirectApply=rp_guardLicensed(rp_a1DirectApply);
rp_a1Step=rp_guardJob(rp_a1Step);
rp_syncSources=rp_guardLifetime(rp_syncSources);
rp_syncBegin=rp_guardLifetime(rp_syncBegin);
rp_syncStep=rp_syncGuardStep(rp_syncStep);
rp_syncSelected=rp_guardLifetime(rp_syncSelected);
rp_syncActive=rp_guardLifetime(rp_syncActive);
rp_syncShiftDrone=rp_guardLifetime(rp_syncShiftDrone);
