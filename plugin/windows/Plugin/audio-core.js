(function(root){
'use strict';
var api={};
api.features=function(){
 // 8 kHz mono analysis. Keep the original broad features for compatibility, while
 // adding sub/mid/flux proxies so drop scoring can distinguish a real impact from
 // a simple loudness rise. These are lightweight one-pole bands (no FFT required).
 var samples=0,sum=0,lowSum=0,subSum=0,midSum=0,highSum=0,transSum=0,fluxSum=0;
 var low=0,sub=0,prev=0,prevSub=0,prevMid=0,prevHigh=0;
 var rms=[],bass=[],subbass=[],mid=[],high=[],transient=[],flux=[];
 return {push:function(x){
  if(!Number.isFinite(x))x=0;
  sub+=0.055*(x-sub);            // sub/low-bass proxy
  low+=0.132*(x-low);            // legacy bass proxy
  var midBand=low-sub,hi=x-low,dx=x-prev;prev=x;
  var sm=Math.abs(sub),mm=Math.abs(midBand),hm=Math.abs(hi);
  var fl=Math.max(0,sm-prevSub)+Math.max(0,mm-prevMid)+Math.max(0,hm-prevHigh);
  prevSub=sm;prevMid=mm;prevHigh=hm;
  sum+=x*x;lowSum+=low*low;subSum+=sub*sub;midSum+=midBand*midBand;highSum+=hi*hi;transSum+=dx*dx;fluxSum+=fl*fl;samples++;
  if(samples===80){
   rms.push(Math.sqrt(sum/80));bass.push(Math.sqrt(lowSum/80));subbass.push(Math.sqrt(subSum/80));mid.push(Math.sqrt(midSum/80));high.push(Math.sqrt(highSum/80));transient.push(Math.sqrt(transSum/80));flux.push(Math.sqrt(fluxSum/80));
   samples=0;sum=0;lowSum=0;subSum=0;midSum=0;highSum=0;transSum=0;fluxSum=0;
  }
 },result:function(){return {rms:rms,bass:bass,subbass:subbass,mid:mid,high:high,transient:transient,flux:flux};}};
};
api.analyze=async function(feature,options){
 options=options||{};
 var rms=feature.rms,bass=feature.bass,rate=100,onset=new Float64Array(rms.length),bassAttack=new Float64Array(rms.length),rhythmAttack=new Float64Array(rms.length),beats=[],tempos=[],measuredTempo=[],previousPeriod=0;
 var tick=options.tick||function(){return Promise.resolve();},progress=options.progress||function(){};
 for(var i=2;i<rms.length;i++){
  if(rms[i]<0.00001)continue;
  onset[i]=0.35*Math.max(0,Math.log((rms[i]+1e-8)/(rms[i-2]+1e-8)))+
   0.65*Math.max(0,Math.log((bass[i]+1e-8)/(bass[i-2]+1e-8)));
  bassAttack[i]=Math.max(0,bass[i]-bass[i-2]);
  rhythmAttack[i]=Math.max(0,Number((feature.flux||[])[i])||0)+Math.max(0,(Number((feature.transient||[])[i])||0)-(Number((feature.transient||[])[i-2])||0));
 }
 // Smooth low-band attacks over 30 ms so fractional beat periods retain their
 // fundamental correlation instead of preferring an exact three-beat multiple.
 var attacks=bassAttack.slice();for(i=1;i<rms.length-1;i++)bassAttack[i]=(attacks[i-1]+2*attacks[i]+attacks[i+1])/4;
 // Re-estimate local tempo every four seconds. A sixteen-second context keeps
 // autocorrelation stable while reacting faster to genuine BPM changes.
 var tempoHop=400,tempoLookBack=400,tempoLookAhead=1200;
 for(var base=0;base<rms.length;base+=tempoHop){
  await tick();
  var left=Math.max(0,base-tempoLookBack),right=Math.min(rms.length,base+tempoLookAhead),n=right-left;
  if(n<600)continue;
  var mu=0,bassMu=0,rhythmMu=0,variance=0,bassVariance=0,rhythmVariance=0,amplitude=0;
  for(i=left;i<right;i++){mu+=onset[i];bassMu+=bassAttack[i];rhythmMu+=rhythmAttack[i];amplitude+=rms[i]*rms[i];}
  mu/=n;bassMu/=n;rhythmMu/=n;
  for(i=left;i<right;i++)rhythmVariance+=(rhythmAttack[i]-rhythmMu)*(rhythmAttack[i]-rhythmMu);
  for(i=left;i<right;i++)bassVariance+=(bassAttack[i]-bassMu)*(bassAttack[i]-bassMu);
  for(i=left;i<right;i++)variance+=(onset[i]-mu)*(onset[i]-mu);
  if(variance/n<0.0005||Math.sqrt(amplitude/n)<0.00001)continue;
  var best=-1,lag=50,quality=0,correlations=[];
  for(var k=25;k<=150;k++){
   var dot=0,a=0,b=0,bd=0,ba=0,bb=0,rd=0,ra=0,rb=0;
   for(i=left+k;i<right;i++){var u=onset[i]-mu,v=onset[i-k]-mu;dot+=u*v;a+=u*u;b+=v*v;var bu=bassAttack[i]-bassMu,bv=bassAttack[i-k]-bassMu;bd+=bu*bv;ba+=bu*bu;bb+=bv*bv;var ru=rhythmAttack[i]-rhythmMu,rv=rhythmAttack[i-k]-rhythmMu;rd+=ru*rv;ra+=ru*ru;rb+=rv*rv;}
   // Kick prominence disambiguates eighth-note hats from the quarter-note pulse.
   // Fall back to broad onset evidence where bass is absent.
   var broad=dot/Math.sqrt(a*b||1),low=bd/Math.sqrt(ba*bb||1),rhythm=rd/Math.sqrt(ra*rb||1),hasRhythm=rhythmVariance/n>1e-10;
   var ac=bassVariance/n>1e-8?(hasRhythm?.25*broad+.65*low+.10*rhythm:.3*broad+.7*low):(hasRhythm?.65*broad+.35*rhythm:broad),score=ac-.012*Math.abs(Math.log(k/50));
   correlations[k]=ac;if(score>best){best=score;lag=k;quality=ac;}
  }
  // Prefer a strong fundamental repetition over its two/three-beat multiple.
  // Fractional periods otherwise make 180 BPM appear as an exact 60 BPM peak.
  for(k=25;k<=lag;k++)if(correlations[k]>=Math.max(.25,quality*.65)&&correlations[k]>=(correlations[k-1]||0)&&correlations[k]>=(correlations[k+1]||0)){lag=k;quality=correlations[k];break;}
  // Octave ambiguity is resolved only when a nearby previous tempo has nearly
  // equal evidence. A strong genuine tempo change is not forcibly smoothed away.
  var octaveCandidates=[lag/2,lag,lag*2],previousAt=Math.round(previousPeriod);
  // Only a previous tempo that is not slower is kept: a beat repeating every 0.46 s also correlates almost as well at
  // 0.92 s, so holding a slower previous period locked a third of a 130 BPM set at 65 BPM (Best Drop windows doubled).
  if(previousAt>=25&&previousAt<=150&&previousAt<lag&&Math.abs(Math.log(lag/previousPeriod))>.4&&correlations[previousAt]>=quality*.94){lag=previousAt;quality=correlations[lag];}
  if(quality<.30&&previousAt>=25&&previousAt<=150&&previousAt<=lag*1.1&&correlations[previousAt]>=.12){lag=previousAt;quality=correlations[lag];}
  if(quality<.12)continue;
  var lm=correlations[lag-1],lc=correlations[lag],lp=correlations[lag+1],den=lm-2*lc+lp;
  var delta=isFinite(den)&&den<-.000001?Math.max(-.5,Math.min(.5,.5*(lm-lp)/den)):0,period=lag+delta;
  var phase=0,peak=-1;
  for(k=0;k<lag;k++){
   var scoreSum=0;
   for(i=left+k;i<right-.5;i+=period)scoreSum+=onset[Math.round(i)];
   if(scoreSum>peak){phase=k;peak=scoreSum;}
  }
  previousPeriod=period;
  tempos.push(6000/period);measuredTempo.push({time:base/rate,bpm:6000/period,beat_interval:period/rate,confidence:quality,octave_candidates:octaveCandidates.filter(function(x){return x>=25&&x<=150;}).map(function(x){return {bpm:6000/x,evidence:correlations[Math.round(x)]||0};}),tracker:'multifeature-local-v18'});
  for(var j=left+phase;j<right-.5;j+=period){
   var center=Math.round(j),pos=center,radius=Math.floor(period*.2);
   for(i=Math.max(left,center-radius);i<Math.min(right,center+radius+1);i++)if(onset[i]>onset[pos])pos=i;
   if(pos<base||pos>=Math.min(rms.length,base+tempoHop)||rms[pos]<Math.max(.00001,Math.sqrt(amplitude/n)*.03))continue;
   var time=pos/rate;
   if(!beats.length||time-beats[beats.length-1].time>.23)beats.push({time:time,strength:onset[pos]});
  }
  progress(Math.min(1,(base+tempoHop)/rms.length));
 }
 // Keep the detected beat grid dense. AI pacing chooses which beats become actual edit boundaries later.
 var markers=[];
 for(i=0;i<beats.length;i++){
  var at=Math.round(beats[i].time*rate),before=0,after=0;
  if(at>=100&&at+100<rms.length){
   for(j=at-100;j<at;j++)before+=rms[j]*rms[j];
   for(j=at;j<at+100;j++)after+=rms[j]*rms[j];
  }
  var energyJump=before>1e-7&&after/before>3.2;
  markers.push({time:beats[i].time,reason:energyJump?'Energy change':'Beat',strength:beats[i].strength});
 }
 // Infer bar/downbeat phase from repeating beat-strength accents. This is evidence, not a guaranteed musical label.
 var phaseScores=[0,0,0,0];for(i=0;i<beats.length;i++)phaseScores[i%4]+=Number(beats[i].strength)||0;var downPhase=0;for(i=1;i<4;i++)if(phaseScores[i]>phaseScores[downPhase])downPhase=i;
 var grid=[];for(i=0;i<beats.length;i++){var isDown=(i%4)===downPhase,bar=Math.floor((i-downPhase)/4)+1;grid.push({time:beats[i].time,strength:beats[i].strength||0,beat_in_bar:((i-downPhase)%4+4)%4+1,is_downbeat:isDown,bar:Math.max(1,bar),phrase8:isDown&&bar>0&&((bar-1)%8===0),phrase16:isDown&&bar>0&&((bar-1)%16===0),phrase32:isDown&&bar>0&&((bar-1)%32===0)});}
 progress(1);
 return {markers:markers,beatCount:beats.length,tempos:tempos,tempoMap:measuredTempo,grid:grid,downbeatPhase:downPhase};
};
api.timeline=function(results,snapshot){
 var points=[],meta=[],seen={};
 results.forEach(function(result,i){
  var clip=snapshot.clips[i];
  result.markers.forEach(function(m){
   var frame=Math.round((clip.start+m.time)/snapshot.frame),t=frame*snapshot.frame;
   if(t>0&&t<snapshot.duration&&t>=clip.start&&t<clip.end&&!seen[frame]){
    seen[frame]=true;points.push(t);meta.push({time:t,reason:m.reason,strength:m.strength||0});
   }
  });
 });
 points.sort(function(a,b){return a-b;});meta.sort(function(a,b){return a.time-b.time;});
 return {points:points,meta:meta};
};
root.RPBeat=api;
if(typeof module!=='undefined'&&module.exports)module.exports=api;
}(typeof window!=='undefined'?window:globalThis));
