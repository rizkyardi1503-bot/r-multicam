/* R Project audio sync: places camera clips on the master-music timeline from their own scratch audio.
   Two cues at 10 ms: the onset envelope (beat-sharp, but repeats every beat) and the loudness contour
   (breakdowns, drops, crowd: places a clip in the right region). One camera has one clock, so file
   creation_time minus timeline offset is the same for all of its clips: a few long clips fix that
   anchor, then every clip is searched only near where its clock puts it. That is what makes short
   clips usable and keeps a long set fast. Local only: audio is decoded by the user's FFmpeg. */
(function(root){
'use strict';
var RATE=100,SR=8000,HOP=SR/RATE;
var RANK={high:2,medium:1,low:0};
// Shortest single clip whose high-confidence match is trusted as the camera clock (see syncCameraSteps).
var SINGLE_CLOCK_MIN=120;
// Seconds the start and end matches of one long take may differ and still confirm each other (clock drift is ~0.1 s/h).
var SINGLE_END_AGREE=1;

// ---- envelopes ----
// onset + level are the rp-engine cues (lib/media.mjs onsetEnvelope). The band contours add what a few
// seconds of beat music need: kick, snare, chords and vocals fill different bands, so beats inside a bar
// stop looking alike. Bands are only used by the clock-guided window search.
var BAND_HZ=[90,250,600,1500,3000],BAND_KEYS=BAND_HZ.map(function(f,i){return 'band'+i;});
function bandpass(f0){var w=2*Math.PI*f0/SR,alpha=Math.sin(w)/(2*1.0),a0=1+alpha;return {b0:alpha/a0,b2:-alpha/a0,a1:-2*Math.cos(w)/a0,a2:(1-alpha)/a0,x1:0,x2:0,y1:0,y2:0};}
function envelopeBuilder(){
 var onset=[],level=[],acc=0,n=0,prev=0,filters=BAND_HZ.map(bandpass),bandAcc=new Float64Array(BAND_HZ.length),bands=BAND_HZ.map(function(){return [];});
 function push(v){
  if(!isFinite(v))v=0;acc+=v*v;
  for(var k=0;k<filters.length;k++){var f=filters[k],y=f.b0*v+f.b2*f.x2-f.a1*f.y1-f.a2*f.y2;f.x2=f.x1;f.x1=v;f.y2=f.y1;f.y1=y;bandAcc[k]+=y*y;}
  if(++n===HOP){var l=Math.log10(1e-6+Math.sqrt(acc/HOP));onset.push(Math.max(0,l-prev));level.push(Math.max(-4,l));prev=l;acc=0;n=0;
   for(k=0;k<bands.length;k++){bands[k].push(Math.max(-5,Math.log10(1e-7+Math.sqrt(bandAcc[k]/HOP))));bandAcc[k]=0;}}
 }
 return {push:push,pushMany:function(a,from,to){for(var i=from;i<to;i++)push(a[i]);},result:function(){var r={onset:Float32Array.from(onset),level:Float32Array.from(level)};for(var k=0;k<bands.length;k++)r[BAND_KEYS[k]]=Float32Array.from(bands[k]);return r;}};
}
function envelopeFromSamples(samples){var b=envelopeBuilder();b.pushMany(samples,0,samples.length);return b.result();}

function runtime(){
 var n=root.cep_node;if(n)return {cp:n.require('child_process'),Buffer:n.require('buffer').Buffer};
 if(typeof require==='function')return {cp:require('child_process'),Buffer:require('buffer').Buffer};
 throw Error('Node is unavailable. Reinstall and restart Premiere.');
}
var LITTLE_ENDIAN=new Uint8Array(new Uint32Array([1]).buffer)[0]===1;
// Seek exactly: an input -ss on AAC audio (m4a, mp4/mov camera files) lands 8-64 ms off (even -ss 0 drops
// the first AAC frame). Seek the input to 10 s before the start, then trim the rest after decoding: exact.
function seekArgs(file,start){var s=Math.max(0,Number(start)||0),coarse=Math.max(0,s-10),fine=s-coarse,out=[];if(coarse>=1e-6)out.push('-ss',coarse.toFixed(6));out.push('-i',file);if(fine>=1e-6)out.push('-ss',fine.toFixed(6));return out;}
/** Decode [start, start+length) of a file's first audio stream (length 0 = to the end) into envelopes. */
function decodeEnvelope(ffmpeg,file,start,length,state){
 var r=runtime();state=state||{};
 return new Promise(function(resolve,reject){
  if(state.cancelled)return reject(Error('Sync stopped.'));
  var args=['-nostdin','-hide_banner','-v','error'].concat(seekArgs(file,start));
  if(length)args.push('-t',Number(length).toFixed(6));
  args.push('-map','0:a:0','-vn','-ac','1','-ar',String(SR),'-af','highpass=f=30,lowpass=f=3500','-f','f32le','pipe:1');
  var proc=r.cp.spawn(ffmpeg,args,{windowsHide:true,shell:false}),env=envelopeBuilder(),carry=r.Buffer.alloc(0),err='',settled=false;state.process=proc;
  function fail(e){if(!settled){settled=true;reject(e);}}
  proc.stdout.on('data',function(chunk){
   if(settled)return;if(state.cancelled){proc.kill();return;}
   var b=carry.length?r.Buffer.concat([carry,chunk]):chunk,end=b.length-b.length%4,count=end>>2;
   if(LITTLE_ENDIAN){var pcm=b.byteOffset%4===0?new Float32Array(b.buffer,b.byteOffset,count):new Float32Array(new Uint8Array(b.subarray(0,end)).buffer,0,count);env.pushMany(pcm,0,count);}
   else for(var i=0;i<end;i+=4)env.push(b.readFloatLE(i));
   carry=r.Buffer.from(b.subarray(end));
  });
  proc.stderr.on('data',function(d){err=(err+d).slice(-1000);});
  proc.on('error',function(e){fail(Error('Could not start FFmpeg: '+e.message));});
  proc.on('close',function(code){state.process=null;if(state.cancelled)return fail(Error('Sync stopped.'));if(code!==0)return fail(Error('FFmpeg could not read audio from '+file+': '+err));if(!settled){settled=true;resolve(env.result());}});
 });
}

// ---- correlation ----
function zeroMean(a){var m=0,i;for(i=0;i<a.length;i++)m+=a[i];m/=Math.max(1,a.length);var s=0,out=new Float64Array(a.length);for(i=0;i<a.length;i++){out[i]=a[i]-m;s+=out[i]*out[i];}var k=1/Math.sqrt(s||1);for(i=0;i<out.length;i++)out[i]*=k;return out;}
function fft(re,im,inverse){
 var n=re.length,i,j,t;
 for(i=1,j=0;i<n;i++){var bit=n>>1;for(;j&bit;bit>>=1)j^=bit;j^=bit;if(i<j){t=re[i];re[i]=re[j];re[j]=t;t=im[i];im[i]=im[j];im[j]=t;}}
 for(var len=2;len<=n;len<<=1){var ang=(2*Math.PI/len)*(inverse?1:-1),wr=Math.cos(ang),wi=Math.sin(ang),half=len>>1;
  for(i=0;i<n;i+=len){var cr=1,ci=0;for(var k=0;k<half;k++){var a=i+k,b=a+half,xr=re[b]*cr-im[b]*ci,xi=re[b]*ci+im[b]*cr;re[b]=re[a]-xr;im[b]=im[a]-xi;re[a]+=xr;im[a]+=xi;t=cr*wr-ci*wi;ci=cr*wi+ci*wr;cr=t;}}}
 if(inverse)for(i=0;i<n;i++){re[i]/=n;im[i]/=n;}
}
var KEYS=['onset','level'],WINDOW_KEYS=KEYS.concat(BAND_KEYS);
/** Normalise the master envelopes once per music file; spectra are added lazily per FFT size. */
function prepareMaster(env){
 var m={n:env.onset.length,onset:zeroMean(env.onset),level:zeroMean(env.level),energy:{},spectra:{}};
 WINDOW_KEYS.forEach(function(key){if(!env[key])return;var a=key==='onset'||key==='level'?m[key]:(m[key]=zeroMean(env[key])),e=new Float64Array(a.length+1);for(var i=0;i<a.length;i++)e[i+1]=e[i]+a[i]*a[i];m.energy[key]=e;});
 return m;
}
function camCues(cam){var c={nb:cam.onset.length};WINDOW_KEYS.forEach(function(key){if(!cam[key])return;var z=zeroMean(cam[key]),p=new Float64Array(z.length+1);for(var i=0;i<z.length;i++)p[i+1]=p[i]+z[i]*z[i];c[key]=z;c[key+'Prefix']=p;});return c;}
function summarise(scores,lags,minRivalGap){
 var best=-Infinity,bestLag=0,sum=0,sq=0,count=0,i;
 for(i=0;i<scores.length;i++){var v=scores[i];if(!isFinite(v))continue;sum+=v;sq+=v*v;count++;if(v>best){best=v;bestLag=lags(i);}}
 var second=-Infinity;for(i=0;i<scores.length;i++){var w=scores[i];if(!isFinite(w)||Math.abs(lags(i)-bestLag)<minRivalGap)continue;if(w>second)second=w;}
 var mean=sum/Math.max(1,count),sd=Math.sqrt(Math.max(1e-12,sq/Math.max(1,count)-mean*mean));
 return {best:best,bestLag:bestLag,second:second,z:(best-mean)/sd,ratio:second>0?best/second:10,count:count};
}
/** Whole-music search (ported unchanged from rp-engine syncByAudio). */
function scanFull(master,cam,opts){
 opts=opts||{};var excerptStart=Number(opts.excerptStart)||0,cue=camCues(cam),na=master.n,nb=cue.nb;
 if(nb<RATE*3)throw Error('Camera audio too short to sync without a camera clock.');
 var size=1;while(size<na+nb)size<<=1;
 if(!master.spectra[size]){var spec={};KEYS.forEach(function(key){var re=new Float64Array(size),im=new Float64Array(size);re.set(master[key]);fft(re,im,false);spec[key]={re:re,im:im};});master.spectra[size]=spec;}
 var A=master.spectra[size],minOverlap=Math.max(RATE*3,Math.floor(nb*.5));
 function lagOf(i){return i<size-nb?i:i-size;}
 function overlapOf(lag){return Math.min(na,lag+nb)-Math.max(0,lag);}
 function valid(lag){return lag<=na-1&&lag>=-(nb-1)&&overlapOf(lag)>=minOverlap;}
 var sumCorr=new Float64Array(size).fill(NaN);
 for(var i0=0;i0<size;i0++)if(valid(lagOf(i0)))sumCorr[i0]=0;
 KEYS.forEach(function(key){
  var ar=new Float64Array(size),ai=new Float64Array(size),br=new Float64Array(size),bi=new Float64Array(size),i;br.set(cue[key]);fft(br,bi,false);
  for(i=0;i<size;i++){ar[i]=A[key].re[i]*br[i]+A[key].im[i]*bi[i];ai[i]=A[key].im[i]*br[i]-A[key].re[i]*bi[i];}
  fft(ar,ai,true);var e=master.energy[key],bp=cue[key+'Prefix'];
  for(i=0;i<size;i++){var lag=lagOf(i);if(!valid(lag))continue;var s0=Math.max(0,lag),s1=Math.min(na,lag+nb);sumCorr[i]+=ar[i]/(Math.sqrt(Math.max(1e-12,e[s1]-e[s0]))*Math.sqrt(Math.max(1e-12,bp[s1-lag]-bp[s0-lag])))/2;}
 });
 var s=summarise(sumCorr,lagOf,RATE/2);
 var confidence=s.best>=.4&&s.ratio>=1.05&&s.z>=4?'high':s.best>=.25&&s.ratio>=1.03&&s.z>=4?'medium':'low';
 return {sumCorr:sumCorr,lagOf:lagOf,excerptStart:excerptStart,seconds:nb/RATE,legacy:result(s,excerptStart,confidence,'audio')};
}
/** rp-engine syncByAudio behaviour, kept for comparison: the 2-cue FFT peak and its confidence. */
function matchFullLegacy(master,cam,opts){return scanFull(master,cam,opts).legacy;}
/**
 * Whole-music search without a camera clock. The 2-cue FFT peak alone is not trustworthy on varied
 * music with crowd noise (it placed clips hundreds of seconds off with "high" confidence), so it only
 * shortlists candidates: the best FULL_CANDIDATES peaks at least 2 s apart are rescored with all
 * 7 cues, and the winner must be agreed by the cues AND clearly beat the runner-up.
 */
// Candidates are 2 s apart, so a lag 0.5-2 s from a shortlisted peak (the true beat next to a louder wrong one) is
// never shortlisted itself: the winner is searched again over +-FULL_REFINE s, which covers that exclusion radius.
// Only the winner: widening every candidate lifts wrong ones too (best of 4x more lags) and lost correct matches on
// the benchmark; widening the winner can only raise its score, so its margin never drops.
var FULL_CANDIDATES=8,FULL_REFINE=2;
function matchFull(master,cam,opts){
 var scan=scanFull(master,cam,opts),sc=scan.sumCorr,taken=[],cands=[],i,k;
 for(k=0;k<FULL_CANDIDATES;k++){
  var best=-Infinity,at=-1;
  for(i=0;i<sc.length;i++){var v=sc[i];if(!(v>best))continue;var lag=scan.lagOf(i),near=false;for(var j=0;j<taken.length;j++)if(Math.abs(taken[j]-lag)<2*RATE){near=true;break;}if(!near){best=v;at=lag;}}
  if(at===-1&&best===-Infinity)break;taken.push(at);
  var cand=matchWindow(master,cam,{excerptStart:scan.excerptStart,expectedOffset:at/RATE-scan.excerptStart,radius:.3,clockBound:Infinity});cand.center=at/RATE-scan.excerptStart;cands.push(cand);
 }
 cands.sort(function(a,b){return b.score-a.score;});
 var wide=matchWindow(master,cam,{excerptStart:scan.excerptStart,expectedOffset:cands[0].center,radius:FULL_REFINE,clockBound:Infinity});
 if(wide.score>cands[0].score)cands[0]=wide;
 // The widened winner may climb onto a runner-up's peak: that runner-up is then the same position, not a rival.
 cands=cands.filter(function(a,i){return i===0||Math.abs(a.offset-cands[0].offset)>=.5;});
 var top=cands[0],margin=cands.length>1?top.score-cands[1].score:top.score,T=SYNC_THRESHOLDS,need=agreementNeeded(scan.seconds);
 // Below fullMinSeconds a wrong match can look fully agreed and clear (benchmark): such clips need the camera clock.
 var confidence=scan.seconds<T.fullMinSeconds||top.score<T.minScore||top.agree<need||margin<T.fullMargin?'low':top.agree>=Math.max(need,T.highAgree)&&margin>=2*T.fullMargin?'high':'medium';
 return {offset:top.offset,confidence:confidence,score:top.score,agree:top.agree,cues:top.cues,margin:Math.round(margin*1000)/1000,legacy:scan.legacy,method:'audio'};
}
/** Search only lags within `radius` seconds of where the camera clock puts the clip. */
function matchWindow(master,cam,opts){
 var excerptStart=Number(opts.excerptStart)||0,cue=camCues(cam),na=master.n,nb=cue.nb,radius=Math.max(.5,Number(opts.radius)||3);
 if(nb<RATE)throw Error('Camera audio shorter than 1 s.');
 var keys=(opts.keys||WINDOW_KEYS).filter(function(k){return master[k]&&cue[k];});
 var center=Math.round((Number(opts.expectedOffset)+excerptStart)*RATE),span=Math.round(radius*RATE),minOverlap=Math.max(RATE,Math.floor(nb*.5)),width=2*span+1,scores=new Float64Array(width).fill(NaN),perKey=keys.map(function(){return new Float64Array(width).fill(NaN);});
 // Dot products for four neighbouring lags per pass (one load of m[t], four independent sums). Every lag still sums
 // m[t]*c[t-lag] over its own overlap in increasing t (own head, shared middle, own tail), and the per-cue scores
 // are combined in the same cue order, so all values are bit-identical to a lag-by-lag loop; about 2-3x faster.
 var dots=new Float64Array(width);
 for(var k=0;k<keys.length;k++){
  var key=keys[k],m=master[key],c=cue[key],e=master.energy[key],bp=cue[key+'Prefix'],pk=perKey[k];
  for(var d=-span;d<=span;d+=4){
   var g=Math.min(4,span-d+1),L=center+d,a0=Math.max(0,L+g-1),a1=Math.min(na,L+nb),q,t,lag,s0,s1;
   for(q=0;q<g;q++){lag=L+q;s0=Math.max(0,lag);s1=Math.min(na,lag+nb);var hd=0;for(t=s0;t<Math.min(s1,a0);t++)hd+=m[t]*c[t-lag];dots[d+span+q]=hd;}
   if(g===4&&a0<a1){var u0=dots[d+span],u1=dots[d+span+1],u2=dots[d+span+2],u3=dots[d+span+3];
    for(t=a0;t<a1;t++){var mt=m[t],ct=t-L;u0+=mt*c[ct];u1+=mt*c[ct-1];u2+=mt*c[ct-2];u3+=mt*c[ct-3];}
    dots[d+span]=u0;dots[d+span+1]=u1;dots[d+span+2]=u2;dots[d+span+3]=u3;
    for(q=0;q<4;q++){lag=L+q;s1=Math.min(na,lag+nb);var tl=dots[d+span+q];for(t=a1;t<s1;t++)tl+=m[t]*c[t-lag];dots[d+span+q]=tl;}}
   else for(q=0;q<g;q++){lag=L+q;s0=Math.max(0,lag);s1=Math.min(na,lag+nb);var rest=dots[d+span+q];for(t=Math.max(s0,Math.min(s1,a0));t<s1;t++)rest+=m[t]*c[t-lag];dots[d+span+q]=rest;}
   for(q=0;q<g;q++){lag=L+q;s0=Math.max(0,lag);s1=Math.min(na,lag+nb);if(s1-s0<minOverlap)continue;pk[d+span+q]=dots[d+span+q]/(Math.sqrt(Math.max(1e-12,e[s1]-e[s0]))*Math.sqrt(Math.max(1e-12,bp[s1-lag]-bp[s0-lag])));}
  }
 }
 for(var d2=-span;d2<=span;d2++){var lag2=center+d2;if(Math.min(na,lag2+nb)-Math.max(0,lag2)<minOverlap)continue;var total=0;for(k=0;k<keys.length;k++)total+=perKey[k][d2+span]/keys.length;scores[d2+span]=total;}
 var lagAt=function(i){return center-span+i;},s=summarise(scores,lagAt,RATE/2);
 if(s.count===0)return {offset:Number(opts.expectedOffset),confidence:'low',score:0,prominence:0,peakRatio:0,agree:0,cues:keys.length,method:'clock',reason:'clip does not overlap the music near its clock position'};
 // Cue agreement: each cue's own best lag lands within 30 ms of the combined peak. A wrong beat-sized
 // match is usually carried by one or two cues; a true match is seen independently by most of them.
 var agree=0;perKey.forEach(function(arr){var b=-Infinity,at=0;for(var i=0;i<arr.length;i++)if(isFinite(arr[i])&&arr[i]>b){b=arr[i];at=lagAt(i);}if(Math.abs(at-s.bestLag)<=3)agree++;});
 var T=SYNC_THRESHOLDS,seconds=nb/RATE,need=agreementNeeded(seconds);
 // The audio peak may sit only as far from the clock position as the clock itself can be off (creation_time is
 // whole seconds plus record-start latency); a peak further out, e.g. at the window edge, is a different beat or bar.
 var margin=isFinite(s.second)?s.best-s.second:s.best,deviation=Math.abs(s.bestLag-center)/RATE,clockBound=opts.clockBound===undefined?T.maxClockDeviation:Number(opts.clockBound);
 // High also needs the peak to beat its best rival at least 0.5 s away (another beat or bar) by highWindowMargin: on
 // loop-based music a rival beat can tie the true one in all cues. A narrow win stays placed, but as medium ([CHECK]).
 var confidence=s.best<T.minScore||agree<need||deviation>clockBound?'low':agree>=Math.max(need,T.highAgree)&&seconds>=3&&margin>=T.highWindowMargin?'high':'medium';
 var r=result(s,excerptStart,confidence,'audio+clock');r.agree=agree;r.cues=keys.length;r.margin=Math.round(margin*1000)/1000;return r;
}
// Window confidence = how many of the 7 cues agree on the peak, stricter for short clips. Calibrated on a
// synthetic benchmark (6 seeds, 330 window matches): the smallest agreement with no wrong placement per length.
// highWindowMargin: on the benchmark (60 min --short seeds 1-8, 20 min seeds 1-5) correct high windows beat their
// rival by >= 0.026 while correct medium ones win by as little as 0.000, so a margin can only lower high to medium.
var SYNC_THRESHOLDS={agree:[[3,7],[10,5],[Infinity,4]],highAgree:6,minScore:.2,highWindowMargin:.02,fullMargin:.09,fullMinSeconds:10,maxClockDeviation:1.5};
function agreementNeeded(seconds){var t=SYNC_THRESHOLDS.agree;for(var q=0;q<t.length;q++)if(seconds<t[q][0])return t[q][1];return t[t.length-1][1];}
function result(s,excerptStart,confidence,method){return {offset:Math.round((s.bestLag/RATE-excerptStart)*1000)/1000,confidence:confidence,score:Math.round(s.best*1000)/1000,prominence:Math.round(s.z*10)/10,peakRatio:Math.round(s.ratio*100)/100,method:method};}

// ---- per camera ----
/**
 * clips: [{id, duration, created (unix s or null), env:{onset,level,band*}, excerptStart, sourceIn?, file? (same file + In = one clip for the clock), mediaDuration? (whole file, for split recordings), endEnv?, endExcerptStart?}]
 *   duration/sourceIn describe the part that will be placed (a trimmed timeline clip: sourceIn = its In point);
 *   excerptStart and created are in media time from the file's first frame.
 * Returns {anchor, clips:[{id, status:'placed'|'review'|'excluded', offset, confidence, method, reason, drift?}]}
 * timeline time = camera time + offset.
 */
function syncCamera(master,clips,opts){var it=syncCameraSteps(master,clips,opts),r;while(!(r=it.next()).done){}return r.value;}
/** Same as syncCamera, but gives the panel back control every ~30 ms and stops when state.cancelled is set. */
async function syncCameraAsync(master,clips,opts,state){
 var it=syncCameraSteps(master,clips,opts),r,t=Date.now();
 while(!(r=it.next()).done){if(state&&state.cancelled)throw Error('Sync stopped.');if(Date.now()-t>30){await new Promise(function(res){setTimeout(res,0);});t=Date.now();}}
 if(state&&state.cancelled)throw Error('Sync stopped.');return r.value;
}
function* syncCameraSteps(master,clips,opts){
 opts=opts||{};var musicDuration=master.n/RATE,frame=Number(opts.frame)||0,radius=Number(opts.radius)||3,minRank=RANK[opts.minConfidence||'medium'],anchorClips=Math.max(2,Number(opts.anchorClips)||4);
 var weight=function(c){return c==='high'?3:c==='medium'?1:0;},out={},timed=clips.filter(function(c){return isFinite(c.created)&&c.env&&c.env.onset.length>=RATE*3;});
 // 1. Anchor from the longest clips with a clock (full search only for these).
 var probes=timed.slice().sort(function(a,b){return b.duration-a.duration;}).slice(0,anchorClips),full={},pi;
 for(pi=0;pi<probes.length;pi++){try{full[probes[pi].id]=matchFull(master,probes[pi].env,{excerptStart:probes[pi].excerptStart});}catch(e){}yield;}
 // Two project items of one file with the same In point are one piece of evidence, not two agreeing clips.
 function anchorFrom(all){var best=null,bestW=0,bestN=0,seen={},list=all.filter(function(d){var k=(d.clip.file||d.clip.fileName||'#'+d.clip.id)+'|'+(Number(d.clip.sourceIn)||0)+'|'+d.clip.created;if(seen[k])return false;seen[k]=true;return true;});list.forEach(function(c){var a0=c.created-c.offset,support=list.filter(function(d){return Math.abs(d.created-d.offset-a0)<=2.5;}),w=support.reduce(function(n,d){return n+weight(d.confidence);},0);if(w>bestW){bestW=w;bestN=support.length;best=support.reduce(function(n,d){return n+(d.created-d.offset)*weight(d.confidence);},0)/w;}});return {anchor:best,weight:bestW,support:bestN,distinct:list.length};}
 var seeds=probes.filter(function(c){return full[c.id]&&weight(full[c.id].confidence)>0;}).map(function(c){return {created:c.created,offset:full[c.id].offset,confidence:full[c.id].confidence,duration:c.duration,clip:c};});
 // A medium match whose end excerpt, searched separately over the whole music, lands on the same offset (within
 // SINGLE_END_AGREE) is two independent matches of one clip: it weighs as high for the clock (the single-take rule below
 // trusts the same evidence). New zumana cam 2 (DJI Osmo, split take 0003 + 0004, both medium): 0003 start -41.31 s,
 // end -41.34 s, so the DJI clock is trusted and the drone bridges through it. Only the anchor (its weight and the
 // weighted mean inside the 2.5 s cluster) changes; placed clips keep their own confidence. A second agreeing clip is
 // still required for a camera of several clips.
 for(pi=0;pi<seeds.length;pi++){if(seeds[pi].confidence!=='medium')continue;yield;if(endAgrees(seeds[pi]))seeds[pi].confidence='high';}
 var A=anchorFrom(seeds);
 // Not enough agreeing long clips: try the next ones before giving up on the clock.
 for(var more=anchorClips;!(A.weight>=3&&A.support>=2)&&more<timed.length&&more<anchorClips+8;more++){
  var c2=timed.slice().sort(function(a,b){return b.duration-a.duration;})[more];if(!c2)break;try{full[c2.id]=matchFull(master,c2.env,{excerptStart:c2.excerptStart});}catch(e){continue;}
  if(weight(full[c2.id].confidence)>0){var sd2={created:c2.created,offset:full[c2.id].offset,confidence:full[c2.id].confidence,duration:c2.duration,clip:c2};if(sd2.confidence==='medium'){yield;if(endAgrees(sd2))sd2.confidence='high';}seeds.push(sd2);A=anchorFrom(seeds);}
  yield;
 }
 // A camera filmed in one long take has no second clip to cross-check its clock. When it is the only clip that
 // matched, it is trusted on its own (drones bridge through it). A take with an end excerpt (over 600 s, see
 // sync-ui.js LONG_CLIP) is trusted only when a separate whole-music search of that end lands on the same offset
 // (medium or better, within SINGLE_END_AGREE), whether its start matched high or medium: a high start alone can
 // still be a wrong region, and the end is a second, independent check (the halloween cams: one 1 h take each,
 // medium at the start, end within 0.1 s). A take without an end excerpt needs a high-confidence match of at least
 // SINGLE_CLOCK_MIN seconds; so does a take whose end excerpt is too short to search (audio shorter than the video)
 // or, placed at the start's offset, lies mostly outside the music (after its end, in an A1 gap): nothing to check.
 // Two or more matching clips still have to agree, so a camera with a wrong clock is not trusted.
 var single=false;
 if(!(A.weight>=3&&A.support>=2)&&A.distinct===1){
  var s1=seeds[0],sc=s1.clip;
  if(endUsable(sc)&&endInMusic(sc,s1.offset)){yield;var e1=null;try{e1=matchFull(master,sc.endEnv,{excerptStart:sc.endExcerptStart});}catch(e){e1=null;}single=!!e1&&RANK[e1.confidence]>=1&&Math.abs(e1.offset-s1.offset)<=SINGLE_END_AGREE;}
  else single=s1.confidence==='high'&&s1.duration>=SINGLE_CLOCK_MIN;
 }
 var clock=(A.weight>=3&&A.support>=2)||single?A.anchor:null;
 // 2. Every clip: clock-guided window when the camera clock is trusted, whole-music search otherwise.
 for(var ci=0;ci<clips.length;ci++){
  yield;
  var c=clips[ci],r;
  if(!c.env||!c.env.onset.length){out[c.id]={id:c.id,status:'excluded',reason:'no audio to sync'};continue;}
  if(clock!==null&&isFinite(c.created)){
   var expected=c.created-clock;
   if(expected+(c.sourceIn||0)>=musicDuration+2||expected+(c.sourceIn||0)+c.duration<=-2){out[c.id]={id:c.id,status:'excluded',offset:expected,reason:'camera clock places it outside the music'};continue;}
   try{r=matchWindow(master,c.env,{excerptStart:c.excerptStart,expectedOffset:expected,radius:radius});}catch(e){out[c.id]={id:c.id,status:'review',offset:expected,confidence:'low',method:'clock',reason:c.duration<1?'clip shorter than 1 s':String(e.message||e)};continue;}
   r.clockOffset=Math.round(expected*1000)/1000;
   // One clip's creation_time can be off while the camera clock is right for the others (C0242: +231.7 s). Its own
   // whole-music match then wins over the clock window. Probes already have it; any other clip of at least
   // fullMinSeconds gets the search now when its window is not high; a clip with a high window keeps it (a narrow,
   // beat-periodic win is medium, see highWindowMargin, so it is searched; one search per clip would slow sets with
   // hundreds of clips; clips over 600 s are also checked at their end). Clips under fullMinSeconds are never high in a whole-music
   // search, so they keep the clock. When the window is also high (it
   // is then near the clock), both are 7-cue scores of the same kind, and the clock position is kept only when it
   // scores clearly better (by fullMargin): the whole-music search ranks its candidates on that score, so a clearly
   // better clock peak is one it missed; otherwise the clip's own audio wins.
   var own=full[c.id]||null,T=SYNC_THRESHOLDS;
   if(!own&&c.duration>=T.fullMinSeconds&&r.confidence!=='high'){yield;try{own=full[c.id]=matchFull(master,c.env,{excerptStart:c.excerptStart});}catch(e){own=null;}}
   if(own&&own.confidence==='high'&&Math.abs(own.offset-expected)>T.maxClockDeviation&&!(r.confidence==='high'&&r.score>=own.score+T.fullMargin)){
    var off=Math.round((own.offset-expected)*10)/10;
    out[c.id]={id:c.id,status:'placed',offset:own.offset,confidence:own.confidence,method:'audio',score:own.score,agree:own.agree,margin:own.margin,clockOffset:r.clockOffset,reason:'camera clock disagrees with this clip\'s audio (clock off by '+(off>0?'+':'')+off+' s); placed by audio',clockWindow:r};
    driftCheck(c,own);continue;
   }
   // Too short or unclear near the clock: keep the clock position, flag for review.
   if(RANK[r.confidence]<minRank){out[c.id]={id:c.id,status:'review',offset:expected,confidence:'low',method:'clock',reason:c.duration<3?'clip shorter than 3 s':'audio match unclear near the clock position',audio:r};continue;}
  }else{
   try{r=full[c.id]||matchFull(master,c.env,{excerptStart:c.excerptStart});}catch(e){out[c.id]={id:c.id,status:'review',offset:null,confidence:'low',method:'none',reason:String(e.message||e)};continue;}
   // A long take whose start excerpt is unclear can still be found by its end excerpt (FULL MOON cam 3, one DJI take:
   // start searched to 346.7 s low, end 184.07 s high 7/7, the start re-checked there 184.10 s high). The end is searched
   // over the whole music and the start then has to match within 0.25 s of it (camera drift over a take is tens of ms;
   // one beat is ~0.47 s at 128 BPM), so a start that only fits a beat away goes to review instead.
   if(RANK[r.confidence]<minRank&&endUsable(c)){
    yield;var e4=null,s4=null;try{e4=matchFull(master,c.endEnv,{excerptStart:c.endExcerptStart});}catch(e){e4=null;}
    if(e4&&RANK[e4.confidence]>=minRank){try{s4=matchWindow(master,c.env,{excerptStart:c.excerptStart,expectedOffset:e4.offset,radius:1,clockBound:Infinity});}catch(e){s4=null;}
     if(s4&&RANK[s4.confidence]>=minRank&&Math.abs(s4.offset-e4.offset)<=.25)r={offset:s4.offset,confidence:RANK[s4.confidence]<RANK[e4.confidence]?s4.confidence:e4.confidence,method:'audio (start+end)',score:s4.score,agree:s4.agree,margin:s4.margin};
     // Placed at the end's offset, the start excerpt lies mostly before the music or in an A1 gap: nothing there to confirm
     // (new zumana cam 1, a 73 min take that began 27 min before the recording: end -1608.69 s high 7/7). A high end
     // places it alone, as an end past the music leaves a placed start alone in driftCheck. That is one match, not two
     // (driftCheck then finds the same end again); it only places this clip and never sets the camera clock.
     else if(e4.confidence==='high'&&!excerptInMusic(e4.offset+c.excerptStart,c.env.onset.length))r={offset:e4.offset,confidence:e4.confidence,method:'audio (end)',score:e4.score,agree:e4.agree,margin:e4.margin};
     else{out[c.id]={id:c.id,status:'review',offset:e4.offset,confidence:'low',method:'audio (end)',agree:e4.agree,margin:e4.margin,reason:'audio at the start of this clip is unclear; its end matches at '+e4.offset.toFixed(2)+' s but the start does not confirm it'};continue;}}
   }
   if(RANK[r.confidence]<minRank){out[c.id]={id:c.id,status:'review',offset:r.offset,confidence:r.confidence,method:'audio',agree:r.agree,margin:r.margin,reason:'audio match unclear and no trusted camera clock'};continue;}
  }
  out[c.id]={id:c.id,status:'placed',offset:r.offset,confidence:r.confidence,method:r.method,score:r.score,agree:r.agree,margin:r.margin,clockOffset:r.clockOffset};
  driftCheck(c,r);
 }
 // Long clips: compare the start and end placement; a camera clock that runs fast/slow shows up as drift.
 // An end that does not match near the start's position, while that position puts the end inside the music, means the
 // start match (or the clip) is wrong: review. An end mostly past the music, before it or in an A1 gap (master level
 // flat at its floor) has nothing to match, so the clip stays placed; so does one whose end excerpt is under 3 s
 // (camera audio shorter than its video, a truncated tail).
 function endUsable(c){return !!c.endEnv&&isFinite(c.endExcerptStart)&&c.endEnv.onset.length>=RATE*3;}
 function endInMusic(c,offset){return excerptInMusic(offset+c.endExcerptStart,c.endEnv.onset.length);}
 /** An excerpt of n envelope samples placed at master time `at` (s) lies at least half inside music (level not flat). */
 function excerptInMusic(at,n){
  var t0=Math.round(at*RATE),t1=t0+n,lv=master.level,music=0;
  for(var t=Math.max(1,t0+1);t<Math.min(master.n,t1);t++)if(lv[t]!==lv[t-1])music++;
  return music>=(t1-t0)/2;
 }
 /** A seed's end excerpt, searched over the whole music, lands within SINGLE_END_AGREE of its start (medium or better). */
 function endAgrees(sd){
  var sc=sd.clip;if(!endUsable(sc)||!endInMusic(sc,sd.offset))return false;
  var e=null;try{e=matchFull(master,sc.endEnv,{excerptStart:sc.endExcerptStart});}catch(err){e=null;}
  return !!e&&RANK[e.confidence]>=1&&Math.abs(e.offset-sd.offset)<=SINGLE_END_AGREE;
 }
 function driftCheck(c,r){
  if(!endUsable(c))return;
  var e2=null;try{e2=matchWindow(master,c.endEnv,{excerptStart:c.endExcerptStart,expectedOffset:r.offset,radius:1,clockBound:Infinity});}catch(endError){e2=null;}
  if(e2&&RANK[e2.confidence]>=1){var drift=Math.round((e2.offset-r.offset)*1000)/1000;out[c.id].drift=drift;if(frame&&Math.abs(drift)>frame)out[c.id].reason='audio drifts '+drift.toFixed(3)+' s over the clip';return;}
  if(!endInMusic(c,r.offset))return;
  out[c.id].status='review';out[c.id].reason='start and end of this clip disagree (its end audio is not found where its start places it)';
 }
 // 2b. Split recordings: a camera that splits one long take into files (DJI ~35 min, GoPro, Sony 4 GB) writes the
 // next file's creation_time up to ~3 s after the previous file really ended, so the clock window above misses
 // the audio (Kaehla cam 1: DJI_0004/0005 sat 2.8/3.2 s late). A file whose clock starts within 4 s of the
 // previous file's end continues it exactly: search the audio around that join instead of the clock position.
 var byClock=clips.filter(function(c){return isFinite(c.created)&&isFinite(c.mediaDuration)&&out[c.id];}).sort(function(a,b){return a.created-b.created;});
 for(var bi=1;bi<byClock.length;bi++){
  var c3=byClock[bi],p3=byClock[bi-1],o3=out[c3.id],po=out[p3.id],gap=c3.created-(p3.created+p3.mediaDuration);
  if(o3.status==='placed'||po.status!=='placed'||!(gap>-1.5&&gap<=4)||!c3.env||!c3.env.onset.length)continue;
  yield;
  var join=po.offset+p3.mediaDuration,r3;
  try{r3=matchWindow(master,c3.env,{excerptStart:c3.excerptStart,expectedOffset:join,radius:1});}catch(e){continue;}
  if(RANK[r3.confidence]<minRank){o3.reason='continues '+(p3.name||p3.id)+' (join at '+join.toFixed(3)+' s); audio match unclear there too';continue;}
  out[c3.id]={id:c3.id,status:'placed',offset:r3.offset,confidence:r3.confidence,method:'audio+chain',score:r3.score,agree:r3.agree,margin:r3.margin,clockOffset:o3.offset,chainOffset:Math.round(join*1000)/1000};
  driftCheck(c3,r3);
 }
 // 3. A camera records one clip at a time: the weaker of two overlapping placed clips goes to review.
 var placed=clips.map(function(c){return {c:c,r:out[c.id]};}).filter(function(x){return x.r.status==='placed';}).sort(function(a,b){return weight(b.r.confidence)-weight(a.r.confidence)||(b.r.score||0)-(a.r.score||0);}),kept=[];
 placed.forEach(function(x){var s0=x.r.offset+(x.c.sourceIn||0),e0=s0+x.c.duration,clash=null;for(var k=0;k<kept.length;k++){var y=kept[k],y0=y.r.offset+(y.c.sourceIn||0);if(Math.min(e0,y0+y.c.duration)-Math.max(s0,y0)>1){clash=y;break;}}
  if(clash){x.r.status='review';x.r.reason='overlaps '+(clash.c.name||clash.c.id)+' of the same camera';return;}
  if(s0>=musicDuration||e0<=0){x.r.status='excluded';x.r.reason='outside the music';return;}kept.push(x);});
 clips.forEach(function(c){var r=out[c.id];if(frame&&r&&isFinite(r.offset)&&r.offset!==null)r.offset=Math.round(Math.round(r.offset/frame)*frame*1e6)/1e6;});
 return {anchor:clock,anchorSupport:A.support,anchorWeight:A.weight,clips:clips.map(function(c){return out[c.id];})};
}
/** Audio excerpt used for syncing: the whole clip if short, otherwise 2 minutes from ~20% in (as rp-engine). */
function excerptFor(duration){return duration<=150?{excerptStart:0,excerptSeconds:duration}:{excerptStart:Math.min(duration*.2,duration-120),excerptSeconds:120};}

/** Probe a media file with `ffmpeg -i` (no ffprobe needed): duration, creation_time (unix s), audio presence. */
function probe(ffmpeg,file,state){
 var r=runtime();state=state||{};
 return new Promise(function(resolve,reject){
  if(state.cancelled)return reject(Error('Sync stopped.'));
  var proc=r.cp.spawn(ffmpeg,['-hide_banner','-nostdin','-i',file],{windowsHide:true,shell:false}),text='';state.process=proc;
  proc.stderr.on('data',function(d){if(text.length<200000)text+=d;});
  proc.on('error',function(e){reject(Error('Could not start FFmpeg: '+e.message));});
  proc.on('close',function(){
   state.process=null;if(state.cancelled)return reject(Error('Sync stopped.'));
   if(/No such file|Invalid data found|does not exist/i.test(text))return reject(Error('Cannot read media: '+file));
   var lines=text.split(/\r?\n/),video=false;for(var i=0;i<lines.length;i++)if(/Stream #.*Video:/.test(lines[i])&&!/attached pic/.test(lines[i]))video=true;
   var out={file:file,duration:null,created:null,hasAudio:/Stream #.*Audio:/.test(text),hasVideo:video,make:root.RPDroneSync&&root.RPDroneSync.makeFromProbe?root.RPDroneSync.makeFromProbe(text):'',model:root.RPDroneSync&&root.RPDroneSync.modelFromProbe?root.RPDroneSync.modelFromProbe(text):'',serial:root.RPDroneSync&&root.RPDroneSync.serialFromProbe?root.RPDroneSync.serialFromProbe(text):''};
   var d=/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(text);if(d)out.duration=Number(d[1])*3600+Number(d[2])*60+Number(d[3]);
   var c=/creation_time\s*:\s*(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?)/.exec(text);if(c){var ms=Date.parse(/Z$/.test(c[1])?c[1]:c[1]+'Z');if(isFinite(ms))out.created=ms/1000;}
   if(!out.duration)return reject(Error('Could not read the duration of '+file));
   resolve(out);
  });
 });
}
/** Assemble the master envelope on the sequence timeline from decoded A1 clips [{start, env}]; gaps are silence. */
function masterFromClips(parts,duration){
 var n=Math.max(1,Math.ceil(duration*RATE)),keys=['onset','level'].concat(BAND_KEYS),out={},k,i;
 for(k=0;k<keys.length;k++){var a=new Float64Array(n),floor=keys[k]==='level'?-4:keys[k]==='onset'?0:-5;for(i=0;i<n;i++)a[i]=floor;out[keys[k]]=a;}
 parts.forEach(function(p){var at=Math.round(p.start*RATE);for(k=0;k<keys.length;k++){var src=p.env[keys[k]];if(!src)continue;for(i=0;i<src.length&&at+i<n;i++)if(at+i>=0)out[keys[k]][at+i]=src[i];}});
 return out;
}
var api={RATE:RATE,RANK:RANK,THRESHOLDS:SYNC_THRESHOLDS,envelopeBuilder:envelopeBuilder,envelopeFromSamples:envelopeFromSamples,decodeEnvelope:decodeEnvelope,prepareMaster:prepareMaster,matchFull:matchFull,matchFullLegacy:matchFullLegacy,matchWindow:matchWindow,syncCamera:syncCamera,syncCameraAsync:syncCameraAsync,excerptFor:excerptFor,probe:probe,masterFromClips:masterFromClips};
root.RPSync=api;
if(typeof module!=='undefined'&&module.exports)module.exports=api;
}(typeof window!=='undefined'?window:globalThis));
