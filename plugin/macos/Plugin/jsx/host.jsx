/* ES3 ExtendScript. v2.3.11.3 single-pass low-memory timeline engine. */
var rp_job=null;
var RP_LOW_MEMORY=true;
function rp_gc(){try{rp_stepRanges=null;if(typeof $!=='undefined'&&$.gc)$.gc();}catch(e){}}
function rp_encode(v){
 if(v===undefined||v===null)return 'null';
 if(typeof v==='string')return '"'+v.replace(/\\/g,'\\\\').replace(/"/g,'\\"').replace(/[\u0000-\u001f\u2028\u2029]/g,function(c){return '\\u'+('0000'+c.charCodeAt(0).toString(16)).slice(-4);})+'"';
 if(typeof v==='number')return isFinite(v)?String(v):'null';
 if(typeof v==='boolean')return String(v);
 var a=[],k;if(v instanceof Array){for(k=0;k<v.length;k++)a.push(rp_encode(v[k]));return '['+a.join(',')+']';}for(k in v)if(v.hasOwnProperty(k))a.push(rp_encode(k)+':'+rp_encode(v[k]));return '{'+a.join(',')+'}';
}
var rp_license_until=0;
function rp_licenseProof(expires){return rp_digest('RPROJECT-LICENSE-2.1.12|'+String(expires)+'|host-gate-v1');}
function rp_authorize(expires,proof){
 try{var now=new Date().getTime(),x=Number(expires);if(!isFinite(x)||x<=now||x>now+180000)throw Error('Online account session is invalid or expired.');if(String(proof)!==rp_licenseProof(Math.floor(x)))throw Error('Online account session proof is invalid.');rp_license_until=Math.floor(x);return {ok:true,expires:rp_license_until};}
 catch(e){rp_license_until=0;return {ok:false,status:'error',code:'ACCOUNT_ACCESS_REQUIRED',message:'Online account verification is required to continue.'};}
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
 try{var s=app.project.activeSequence,marks=s?rp_manual(s):{points:[],ignored:0};
 return rp_encode({ok:true,version:'2.3.11.3',name:s?s.name:'',duration:s?rp_duration(s):0,manual:marks.points.length,ignored:marks.ignored,pendingID:rp_job&&rp_job.status==='running'?rp_job.id:'',pendingKind:rp_job&&rp_job.status==='running'?rp_job.kind:'',pendingPhase:rp_job&&rp_job.status==='running'?rp_job.phase:''});}
 catch(e){return rp_encode({ok:false,message:String(e)});}
}
function rp_ping(){
 try{return rp_encode({ok:true,version:'2.3.11.3',host:'R Project Multicam',sequence:!!(app&&app.project&&app.project.activeSequence)});}
 catch(e){return rp_encode({ok:false,message:'ExtendScript host is not ready: '+String(e)});}
}
function rp_state(){
 var j=rp_job;if(!j)return rp_encode({ok:false,status:'error',message:'No active job.'});return rp_encode({ok:j.status!=='error',id:j.id,status:j.status,kind:j.kind,name:j.name,
 phase:j.phase,done:j.done,total:j.total,point:j.point||0,track:j.track||0,verifyPoint:j.verifyPoint||0,prepScene:j.prepScene||0,task:j.task||0,tracks:j.tracks||[],seqID:j.seqID||'',projectPath:j.projectPath||'',created:j.created||0,cuts:j.cuts,changed:j.changed,removed:j.removed,skipped:j.skipped,
 waitMs:Math.max(0,(j.waitUntil||0)-new Date().getTime()),cameraMediaSignature:j.cameraMediaSignature||'',lastRazor:j.lastRazor||null,verifyTrack:j.verifyTrack||0,uiKind:j.uiKind||'',queued:j.queued||0,outputFolder:j.outputFolder||'',outputs:j.outputs||[],zoomIn:j.zoomIn||0,zoomOut:j.zoomOut||0,zoomErrors:j.zoomErrors||[],warning:!!j.warning,message:j.message});
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
   if(a+e<time&&b-e>time)return true;
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
 if(rp_job&&rp_job.status==='running')throw Error('A process is active. Click Stop first.');
 var s=app.project.activeSequence;if(!s)throw Error('No active sequence.');
 if(kind!=='cut'&&kind!=='angle'&&kind!=='delete')throw Error('Unknown process type.');
 if(!points||!points.length)throw Error('No edit points are available.');
 var duration=rp_duration(s),frame=rp_frame(s),tracks=[],v;
 if(!isFinite(duration)||duration<=0)throw Error('Invalid sequence duration.');
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
  if(tr.isMuted&&tr.isMuted()){
   if(!(processingRange&&processingRange.selected)&&useOverride&&typeof tr.setMute==='function'){try{tr.setMute(0);}catch(unmuteError){}}
   if(tr.isMuted&&tr.isMuted()){
    if(useOverride)skippedSelected.push('V'+(v+1)+' Track Output OFF');
    continue;
   }
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
   clips.push({start:rp_seconds(item.start),end:rp_seconds(item.end),input:rp_seconds(item.inPoint),file:file,supported:supported,disabled:!!item.disabled});
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
 return rp_buildAISnapshot(points,a1.signature,'internal');
}
function rp_getAI(){try{var d=rp_aiSnapshot();d.ok=true;return rp_encode(d);}catch(e){return rp_encode({ok:false,message:String(e)});}}
function rp_getAIInternal(a1Signature,csv){try{var d=rp_aiInternalSnapshot(a1Signature,csv);d.ok=true;return rp_encode(d);}catch(e){return rp_encode({ok:false,message:String(e)});}}
function rp_validateAIContext(sequenceID,projectPath,a1Signature,duration){try{var s=app.project.activeSequence;if(!s)throw Error('Open the original sequence first.');if(String(s.sequenceID)!==String(sequenceID))throw Error('Active sequence changed.');if(String(projectPath||'')&&String(app.project.path)!==String(projectPath))throw Error('Project changed.');var a1=rp_a1Snapshot();if(String(a1.signature)!==String(a1Signature))throw Error('A1 changed.');var d=rp_seqDuration(s);var frame=rp_frame(s);if(Math.abs(Number(d)-Number(duration||0))>Math.max(frame*2,.08))throw Error('Sequence duration changed.');return rp_encode({ok:true,contextValid:true,sequenceID:String(s.sequenceID),duration:d});}catch(e){return rp_encode({ok:false,contextValid:false,message:String(e)});}}
function rp_aiStage(signature,a1Signature,csv,enabledCsv){
 try{
  if(rp_job&&rp_job.status==='running')throw Error('A process is already active.');
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
function rp_aiApply(kind){
 try{
  if(rp_job&&rp_job.status==='running')throw Error('A process is already active.');
  var p=rp_ai_pending;if(!p)throw Error('AI plan has not been staged.');
  if(kind!=='angle'&&kind!=='delete')throw Error('Unknown AI action.');
  if(p.choices.length!==p.intervals.length)throw Error('AI plan is incomplete.');
  // v2.3.11.2 SINGLE-PASS APPLY: rp_aiStage already performed the full live camera/coverage snapshot.
  // Do not rebuild the entire snapshot again here. Only verify cheap context + A1 + camera-media identity.
  var live=app.project.activeSequence;if(!live)throw Error('Open the original sequence first.');
  if(String(live.sequenceID)!==String(p.sequenceID)||String(app.project.path)!==String(p.projectPath))throw Error('Project or active sequence changed. Generate a new AI plan.');
  if(Math.abs(rp_duration(live)-Number(p.duration||0))>Math.max(rp_frame(live)*2,.08)||Math.abs(rp_frame(live)-Number(p.frame||0))>.00000001)throw Error('Sequence duration or frame rate changed. Generate a new AI plan.');
  if(String(rp_a1Snapshot().signature)!==String(p.a1Signature))throw Error('A1 changed. Analyze the music again.');
  var result=rp_startJob(kind,p.points,p.boundaryMode==='markers'?p.points.join('|'):p.signature,p.boundaryMode,p.a1Signature,p.choices,true,p.enabledTracks,false,p.cameraMediaSignature);
  if(rp_job&&rp_job.status==='running'){rp_job.winners=p.choices;rp_job.message='Applying AI camera plan';result=rp_state();}
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
  for(c=0;c<tr.clips.length;c++){var f=String(tr.clips[c].file||'');if(f&&!seen[f]){seen[f]=1;files.push(f);}}
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
  var a1=rp_a1Snapshot();if(String(a1.signature)!==String(a1Signature))throw Error('A1 does not match the saved job. Resume stopped before any timeline change.');
  var duration=rp_seqDuration(s),frame=rp_frame(s),tol=Math.max(frame*2,.08);
  if(savedDuration&&Math.abs(Number(duration)-Number(savedDuration))>tol)throw Error('Sequence duration does not match the saved job. Resume stopped safely.');
  var points=rp_parseInternalPoints(pointsCsv,a1.frame,a1.duration),choices=rp_parseChoices(choicesCsv,String(savedKind)==='cut'?0:points.length+1),enabled=[],parts=String(enabledCsv||'').split(','),seen={},ei;
  for(ei=0;ei<parts.length;ei++){if(!parts[ei].length)continue;var et=Number(parts[ei]);if(!isFinite(et)||et!==Math.floor(et)||et<0||seen['v'+et])continue;seen['v'+et]=true;if(et>=s.videoTracks.numTracks)continue;var etr=s.videoTracks[et];if(!etr||(etr.isLocked&&etr.isLocked())||(etr.isMuted&&etr.isMuted())||!etr.clips.numItems)continue;enabled.push(et);}
  if(!enabled.length)throw Error('Saved camera selection has no usable footage in this sequence. Enable at least one unlocked camera track and generate a new plan.');
  var currentCamSig=rp_cameraMediaSignature(s,enabled),savedCamSig=String(cameraMediaSignature||'');
  if(!savedCamSig&&String(s.sequenceID)!==String(sequenceID))throw Error('Legacy checkpoint has no camera identity. Open the original sequence.');
  if(savedCamSig&&currentCamSig!==savedCamSig)throw Error('Camera media does not match the saved job. Resume stopped before any delete operation.');
  var sameSequence=String(s.sequenceID)===String(sequenceID);
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
  if(rp_job&&rp_job.status==='running')throw Error('A process is already active. Click Stop first.');
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
  if(rp_job&&rp_job.status==='running')throw Error('A process is already active. Click Stop first.');
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
  if(rp_job&&rp_job.status==='running')throw Error('A process is already active. Click Stop first.');
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
 try{
  var active=app.project.activeSequence;
  if(!active||String(active.sequenceID)!==j.seqID||String(app.project.path)!==j.projectPath)throw Error('Sequence changed. Process stopped.');
  if(Math.abs(rp_frame(active)-j.frame)>0.00000001||Math.abs(rp_duration(active)-j.duration)>rp_boundaryEpsilon(j.frame))throw Error('Sequence duration or frame rate changed.');
  if(j.boundaryMode==='markers'){if(rp_manual(active).signature!==j.signature)throw Error('Manual markers changed or removed. Process stopped.');}
  else if(j.boundaryMode==='internal'&&rp_a1Snapshot().signature!==j.a1Signature)throw Error('A1 changed during processing. Process stopped.');
  if(j.waitUntil&&new Date().getTime()<j.waitUntil)return rp_state();
  var start=new Date().getTime(),ops=0,limit=light?2:j.phase==='prepare'?48:j.phase==='cut'?16:12;rp_stepRanges=[];
  while(j.status==='running'&&ops<limit&&new Date().getTime()-start<90){
   if(j.phase==='cut'){
    if(j.point>=j.points.length){
     // v2.3.11.2 FAST FINISH: cut correctness is guarded while each cut is applied.
     // Do not scan every boundary again after a long-set cut pass.
     if(j.kind==='cut'){j.status='done';j.message='Cutting complete.';break;}
     rp_beginPrepare(j);break;
    }
    var batchResult=rp_cutBatch(j,start);ops+=batchResult.ops;if(batchResult.waiting)break;

   }else if(j.phase==='prepare'){
    if(j.prepTrack<j.tracks.length){if(rp_prepareTrack(j,j.prepTrack))j.prepTrack++;j.done=j.prepTrack;ops++;j.message='Building compact cleanup map · camera '+j.prepTrack+' / '+j.tracks.length;continue;}
    rp_finishPrepare(j);break;
   }else{
    if(j.task>=j.tasks.length){j.status='done';break;}
    var task=j.tasks[j.task],liveCleanup=app.project.activeSequence,tr=liveCleanup.videoTracks[task.track];
    if((tr.isLocked&&tr.isLocked())||(tr.isMuted&&tr.isMuted()))throw Error('Track locked or muted while switching or removing clips.');
    if(task.keep||j.kind==='angle'){
     var currentClip=rp_resolveTask(liveCleanup,task,j.frame);
     if(!currentClip)throw Error('Camera piece changed before switching. Resume to rebuild the map.');
     if(Boolean(currentClip.disabled)!==!task.keep)currentClip.disabled=!task.keep;
     if(Boolean(currentClip.disabled)!==!task.keep)throw Error('Camera change was not confirmed.');
     j.changed++;
    }else{
     // Never trust a stale clip object after earlier removals. Re-resolve the exact loser
     // by protected track + start/end range immediately before deletion.
     var target=rp_resolveTask(liveCleanup,task,j.frame);
     // Final winner guard: the selected camera for this interval can never be deleted.
     if((task.winner!==undefined?task.winner:(task.interval>=0?j.winners[task.interval]:-999))===task.track){j.skipped++;j.message='Winner protection blocked an unsafe delete.';}
     else if(!target)throw Error('Camera piece changed before cleanup. Resume to rebuild the map.');
     else{
      // v2.3.11.2 FAST CLEANUP: the compact map is built after all transition cuts.
      // Winner tasks are never deleted, so repeating a full winner-coverage scan for every loser
      // is redundant and was the largest cleanup bottleneck on long DJ sets.
      // Keep the destructive invariants: every covered interval must have a real different winner.
      for(var si=task.interval;si<=task.lastInterval;si++){
       var winner=j.winners[si];if(winner<0||winner===task.track)throw Error('Preserved scene cannot be deleted.');
       var wt=liveCleanup.videoTracks[winner];if(!wt||(wt.isLocked&&wt.isLocked())||(wt.isMuted&&wt.isMuted()))throw Error('Winner track unavailable. Cleanup stopped.');
      }
      var n=tr.clips.numItems,mkey=rp_mediaKey(task.track,target);rp_removeVideo(liveCleanup,target);rp_invalidateRange(tr);
      if(app.project.activeSequence.videoTracks[task.track].clips.numItems>=n)throw Error('Removal was not confirmed. Resume to inspect the live timeline.');
      j.removed++;j.liveCounts['v'+task.track]--;
      var tk='v'+task.track,tree=j.removalTrees[tk]||(j.removalTrees[tk]={});
      for(var fi=task.clipIndex+1;fi<=j.trackSizes[tk];fi+=fi&-fi)tree[fi]=(tree[fi]||0)+1;
      if(j.mediaCounts){j.mediaCounts[mkey]--;if(j.mediaCounts[mkey]===0)j.cameraMediaSignature=rp_cameraMediaSignature(app.project.activeSequence,j.tracks);}
     }
    }
    j.task++;j.done++;ops++;
   }
  }
  if(j.status==='done')j.message=j.cameraWarning?('Done with camera warning: '+j.cameraWarning):'Done';
 }catch(e){

  j.status='error';j.message=String(e)+' [stage '+String(j.phase)+', point '+String(j.point)+', track '+String(j.track)+']';
 }
 rp_gc();if(j.status!=='running'){j.tasks=[];j.removalTrees=null;j.mediaCounts=null;j.seq=null;}return rp_state();
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
 if(!s.audioTracks.numTracks)throw Error('No A1 track.');
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
 if(!clips.length)throw Error('A1 is empty or all clips are disabled.');
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

/* Commercial host gate: public entry points refuse work without a short-lived licensed session. */
function rp_guardLicensed(fn){return function(){try{rp_requireLicense();return fn.apply(this,arguments);}catch(e){return rp_encode({ok:false,status:'error',code:'ACCOUNT_ACCESS_REQUIRED',message:String(e)});}};}
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
rp_zoomStep=rp_guardLicensed(rp_zoomStep);
rp_best15ResolvePreset=rp_guardLicensed(rp_best15ResolvePreset);
rp_best15Begin=rp_guardLicensed(rp_best15Begin);
rp_best15Step=rp_guardLicensed(rp_best15Step);
rp_step=rp_guardLicensed(rp_step);
rp_getA1=rp_guardLicensed(rp_getA1);
rp_a1Begin=rp_guardLicensed(rp_a1Begin);
rp_a1Upload=rp_guardLicensed(rp_a1Upload);
rp_a1DirectApply=rp_guardLicensed(rp_a1DirectApply);
rp_a1Step=rp_guardLicensed(rp_a1Step);
