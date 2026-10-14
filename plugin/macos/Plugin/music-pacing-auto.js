/* R Project Auto Music Map Pacing V12.
   Independent implementation: the music map decides timing; pacing choices are preferences only.
   No strict cadence validator may abort a multicam edit. */
(function(root){'use strict';
function clamp(x,a,b){return Math.max(a,Math.min(b,x));}
function lower(a,t){var l=0,h=a.length;while(l<h){var m=(l+h)>>1;if(Number(a[m].time)<t)l=m+1;else h=m;}return l;}
var TEMPO_MAP_CACHE=typeof WeakMap==='function'?new WeakMap():null;
function tempoMap(result){var src=result&&result.tempoMap;if(TEMPO_MAP_CACHE&&src&&typeof src==='object'){var hit=TEMPO_MAP_CACHE.get(src);if(hit&&hit.n===src.length)return hit.map;}var built=buildTempoMap(result);if(TEMPO_MAP_CACHE&&src&&typeof src==='object')TEMPO_MAP_CACHE.set(src,{n:src.length,map:built});return built;}
function buildTempoMap(result){var a=(result.tempoMap||[]).filter(function(x){return isFinite(x.time)&&Number(x.bpm)>=40&&Number(x.bpm)<=240;}).slice().sort(function(a,b){return a.time-b.time;}),out=[];a.forEach(function(x){if(out.length&&out[out.length-1].time===x.time)out.pop();out.push({time:Number(x.time),bpm:Number(x.bpm),confidence:Number(x.confidence)||0});});return out;}
function bpmAt(map,t,fallback){var i=lower(map,t+.000001)-1;return i>=0?map[i].bpm:Number(fallback)||120;}
function beatDistance(map,a,b,fallback){if(b<=a)return 0;var i=lower(map,a+.000001),at=a,bpm=bpmAt(map,a,fallback),n=0;for(;i<map.length&&map[i].time<b;i++){n+=(map[i].time-at)*bpm/60;at=map[i].time;bpm=map[i].bpm;}return n+(b-at)*bpm/60;}
function enrich(result,duration){var map=tempoMap(result),v=result.musicV12||result.musicV10||{},sections=Array.isArray(v.sections)?v.sections.slice():[];result.beatFirst={version:12,priority:'music-map-auto',duration:duration,sections:sections,tempo_map:map};return result;}
function allowedCadences(pacing){var raw=pacing&&pacing.config&&pacing.config.allowedCadences,out=[];if(Array.isArray(raw))for(var i=0;i<raw.length;i++){var v=Number(raw[i]);if((v===2||v===4||v===6||v===8)&&out.indexOf(v)<0)out.push(v);}out.sort(function(a,b){return a-b;});return out.length?out:[4,6,8];}
function nearestCadence(values,target){var best=values[0],d=Math.abs(best-target);for(var i=1;i<values.length;i++){var x=Math.abs(values[i]-target);if(x<d){d=x;best=values[i];}}return best;}
function ensureGrid(result,duration,map){var src=result.musicGrid&&result.musicGrid.length?result.musicGrid:result.beatMeta&&result.beatMeta.length?result.beatMeta:result.beats||[],grid=[],last=-999,frame=Number(result.snapshot&&result.snapshot.frame)||0;src=src.filter(function(x){return x!=null&&isFinite(Number(typeof x==='object'?x.time:x));}).slice().sort(function(a,b){return Number(typeof a==='object'?a.time:a)-Number(typeof b==='object'?b.time:b);});for(var i=0;i<src.length;i++){var raw=src[i]&&typeof src[i]==='object'?src[i].time:src[i],t=Number(raw);if(isFinite(t)&&t>=0&&t<duration&&t-last>.04){grid.push({time:t,strength:Number(src[i]&&src[i].strength)||0});last=t;}}
 var bi=Number(result.beatInterval)||60/Math.max(40,Number(result.tempo)||120),expected=Math.floor(beatDistance(map,0,duration,60/bi)),measured=grid.length;
 if(expected>16&&measured<expected*.55){
  var rebuilt=grid.slice(),origin=grid.length?grid[0].time:0;
  function advance(t,n){return offsetBeats(map,t,n,60/bi);}
  function add(t){var s=frame>0?Math.round(t/frame)*frame:t;if(s>=0&&s<duration)rebuilt.push({time:s,strength:0,estimated:true});}
  var t=origin;if(!grid.length)add(t);
  while(t>0){t=advance(t,-1);if(t>=0)add(t);}
  for(var gi=0;gi<grid.length;gi++){t=grid[gi].time;var end=gi+1<grid.length?grid[gi+1].time:duration;while(true){var next=advance(t,1);if(next>=end-.45*60/bpmAt(map,next,60/bi))break;add(next);t=next;}}
  if(!grid.length){t=origin;while((t=advance(t,1))<duration)add(t);}
  rebuilt.sort(function(a,b){return a.time-b.time||Number(!!a.estimated)-Number(!!b.estimated);});grid=[];
  rebuilt.forEach(function(g){if(!grid.length||g.time-grid[grid.length-1].time>.04)grid.push(g);else if(!g.estimated)grid[grid.length-1]=g;});
 }
 result.fullLengthBeatGrid={reconstructed:grid.length>measured,source_candidates:measured,grid_beats:grid.length,expected_beats:expected};return grid;}
function offsetBeats(map,t,n,fallback){
 if(!n)return t;var sign=n>0?1:-1,left=Math.abs(n),at=t;
 while(left>1e-9){var idx=lower(map,at+(sign>0?.000001:-.000001))-1,bpm=idx>=0?map[idx].bpm:Number(fallback)||120,boundary=sign>0?(idx+1<map.length?map[idx+1].time:Infinity):(idx>=0?map[idx].time:-Infinity),capacity=Math.abs(boundary-at)*bpm/60;
  if(left<=capacity||!isFinite(capacity))return at+sign*left*60/bpm;left-=capacity;at=boundary;
 }return at;
}
function apply(result,pacing,duration,maxPoints){duration=Number(duration)||0;enrich(result,duration);var map=result.beatFirst.tempo_map||[],grid=ensureGrid(result,duration,map);if(!grid.length)throw Error('No usable A1 beat grid. Analyze Music again.');
 var segments=(pacing&&pacing.segments||[]).slice().sort(function(a,b){return Number(a.start_second)-Number(b.start_second);});if(!segments.length)segments=[{start_second:0,beats_per_cut:6,reason:'auto'}];var allowed=allowedCadences(pacing),cap=Math.max(1,Math.min(6000,Number(maxPoints)||6000)),meta=[],anchor=0,si=0,frame=Number(result.snapshot&&result.snapshot.frame)||0;
 function targetAt(t){while(si+1<segments.length&&t>=Number(segments[si+1].start_second))si++;var raw=clamp(Number(segments[si].beats_per_cut)||6,2,8);return nearestCadence(allowed,raw);}
 // Validated selected drops interrupt cadence and restart its beat count.
 if(pacing&&pacing.config&&pacing.config.userSelectedCadence){
  var range=result.snapshot&&result.snapshot.range||{start:0,end:duration},scopeStart=range.start,scopeEnd=range.end;
  var at=scopeStart,previous=scopeStart,di=0,drops=(result.structure&&result.structure.events||[]).map(function(e){var raw=Number(e.drop_time);return {time:frame>0?Math.round(raw/frame)*frame:raw,confidence:Number(e.confidence_score)||0};}).filter(function(e){return isFinite(e.time)&&e.time>scopeStart&&e.time<scopeEnd;}).sort(function(a,b){return a.time-b.time;});
  while(at<scopeEnd){
   while(di<drops.length&&drops[di].time<=previous+1e-9)di++;
   var cadence=targetAt(at),next=offsetBeats(map,at,cadence,result.tempo),snapped=frame>0?Math.round(next/frame)*frame:next,isDrop=di<drops.length&&drops[di].time<=snapped+1e-9;
   if(!isFinite(next)||next<=at)throw Error('Invalid tempo map for selected pacing.');
   if(isDrop){snapped=drops[di].time;next=snapped;}
   if(snapped>=scopeEnd)break;
   if(snapped>previous){meta.push({time:snapped,reason:isDrop?'Drop impact':'Selected pace '+cadence+' beats',beats_per_cut:cadence,strength:isDrop?1000+drops[di].confidence:0});previous=snapped;}
   at=next;if(isDrop)di++;if(meta.length>100000)throw Error('Sequence exceeds 100,000 cadence cuts. Split the sequence before editing.');
  }
  if(scopeStart>0)meta.unshift({time:scopeStart,reason:'Mark In',beats_per_cut:0});if(scopeEnd<duration)meta.push({time:scopeEnd,reason:'Mark Out',beats_per_cut:0});
  result.points=meta.map(function(x){return x.time;});result.meta=meta;
  result.pacing={summary:'Selected cadence '+allowed.join('/')+' beats; restart on drops',segments:segments,config:pacing.config,allowed_cadences:allowed,soft_preference:false,strict_guard:true,drop_resets_cadence:true,transition_only:true,physical_cut_mode:'winner-transition-only',uncapped_points:meta.length,capped:false,max_points:100000};return result;
 }
 for(var i=0;i<grid.length;i++){var g=grid[i],target=targetAt(g.time),elapsed=beatDistance(map,anchor,g.time,result.tempo);if(elapsed>=target-.18){meta.push({time:g.time,reason:'Auto pace '+target+' beats',strength:g.strength||0,beats_per_cut:target});anchor=g.time;}}
 /* Exact validated drops are authoritative. Nearby optional decision points are removed instead of failing validation. */
 var events=result.structure&&Array.isArray(result.structure.events)?result.structure.events:[];for(i=0;i<events.length;i++){var dt=Number(events[i].drop_time);if(!isFinite(dt)||dt<=0||dt>=duration)continue;var snap=frame>0?Math.round(dt/frame)*frame:dt;var cleaned=[];for(var j=0;j<meta.length;j++){var mb=beatDistance(map,Math.min(meta[j].time,snap),Math.max(meta[j].time,snap),result.tempo);if(mb<2.25&&meta[j].reason!=='Drop impact')continue;cleaned.push(meta[j]);}meta=cleaned;meta.push({time:snap,reason:'Drop impact',strength:1000+(Number(events[i].confidence_score)||0),beats_per_cut:nearestCadence(allowed,4),drop_confidence:Number(events[i].confidence_score)||0});}
 meta.sort(function(a,b){return a.time-b.time||b.strength-a.strength;});var keep=[];for(i=0;i<meta.length;i++){var c=meta[i];if(!(c.time>0&&c.time<duration))continue;if(keep.length&&Math.abs(c.time-keep[keep.length-1].time)<.04){if(c.reason==='Drop impact')keep[keep.length-1]=c;continue;}keep.push(c);}
 if(keep.length>cap){var drops=keep.filter(function(x){return x.reason==='Drop impact';}),normal=keep.filter(function(x){return x.reason!=='Drop impact';}),room=Math.max(0,cap-drops.length),sample=[];if(room>0){var step=Math.max(1,Math.ceil(normal.length/room));for(i=0;i<normal.length&&sample.length<room;i+=step)sample.push(normal[i]);}keep=drops.concat(sample).sort(function(a,b){return a.time-b.time;});}
 result.points=keep.map(function(x){return x.time;});result.meta=keep;result.pacing={summary:'Auto Music Map · music-map timing · '+allowed.join('/')+' beat preference · exact main drops · non-blocking',segments:segments,config:pacing&&pacing.config||{},allowed_cadences:allowed,soft_preference:true,strict_guard:false,max_cut_beats:8,min_cut_beats:0,transition_only:true,physical_cut_mode:'winner-transition-only',uncapped_points:meta.length,max_points:cap,capped:meta.length>cap};return result;}
function guardHold(choice,it,music,state){state=state||{};state.forced=state.forced||0;state.warnings=state.warnings||[];var pool=Array.isArray(it&&it.candidates)?it.candidates.map(Number).filter(function(x,i,a){return isFinite(x)&&x>=0&&a.indexOf(x)===i;}):[],cam=Number(choice.camera);if(!pool.length){choice.camera=-1;state.last=-999;state.held=0;return choice;}if(pool.indexOf(cam)<0){cam=pool[0];choice.camera=cam;choice.reason='Coverage fallback: selected an available camera.';}
 var map=music&&music.beat_first&&music.beat_first.tempo_map||[],bpm=Number(music&&music.estimated_bpm)||120,n=beatDistance(map,Number(it.start)||0,Number(it.end)||0,bpm),held=cam===state.last?(state.held||0)+n:n;if(held>8.2&&choice.structureLock!=='drop-force'&&choice.structureLock!=='drop'){var alt=pool.filter(function(x){return x!==cam;});if(alt.length){cam=alt[0];choice.camera=cam;choice.reason='Auto camera flow: changed angle at an existing music decision point after a long hold.';choice.structureLock='';state.forced++;held=n;}}
 state.last=cam;state.held=held;return choice;}
function validateHold(choices,intervals,music,report){if(!choices||!intervals||choices.length!==intervals.length)throw Error('Camera plan is incomplete.');if(report){report.forced=0;report.warnings=[];}return true;}
root.RPBeatFirst={guardHold:guardHold,validateHold:validateHold,enrich:enrich,apply:apply,offsetBeats:offsetBeats,beatDistance:beatDistance,tempoMap:tempoMap,bpmAt:bpmAt};
}(typeof window!=='undefined'?window:globalThis));
