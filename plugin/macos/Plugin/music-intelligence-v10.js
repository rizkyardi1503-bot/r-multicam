/* R Project Music Intelligence V12 — Drop Selection + Full Live Set orchestration map.
   Independent implementation of a music-driven drop selection workflow:
   compute candidates once -> confidence threshold -> best-spaced main-drop selection -> shared drop map for Multicam/Best Drops. */
(function(root){
'use strict';
function num(x,d){x=Number(x);return isFinite(x)?x:d;}
function clamp(x,a,b){return Math.max(a,Math.min(b,x));}
function round(x,n){var p=Math.pow(10,n||0);return Math.round(num(x,0)*p)/p;}
function quantile(a,q){if(!a.length)return 0;var x=a.slice().sort(function(m,n){return m-n;}),p=(x.length-1)*q,l=Math.floor(p),h=Math.ceil(p);return l===h?x[l]:x[l]+(x[h]-x[l])*(p-l);}
function threshold(mode){mode=String(mode||'balanced').toLowerCase();return mode==='conservative'?94:mode==='aggressive'?78:88;}
function lower(a,t){var lo=0,hi=a.length;while(lo<hi){var m=(lo+hi)>>1;if(a[m].time<t)lo=m+1;else hi=m;}return lo;}
function prefix(series,key){var p=new Float64Array(series.length+1);for(var i=0;i<series.length;i++)p[i+1]=p[i]+num(series[i][key],0);return p;}
function avg(series,pref,a,b){if(!(b>a)||!series.length)return 0;var l=lower(series,a),r=lower(series,b);return r>l?(pref[r]-pref[l])/(r-l):0;}
function peak(series,key,a,b,wantMin){var l=lower(series,a),r=lower(series,b),best=wantMin?Infinity:-Infinity,at=a;for(var i=l;i<r;i++){var v=num(series[i][key],0);if((wantMin&&v<best)||(!wantMin&&v>best)){best=v;at=series[i].time;}}return {value:isFinite(best)?best:0,time:at};}
function slope(series,key,a,b){var l=lower(series,a),r=lower(series,b),n=r-l;if(n<3)return 0;var sx=0,sy=0,sxx=0,sxy=0;for(var i=l;i<r;i++){var x=series[i].time-a,y=num(series[i][key],0);sx+=x;sy+=y;sxx+=x*x;sxy+=x*y;}var den=n*sxx-sx*sx;return Math.abs(den)>1e-9?(n*sxy-sx*sy)/den:0;}
function beats(result){var src=result.beats||[],out=[];for(var i=0;i<src.length;i++){var t=num(typeof src[i]==='object'?src[i].time:src[i],-1);if(t>=0&&(!out.length||t>out[out.length-1]+.02))out.push(t);}if(!out.length){var g=result.musicGrid||[];for(i=0;i<g.length;i++){t=num(g[i].time,-1);if(t>=0&&(!out.length||t>out[out.length-1]+.02))out.push(t);}}return out;}
function nearestIndex(a,t){if(!a.length)return -1;var lo=0,hi=a.length;while(lo<hi){var m=(lo+hi)>>1;if(a[m]<t)lo=m+1;else hi=m;}if(lo<=0)return 0;if(lo>=a.length)return a.length-1;return t-a[lo-1]<=a[lo]-t?lo-1:lo;}
function beatOffset(result,t,n){return root.RPBeatFirst.offsetBeats(root.RPBeatFirst.tempoMap(result),Number(t),num(n,0),num(result.tempo||result.bpm,120));}
function beatDistance(result,a,b){return root.RPBeatFirst.beatDistance(root.RPBeatFirst.tempoMap(result),a,b,num(result.tempo||result.bpm,120));}
// localBeat runs for every candidate beat; sorting the tempo map per call made drop scoring quadratic on long sets.
// The sorted times and the last valid BPM at each entry are built once per tempo map, then binary-searched.
var LOCAL_BEAT_CACHE=typeof WeakMap==='function'?new WeakMap():null;
function localBeatTable(src){var hit=LOCAL_BEAT_CACHE&&LOCAL_BEAT_CACHE.get(src);if(hit&&hit.n===src.length)return hit;
 var map=src.slice().sort(function(a,b){return num(a.time,0)-num(b.time,0);}),times=new Float64Array(map.length),bpm=new Float64Array(map.length),valid=new Uint8Array(map.length),have=false,last=0;
 for(var i=0;i<map.length;i++){times[i]=num(map[i].time,0);var b=Number(map[i].bpm);if(isFinite(b)){last=b;have=true;}bpm[i]=last;valid[i]=have?1:0;}
 var table={n:src.length,times:times,bpm:bpm,valid:valid};if(LOCAL_BEAT_CACHE)LOCAL_BEAT_CACHE.set(src,table);return table;}
function localBeat(result,t){var table=localBeatTable(result.tempoMap||[]),times=table.times,lo=0,hi=times.length;while(lo<hi){var m=(lo+hi)>>1;if(times[m]<=t)lo=m+1;else hi=m;}var bpm=lo>0&&table.valid[lo-1]?table.bpm[lo-1]:num(result.tempo||result.bpm,120);return 60/Math.max(40,bpm);}
function sourceCandidates(result,duration){var grid=result.musicGrid||[],out=[];for(var i=0;i<grid.length;i++){var t=num(grid[i].time,-1);if(t>0&&t<duration)out.push({time:t,strength:num(grid[i].strength,0),phrase8:!!grid[i].phrase8,phrase16:!!grid[i].phrase16,phrase32:!!grid[i].phrase32});}
 // A guessed bar phase must not hide a real impact. Phrase flags remain supporting evidence.
 if(out.length)return out;var a=beats(result);for(i=0;i<a.length;i++)if(a[i]>0&&a[i]<duration)out.push({time:a[i],strength:0,phrase8:i%32===0,phrase16:i%64===0,phrase32:i%128===0});return out;
}
function preciseImpact(result,t){
 var series=result.onsetSeries||[],radius=Math.min(.18,localBeat(result,t)*.35),a=lower(series,t-radius),z=lower(series,t+radius),best=-1,at=t;
 for(var i=a;i<z;i++){var s=series[i],distance=Math.abs(s.time-t)/radius,score=num(s.attack,0)*(1-.20*distance);if(score>best){best=score;at=s.time;}}
 if(best<=0)return t;
 // Backtrack only a contiguous attack ramp; never jump across a missing trace.
 var idx=lower(series,at),start=at,maximum=num(series[idx]&&series[idx].attack,0);
 for(var j=idx-1;j>=0&&at-series[j].time<=.04;j--){if(start-series[j].time>.015||num(series[j].attack,0)<maximum*.2||num(series[j].attack,0)>num(series[j+1].attack,0))break;start=series[j].time;}
 return start;
}
function spectralVector(series,pref,a,b){return [avg(series,pref.subbass,a,b),avg(series,pref.bass,a,b),avg(series,pref.mid,a,b),avg(series,pref.high,a,b)];}
function spectralShift(pre,post){var ps=pre.reduce(function(a,b){return a+b;},0)+1e-6,qs=post.reduce(function(a,b){return a+b;},0)+1e-6,s=0;for(var i=0;i<4;i++)s+=Math.abs(pre[i]/ps-post[i]/qs);return s*100;}
function candidateFeatures(result,duration){var series=(result.dropSeries||[]).slice().sort(function(a,b){return num(a.time,0)-num(b.time,0);});if(!series.length)return [];
 var keys=['energy','bass','subbass','mid','high','transient','flux'],pref={};for(var k=0;k<keys.length;k++)pref[keys[k]]=prefix(series,keys[k]);var src=sourceCandidates(result,duration),raw=[];
 for(var i=0;i<src.length;i++){
  var t=preciseImpact(result,src[i].time),b=localBeat(result,t);if(!(b>0)||t<8*b||t>duration-16*b)continue;
  var preA=Math.max(0,beatOffset(result,t,-16)),preB=beatOffset(result,t,-4),impactEnd=beatOffset(result,t,4),sustainEnd=beatOffset(result,t,16),farA=Math.max(0,beatOffset(result,t,-32)),farB=Math.max(0,beatOffset(result,t,-16));
  var preE=avg(series,pref.energy,preB,t),earlyE=avg(series,pref.energy,preA,preB),postE=avg(series,pref.energy,t,impactEnd),sustainE=avg(series,pref.energy,impactEnd,sustainEnd);
  var preBass=avg(series,pref.bass,preB,t),postBass=avg(series,pref.bass,t,impactEnd),sustainBass=avg(series,pref.bass,impactEnd,sustainEnd);
  var preMid=avg(series,pref.mid,preB,t),postMid=avg(series,pref.mid,t,impactEnd),sustainMid=avg(series,pref.mid,impactEnd,sustainEnd),preHigh=avg(series,pref.high,preB,t),postHigh=avg(series,pref.high,t,impactEnd),sustainHigh=avg(series,pref.high,impactEnd,sustainEnd);
  var preSub=avg(series,pref.subbass,preB,t),postSub=avg(series,pref.subbass,t,impactEnd),preTr=avg(series,pref.transient,preB,t),postTr=avg(series,pref.transient,t,impactEnd),preFlux=avg(series,pref.flux,preB,t),postFlux=avg(series,pref.flux,t,impactEnd);
  var preSpec=spectralVector(series,pref,preB,t),postSpec=spectralVector(series,pref,t,impactEnd),farE=avg(series,pref.energy,farA,farB),preMin=peak(series,'energy',preA,t,true).value;
  var energyJump=postE-preE,bassJump=postBass-preBass,lowJump=((postBass+postSub)-(preBass+preSub))/2,midJump=postMid-preMid,highJump=postHigh-preHigh,fluxJump=postFlux-preFlux,buildRise=preE-earlyE,spShift=spectralShift(preSpec,postSpec),tensionRelease=Math.max(0,(preFlux+preTr*.65)-(avg(series,pref.flux,impactEnd,sustainEnd)+avg(series,pref.transient,impactEnd,sustainEnd)*.65));
  var postFull=(postE+postBass+postSub)/3,novelty=Math.max(0,postFlux-preFlux)+spShift*.35,bassPresence=(postBass+postSub)/2,energySustain=sustainE,bassSustain=sustainBass,rhythmJump=(postTr-preTr)+num(src[i].strength,0)*12;
  var breakdownDepth=Math.max(0,farE-earlyE),structuralNovelty=spShift+Math.abs(postE-preE)*.35+Math.abs(postBass-preBass)*.25,preBreakDepth=Math.max(0,Math.max(farE,earlyE)-preMin),buildSlope=slope(series,'energy',preA,t);
  var impactScore=Math.max(0,energyJump)*.8+Math.max(0,bassJump)*.75+Math.max(0,lowJump)*.5+Math.max(0,postFlux-preFlux)*.55+postTr*.22;
  var kickGate=(postBass>=preBass+4&&postTr>=preTr+2)||(energyJump>=8&&lowJump>=5)||(postFull>=58&&impactScore>=20);
  var score=0;
  score+=Math.max(0,energyJump)*1.15+Math.max(0,lowJump)*.8+Math.max(0,bassJump)*.65+impactScore*.65+Math.max(0,buildRise)*.5+spShift*.22+Math.max(0,tensionRelease)*.12+postFull*.16+novelty*.25+bassPresence*.10+energySustain*.10+bassSustain*.09+Math.max(0,rhythmJump)*.30+breakdownDepth*.22+structuralNovelty*.18+preBreakDepth*.18+Math.max(0,buildSlope)*2.2+(kickGate?12:-6)+(src[i].phrase32?7:src[i].phrase16?5:src[i].phrase8?3:0);
  raw.push({time:t,beat_interval:b,score:score,energy_jump:energyJump,low_jump:lowJump,bass_jump:bassJump,mid_jump:midJump,high_jump:highJump,flux_jump:fluxJump,impact_score:impactScore,build_rise:buildRise,spectral_shift:spShift,tension_release:tensionRelease,post_fullness:postFull,novelty:novelty,bass_presence:bassPresence,energy_sustain:energySustain,bass_sustain:bassSustain,mid_sustain:sustainMid,high_sustain:sustainHigh,rhythm_jump:rhythmJump,breakdown_depth:breakdownDepth,structural_novelty:structuralNovelty,pre_break_depth:preBreakDepth,buildup_slope:buildSlope,kick_gate:kickGate,phrase8:src[i].phrase8,phrase16:src[i].phrase16,phrase32:src[i].phrase32,pre_energy:preE,post_energy:postE,pre_bass:preBass,post_bass:postBass,pre_mid:preMid,post_mid:postMid,pre_high:preHigh,post_high:postHigh,pre_subbass:preSub,post_subbass:postSub});
 }
 if(!raw.length)return raw;var scores=raw.map(function(x){return x.score;}),q35=quantile(scores,.35),q88=quantile(scores,.88),span=Math.max(1,q88-q35);
 for(i=0;i<raw.length;i++){var c=raw[i],conf=clamp(48+(c.score-q35)/span*44,1,99);if(!c.kick_gate)conf-=9;if(c.energy_sustain<c.pre_energy*.82)conf-=6;c.confidence_score=Math.round(clamp(conf,1,99));c.confidence=c.confidence_score>=86?'high':c.confidence_score>=70?'medium':'low';c.id=i;}
 return raw;
}
function makeEvent(result,c,duration,rank){var t=c.time,b=c.beat_interval||localBeat(result,t),series=(result.dropSeries||[]).slice().sort(function(a,b){return a.time-b.time;}),searchA=Math.max(0,beatOffset(result,t,-32)),searchB=Math.max(0,beatOffset(result,t,-8)),low=peak(series,'energy',searchA,searchB,true),build=low.time;
 if(!(build<t-6*b))build=beatOffset(result,t,-16);if(build<t-32*b)build=beatOffset(result,t,-32);var impactEnd=Math.min(duration,beatOffset(result,t,4)),dropEnd=Math.min(duration,beatOffset(result,t,16));
 var e={id:rank-1,rank:rank,type:'build_drop',build_start:round(build,3),build_end:round(t,3),drop_time:round(t,3),impact_end:round(impactEnd,3),drop_end:round(dropEnd,3),score:round(c.score,1),confidence_score:c.confidence_score,confidence:c.confidence,impact_class:c.confidence_score>=88?'main':c.confidence_score>=76?'strong':'minor',impact_profile:c.impact_profile||'unknown'};var names=['energy_jump','low_jump','bass_jump','mid_jump','high_jump','flux_jump','impact_score','build_rise','spectral_shift','tension_release','post_fullness','novelty','bass_presence','energy_sustain','bass_sustain','mid_sustain','high_sustain','rhythm_jump','breakdown_depth','structural_novelty','pre_break_depth','buildup_slope','kick_gate'];for(var i=0;i<names.length;i++)e[names[i]]=typeof c[names[i]]==='boolean'?c[names[i]]:round(c[names[i]],2);return e;
}
function featureStats(raw){
 var get=function(k,q){return quantile(raw.map(function(x){return num(x[k],0);}),q);};
 return {
  impact:Math.max(18,get('impact_score',.65)),energy:Math.max(6,get('energy_jump',.70)),low:Math.max(5,get('low_jump',.68)),
  build:Math.max(3,get('build_rise',.70)),breakdown:Math.max(4,get('breakdown_depth',.68)),prebreak:Math.max(5,get('pre_break_depth',.68)),slope:Math.max(.10,get('buildup_slope',.70)),
  novelty:Math.max(10,get('structural_novelty',.65)),spectral:Math.max(8,get('spectral_shift',.68)),rhythm:Math.max(9,get('rhythm_jump',.68)),mid:Math.max(4,get('mid_jump',.65)),high:Math.max(4,get('high_jump',.65)),flux:Math.max(3,get('flux_jump',.65)),full:Math.max(50,get('post_fullness',.55))
 };
}
/* Main-drop validation deliberately separates a transient peak from a structural drop.
   A phrase-grid position is supporting evidence only: it can never turn a flat/impulsive peak into a main drop by itself. */
function mainDropEvidence(c,mode,st){
 var bassImpact=!!c.kick_gate&&c.impact_score>=st.impact&&(c.energy_jump>=st.energy||c.low_jump>=st.low||c.bass_jump>=Math.max(4,st.low*.8));
 var melodicAttack=c.mid_jump>=st.mid||c.high_jump>=st.high||c.flux_jump>=st.flux;
 var melodicImpact=c.impact_score>=st.impact*.88&&c.energy_jump>=Math.max(4,st.energy*.72)&&melodicAttack&&(c.spectral_shift>=st.spectral||c.rhythm_jump>=st.rhythm);
 var impact=bassImpact||melodicImpact;
 var realBuild=c.build_rise>=st.build||c.breakdown_depth>=st.breakdown||c.pre_break_depth>=st.prebreak||c.buildup_slope>=st.slope;
 var novelty=c.structural_novelty>=st.novelty||c.spectral_shift>=st.spectral||c.rhythm_jump>=st.rhythm;
 var postLift=c.energy_sustain>=c.pre_energy+5||c.energy_sustain>=c.pre_energy*1.10;
 var bassLift=c.bass_sustain>=num(c.pre_bass,0)+4||c.bass_sustain>=num(c.pre_bass,0)*1.10;
 var fullnessLift=c.post_fullness>=Math.max(st.full,c.pre_energy+6);
 var tonalLift=c.mid_sustain>=num(c.pre_mid,0)+4||c.high_sustain>=num(c.pre_high,0)+4||c.mid_sustain>=num(c.pre_mid,0)*1.12||c.high_sustain>=num(c.pre_high,0)*1.12;
 var sustain=postLift&&fullnessLift&&(bassLift||c.bass_presence>=num(c.pre_bass,0)+5||(melodicImpact&&tonalLift));
 var phrase=!!(c.phrase16||c.phrase32);
 var count=(impact?1:0)+(realBuild?1:0)+(novelty?1:0)+(sustain?1:0)+(phrase?1:0);
 c.impact_profile=bassImpact?'bass':melodicImpact?'melodic':'none';c.drop_evidence_count=count;c.evidence={impact:impact,bass_impact:bassImpact,melodic_impact:melodicImpact,build:realBuild,novelty:novelty,sustain:sustain,phrase:phrase};
 if(mode==='conservative')return impact&&realBuild&&novelty&&sustain&&phrase&&count===5;
 if(mode==='aggressive')return impact&&((realBuild&&(novelty||sustain))||(novelty&&sustain))&&count>=3;
 return impact&&realBuild&&novelty&&sustain&&count>=4;
}
function withinSpacing(result,a,b,spacing){var lo=beatOffset(result,a,-spacing),hi=beatOffset(result,a,spacing);return b>lo+.001&&b<hi-.001;}
function pickBestSpaced(result,ranked,mode,spacing,stats,minimum){
 var min=minimum,accepted=[];
 for(var i=0;i<ranked.length;i++){var c=ranked[i];c.accepted=false;c.suppressed=false;c.selection_origin='';c.drop_evidence_count=0;c.evidence=null;c.rejection_reason='';var structural=mainDropEvidence(c,mode,stats);if(c.confidence_score<min){c.rejection_reason='confidence-threshold';continue;}if(!structural){c.rejection_reason='structural-evidence';continue;}var near=false;for(var j=0;j<accepted.length;j++)if(withinSpacing(result,accepted[j].time,c.time,spacing)){near=true;break;}if(near){c.suppressed=true;c.rejection_reason='minimum-spacing';continue;}c.accepted=true;c.selection_origin='best-spaced';accepted.push(c);}
 return accepted;
}
/* Impact alignment. Drop scores compare 4-16 beat windows, so the beat before a drop often scores
   about the same as the drop itself: its "before" window holds less of a crescendoing build-up.
   The real drop is the beat where the low-band attack (kick/bass) suddenly appears, so a selected
   drop moves to a nearby candidate (0.2-1.25 beats away: the grid can hold half-beat points near a
   snare roll) only when that beat's attack jump is clearly larger. */
var ATTACK_PREFIX=typeof WeakMap==='function'?new WeakMap():null;
function attackPrefix(series){var hit=ATTACK_PREFIX&&ATTACK_PREFIX.get(series);if(hit&&hit.length===series.length+1)return hit;var p=new Float64Array(series.length+1);for(var i=0;i<series.length;i++)p[i+1]=p[i]+Math.max(0,num(series[i].attack,0));if(ATTACK_PREFIX)ATTACK_PREFIX.set(series,p);return p;}
// Attack in a short impact window at t (-30..+120 ms) minus the same window one beat earlier: high only
// where a kick/bass hit newly arrives. A whole-beat window would let a half-beat-early point borrow the drop hit.
function attackJump(result,t){var s=result.onsetSeries||[];if(!s.length)return 0;var p=attackPrefix(s),b=localBeat(result,t);function hit(x){return p[lower(s,x+.12)]-p[lower(s,x-.03)];}return hit(t)-hit(t-b);}
function alignImpacts(result,selected,ranked){
 var byTime=ranked.slice().sort(function(a,b){return a.time-b.time;});
 for(var i=0;i<selected.length;i++){
  var c=selected[i],b=c.beat_interval||localBeat(result,c.time),own=attackJump(result,c.time),best=null,bestJump=own;
  for(var j=lower(byTime,c.time-1.25*b);j<byTime.length&&byTime[j].time<=c.time+1.25*b;j++){var n=byTime[j];if(n===c||Math.abs(n.time-c.time)<.2*b)continue;var jump=attackJump(result,n.time);if(jump>bestJump){best=n;bestJump=jump;}}
  if(!best||!(bestJump>Math.max(0,own)*1.25+1e-9))continue;
  best.accepted=true;best.suppressed=false;best.rejection_reason='';best.selection_origin='impact-aligned';best.aligned_from=c.time;best.attack_jump=bestJump;
  best.evidence=c.evidence;best.drop_evidence_count=c.drop_evidence_count;best.impact_profile=c.impact_profile;best.confidence_score=Math.max(num(best.confidence_score,0),num(c.confidence_score,0));best.confidence=c.confidence;
  c.accepted=false;c.selection_origin='';c.rejection_reason='impact-aligned to '+round(best.time,3)+'s';
  selected[i]=best;
 }
 return selected;
}
function selectMainDrops(result,ranked,mode,spacing,duration,options){options=options||{};var minimum=options.confidenceThreshold==null?threshold(mode):clamp(num(options.confidenceThreshold,threshold(mode)),1,99),stats=featureStats(ranked),selected=alignImpacts(result,pickBestSpaced(result,ranked,mode,spacing,stats,minimum),ranked);selected.sort(function(a,b){return a.time-b.time;});return {selected:selected,stats:stats,threshold:minimum};}
// Content hash of every analysis input, walked value by value. It used to JSON.stringify the whole map
// (~720k onset rows for a 2 h set) on every call. The key stays content-based so a cache saved in the
// master music map still matches after reload; JSON round-trips keep keys, order and numbers.
var HASH_F64=new Float64Array(1),HASH_U32=new Uint32Array(HASH_F64.buffer);
function hashValue(h,v){
 var i;
 if(typeof v==='number'){HASH_F64[0]=v;h=Math.imul(h^HASH_U32[0],16777619);return Math.imul(h^HASH_U32[1],16777619);}
 if(typeof v==='string'){h=Math.imul(h^(v.length|0x40000000),16777619);for(i=0;i<v.length;i++)h=Math.imul(h^v.charCodeAt(i),16777619);return h;}
 if(typeof v==='boolean')return Math.imul(h^(v?0x7001:0x7000),16777619);
 if(v===null||v===undefined)return Math.imul(h^0x7002,16777619);
 if(Array.isArray(v)){h=Math.imul(h^(v.length|0x20000000),16777619);for(i=0;i<v.length;i++)h=hashValue(h,v[i]);return h;}
 if(typeof v==='object'){var keys=Object.keys(v);h=Math.imul(h^(keys.length|0x10000000),16777619);for(i=0;i<keys.length;i++){var k=keys[i];if(v[k]===undefined)continue;h=hashValue(h,k);h=hashValue(h,v[k]);}return h;}
 return h;
}
function analysisKey(result,duration){var parts=[result.snapshot&&result.snapshot.range,duration,result.tempo,result.bpm,result.beatInterval,result.tempoMap,result.musicGrid,result.beats,result.dropSeries,result.onsetSeries],h=2166136261,n=0;for(var i=0;i<parts.length;i++){h=hashValue(h,parts[i]);n+=Array.isArray(parts[i])?parts[i].length:1;}return 'features-v19-multifeature-public|'+n+'|'+(h>>>0);}
function cachedFeatures(result,duration){var key=analysisKey(result,duration),cache=result.dropFeatureCache;if(!cache||cache.key!==key){cache={key:key,rows:candidateFeatures(result,duration).filter(function(c){var r=result.snapshot&&result.snapshot.range;return !r||(c.time>=r.start&&c.time<r.end);})};result.dropFeatureCache=cache;}return cache.rows.map(function(x){return Object.assign({},x);});}
function sections(result,duration,events){var series=(result.dropSeries||[]).slice().sort(function(a,b){return a.time-b.time;}),prefE=prefix(series,'energy'),a=beats(result),bounds=[0,duration],i;
 for(i=0;i<a.length;i+=16)if(a[i]>0&&a[i]<duration)bounds.push(a[i]);events.forEach(function(e){[e.build_start,beatOffset(result,e.drop_time,-4),e.drop_time,e.impact_end,e.drop_end,beatOffset(result,e.drop_end,8)].forEach(function(t){if(t>0&&t<duration)bounds.push(t);});});bounds.sort(function(x,y){return x-y;});var uniq=[];for(i=0;i<bounds.length;i++)if(!uniq.length||bounds[i]>uniq[uniq.length-1]+.01)uniq.push(bounds[i]);var vals=series.map(function(x){return num(x.energy,0);}),lo=quantile(vals,.25),hi=quantile(vals,.72),out=[];
 for(i=1;i<uniq.length;i++){var st=uniq[i-1],en=uniq[i],mid=(st+en)/2,e=avg(series,prefE,st,en),before=avg(series,prefE,Math.max(0,st-(en-st)),st),after=avg(series,prefE,en,Math.min(duration,en+(en-st))),trend=after>before+7?'rising':after<before-7?'falling':'stable',label=e>=hi?'high-energy':e<=lo?'breakdown':'groove';if(st<Math.min(8,duration*.06))label='intro';if(en>duration-Math.min(8,duration*.06))label='outro';
  for(var j=0;j<events.length;j++){var ev=events[j],pre4=beatOffset(result,ev.drop_time,-4),rec=beatOffset(result,ev.drop_end,8);if(mid>=ev.build_start&&mid<pre4)label='build-up';else if(mid>=pre4&&mid<ev.drop_time)label='pre-drop';else if(mid>=ev.drop_time&&mid<ev.impact_end)label='drop-impact';else if(mid>=ev.impact_end&&mid<ev.drop_end)label='drop-body';else if(mid>=ev.drop_end&&mid<rec)label='recovery';}
  out.push({start_second:round(st,3),end_second:round(en,3),section:label,energy:round(e/100,3),energy_raw:round(e,1),trend:trend});
 }
 return out;
}
function enrich(result,duration,options){result=result||{};root.RPMusicTrainingResult=result;options=options||{};duration=num(duration,0);
 var mode=String(options.sensitivity||result.dropSensitivity||'balanced').toLowerCase();if(['conservative','balanced','aggressive'].indexOf(mode)<0)mode='balanced';
 var defaultSpacing=mode==='conservative'?96:mode==='aggressive'?32:64,spacing=clamp(num(options.minSpacingBeats,defaultSpacing),32,256),raw=cachedFeatures(result,duration);if(root.RPMusicLearning)raw=root.RPMusicLearning.apply(raw);if(root.RPOnlineMusicAI)raw=root.RPOnlineMusicAI.apply(result,raw);var ranked=raw.slice().sort(function(a,b){return b.confidence_score-a.confidence_score||b.score-a.score||a.time-b.time;});
 for(var i=0;i<ranked.length;i++)ranked[i].rank=i+1;var selection=selectMainDrops(result,ranked,mode,spacing,duration,options),automatic=selection.selected.slice(),excluded=result.excludedDropTimes||[],accepted=automatic.filter(function(c){return excluded.indexOf(String(round(c.time,3)))<0;}),acceptedRank=accepted.slice().sort(function(a,b){return b.confidence_score-a.confidence_score||b.drop_evidence_count-a.drop_evidence_count||b.score-a.score;}),events=[];
 for(i=0;i<accepted.length;i++){var ev=makeEvent(result,accepted[i],duration,i+1);if(accepted[i].online_decision){ev.local_confidence_score=accepted[i].local_confidence_score;ev.online_decision=accepted[i].online_decision;ev.online_adjustment=accepted[i].online_adjustment;}ev.selection_origin=accepted[i].selection_origin||'best-spaced';ev.drop_evidence_count=accepted[i].drop_evidence_count||0;events.push(ev);}events.sort(function(a,b){return a.drop_time-b.drop_time;});
 var sec=sections(result,duration,events),pre=clamp(num(options.preBeats,24),8,64),post=clamp(num(options.postBeats,32),8,64);
 var map={version:'18.0',engine:'Music Engine V18',method:'full-A1 dual-profile candidate analysis + confidence threshold + structural evidence gate + best-spaced main-drop selection',independent_implementation:true,selection_model:'threshold -> bass/melodic evidence -> best-spaced',sensitivity:mode,confidence_threshold:selection.threshold,automatic_drops:automatic,minimum_spacing_beats:spacing,best_drop_window:{pre_beats:pre,post_beats:post},feature_names:['energy_jump','low_jump','bass_jump','mid_jump','high_jump','flux_jump','impact_score','build_rise','spectral_shift','tension_release','post_fullness','novelty','bass_presence','energy_sustain','bass_sustain','mid_sustain','high_sustain','rhythm_jump','breakdown_depth','structural_novelty','pre_break_depth','buildup_slope','kick_gate','impact_profile'],candidate_count:ranked.length,ranked_drops:ranked,accepted_drops:acceptedRank,drop_count:events.length,events:events,sections:sec,automatic_pacing:true,cut_cadences:[4,6,8],transition_only:true};
 result.beatFirst=null;result.pacing=null;result.points=[];result.meta=[];result.musicV12=map;result.masterMusicMapV12=map;result.musicV10=map;result.masterMusicMapV10=map;result.dropSensitivity=mode;result.bestDropWindow=map.best_drop_window;
 result.structure={events:events,zones:sec.map(function(x){return {start:x.start_second,end:x.end_second,type:x.section};}),drop_count:events.length,build_up_count:events.length,summary:events.length?('Music Engine V18 selected '+events.length+' main build-up → drop transition'+(events.length===1?'':'s')+' from '+ranked.length+' analyzed candidates.'):'Music Engine V18 found no main drops that passed threshold, spacing and structural evidence.',intelligence:{version:'18.0',bpm:num(result.tempo||result.bpm,null),duration:duration,sections:sec,transitions:events,candidate_count:ranked.length,drop_count:events.length,build_up_count:events.length,minimum_spacing_beats:spacing,feature_names:map.feature_names}};
 return result;
}
function pacing(obj,duration){var v=obj&&obj.musicV12||obj&&obj.music_v12||obj&&obj.music_v11||obj&&obj.masterMusicMapV12||obj&&obj.musicV10||obj&&obj.music_v10||obj&&obj.masterMusicMapV10;if(!v||!Array.isArray(v.sections)||!v.sections.length)return {summary:'Automatic fallback pacing · 6-beat groove / 4-beat high energy / 8-beat calm',segments:[{start_second:0,beats_per_cut:6,max_hold_beats:8,reason:'Automatic fallback'}],config:{base:6,minCadence:4,maxCadence:8,explicitCadence:false,energyAdaptive:true}};
 var seg=[],last=null;for(var i=0;i<v.sections.length;i++){var s=v.sections[i],label=String(s.section||'groove'),cad=6;if(label==='drop-impact'||label==='drop-body'||label==='pre-drop'||label==='high-energy')cad=4;else if(label==='build-up')cad=s.trend==='rising'?4:6;else if(label==='recovery'||label==='groove')cad=6;else cad=8;if(last&&last.beats_per_cut===cad&&last.reason===label)continue;last={start_second:num(s.start_second,0),beats_per_cut:cad,max_hold_beats:8,drop_pacing:/drop|build-up|pre-drop/.test(label),reason:label};seg.push(last);}if(!seg.length||seg[0].start_second>.01)seg.unshift({start_second:0,beats_per_cut:8,max_hold_beats:8,reason:'intro'});return {summary:'Music Engine V18 · selected 4/6/8 decision cadence · exact validated drop impacts · no editing prompt',segments:seg,config:{base:6,minCadence:4,maxCadence:8,explicitCadence:false,energyAdaptive:true,source:'music-v13-drop-selection'}};
}
function candidates(result,duration,max){var v=result&&(result.musicV12||result.musicV10);if(!v)return [];var pre=v.best_drop_window.pre_beats,post=v.best_drop_window.post_beats;return v.accepted_drops.filter(function(e){return beatOffset(result,e.time,-pre)>=(result.snapshot&&result.snapshot.range?result.snapshot.range.start:0)&&beatOffset(result,e.time,post)<=(result.snapshot&&result.snapshot.range?result.snapshot.range.end:duration);}).slice(0,max||100).map(function(e,i){var event=null;for(var j=0;j<v.events.length;j++)if(Math.abs(v.events[j].drop_time-e.time)<.02){event=v.events[j];break;}return Object.assign({},event||e,{id:i,time:e.time,drop_time:e.time,score:e.confidence_score,confidence_score:e.confidence_score});});}
function windows(result,selections,cs,duration,frame){var v=result.musicV12||result.musicV10,by={},out=[];for(var i=0;i<cs.length;i++)by[cs[i].id]=cs[i];for(i=0;i<selections.length;i++){var c=by[selections[i].candidate_id];if(!c)continue;var t=num(c.time||c.drop_time,0),st=beatOffset(result,t,-v.best_drop_window.pre_beats),en=beatOffset(result,t,v.best_drop_window.post_beats);var range=result.snapshot&&result.snapshot.range||{start:0,end:duration};if(st<range.start||en>range.end)continue;function snap(x){return frame>0?Math.round(x/frame)*frame:x;}st=Math.max(range.start,snap(st));en=Math.min(range.end,snap(en));t=snap(t);if(!(st<t&&t<en))continue;out.push({rank:out.length+1,candidate_id:c.id,start:st,end:en,drop_time:t,pre_beats:v.best_drop_window.pre_beats,post_beats:v.best_drop_window.post_beats,beat_interval:localBeat(result,t),total_seconds:round(en-st,3),build_seconds:round(t-st,3),drop_seconds:round(en-t,3),confidence:c.confidence||'medium',score:c.score,confidence_score:c.confidence_score,reason:selections[i].reason||'Music Engine V18 selected main drop'});}return out;}
function reviewCandidates(result,duration){var rows=cachedFeatures(result,duration),stats=featureStats(rows);return rows.filter(function(c){return mainDropEvidence(c,'aggressive',stats);});}
var api={reviewCandidates:reviewCandidates,enrich:enrich,pacing:pacing,candidates:candidates,windows:windows,beatOffset:beatOffset,threshold:threshold,selectMainDrops:selectMainDrops};root.RPMusicV12=api;root.RPMusicV10=api;
}(typeof window!=='undefined'?window:globalThis));
