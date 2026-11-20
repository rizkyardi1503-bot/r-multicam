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
// Detected beats contain off-beat onsets (half- and 3/4-beat gaps) and miss beats (2-beat gaps), so "8 beats" counted
// on them drifted from 6 to 16 real beats. Phase-locked grid: step one beat at the song tempo and snap to a detected
// beat only when it sits within 10% of where the beat is due (DJ pitch range); the step follows real drift (median of nearby gaps).
// Each A1 clip (segments: [{start,end}] in sequence time) gets its own phase anchor, so two songs on A1 each stay on
// their beat; inside a clip the grid re-locks its phase after 4 beats without a detected beat.
function asc(a,b){return a-b;}
// Beat length the step band is centred on at time v: the engine tempo map (a set at 132 BPM may play 150 BPM for half an
// hour), median-smoothed over 12 s against single-window misreads, and replaced by its 120 s median where it jumps
// outside 0.8-1.25x of that: there the map read the off-beat pattern itself (176 in a 132 set = 4/3 x). Within 6% of the
// set tempo (normal drift, which the step median follows anyway) and without a usable map: the set beat, as before.
function localBeat(map,beat){
 var m=(map||[]).filter(function(x){return x&&isFinite(x.time)&&Number(x.bpm)>=40&&Number(x.bpm)<=240;}).map(function(x){return {time:Number(x.time),bpm:Number(x.bpm)};}).sort(function(a,b){return a.time-b.time;});
 if(m.length<2)return function(){return beat;};
 function med(i,w,a){var v=[];for(var q=lower(m,m[i].time-w);q<m.length&&m[q].time<=m[i].time+w;q++)v.push(a[q]);v.sort(asc);return v[v.length>>1];}
 var raw=m.map(function(x){return x.bpm;}),s=raw.map(function(_,i){return med(i,12,raw);}),ref=s.map(function(v,i){var L=med(i,120,s),r=v/L;return r>.8&&r<1.25?v:L;});
 return function(v){var b=60/ref[Math.max(0,lower(m,v+.000001)-1)];return Math.abs(b/beat-1)<.06?beat:b;};
}
function steadyGrid(raw,beat,duration,frame,segments,map){
 var all=raw.filter(function(x){return isFinite(x)&&x>=0&&x<duration;}).sort(asc),out=[];
 function snap(x){return frame>0?Math.round(x/frame)*frame:x;}
 function push(x){x=snap(x);if(x>=0&&x<duration&&(!out.length||x-out[out.length-1]>.04))out.push(x);}
 if(!(beat>0))return out;
 var ref=localBeat(map,beat);
 var segs=(segments||[]).filter(function(s){return isFinite(s.start)&&isFinite(s.end)&&s.end>s.start;}).map(function(s){return {start:Math.max(0,Number(s.start)),end:Math.min(duration,Number(s.end))};}).filter(function(s){return s.end>s.start;}).sort(function(a,b){return a.start-b.start;});
 if(!segs.length)segs=[{start:0,end:duration}];
 segs.forEach(function(seg){
  var t=all.filter(function(x){return x>=seg.start&&x<seg.end;}),i,j,x,L,due,hit;
  if(t.length<8){for(x=seg.start;x<seg.end;x+=ref(x))push(x);return;}
  // The step follows real drift but stays within 10% of the local tempo from the tempo map: a band that followed its own
  // last value ratcheted down onto the off-beat pattern (3/4 beat in artbat and argy), as did a per-clip estimate of the
  // most common gap; a band around the single set tempo could not follow a 150 BPM track in a 132 BPM set.
  var T=t.map(function(v){return {time:v};});
  function closest(v,win){var k=lower(T,v),best=null;for(var q=Math.max(0,k-2);q<Math.min(t.length,k+2);q++)if(Math.abs(t[q]-v)<=win&&(best===null||Math.abs(t[q]-v)<Math.abs(best-v)))best=t[q];return best;}
  function step(v){var k=lower(T,v),R=ref(v),w=[];for(var q=Math.max(1,k-24);q<Math.min(t.length,k+24);q++){var d=t[q]-t[q-1];if(d>R*.9&&d<R*1.1)w.push(d);}w.sort(asc);return w.length>=6?w[w.length>>1]:R;}
  // Next run of 4 detected beats evenly spaced at the current tempo, after v: where the beat continues after a phase jump.
  function relock(v,limit,cur){for(var k=lower(T,v);k+3<t.length&&t[k]<limit;k++){var ok=true;for(var q=k+1;q<=k+3;q++){var d=t[q]-t[q-1];if(!(d>cur*.9&&d<cur*1.1)){ok=false;break;}}if(ok)return t[k];}return null;}
  // Anchor on the phase most detected beats agree with (first 30 s of the clip), so an early off-beat hit cannot set it.
  var anchor=t[0],support=-1,B0=ref(t[0]);for(i=0;i<t.length&&t[i]<t[0]+30;i++){var n=0;for(j=i;j<t.length&&t[j]<t[i]+30;j++){var ph=(t[j]-t[i])/B0;ph-=Math.round(ph);if(Math.abs(ph)<.12)n++;}if(n>support){support=n;anchor=t[i];}}
  var head=[];for(x=anchor;;){L=step(x);due=x-L;if(due<=seg.start-L*.25)break;hit=closest(due,L*.1);x=hit===null?due:hit;head.unshift(Math.max(seg.start,x));}head.forEach(push);
  var miss=0;
  for(x=anchor;x<seg.end;){push(x);L=step(x);due=x+L;hit=closest(due,L*.1);
   if(hit!==null){miss=0;x=hit;continue;}
   if(++miss>=4){var r=relock(x+L*.5,x+L*8,L);if(r!==null&&r>x+L*.25){var n2=Math.max(1,Math.round((r-x)/L));for(var f=1;f<n2;f++)push(x+(r-x)*f/n2);miss=0;x=r;continue;}}
   x=due;}
 });
 return out;
}
// Tempo map that agrees with the steady grid (one entry per 8 beats), for the hold and 4-beat guards.
function gridTempoMap(g){var out=[];for(var i=0;i+1<g.length;i+=8){var j=Math.min(i+8,g.length-1);out.push({time:i?g[i]:0,bpm:Math.round(60*(j-i)/(g[j]-g[i])*10)/10,confidence:1});}return out;}
function countBeats(g,a,b){return Math.abs(lower(g,b-1e-6)-lower(g,a-1e-6));}
/**
 * Where no enabled camera covers a whole shot, cut over to the camera that continues: on a beat inside the
 * overlap of both cameras (as even as possible), at the exact clip edge when they do not overlap. Returns new edit times.
 */
