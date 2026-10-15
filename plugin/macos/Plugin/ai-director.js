/* R Project Agent AI Director. Agent AI Director engine with optional AI Vision frame analysis. */
(function(root){
'use strict';
function node(name){if(!root.cep_node)throw Error('CEP Node is unavailable. Reinstall the plugin.');return root.cep_node.require(name);}
function check(state){if(state&&state.cancelled)throw Error('Agent AI Director stopped.');}
function stamp(snapshot){
 var fs=node('fs'),seen={},out=[];
 snapshot.tracks.forEach(function(t){t.clips.forEach(function(c){if(c.file&&!seen[c.file]){seen[c.file]=true;try{var s=fs.statSync(c.file);out.push([c.file,s.size,s.mtimeMs]);}catch(e){out.push([c.file,'unavailable']);}}});});
 return JSON.stringify(out);
}
function clamp(v,a,b){return Math.max(a,Math.min(b,v));}
function median(a){if(!a.length)return 0;var x=a.slice().sort(function(p,q){return p-q;}),m=Math.floor(x.length/2);return x.length%2?x[m]:(x[m-1]+x[m])/2;}
function quantile(a,q){if(!a.length)return 0;var x=a.slice().sort(function(p,q){return p-q;}),p=(x.length-1)*q,lo=Math.floor(p),hi=Math.ceil(p);return lo===hi?x[lo]:x[lo]+(x[hi]-x[lo])*(p-lo);}
function hash01(s){var h=2166136261>>>0;for(var i=0;i<String(s).length;i++){h^=String(s).charCodeAt(i);h=Math.imul(h,16777619)>>>0;}return (h%100000)/100000;}
var MIN_CUT_BEATS=4,MAX_CUT_BEATS=8;
// Frame-snapped 4-beat shots measure slightly under 4 beats (one frame is up to ~0.12 beat); merge, validate and block with the same tolerance.
var SHOT_BEAT_TOLERANCE=.25;
function allowedBeat(v){v=Math.round(Number(v)||MIN_CUT_BEATS);return Math.max(MIN_CUT_BEATS,Math.min(MAX_CUT_BEATS,v));}
function nextFaster(v){return allowedBeat(Math.max(MIN_CUT_BEATS,Math.round(Number(v)/2)));}
function nextSlower(v){return allowedBeat(Math.min(MAX_CUT_BEATS,Math.round(Number(v)*2)));}
function safeCadence(v){return allowedBeat(v);}
function compactEnergy(music,duration){
 var list=(music||[]).filter(function(x){return isFinite(Number(x.time))&&isFinite(Number(x.energy));});
 if(!list.length)return [{start:0,end:duration,energy:50,level:'mid'}];
 var vals=list.map(function(x){return Number(x.energy);}),lo=quantile(vals,.30),hi=quantile(vals,.72),windowSec=Math.max(8,Math.min(16,duration/Math.max(6,Math.min(20,Math.ceil(duration/45))))),out=[];
 for(var t=0;t<duration;t+=windowSec){var sum=0,n=0;for(var i=0;i<list.length;i++){var z=Number(list[i].time);if(z>=t&&z<Math.min(duration,t+windowSec)){sum+=Number(list[i].energy);n++;}}var e=n?sum/n:median(vals),level=e>=hi?'high':e<=lo?'low':'mid';out.push({start:t,end:Math.min(duration,t+windowSec),energy:e,level:level});}
 return out;
}
function v5EnergyZones(musicAnalysis,duration){
 var src=musicAnalysis&&musicAnalysis.music_v5&&Array.isArray(musicAnalysis.music_v5.sections)?musicAnalysis.music_v5.sections:[],out=[];
 for(var i=0;i<src.length;i++){var x=src[i],start=Number(x.start_second),end=Number(x.end_second),e=Number(x.energy);if(!isFinite(start)||!isFinite(end)||end<=start)continue;if(!isFinite(e))e=.5;var section=String(x.section||'groove'),level=e>=.67?'high':e<=.30?'low':'mid';if(section==='drop-impact'||section==='drop-body'||section==='pre-drop')level='high';else if(section==='breakdown'||section==='intro'||section==='outro')level='low';out.push({start:start,end:end,energy:e*100,level:level,trend:String(x.trend||'stable'),section:section});}
 return out;
}
function buildPacing(music,duration,musicAnalysis){
 var zones=v5EnergyZones(musicAnalysis,duration);if(!zones.length)zones=compactEnergy(music,duration);var segments=[],last=null;
 for(var i=0;i<zones.length;i++){var z=zones[i],cad=z.level==='high'?4:z.level==='low'?8:6;if(z.section==='drop-impact'||z.section==='drop-body'||z.section==='pre-drop'||z.section==='build-up')cad=4;else if(z.section==='breakdown'||z.section==='intro'||z.section==='outro')cad=8;cad=safeCadence(cad);if(last&&last.beats_per_cut===cad)continue;last={start_second:Math.round(Number(z.start||0)*100)/100,beats_per_cut:cad,max_hold_beats:8,reason:'Automatic A1 energy/structure fallback'};segments.push(last);}
 if(!segments.length)segments=[{start_second:0,beats_per_cut:6,max_hold_beats:8,reason:'Automatic fallback'}];
 return {summary:'Automatic 4/6/8-beat pacing from A1 music structure',segments:segments,config:{base:6,minCadence:4,maxCadence:8,explicitCadence:false,energyAdaptive:true,maxHoldBeats:8,source:'auto-fallback'}};
}
function parseRoles(text){
 var map={},src=String(text||'').replace(/\r\n?/g,'\n').replace(/;/g,'\n'),lines=src.split('\n'),idx=0;
 for(var i=0;i<lines.length;i++){
  var line=String(lines[i]||'').trim();if(!line)continue;
  var legacy=line.match(/^\s*[Vv]\s*(\d{1,2})\s*(?:[:=\-–—]\s*)?(.*?)\s*$/),role,key;
  if(legacy){key=Math.max(0,Number(legacy[1])-1);role=String(legacy[2]||'').trim();}
  else{key=idx;role=line.replace(/^\s*(?:camera|cam|angle)\s*\d*\s*[:=\-–—]?\s*/i,'').trim();}
  if(!role)role='camera '+(key+1);map[key]=role.toLowerCase();idx++;
 }
 return map;
}
function enabledCameraMap(list){var map={},has=Array.isArray(list)&&list.length>0;if(has)for(var i=0;i<list.length;i++){var n=Number(list[i]);if(isFinite(n)&&n>=0)map[n]=true;}return {map:map,restricted:has};}
function filterEnabledCameras(cands,list){var state=enabledCameraMap(list);if(!state.restricted)return (cands||[]).slice();var out=[];for(var i=0;i<(cands||[]).length;i++)if(state.map[cands[i]])out.push(cands[i]);return out;}
function roleMatchCameras(cands,roleMap,wanted,excludeCamera,excludeSameRole){
 var out=[],exRole=excludeCamera>=0?String(roleMap[excludeCamera]||'').trim().toLowerCase():'';
 for(var w=0;w<wanted.length;w++)for(var i=0;i<cands.length;i++){
  var cam=cands[i];if(cam===excludeCamera)continue;
  var role=String(roleMap[cam]||'').trim().toLowerCase();if(excludeSameRole&&exRole&&role&&role===exRole)continue;
  if(roleTags(role)[wanted[w]]&&out.indexOf(cam)<0)out.push(cam);
 }
 return out;
}
function differentAnglePool(cands,last,roleMap){
 var src=(cands||[]).slice(),lastRole=String(roleMap&&roleMap[last]||'').trim().toLowerCase(),strong=src.filter(function(c){var r=String(roleMap&&roleMap[c]||'').trim().toLowerCase();return c!==last&&(!lastRole||!r||r!==lastRole);});if(strong.length)return contrastPool(strong,last,roleMap);var different=src.filter(function(c){return c!==last;});return different.length?contrastPool(different,last,roleMap):src;
}
function randomAntiRepeatCamera(cands,history,last){var pool=antiRepeatPool(cands,history,last);if(!pool.length)pool=(cands||[]).slice();if(!pool.length)return -1;return pool[Math.floor(Math.random()*pool.length)];}
function dropBodyEventAt(musicAnalysis,start,end){
 var events=musicAnalysis&&Array.isArray(musicAnalysis.structure_events)?musicAnalysis.structure_events:[];start=Number(start)||0;end=Number(end)||start;
 for(var i=0;i<events.length;i++){var d=Number(events[i].drop_time),de=Number(events[i].drop_end);if(!isFinite(d)||!isFinite(de)||de<=d)continue;if(start>=d-.15&&start<de-.01)return events[i];}
 return null;
}
function roleTags(s){s=String(s||'').toLowerCase();return {wide:/wide|master|establish/.test(s),close:/close|cu|detail/.test(s),crowd:/crowd|audience|penonton/.test(s),dj:/dj|artist|performer/.test(s),behind:/behind|rear|back(?:\s+of)?\s*dj|belakang/.test(s),side:/side|rear|back|stage/.test(s),medium:/medium|mid/.test(s)};}
function roleProfile(role){
 var s=' '+String(role||'').toLowerCase().replace(/[^a-z0-9]+/g,' ')+' ',size=null,dir=null;
 if(/ (medium|mid) wide | mws | medium long /.test(s))size='wide';
 else if(/ (wide|master|establish|establishing|full|long|lebar|ws|drone|aerial|overview) /.test(s))size='wide';
 else if(/ (medium|mid|ms|half) /.test(s))size='medium';
 else if(/ (close|closeup|cu|ecu|tight|detail|insert|deck|decks|mixer|cdj|cdjs|hands?|tangan|face|wajah) /.test(s))size='close';
 if(/ (behind|rear|back|belakang) /.test(s))dir='behind';
 else if(/ (left|kiri) /.test(s))dir='left';
 else if(/ (right|kanan) /.test(s))dir='right';
 else if(/ (front|depan) /.test(s))dir='front';
 else if(/ (top|overhead|drone|aerial|atas) /.test(s))dir='top';
 else if(/ (crowd|audience|penonton) /.test(s))dir='crowd';
 else if(/ (side|samping|stage) /.test(s))dir='side';
 return {size:size,dir:dir};
}
function roleConflict(a,b){
 if(!a||!b)return false;
 if(a.size&&b.size)return a.size===b.size;
 if(a.dir&&b.dir)return a.dir===b.dir;
 return false;
}
function camerasConflict(roleMap,x,y){return x>=0&&y>=0&&x!==y&&roleConflict(roleProfile(roleMap&&roleMap[x]),roleProfile(roleMap&&roleMap[y]));}
function contrastPool(cands,last,roleMap){
 var src=(cands||[]).slice();if(!(last>=0))return src;
 var out=src.filter(function(c){return c!==last&&!camerasConflict(roleMap,last,c);});
 return out.length?out:src;
}
// Final pass: a physical cut must not join two cameras of the same kind (wide -> wide,
// close -> close, behind -> behind). Whole shots are swapped, so shot lengths, exact-drop
// cameras and the 4-beat / max-hold rules stay as they were.
function enforceRoleContrast(choices,intervals,enabledCameras,roleMap,bpm){
 var out=choices.map(function(c){return Object.assign({},c);}),repairs=0,warnings=[];
 function runs(){var r=[];for(var i=0;i<out.length;i++){var cam=Number(out[i].camera),last=r[r.length-1];if(last&&last.camera===cam)last.end=i;else r.push({start:i,end:i,camera:cam});}return r;}
 function locked(run){for(var j=run.start;j<=run.end;j++)if(/^(drop|drop-force)$/.test(String(out[j].structureLock||'')))return true;return false;}
 function covering(run){var pool=null;for(var j=run.start;j<=run.end;j++){var c=filterEnabledCameras(intervals[j]&&intervals[j].candidates||[],enabledCameras);pool=pool===null?c:pool.filter(function(x){return c.indexOf(x)>=0;});}return pool||[];}
 function seconds(cam){var t=0;for(var j=0;j<out.length;j++)if(Number(out[j].camera)===cam)t+=Math.max(0,Number(intervals[j].end)-Number(intervals[j].start));return t;}
 function replace(run,prev,next){
  if(locked(run))return false;
  var opts=covering(run).filter(function(c){return c!==run.camera&&(!prev||c!==prev.camera)&&(!next||c!==next.camera)&&!(prev&&camerasConflict(roleMap,prev.camera,c))&&!(next&&camerasConflict(roleMap,c,next.camera));});
  if(!opts.length)return false;
  opts.sort(function(a,b){return seconds(a)-seconds(b)||a-b;});
  var cam=opts[0],role=roleMap&&roleMap[cam]?' ('+roleMap[cam]+')':'';
  for(var j=run.start;j<=run.end;j++){out[j].camera=cam;out[j].reason='Camera Role Contrast: Camera '+(cam+1)+role+' replaces a same-type angle so consecutive shots change shot size/direction.';out[j].confidence='high';}
  repairs++;return true;
 }
 // No other angle type available: drop the cut instead (continue the previous shot), as
 // long as the joined shot stays within 16 beats.
 var beat=60/Math.max(40,Number(bpm)||120);
 function span(x,y){return Number(intervals[y.end].end)-Number(intervals[x.start].start);}
 function merge(from,into,first,last){
  if(locked(from)||into.camera<0||covering(from).indexOf(into.camera)<0||span(first,last)>16*beat+1e-6)return false;
  var role=roleMap&&roleMap[into.camera]?' ('+roleMap[into.camera]+')':'';
  for(var j=from.start;j<=from.end;j++){out[j].camera=into.camera;out[j].reason='Camera Role Contrast: Camera '+(into.camera+1)+role+' continues instead of cutting to another angle of the same type.';out[j].confidence='high';}
  repairs++;return true;
 }
 for(var pass=0;pass<Math.max(1,out.length);pass++){
  var r=runs(),changed=false;
  for(var i=1;i<r.length;i++){
   var a=r[i-1],b=r[i];if(!camerasConflict(roleMap,a.camera,b.camera))continue;
   if(replace(b,a,r[i+1])||replace(a,r[i-2],b)||merge(b,a,a,b)||merge(a,b,a,b)){changed=true;break;}
  }
  if(!changed)break;
 }
 var final=runs();for(var k=1;k<final.length;k++)if(camerasConflict(roleMap,final[k-1].camera,final[k].camera))warnings.push(k);
 return {choices:out,repairs:repairs,warnings:warnings};
}
function energyAt(music,t){
 var list=music||[],best=50,d=1e9;for(var i=0;i<list.length;i++){var x=Math.abs(Number(list[i].time)-t);if(x<d){d=x;best=Number(list[i].energy)||0;}}return clamp(best,0,100);
}
function frameAt(track,interval){var time=(interval.start+interval.end)/2;for(var i=0;i<track.clips.length;i++){var c=track.clips[i];if(c.supported&&!c.disabled&&c.start<=time&&c.end>time&&c.input>=0)return {file:c.file,input:c.input+time-c.start,time:time};}return null;}
function frameMetricsFromBuffer(b){
 if(!b||!b.length)return null;var sum=0,grad=0,w=96,h=54;for(var i=0;i<b.length;i++)sum+=b[i];for(var y=0;y<h;y++)for(var x=0;x<w;x++){var k=y*w+x;if(x+1<w)grad+=Math.abs(b[k]-b[k+1]);if(y+1<h)grad+=Math.abs(b[k]-b[k+w]);}
 return {brightness:sum/b.length,detail:grad/Math.max(1,(w-1)*h+w*(h-1))};
}
function readFrameMetrics(clip,ffmpeg,state){
 return new Promise(function(resolve,reject){
  check(state);var cp=node('child_process'),Buffer=node('buffer').Buffer,attempt=0,finished=false,profile=root.RPResourceGuard&&root.RPResourceGuard.profile?root.RPResourceGuard.profile():{threads:2,hardwareFrames:true};
  function run(hw){
   if(state&&state.cancelled){finished=true;reject(Error('Agent AI Director stopped.'));return;}var attemptDone=false,chunks=[],bytes=0,args=['-nostdin','-hide_banner','-v','error','-threads',String(profile.threads),'-filter_threads','1'];if(hw)args.push('-hwaccel','auto');args=args.concat(['-ss',String(clip.input),'-i',clip.file,'-map','0:v:0','-frames:v','1','-an','-vf','scale=96:54,format=gray','-f','rawvideo','pipe:1']);
   var proc=cp.spawn(ffmpeg,args,{windowsHide:true,shell:false});state.process=proc;var timer=setTimeout(function(){try{proc.kill();}catch(e){}finish(Error('AI Vision frame sample timed out.'));},20000);
   function finish(err,val){if(finished||attemptDone)return;attemptDone=true;if(err&&hw&&attempt===0&&!state.cancelled){clearTimeout(timer);state.process=null;attempt++;try{proc.kill();}catch(e){}return run(false);}finished=true;clearTimeout(timer);state.process=null;err?reject(err):resolve(val);}
   proc.stdout.on('data',function(c){bytes+=c.length;if(bytes>20000){try{proc.kill();}catch(e){}finish(Error('Unexpected AI Vision sample size.'));}else chunks.push(c);});proc.stderr.on('data',function(){});proc.on('error',function(){finish(Error('FFmpeg could not read AI Vision frame.'));});proc.on('close',function(code){if(state.cancelled)return finish(Error('Agent AI Director stopped.'));if(code!==0||bytes<96*54)return finish(Error('Could not decode AI Vision sample.'));var all=Buffer.concat(chunks),m=frameMetricsFromBuffer(all.slice(0,96*54));chunks.length=0;all=null;finish(null,m);});
  }
  run(profile.hardwareFrames);
 });
}
function sampleJobs(snapshot,budget,enabledCameras,musicAnalysis){
 var jobs=[];snapshot.intervals.forEach(function(it){var usable=filterEnabledCameras(it.candidates,enabledCameras);if(usable.length<2)return;usable.forEach(function(camera){var track=null;for(var j=0;j<snapshot.tracks.length;j++)if(snapshot.tracks[j].index===camera){track=snapshot.tracks[j];break;}var clip=track?frameAt(track,it):null;if(clip)jobs.push({id:it.id,camera:camera,clip:clip,time:(Number(it.start)+Number(it.end))/2,priority:0});});});
 if(jobs.length<=budget)return jobs;var events=musicAnalysis&&Array.isArray(musicAnalysis.structure_events)?musicAnalysis.structure_events:[];for(var a=0;a<jobs.length;a++){for(var e=0;e<events.length;e++){var d=Number(events[e].drop_time),b=Number(events[e].build_start);if(Math.abs(jobs[a].time-d)<=3)jobs[a].priority=Math.max(jobs[a].priority,3);else if(jobs[a].time>=b&&jobs[a].time<d)jobs[a].priority=Math.max(jobs[a].priority,2);}}
 var out=[],used={};function take(job){var k=job.id+'|'+job.camera;if(!used[k]){used[k]=1;out.push(job);}}
 jobs.filter(function(x){return x.priority>=3;}).forEach(function(x){if(out.length<Math.ceil(budget*.35))take(x);});
 jobs.filter(function(x){return x.priority===2;}).forEach(function(x){if(out.length<Math.ceil(budget*.55))take(x);});
 for(var n=0;out.length<budget&&n<budget*3;n++)take(jobs[Math.floor(n*(jobs.length-1)/Math.max(1,budget-1))]);
 return out.slice(0,budget);
}
function qualityScore(m){if(!m)return 0;var b=m.brightness,d=m.detail,s=0;if(b<18||b>242)s-=7;else if(b<32||b>225)s-=3;else s+=1;if(d<4)s-=5;else if(d<7)s-=2;else if(d>13)s+=2;else s+=1;return s;}
function dropEventAt(musicAnalysis,start,end){
 var events=musicAnalysis&&Array.isArray(musicAnalysis.structure_events)?musicAnalysis.structure_events:[];
 start=Number(start)||0;end=Number(end)||start;
 for(var i=0;i<events.length;i++){var d=Number(events[i].drop_time),impact=Number(events[i].impact_end)||d;if(start>=d-.15&&start<impact-.01)return events[i];}
 return null;
}
function preDropEventAt(musicAnalysis,start,end){
 var events=musicAnalysis&&Array.isArray(musicAnalysis.structure_events)?musicAnalysis.structure_events:[];
 start=Number(start)||0;end=Number(end)||start;
 var beat=Number(musicAnalysis&&musicAnalysis.approx_beat_interval_seconds)||0;if(!(beat>0)){var bpm=Number(musicAnalysis&&musicAnalysis.estimated_bpm)||0;if(bpm>0)beat=60/bpm;}if(!(beat>0))beat=.5;
 for(var i=0;i<events.length;i++){
  var d=Number(events[i].drop_time);if(!isFinite(d))continue;
  // The interval immediately ending on the detected drop is the final pre-drop scene.
  if(start<d-.05&&Math.abs(end-d)<=Math.max(.18,beat*.35))return events[i];
 }
 return null;
}
function selectedCamera(value,cands){var n=Number(value);return isFinite(n)&&n>=0&&cands.indexOf(n)>=0?n:-1;}
function recentCameraSet(history,count){var out={},h=Array.isArray(history)?history:[],n=Math.max(1,Number(count)||3);for(var i=Math.max(0,h.length-n);i<h.length;i++)if(Number(h[i])>=0)out[Number(h[i])]=true;return out;}
function antiRepeatPool(cands,history,last){var src=(cands||[]).slice(),other=src.filter(function(cam){return cam!==last;});return other.length?other:src;}
function weightedRandomCamera(cands,it,index,options,roleMap,last,lastUsed,metrics,history,usage){
 var e=energyAt(options.music,(it.start+it.end)/2),pool=[],total=0,source=contrastPool(antiRepeatPool(cands,history,last),last,roleMap),minUsage=Infinity;usage=usage||{};
 for(var u=0;u<source.length;u++)minUsage=Math.min(minUsage,Number(usage[source[u]])||0);if(!isFinite(minUsage))minUsage=0;
 for(var i=0;i<source.length;i++){
  var cam=source[i],tags=roleTags(roleMap[cam]),w=1;
  if(cam===last&&source.length>1)continue;
  if(e>=68){if(tags.crowd)w+=1.15;if(tags.dj||tags.close)w+=.85;if(tags.behind)w+=.65;if(tags.wide)w+=.45;}
  else if(e<=35){if(tags.wide)w+=1.05;if(tags.medium)w+=.75;if(tags.dj)w+=.35;}
  else{if(tags.dj||tags.medium)w+=.7;if(tags.wide)w+=.55;if(tags.crowd)w+=.35;}
  if(lastUsed[cam]!=null){var ago=index-lastUsed[cam];if(ago<=2)w*=.52;else if(ago<=4)w*=.78;}
  var over=Math.max(0,(Number(usage[cam])||0)-minUsage),unit=Math.max(.5,Number(it.end)-Number(it.start));w*=1/(1+over/Math.max(8,unit*6));
  var metric=metrics[it.id+'|'+cam];if(metric){var qs=qualityScore(metric);w*=clamp(1+qs*.08,.55,1.5);}
  w=Math.max(.05,w);total+=w;pool.push({camera:cam,weight:w});
 }
 if(!pool.length){for(i=0;i<source.length;i++)pool.push({camera:source[i],weight:1});total=pool.length;}
 var r=hash01('bg|'+index+'|'+Number(it.start).toFixed(3)+'|'+Number(it.end).toFixed(3)+'|'+last+'|'+source.join(','))*Math.max(.0001,total),acc=0;for(i=0;i<pool.length;i++){acc+=pool[i].weight;if(r<=acc)return pool[i].camera;}return pool[pool.length-1].camera;
}
function structuralCamera(cands,roleMap,wanted,last){
 for(var w=0;w<wanted.length;w++)for(var i=0;i<cands.length;i++)if(cands[i]!==last&&roleTags(roleMap[cands[i]])[wanted[w]])return cands[i];
 for(w=0;w<wanted.length;w++)for(i=0;i<cands.length;i++)if(roleTags(roleMap[cands[i]])[wanted[w]])return cands[i];
 return -1;
}


function weightedDropCamera(cands,it,index,roleMap,last,lastUsed,usage){
 var source=differentAnglePool(cands,last,roleMap),pool=[],total=0,minUsage=Infinity;usage=usage||{};if(!source.length)source=(cands||[]).slice();for(var u=0;u<source.length;u++)minUsage=Math.min(minUsage,Number(usage[source[u]])||0);if(!isFinite(minUsage))minUsage=0;
 for(var i=0;i<source.length;i++){var cam=source[i],tags=roleTags(roleMap[cam]),w=1;if(tags.behind)w+=4.2;if(tags.crowd)w+=3.2;if(tags.dj||tags.close)w+=2.5;if(tags.medium)w+=1.3;if(tags.wide)w+=.8;if(lastUsed[cam]!=null&&index-lastUsed[cam]<=2)w*=.62;var over=Math.max(0,(Number(usage[cam])||0)-minUsage),unit=Math.max(.5,Number(it.end)-Number(it.start));w*=1/(1+over/Math.max(10,unit*8));w=Math.max(.05,w);pool.push({camera:cam,weight:w});total+=w;}
 var r=hash01('drop|'+index+'|'+Number(it.start).toFixed(3)+'|'+last+'|'+source.join(','))*Math.max(.0001,total),acc=0;for(i=0;i<pool.length;i++){acc+=pool[i].weight;if(r<=acc)return pool[i].camera;}return pool.length?pool[pool.length-1].camera:-1;
}


function structurePolicy(snapshot,options){
 var events=options.musicAnalysis&&options.musicAnalysis.structure_events||[],enabled=options.enabledCameras||[],intervals=snapshot.intervals.map(function(it){var copy={};Object.keys(it).forEach(function(k){copy[k]=it[k];});copy.candidates=filterEnabledCameras(it.candidates||[],enabled);copy.policyDropEvent=null;return copy;}),allowed=intervals.map(function(it){return it.candidates.slice();});
 for(var e=0;e<events.length;e++){
  var event=events[e],d=Number(event.drop_time),idx=-1,dist=Infinity;if(!isFinite(d))continue;
  for(var i=0;i<intervals.length;i++){var delta=Math.abs(Number(intervals[i].start)-d);if(delta<dist){dist=delta;idx=i;}}
  var bpm=Number(options.musicAnalysis.estimated_bpm)||120,beat=60/bpm;if(root.RPBeatFirst)beat=60/root.RPBeatFirst.bpmAt(options.musicAnalysis.beat_first&&options.musicAnalysis.beat_first.tempo_map||[],d,bpm);
  if(idx>=0&&dist<=Math.max(Number(snapshot.frame)||0,beat*.36)+.001)intervals[idx].policyDropEvent=event;
 }
 return {intervals:intervals,allowed:allowed};
}
function validateStructure(choices,allowed){if(!Array.isArray(allowed)||allowed.length!==choices.length)throw Error('Build-up/drop policy is missing. Generate a new plan.');for(var i=0;i<choices.length;i++){var pool=Array.isArray(allowed[i])?allowed[i]:[],cam=Number(choices[i].camera);if(cam<0&&!pool.length)continue;if(pool.indexOf(cam)<0)throw Error('Build-up/drop camera rule violated at shot '+(i+1)+'. Generate a new plan.');}return true;}

function chooseCamera(it,index,options,roleMap,last,lastUsed,metrics,history,usage){
 var original=it.candidates||[],cands=filterEnabledCameras(original,options.enabledCameras);if(!cands.length)return {camera:-1,reason:original.length?'No enabled camera covers this beat interval.':'No camera fully covers this beat interval.',confidence:'high'};
 var dropEvent=it.policyDropEvent!==undefined?it.policyDropEvent:dropEventAt(options.musicAnalysis,it.start,it.end),dropBody=dropBodyEventAt(options.musicAnalysis,it.start,it.end);
 if(dropEvent){
  var forcedDrop=Number(options.dropCamera);if(options.dropCamera!==null&&options.dropCamera!==undefined&&isFinite(forcedDrop)&&forcedDrop>=0&&forcedDrop===Math.floor(forcedDrop)&&cands.indexOf(forcedDrop)>=0){var fr=roleMap[forcedDrop]?' ('+roleMap[forcedDrop]+')':'';return {camera:forcedDrop,reason:'Main Drop Camera: forced V'+(forcedDrop+1)+fr+' exactly on the validated drop impact.',confidence:'high',structureLock:'drop-force'};}
  var diff=differentAnglePool(cands,last,roleMap);if(!diff.length&&cands.length>1)diff=cands.filter(function(cam){return cam!==last;});
  var autoDrop=weightedDropCamera(diff.length?diff:cands,it,index,roleMap,last,lastUsed,usage);if(autoDrop<0)autoDrop=randomAntiRepeatCamera(diff.length?diff:cands,history,last);
  if(autoDrop>=0){var ar=roleMap[autoDrop]?' ('+roleMap[autoDrop]+')':'';return {camera:autoDrop,reason:(options.dropCamera!==null&&options.dropCamera!==undefined?'Main Drop Camera unavailable here; fallback: ':'Auto Music Map drop impact: ')+'Camera '+(autoDrop+1)+ar+' selected exactly on the detected drop with an angle change when coverage allows.',confidence:'high',structureLock:'drop'};}
 }
 if(dropBody){
  var bodyPool=antiRepeatPool(cands,history,last),bd=weightedRandomCamera(bodyPool,it,index,options,roleMap,last,lastUsed,metrics,history,usage),bdr=roleMap[bd]?' ('+roleMap[bd]+')':'';
  return {camera:bd,reason:'Auto Music Map drop body: Camera '+(bd+1)+bdr+' · high-energy anti-repeat flow.',confidence:metrics[it.id+'|'+bd]?'high':'medium',structureLock:'drop-body'};
 }
 var pre=preDropEventAt(options.musicAnalysis,it.start,it.end),pool=cands.slice();
 if(pre){
  var prePool=contrastPool(antiRepeatPool(pool,history,last),last,roleMap),forcedFuture=options.dropCamera!==null&&options.dropCamera!==undefined?Number(options.dropCamera):-1;if(isFinite(forcedFuture)&&forcedFuture>=0){var withoutForced=prePool.filter(function(c){return c!==forcedFuture;});if(withoutForced.length)prePool=withoutForced;}var autoPre=structuralCamera(prePool,roleMap,['wide','crowd','medium','dj','close','behind'],last);if(autoPre<0)autoPre=structuralCamera(pool,roleMap,['wide','crowd','medium','dj','close','behind'],last);if(autoPre<0)autoPre=randomAntiRepeatCamera(prePool.length?prePool:pool,history,last);
  if(autoPre>=0){var pr=roleMap[autoPre]?' ('+roleMap[autoPre]+')':'';return {camera:autoPre,reason:'Auto Music Map pre-drop: Camera '+(autoPre+1)+pr+' prepares a contrasting angle before the detected impact.',confidence:'high',structureLock:'pre-drop'};}
 }
 var picked=weightedRandomCamera(pool,it,index,options,roleMap,last,lastUsed,metrics,history,usage),role=roleMap[picked]?' ('+roleMap[picked]+')':'';
 return {camera:picked,reason:'Auto music-aware flow: Camera '+(picked+1)+role+' · energy-weighted anti-repeat selection'+(metrics[it.id+'|'+picked]?' · AI Vision checked':''),confidence:metrics[it.id+'|'+picked]?'high':'medium',structureLock:''};
}
function enforceBuildDropDifference(choices,intervals,options,roleMap){
 var events=options&&options.musicAnalysis&&Array.isArray(options.musicAnalysis.structure_events)?options.musicAnalysis.structure_events:[],enabled=Array.isArray(options.enabledCameras)?options.enabledCameras:[],repairs=0,validated=0,unresolved=0,forced=0,fallbacks=0,preferred=options&&options.dropCamera!==null&&options.dropCamera!==undefined?Number(options.dropCamera):-1;
 function validAt(idx){return filterEnabledCameras(intervals[idx]&&intervals[idx].candidates||[],enabled);}
 for(var e=0;e<events.length;e++){
  var dt=Number(events[e].drop_time);if(!isFinite(dt))continue;var pre=-1,drop=-1;
  for(var i=0;i<intervals.length;i++){var it=intervals[i];if(Number(it.start)<dt-.03&&Number(it.end)<=dt+.18)pre=i;if(Number(it.start)>=dt-.18&&Number(it.start)<=dt+.18&&Number(it.end)>dt+.03){drop=i;break;}}
  for(var pi=0;pi<intervals.length;pi++)if(intervals[pi].policyDropEvent===events[e]){drop=pi;pre=pi-1;break;}
  if(drop<0){for(i=0;i<intervals.length;i++){it=intervals[i];if(Number(it.start)<=dt+.03&&Number(it.end)>dt+.03){drop=i;break;}}}
  if(pre<0&&drop>0)pre=drop-1;if(drop<0)continue;
  var dropValid=validAt(drop);if(!dropValid.length)continue;
  var hasForced=isFinite(preferred)&&preferred>=0&&preferred===Math.floor(preferred)&&dropValid.indexOf(preferred)>=0;
  if(hasForced){choices[drop].camera=preferred;choices[drop].confidence='high';choices[drop].reason='Main Drop Camera: forced V'+(preferred+1)+' exactly on the validated drop impact.';choices[drop].structureLock='drop-force';forced++;}
  else if(isFinite(preferred)&&preferred>=0&&preferred===Math.floor(preferred)){fallbacks++;}
  if(pre<0||pre===drop)continue;
  var preValid=validAt(pre);if(!preValid.length)continue;
  var dropCam=Number(choices[drop]&&choices[drop].camera),preCam=Number(choices[pre]&&choices[pre].camera);
  if(preCam===dropCam){
   var preAlt=differentAnglePool(preValid,dropCam,roleMap).filter(function(c){return c!==dropCam;});
   if(preAlt.length){var preReplacement=structuralCamera(preAlt,roleMap,['wide','crowd','medium','dj','close','behind'],dropCam);if(preReplacement<0)preReplacement=randomAntiRepeatCamera(preAlt,[],dropCam);choices[pre].camera=preReplacement;choices[pre].confidence='high';choices[pre].reason='Pre-drop validator: changed pre-drop to V'+(preReplacement+1)+' to preserve the selected main-drop camera V'+(dropCam+1)+'.';choices[pre].structureLock='pre-drop';preCam=preReplacement;repairs++;}
   else {var alt=differentAnglePool(dropValid,preCam,roleMap).filter(function(c){return c!==preCam;});if(alt.length){var replacement=structuralCamera(alt,roleMap,['behind','crowd','dj','close','medium','wide'],preCam);if(replacement<0)replacement=randomAntiRepeatCamera(alt,[],preCam);choices[drop].camera=replacement;choices[drop].confidence='high';if(hasForced){fallbacks++;forced=Math.max(0,forced-1);}choices[drop].reason='Auto Music Map drop validator: changed exact-drop angle to V'+(replacement+1)+' so pre-drop and drop are different.';choices[drop].structureLock='drop';dropCam=replacement;repairs++;}else unresolved++;}
   
  }
  if(preCam!==Number(choices[drop]&&choices[drop].camera))validated++;
 }
 return {choices:choices,repairs:repairs,validated:validated,unresolved:unresolved,forced:forced,fallbacks:fallbacks};
}
function enforceMaxHold(choices,intervals,musicAnalysis,enabledCameras){
 var state={last:-999,held:0,forced:0,warnings:[]},out=[];
 for(var i=0;i<choices.length;i++){
  var copy=Object.assign({},choices[i]),it=Object.assign({},intervals[i]);
  it.candidates=filterEnabledCameras(it.candidates||[],enabledCameras);
  root.RPBeatFirst.guardHold(copy,it,musicAnalysis,state);out.push(copy);
 }
 return {choices:out,forced:state.forced,warnings:state.warnings};
}
function physicalShotRuns(choices,intervals,musicAnalysis){
 var map=musicAnalysis&&musicAnalysis.beat_first&&musicAnalysis.beat_first.tempo_map||[],bpm=Number(musicAnalysis&&musicAnalysis.estimated_bpm)||120,runs=[];
 function beats(a,b){return root.RPBeatFirst&&root.RPBeatFirst.beatDistance?root.RPBeatFirst.beatDistance(map,a,b,bpm):Math.max(0,(b-a)*bpm/60);}
 for(var i=0;i<choices.length;i++){var cam=Number(choices[i].camera),last=runs[runs.length-1];if(last&&last.camera===cam){last.end=i;last.endTime=Number(intervals[i].end);}else runs.push({start:i,end:i,camera:cam,startTime:Number(intervals[i].start),endTime:Number(intervals[i].end)});}
 for(i=0;i<runs.length;i++)runs[i].beats=beats(runs[i].startTime,runs[i].endTime);
 return runs;
}
function validateMinimumPhysicalTransitions(choices,intervals,musicAnalysis){
 if(!Array.isArray(choices)||!Array.isArray(intervals)||choices.length!==intervals.length)throw Error('Camera plan is incomplete.');
 var short=physicalShotRuns(choices,intervals,musicAnalysis).filter(function(r){return r.camera>=0&&r.beats<4-SHOT_BEAT_TOLERANCE;});
 if(short.length)throw Error('4-beat minimum: '+short.length+' camera shot(s) remain too short; first at '+short[0].startTime.toFixed(3)+'s ('+short[0].beats.toFixed(2)+' beats). Coverage or exact-drop constraints prevent a safe merge. No timeline changes made. Review camera coverage and regenerate the plan.');
 return true;
}
function enforceMinimumPhysicalTransitions(choices,intervals,musicAnalysis,enabledCameras){
 var out=choices.map(function(c){return Object.assign({},c);}),repairs=0,warnings=[],locks={},contrasts={},limit=Math.max(1,choices.length),pass=0;
 function exact(c){return c&&(/^(drop|drop-force)$/.test(String(c.structureLock||'')));}
 for(var i=0;i<out.length;i++)if(exact(out[i])){locks[i]=Number(out[i].camera);if(i>0&&Number(out[i-1].camera)>=0&&Number(out[i-1].camera)!==locks[i])contrasts[i-1]=locks[i];}
 function replaceRun(run,cam){
  if(cam<0)return false;
  for(var j=run.start;j<=run.end;j++){
   if(locks.hasOwnProperty(j)&&locks[j]!==cam)return false;
   if(contrasts.hasOwnProperty(j)&&contrasts[j]===cam)return false;
   if(filterEnabledCameras(intervals[j].candidates||[],enabledCameras).indexOf(cam)<0)return false;
  }
  for(j=run.start;j<=run.end;j++)if(Number(out[j].camera)!==cam){out[j].camera=cam;out[j].reason='4-beat Shot Guard: merged an optional camera transition while preserving exact drops and full footage coverage.';out[j].confidence='high';if(!exact(out[j]))out[j].structureLock='';repairs++;}
  return true;
 }
 while(pass++<limit){
  var runs=physicalShotRuns(out,intervals,musicAnalysis),changed=false;
  for(var n=0;n<runs.length;n++){
   var r=runs[n];if(r.camera<0||r.beats>=4-SHOT_BEAT_TOLERANCE)continue;
   var prev=n>0?runs[n-1]:null,next=n+1<runs.length?runs[n+1]:null;
   // Every repair removes a physical transition; locked exact-drop cameras cannot be changed.
   if(prev&&prev.camera>=0&&replaceRun(r,prev.camera)){changed=true;break;}
   if(prev&&prev.camera>=0&&replaceRun(prev,r.camera)){changed=true;break;}
   if(next&&next.camera>=0&&replaceRun(next,r.camera)){changed=true;break;}
   if(next&&next.camera>=0&&replaceRun(r,next.camera)){changed=true;break;}
  }
  if(!changed)break;
 }
 var remaining=physicalShotRuns(out,intervals,musicAnalysis).filter(function(r){return r.camera>=0&&r.beats<4-SHOT_BEAT_TOLERANCE;});
 for(i=0;i<remaining.length;i++)warnings.push({time:remaining[i].startTime,beats:remaining[i].beats,message:'Shot remains below 4 beats because exact-drop timing/contrast or footage coverage prevents a safe merge. Apply is blocked.'});
 return {choices:out,repairs:repairs,warnings:warnings,minimumBeats:4,applyBlocked:remaining.length>0};
}
function validatePacing(result,duration){if(!result||!Array.isArray(result.segments)||!result.segments.length)throw Error('Agent AI pacing plan is incomplete.');return result;}
function validateDrops(result,candidates,target){if(!result||!Array.isArray(result.selections))throw Error('Agent AI Best Drop result is incomplete.');return result;}
function validate(result,intervals){if(!result||!Array.isArray(result.choices)||result.choices.length!==intervals.length)throw Error('Agent AI camera plan is incomplete.');return result;}
root.RPDirector={
 validateMinimumPhysicalTransitions:validateMinimumPhysicalTransitions,
 fresh:function(snapshot,original){return stamp(snapshot)===original;},
 structurePolicy:structurePolicy,validateStructure:validateStructure,sampleJobs:sampleJobs,enforceMaxHold:enforceMaxHold,enforceMinimumPhysicalTransitions:enforceMinimumPhysicalTransitions,validate:validate,validatePacing:validatePacing,validateDrops:validateDrops,
 pace:async function(options,state,progress){check(state);progress(.08,'Auto Music Map is building section-aware pacing…');await new Promise(function(r){setTimeout(r,0);});check(state);var musicEngine=root.RPMusicV12||root.RPMusicV10;var result=musicEngine&&musicEngine.pacing?musicEngine.pacing(options.musicAnalysis||{},Number(options.duration)||0):buildPacing(options.music||[],Number(options.duration)||0,options.musicAnalysis||null);progress(1,'Music-map pacing ready');return result;},
 selectDrops:async function(options,state,progress){
  check(state);var candidates=(options.candidates||[]).slice(),target=Math.max(1,Math.min(100,Number(options.target)||15));if(!candidates.length)throw Error('No usable music-drop candidates were found on A1.');progress(.1,'Agent AI engine is ranking music drops…');
  candidates.sort(function(a,b){return Number(b.score)-Number(a.score)||Number(a.time)-Number(b.time);});var n=Math.min(target,candidates.length),top=candidates.slice(0,n),scores=top.map(function(c){return Number(c.score)||0;}),hi=quantile(scores,.70),mid=quantile(scores,.35),sel=[];
  for(var i=0;i<top.length;i++){check(state);var c=top[i],conf=c.score>=hi?'high':c.score>=mid?'medium':'low';sel.push({candidate_id:c.id,reason:'AI score '+Number(c.score).toFixed(1)+' · energy Δ '+Number(c.energy_jump).toFixed(1)+' · bass Δ '+Number(c.bass_jump).toFixed(1),confidence:conf});progress(.1+.9*(i+1)/top.length,'Agent AI drop ranking '+(i+1)+' / '+top.length);await new Promise(function(r){setTimeout(r,0);});}
  return {summary:sel.length+' renderable drops ranked by Agent AI from A1 beat, energy, bass and build-up metrics.',selections:sel};
 },
 run:async function(snapshot,options,state,progress){
  var guard=root.RPResourceGuard,profile=guard&&guard.profile?guard.profile():{lowMemory:false,visionBudget:240};
  if(guard&&guard.preflight)await guard.preflight(state,'camera analysis');
  // Bound optional visual sampling only; beat/drop detail and camera coverage
  // policies are unchanged. Avoid mutating the user's saved settings.
  if(profile.lowMemory)options=Object.assign({},options,{budget:Math.min(profile.visionBudget,Math.max(1,Number(options.budget)||60))});
  var policy=structurePolicy(snapshot,options);snapshot=Object.assign({},snapshot,{intervals:policy.intervals});
  check(state);var enabled=Array.isArray(options.enabledCameras)?options.enabledCameras.slice():[];if(!enabled.length)throw Error('Enable at least one camera in Camera Selection.');var uncovered=[];for(var vi=0;vi<snapshot.intervals.length;vi++){var rawC=snapshot.intervals[vi].candidates||[],activeC=filterEnabledCameras(rawC,enabled);if(!activeC.length)uncovered.push(snapshot.intervals[vi]);}var preliminary=enforceMaxHold(snapshot.intervals.map(function(it){return {id:it.id,camera:it.candidates.length?it.candidates[0]:-1};}),snapshot.intervals,options.musicAnalysis||null,enabled);if(preliminary.error)throw Error(preliminary.error);var initial=stamp(snapshot),jobs=options.vision?sampleJobs(snapshot,Math.max(1,Number(options.budget)||60),enabled,options.musicAnalysis||null):[],metrics={},failures=0,ffmpeg=jobs.length?root.RPAudio.executable(options.ffmpeg):null;
  for(var i=0;i<jobs.length;i++){check(state);if(guard&&guard.preflight)await guard.preflight(state,'AI Vision sampling');progress(.42*i/Math.max(1,jobs.length),'AI Vision sample '+(i+1)+' / '+jobs.length);try{metrics[jobs[i].id+'|'+jobs[i].camera]=await readFrameMetrics(jobs[i].clip,ffmpeg,state);}catch(e){check(state);failures++;}jobs[i].clip=null;if(profile.lowMemory||(i+1)%12===0)await new Promise(function(r){setTimeout(r,profile.lowMemory?100:0);});}jobs.length=0;
  var roles=parseRoles(options.roles),choices=[],last=-999,lastUsed={},history=[],usage={},liveHold={last:-999,held:0,forced:0,warnings:[]};for(i=0;i<snapshot.intervals.length;i++){check(state);var it=snapshot.intervals[i],pick=chooseCamera(it,i,options,roles,last,lastUsed,metrics,history,usage);root.RPBeatFirst.guardHold(pick,Object.assign({},it,{candidates:filterEnabledCameras(it.candidates||[],enabled)}),options.musicAnalysis,liveHold);choices.push({id:it.id,camera:pick.camera,reason:pick.reason,confidence:pick.confidence,structureLock:pick.structureLock||''});if(pick.camera>=0){last=pick.camera;lastUsed[pick.camera]=i;usage[pick.camera]=(Number(usage[pick.camera])||0)+Math.max(0,Number(it.end)-Number(it.start));history.push(pick.camera);if(history.length>6)history.shift();}if(i%30===0){progress(.42+.58*i/Math.max(1,snapshot.intervals.length),'Agent AI camera planning '+(i+1)+' / '+snapshot.intervals.length);await new Promise(function(r){setTimeout(r,0);});}}
  if(stamp(snapshot)!==initial)throw Error('Camera media changed during Agent AI analysis. Generate a new plan.');var hg={choices:choices,forced:0,warnings:[]},bd={choices:choices,repairs:0,validated:0,unresolved:0,forced:0,fallbacks:0},repaired=0;for(var ci=0;ci<choices.length;ci++){var interval=snapshot.intervals[ci]||{},valid=filterEnabledCameras(interval.candidates||[],enabled),chosen=Number(choices[ci].camera);if(chosen>=0&&valid.indexOf(chosen)<0){choices[ci].camera=valid.length?valid[0]:-1;choices[ci].confidence='medium';choices[ci].reason=valid.length?'Coverage resolver fallback: V'+(valid[0]+1)+' is enabled and available for this interval.':'Coverage resolver: no enabled camera covers this interval; leave it untouched.';choices[ci].structureLock='';repaired++;}else if(chosen<0&&valid.length){choices[ci].camera=valid[0];choices[ci].confidence='medium';choices[ci].reason='Coverage resolver fallback: V'+(valid[0]+1)+' is enabled and available for this interval.';choices[ci].structureLock='';repaired++;}}hg=enforceMaxHold(choices,snapshot.intervals,options.musicAnalysis||null,enabled,'');hg.forced+=liveHold.forced;if(hg.error)throw Error(hg.error);choices=hg.choices;bd=enforceBuildDropDifference(choices,snapshot.intervals,options,roles);choices=bd.choices;var physical=enforceMinimumPhysicalTransitions(choices,snapshot.intervals,options.musicAnalysis||null,enabled);choices=physical.choices;var contrast=enforceRoleContrast(choices,snapshot.intervals,enabled,roles,options.musicAnalysis&&options.musicAnalysis.estimated_bpm);choices=contrast.choices;validateStructure(choices,policy.allowed);if(root.RPBeatFirst)root.RPBeatFirst.validateHold(choices,snapshot.intervals,options.musicAnalysis);var summaries=['Auto Music Map V14 camera orchestration uses separate drop/background priorities, coverage-first candidates, usage balancing and mandatory angle contrast when an alternate camera is available.','Camera Selection: '+enabled.map(function(c){return 'Camera '+(Number(c)+1);}).join(', ')+' enabled.'];if(uncovered.length)summaries.push('Coverage Guard: '+uncovered.length+' interval'+(uncovered.length===1?'':'s')+' had no enabled camera coverage and will be left untouched instead of aborting the full edit.');var structureCount=options.musicAnalysis&&Number(options.musicAnalysis.structure_drop_count)||0;if(structureCount)summaries.push('Auto Music Map V14: '+structureCount+' build-up → drop transition'+(structureCount===1?'':'s')+' detected; exact-drop camera follows Main Drop Camera when available.');if(options.dropCamera!==null&&options.dropCamera!==undefined)summaries.push('Main Drop Camera: V'+(Number(options.dropCamera)+1)+' requested for every validated drop impact.');if(contrast.repairs)summaries.push('Camera Role Contrast: '+contrast.repairs+' shot'+(contrast.repairs===1?'':'s')+' swapped so the same type of angle (for example wide after wide) never follows itself.');if(contrast.warnings.length)summaries.push('Camera Role Contrast: '+contrast.warnings.length+' cut'+(contrast.warnings.length===1?'':'s')+' kept the same angle type because no other covered camera was available.');if(options.vision)summaries.push('AI Vision analysis: '+Object.keys(metrics).length+' successful, '+failures+' failed.');if(hg.forced)summaries.push('Max Hold Guard corrected '+hg.forced+' long same-camera run'+(hg.forced===1?'':'s')+'.');if(hg.warnings.length)summaries.push('Live Max-Hold Guard: '+hg.warnings.length+' interval(s) continued with a hold warning because no usable alternate or shorter boundary was available.');if(bd.forced)summaries.push('Main Drop Camera enforced on '+bd.forced+' validated drop impact'+(bd.forced===1?'':'s')+'.');if(bd.fallbacks)summaries.push('Main Drop Camera fallback used on '+bd.fallbacks+' drop impact'+(bd.fallbacks===1?'':'s')+' because the selected V-track was unavailable or disabled there.');if(bd.validated)summaries.push('Drop Director V2: '+bd.validated+' build-up → drop transition'+(bd.validated===1?'':'s')+' validated with different cameras.');if(bd.repairs)summaries.push('Drop Director V2 Auto-Repair corrected '+bd.repairs+' structural camera conflict'+(bd.repairs===1?'':'s')+'.');if(bd.unresolved)summaries.push('Drop Director V2: '+bd.unresolved+' transition'+(bd.unresolved===1?'':'s')+' could not change angle because no second usable camera covered the boundary.');if(repaired)summaries.push('Coverage Resolver corrected '+repaired+' camera choice'+(repaired===1?'':'s')+' after final validation.');if(physical.repairs)summaries.push('4-beat Shot Guard merged '+physical.repairs+' interval camera choices.');if(physical.warnings.length)summaries.push('4-beat minimum: '+physical.warnings.length+' unresolved short shot(s); Apply is blocked until camera coverage/plan is corrected.');progress(1,'Auto Music Map V14 camera plan ready');
  return {structurePolicy:policy.allowed,choices:choices,summaries:summaries,images:Object.keys(metrics).length,failedImages:failures,holdGuardChanges:hg.forced,minimumShotBeats:4,physicalShotRepairs:physical.repairs,physicalShotWarnings:physical.warnings,fingerprint:initial,snapshot:snapshot,model:'R Project Auto Music Map V14',mode:'AUTO_MUSIC_MAP_V11',roles:options.roles,enabledCameras:enabled,musicAnalysis:options.musicAnalysis||null};
 }
};
}(typeof window!=='undefined'?window:globalThis));