function coverageSplits(snapshot,enabled,result){
 var g=(result&&result.beatFirst&&result.beatFirst.steady_grid||[]).map(function(t){return {time:t};}),frame=Number(snapshot&&snapshot.frame)||0,tol=frame>0?frame/4:.01,out=[];
 var on=(enabled||[]).map(Number),tracks=(snapshot&&snapshot.tracks||[]).filter(function(t){return on.indexOf(Number(t.index))>=0;});
 function best(t){var b=null;tracks.forEach(function(tr){(tr.coverageRanges||[]).forEach(function(r){if(r.start<=t+tol&&r.end>t+tol&&(!b||r.end>b.end))b=r;});});return b;}
 function nextStart(t){var s=Infinity;tracks.forEach(function(tr){(tr.coverageRanges||[]).forEach(function(r){if(r.start>t+tol&&r.start<s)s=r.start;});});return s;}
 function snap(x){return frame>0?Math.round(x/frame)*frame:x;}
 (snapshot&&snapshot.intervals||[]).forEach(function(it){
  if((it.candidates||[]).some(function(c){return on.indexOf(Number(c))>=0;}))return;
  if((it.coverageNotes||[]).join(' ').indexOf('Outside In/Out')>=0)return;
  var t=Number(it.start),b=Number(it.end),guard=0;
  while(t<b-tol&&guard++<64){
   var c=best(t);
   if(!c){var s=nextStart(t);if(s>=b-tol)break;out.push(s);t=s;continue;}
   if(c.end>=b-tol)break;
   var y=best(c.end),from=y?Math.max(t,y.start):c.end,p=c.end,score=-1; // y: the camera that continues after c ends
   if(y)for(var k=lower(g,from-tol);k<g.length&&g[k].time<=c.end+tol;k++){var q=g[k].time;if(q<=t+tol||q>=b-tol)continue;var m=Math.min(countBeats(g,t,q),countBeats(g,q,b));if(m>=score){score=m;p=q;}}
   p=snap(p);if(p<=t+tol)p=snap(c.end);if(p<=t+tol||p>=b-tol)break;
   // No shared beat: a cut at the clip edge under a beat from either end would flash a few frames; leave the shot as before.
   if(score<0){var k2=lower(g,p),L=k2>0&&k2<g.length?g[k2].time-g[k2-1].time:.5;if(p-t<L||b-p<L)break;}
   out.push(p);t=p;
  }
 });
 return out.sort(asc).filter(function(x,i,a){return !i||x-a[i-1]>tol;});
}
function apply(result,pacing,duration,maxPoints){duration=Number(duration)||0;enrich(result,duration);var map=result.beatFirst.tempo_map||[],grid=ensureGrid(result,duration,map);if(!grid.length)throw Error('No usable A1 beat grid. Analyze Music again.');
 var segments=(pacing&&pacing.segments||[]).slice().sort(function(a,b){return Number(a.start_second)-Number(b.start_second);});if(!segments.length)segments=[{start_second:0,beats_per_cut:6,reason:'auto'}];var allowed=allowedCadences(pacing),cap=Math.max(1,Math.min(6000,Number(maxPoints)||6000)),meta=[],anchor=0,si=0,frame=Number(result.snapshot&&result.snapshot.frame)||0;
 function targetAt(t){while(si+1<segments.length&&t>=Number(segments[si+1].start_second))si++;var raw=clamp(Number(segments[si].beats_per_cut)||6,2,8);return nearestCadence(allowed,raw);}
 // Validated selected drops interrupt cadence and restart its beat count.
 if(pacing&&pacing.config&&pacing.config.userSelectedCadence){
  var range=result.snapshot&&result.snapshot.range||{start:0,end:duration},scopeStart=range.start,scopeEnd=range.end;
  var steady=steadyGrid(grid.map(function(x){return x.time;}),Number(result.beatInterval)||60/Math.max(40,Number(result.tempo)||120),duration,frame,result.snapshot&&result.snapshot.clips||null,map);
  grid=steady.map(function(t){return {time:t};});map=gridTempoMap(steady);result.beatFirst.tempo_map=map;result.beatFirst.steady_grid=steady;
  var at=scopeStart,previous=scopeStart,di=0,drops=(result.structure&&result.structure.events||[]).map(function(e){var raw=Number(e.drop_time);return {time:frame>0?Math.round(raw/frame)*frame:raw,confidence:Number(e.confidence_score)||0};}).filter(function(e){
   // A drop cut closer than 4 beats to Mark In/Out leaves an edge shot the 4-beat guard can never merge
   // (no neighbour on the edge side, locked drop camera on the other), which blocked Apply for the whole edit.
   // Such drops get no own cut; the director still gives the shot containing the drop its drop camera.
   return isFinite(e.time)&&e.time>scopeStart&&e.time<scopeEnd&&beatDistance(map,scopeStart,e.time,result.tempo)>=3.75&&beatDistance(map,e.time,scopeEnd,result.tempo)>=3.75;
  }).sort(function(a,b){return a.time-b.time;});
  // Two drops under 4 beats apart (e.g. after impact alignment) each restarted the count, cutting a 2-beat shot the
  // 4-beat guard then had to repair. Only the stronger one cuts and restarts the count (the earlier one on a tie).
  drops=drops.reduce(function(kept,e){var p=kept[kept.length-1];if(p&&beatDistance(map,p.time,e.time,result.tempo)<3.75){if(e.confidence>p.confidence)kept[kept.length-1]=e;}else kept.push(e);return kept;},[]);
  // Count cadence on the detected beat grid (phase-accurate, no tempo drift); tempo stepping is only the fallback past the grid.
  var gi=lower(grid,scopeStart-1e-6);
  function nearestGrid(t){var k=lower(grid,t);if(k>0&&(k>=grid.length||t-grid[k-1].time<=grid[k].time-t))k--;return k;}
  while(at<scopeEnd){
   while(di<drops.length&&drops[di].time<=previous+1e-9)di++;
   var cadence=targetAt(at),onGrid=gi+cadence<grid.length,next=onGrid?grid[gi+cadence].time:offsetBeats(map,at,cadence,result.tempo),snapped=frame>0?Math.round(next/frame)*frame:next,isDrop=di<drops.length&&drops[di].time<=snapped+1e-9;
   if(!isFinite(next)||next<=at)throw Error('Invalid tempo map for selected pacing.');
   gi=onGrid?gi+cadence:grid.length;
   if(isDrop){snapped=drops[di].time;next=snapped;gi=nearestGrid(snapped);}
   // Never leave a sub-4-beat tail before Mark Out/sequence end: the last shot simply runs longer.
   if(snapped>=scopeEnd||beatDistance(map,snapped,scopeEnd,result.tempo)<3.75)break;
   // A regular cut under 4 beats before the next drop leaves a pre-drop shot that must contrast with the drop camera and
   // cannot be merged (both neighbours are the drop camera), which blocked Apply. The previous shot runs on to the drop.
   if(!isDrop&&di<drops.length&&drops[di].time>snapped&&beatDistance(map,snapped,drops[di].time,result.tempo)<3.75){at=next;continue;}
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
root.RPBeatFirst={steadyGrid:steadyGrid,coverageSplits:coverageSplits,guardHold:guardHold,validateHold:validateHold,enrich:enrich,apply:apply,offsetBeats:offsetBeats,beatDistance:beatDistance,tempoMap:tempoMap,bpmAt:bpmAt};
}(typeof window!=='undefined'?window:globalThis));
