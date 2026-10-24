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
// v18 tracker (per-window tempo and phase), kept for comparison benchmarks.
api.analyzeV18=async function(feature,options){
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
// v19 beat tracker. One tempo path for the whole clip and one continuous beat chain:
//  - onset strength: low band, broad band and transients, with a level floor so a bass swell rising out of a
//    sidechain dip does not look like a kick (a pure log ratio made those swells the strongest onsets);
//  - tempo: autocorrelation per 4 s window (16 s context); the window tempos are chosen together (Viterbi) under
//    the whole clip's dominant tempo, so the path cannot jump to 2x, 1/2x, 4/3x or 3/2x of the music's tempo
//    in an intro, a breakdown or a busy groove unless many windows agree;
//  - beats: dynamic programming over the whole clip (Ellis 2007): every beat follows the previous one by about
//    one local beat period, so window borders cannot add or drop beats and beats continue through breakdowns;
//  - each beat is then refined to the sub-frame onset peak and smoothed against its neighbours.
api.analyze=async function(feature,options){
 options=options||{};
 var rms=feature.rms,bass=feature.bass,flux=feature.flux||[],trans=feature.transient||[],N=rms.length,rate=100;
 var tick=options.tick||function(){return Promise.resolve();},progress=options.progress||function(){};
 var i,j,k,q,r,w;
 function median(a){var st=a.length>200000?4:1,b=new Float64Array(Math.ceil(a.length/st)),m7=0;for(var x=0;x<a.length;x+=st){var v7=Number(a[x]);if(v7>0&&isFinite(v7))b[m7++]=v7;}b=b.subarray(0,m7).sort();return m7?b[m7>>1]:0;}
 var fB=Math.max(1e-6,.35*median(bass)),fR=Math.max(1e-6,.35*median(rms)),fT=Math.max(1e-9,.35*median(trans)),fF=Math.max(1e-9,.35*median(flux));
 await tick();
 var low=new Float64Array(N),broad=new Float64Array(N),rhy=new Float64Array(N),onset=new Float64Array(N);
 function rise(a,f,x){var c=Math.log(f+(Number(a[x])||0)),p1=Math.log(f+(Number(a[x-1])||0)),p2=Math.log(f+(Number(a[x-2])||0));return Math.max(0,c-p1,.6*(c-p2));}
 for(i=2;i<N;i++){low[i]=rise(bass,fB,i);broad[i]=rise(rms,fR,i);rhy[i]=.5*rise(trans,fT,i)+.5*rise(flux,fF,i);}
 function mean(a){var s=0;for(var x=0;x<a.length;x++)s+=a[x];return s/(a.length||1);}
 var mL=mean(low)||1,mB=mean(broad)||1,mR=mean(rhy)||1;
 for(i=0;i<N;i++)onset[i]=.55*low[i]/mL+.25*broad[i]/mB+.20*rhy[i]/mR;
 // Remove slow swells: subtract the local mean over +-0.25 s.
 var hp=new Float64Array(N),acc=0,W=25;for(i=0;i<Math.min(N,W);i++)acc+=onset[i];
 for(i=0;i<N;i++){var lo=i-W-1,hi=i+W;if(hi<N)acc+=onset[hi];if(lo>=0)acc-=onset[lo];var cnt=Math.min(N-1,hi)-Math.max(0,lo+1)+1;hp[i]=Math.max(0,onset[i]-acc/cnt);}
 onset=hp;if(options.debug){options.debug.onset=onset;options.debug.low=low;options.debug.broad=broad;options.debug.rhy=rhy;}
 var silent=new Uint8Array(N),rmsMed=median(rms);for(i=0;i<N;i++)silent[i]=rms[i]<Math.max(1e-5,rmsMed*.02)?1:0;
 // ---- local autocorrelation per 4 s window (16 s context)
 var HOP=400,BACK=600,AHEAD=1000,MINL=25,MAXL=150,wins=[];
 for(var base=0;base<N;base+=HOP){
  await tick();
  var left=Math.max(0,base-BACK),right=Math.min(N,base+AHEAD),n=right-left,ac=new Float64Array(MAXL*4+2),mu=0,v=0,live=0;
  for(i=left;i<right;i++){mu+=onset[i];if(!silent[i])live++;}mu/=(n||1);for(i=left;i<right;i++)v+=(onset[i]-mu)*(onset[i]-mu);
  var ok=n>=600&&live>n*.5&&v/n>1e-6;
  // Four lags per pass over the window (one load of each sample, four independent sums). Each lag still adds the
  // same products in the same order as a lag-by-lag loop, so ac[] is bit-identical; about 2.5x faster.
  if(ok){var dm=new Float64Array(n),kEnd=Math.min(MAXL*4,n-1),x,s0,s1,s2,s3;for(i=0;i<n;i++)dm[i]=onset[left+i]-mu;
   for(k=MINL;k<=kEnd;k+=4){
    if(k+3>kEnd){for(var k4=k;k4<=kEnd;k4++){s0=0;for(x=k4;x<n;x++)s0+=dm[x]*dm[x-k4];ac[k4]=s0/v*n/(n-k4);}break;}
    var k1=k+1,k2=k+2,k3=k+3;s0=0;s1=0;s2=0;s3=0;
    for(x=k;x<k3;x++)s0+=dm[x]*dm[x-k];for(x=k1;x<k3;x++)s1+=dm[x]*dm[x-k1];s2+=dm[k2]*dm[0];
    for(x=k3;x<n;x++){var dx=dm[x];s0+=dx*dm[x-k];s1+=dx*dm[x-k1];s2+=dx*dm[x-k2];s3+=dx*dm[x-k3];}
    ac[k]=s0/v*n/(n-k);ac[k1]=s1/v*n/(n-k1);ac[k2]=s2/v*n/(n-k2);ac[k3]=s3/v*n/(n-k3);
   }}
  wins.push({base:base,ok:ok,ac:ac});
  progress(.6*Math.min(1,(base+HOP)/N));
 }
 function acAt(a,L){var f=Math.floor(L),t=L-f;return (a[f]||0)*(1-t)+(a[f+1]||0)*t;}
 // Comb evidence for a beat period: the pulse repeats at 1, 2 and 4 beats.
 function comb(a,L){return acAt(a,L)+.5*acAt(a,2*L)+.35*acAt(a,4*L);}
 // ---- dominant tempo of the clip (all windows together), 70-180 BPM
 var total=new Float64Array(MAXL*4+2),okc=0;for(w=0;w<wins.length;w++)if(wins[w].ok){okc++;for(k=0;k<total.length;k++)total[k]+=wins[w].ac[k];}
 var L0=50,best0=-Infinity;
 // A pulse at 140 BPM also repeats every 2 and 4 beats, so 70 BPM scores almost the same: a tempo prior
 // (log-normal around 125 BPM, 0.6 octave) breaks that tie towards the danceable octave.
 if(okc)for(var L=Math.ceil(6000/180);L<=Math.floor(6000/70);L+=.25){var lg=Math.log(6000/L/125)/Math.LN2,c0=Math.max(0,comb(total,L))*Math.exp(-.5*lg*lg/.36);if(c0>best0){best0=c0;L0=L;}}
 // ---- tempo path: candidate periods per window, chosen together (Viterbi)
 var cands=[];
 for(w=0;w<wins.length;w++){
  var list=[];
  if(wins[w].ok){
   var a=wins[w].ac,sc=[];for(var L1=MINL;L1<=MAXL;L1+=.25)sc.push([L1,comb(a,L1)]);
   sc.sort(function(x,y){return y[1]-x[1];});
   for(q=0;q<sc.length&&list.length<6;q++){var dup=false;for(r=0;r<list.length;r++)if(Math.abs(Math.log(list[r].L/sc[q][0]))<.03)dup=true;if(!dup)list.push({L:sc[q][0],e:sc[q][1]});}
   // Always offer the dominant tempo (and a small drift around it).
   [L0*.97,L0,L0*1.03].forEach(function(x){var dup2=false;for(var r2=0;r2<list.length;r2++)if(Math.abs(Math.log(list[r2].L/x))<.012)dup2=true;if(!dup2)list.push({L:x,e:comb(a,x)});});
   var mx=-Infinity;for(q=0;q<list.length;q++)mx=Math.max(mx,list[q].e);
   for(q=0;q<list.length;q++)list[q].cost=mx>0?1.2*(1-Math.max(0,list[q].e)/mx):0;
  }else list.push({L:L0,e:0,cost:0});
  // Ratio prior against the dominant tempo, and a mild preference for 85-180 BPM.
  for(q=0;q<list.length;q++){var dl=Math.abs(Math.log(list[q].L/L0)),bpm=6000/list[q].L;list[q].cost+=.9*Math.min(dl,.7)+(bpm<85||bpm>180?.4:0);}
  cands.push(list);
 }
 function stepCost(x,y){var d=Math.abs(Math.log(y/x));return d<.02?d*5:.35+3*d;}
 var D=[],B=[];
 for(w=0;w<cands.length;w++){D.push([]);B.push([]);for(q=0;q<cands[w].length;q++){
  if(!w){D[w][q]=cands[w][q].cost;B[w][q]=-1;continue;}
  var bv=Infinity,bi=0;for(r=0;r<cands[w-1].length;r++){var vv=D[w-1][r]+stepCost(cands[w-1][r].L,cands[w][q].L);if(vv<bv){bv=vv;bi=r;}}
  D[w][q]=bv+cands[w][q].cost;B[w][q]=bi;}}
 var path=new Array(cands.length),last=cands.length-1,bq=0;
 if(last>=0){for(q=1;q<D[last].length;q++)if(D[last][q]<D[last][bq])bq=q;for(w=last;w>=0;w--){path[w]=cands[w][bq];bq=B[w][bq];}}
 // Period per frame (linear between window centres).
 var per=new Float64Array(N);
 for(i=0;i<N;i++){var x=i/HOP-.5,w0=Math.max(0,Math.min(path.length-1,Math.floor(x))),w1=Math.min(path.length-1,w0+1),t=Math.max(0,Math.min(1,x-w0));per[i]=path.length?path[w0].L*(1-t)+path[w1].L*t:L0;}
 // Second pass: per window, weight each band by how clearly it pulses at that window's beat period. An intro
 // carried by hats or percussion (no kick yet) then follows the percussion; a kick section follows the kick.
 var bands=[low,broad,rhy],clarity=new Float64Array(wins.length*3),activity=new Float64Array(wins.length*3);
 function hpBand(a){var o=new Float64Array(N),s2=0;for(var x=0;x<Math.min(N,W);x++)s2+=a[x];for(x=0;x<N;x++){var l3=x-W-1,h3=x+W;if(h3<N)s2+=a[h3];if(l3>=0)s2-=a[l3];var c3=Math.min(N-1,h3)-Math.max(0,l3+1)+1;o[x]=Math.max(0,a[x]-s2/c3);}return o;}
 bands=bands.map(hpBand);var bandMean=bands.map(function(b){return mean(b)||1e-12;});
 for(w=0;w<wins.length;w++){
  var lw=Math.max(0,wins[w].base-BACK),rw=Math.min(N,wins[w].base+AHEAD),Lw=path[w]?path[w].L:L0,tot=0;
  for(var bi2=0;bi2<3;bi2++){
   var ba=bands[bi2],m2=0,v2=0,cv=0;for(i=lw;i<rw;i++)m2+=ba[i];m2/=Math.max(1,rw-lw);
   for(i=lw;i<rw;i++)v2+=(ba[i]-m2)*(ba[i]-m2);
   var Li=Math.round(Lw);for(i=lw+Li;i<rw;i++)cv+=(ba[i]-m2)*(ba[i-Li]-m2);
   // A band with almost no attacks here (a pad, silence) has no pulse, however periodic its tiny noise looks.
   var clar=v2>1e-12&&m2>=.2*bandMean[bi2]?Math.max(0,cv/v2):0;activity[w*3+bi2]=m2/bandMean[bi2];clarity[w*3+bi2]=clar;
  }
 }
 // The beat chain keeps the fixed band mix (kick-weighted). The per-window clarity above only decides where
 // the kick is clear enough to set the grid phase (see the DJ-style grid below): weighting the chain by clarity
 // let a very regular off-beat hat pull the beats half a beat off.
 if(options.debug){options.debug.onset2=onset;options.debug.clarity=clarity;options.debug.activity=activity;options.debug.L0=L0;options.debug.path=path;options.debug.cands=cands;}
 progress(.7);
 // ---- dynamic-programming beat chain
 var sd=0;for(i=0;i<N;i++)sd+=onset[i]*onset[i];sd=Math.sqrt(sd/(N||1))||1;
 var score=new Float64Array(N),back=new Int32Array(N),TIGHT=100;
 for(i=0;i<N;i++){
  if(!(i&8191))await tick();
  var P=per[i],lo2=Math.max(0,i-Math.round(P*1.25)),hi2=i-Math.round(P*.8),bs=0,bk=-1;
  for(j=lo2;j<=hi2;j++){var pen=Math.log((i-j)/P),sv=score[j]-TIGHT*pen*pen;if(bk<0||sv>bs){bs=sv;bk=j;}}
  score[i]=onset[i]/sd+(bk>=0?bs:0);back[i]=bk;
 }
 // End on the best-scoring frame of the last beat period.
 var end=N-1,endBest=-Infinity;for(i=Math.max(0,N-Math.round(per[N-1]||50));i<N;i++)if(score[i]>endBest){endBest=score[i];end=i;}
 var chain=[];for(i=end;i>=0;i=back[i]){chain.push(i);if(back[i]<0)break;}chain.reverse();
 progress(.85);
 // ---- refine: sub-frame onset peak (+-2 frames), then local regression against neighbours
 var times=[];
 for(k=0;k<chain.length;k++){
  var c=chain[k];if(silent[c]||!wins[Math.min(wins.length-1,Math.floor(c/HOP))].ok)continue;
  var pk=c;for(i=Math.max(1,c-2);i<=Math.min(N-2,c+2);i++)if(onset[i]>onset[pk])pk=i;
  var y0=onset[pk-1]||0,y1=onset[pk],y2=onset[pk+1]||0,den=y0-2*y1+y2,off=den<0?Math.max(-.5,Math.min(.5,.5*(y0-y2)/den)):0;
  times.push({t:(pk+off)/rate,s:onset[pk],raw:(pk+off)/rate});
 }
 for(k=0;k<times.length;k++){
  var a0=Math.max(0,k-8),a1=Math.min(times.length-1,k+8);if(a1-a0<8)continue;
  var sx=0,sy=0,sxx=0,sxy=0,m=0;for(q=a0;q<=a1;q++){sx+=q;sy+=times[q].raw;sxx+=q*q;sxy+=q*times[q].raw;m++;}
  var slope=(m*sxy-sx*sy)/(m*sxx-sx*sx),icp=(sy-slope*sx)/m,res=0;for(q=a0;q<=a1;q++){var e=times[q].raw-(icp+slope*q);res+=e*e;}
  if(Math.sqrt(res/m)<.015)times[k].t=icp+slope*k;
 }
 // ---- DJ-style grid: kick sections set the phase. Where there is no clear kick (intro, breakdown, outro) the
 // loudest sounds are often off-beat hats, so the chain there is replaced by the grid of the neighbouring kick
 // section (same tempo, exact phase) instead of following those hats. A stretch whose own pulse runs at a
 // different tempo keeps the chain.
 var KICK=.25;
 function isKick(t){var ww=Math.max(0,Math.min(wins.length-1,Math.floor(t*rate/HOP)));return clarity[ww*3]>=KICK;}
 // The clarity window looks up to 10 s ahead, so a window can read clear before the kick enters: a kick
 // section starts (and ends) at a beat whose low-band attack is comparable to the section's typical kick.
 function attack(t){var c9=Math.round(t*rate),m9=0;for(var z9=Math.max(0,c9-3);z9<=Math.min(N-1,c9+3);z9++)m9=Math.max(m9,bands[0][z9]);return m9;}
 function pathPeriodAt(t){var ii=Math.max(0,Math.min(N-1,Math.round(t*rate)));return per[ii]/rate;}
 function fit(arr){var m3=arr.length,sx3=0,sy3=0,sxx3=0,sxy3=0;for(var z=0;z<m3;z++){sx3+=z;sy3+=arr[z];sxx3+=z*z;sxy3+=z*arr[z];}var sl=(m3*sxy3-sx3*sy3)/(m3*sxx3-sx3*sx3);return {slope:sl,icp:(sy3-sl*sx3)/m3};}
 var segs=[],cur=null;
 for(k=0;k<times.length;k++){if(isKick(times[k].t)){if(cur&&times[k].t-times[k-1].t>1.5*pathPeriodAt(times[k].t))cur=null;if(!cur){cur={a:k,b:k};segs.push(cur);}else cur.b=k;}else cur=null;}
 segs.forEach(function(g){var at9=[];for(var z8=g.a;z8<=g.b;z8++)at9.push(attack(times[z8].t));var srt=at9.slice().sort(function(x,y){return x-y;}),md9=srt[srt.length>>1]||0;
  while(g.a<g.b&&attack(times[g.a].t)<.5*md9)g.a++;while(g.b>g.a&&attack(times[g.b].t)<.5*md9)g.b--;});
 segs=segs.filter(function(g){return g.b-g.a+1>=8;});
 if(segs.length){
  var outT=[],strengthAt=function(t){var ii=Math.max(0,Math.min(N-1,Math.round(t*rate)));return onset[ii];};
  var segTimes=function(g){var o=[];for(var z=g.a;z<=g.b;z++)o.push(times[z].t);return o;};
  var edge=function(g,first){var tt=segTimes(g),n3=Math.min(64,tt.length),part=first?tt.slice(0,n3):tt.slice(tt.length-n3),f3=fit(part);return {P:f3.slope,t:first?f3.icp:f3.icp+f3.slope*(n3-1)};};
  var pulse=function(t){var ww=Math.max(0,Math.min(wins.length-1,Math.floor(t*rate/HOP)));return Math.max(clarity[ww*3],clarity[ww*3+1],clarity[ww*3+2])>=.2;};
  // Carry the grid only through a stretch with (almost) no low-band attacks: a real breakdown or pad. Where the
  // low band is active the beat chain follows those attacks (in a DJ set the next track's kick may sit at another
  // phase than the grid of the previous one).
  var lowQuiet=function(t0,t1){var n5=0,act=0;for(var tt3=t0;tt3<t1;tt3+=4){var ww4=Math.max(0,Math.min(wins.length-1,Math.floor(tt3*rate/HOP)));act+=activity[ww4*3];n5++;}return !n5||act/n5<.45;};
  var consistent=function(P,t0,t1){if(!lowQuiet(t0,t1))return false;var n4=0,bad=0;for(var tt2=t0;tt2<t1;tt2+=4){if(!pulse(tt2))continue;n4++;if(Math.abs(Math.log(pathPeriodAt(tt2)/P))>.03)bad++;}return !n4||bad<=n4*.25;};
  var keepChain=function(t0,t1){for(var z=0;z<times.length;z++)if(times[z].t>=t0&&times[z].t<t1)outT.push({t:times[z].t,s:times[z].s});};
  var firstLive=0;while(firstLive<N&&silent[firstLive])firstLive++;var lastLive=N-1;while(lastLive>0&&silent[lastLive])lastLive--;
  // before the first kick section
  var e0=edge(segs[0],true);
  if(consistent(e0.P,firstLive/rate,e0.t)){var pre=[];for(var tb=e0.t-e0.P;tb>=firstLive/rate-1e-6;tb-=e0.P)pre.push(tb);pre.reverse();pre.forEach(function(t5){if(!silent[Math.round(t5*rate)])outT.push({t:t5,s:strengthAt(t5)});});}
  else keepChain(0,times[segs[0].a].t-1e-6);
  for(var g=0;g<segs.length;g++){
   segTimes(segs[g]).forEach(function(t6,z){outT.push({t:t6,s:times[segs[g].a+z].s});});
   if(g+1<segs.length){
    var eA=edge(segs[g],false),eB=edge(segs[g+1],true),Pm=(eA.P+eB.P)/2,gap=eB.t-eA.t,nb=Math.round(gap/Pm);
    if(nb>=1&&Math.abs(gap/nb/Pm-1)<.03&&Math.abs(Math.log(eA.P/eB.P))<.03&&consistent(Pm,eA.t,eB.t)){for(var z2=1;z2<nb;z2++){var t7=eA.t+gap*z2/nb;if(!silent[Math.round(t7*rate)])outT.push({t:t7,s:strengthAt(t7)});}}
    else keepChain(times[segs[g].b].t+1e-6,times[segs[g+1].a].t-1e-6);
   }
  }
  var e1=edge(segs[segs.length-1],false);
  if(consistent(e1.P,e1.t,lastLive/rate)){for(var tf=e1.t+e1.P;tf<=lastLive/rate+1e-6;tf+=e1.P)if(!silent[Math.min(N-1,Math.round(tf*rate))])outT.push({t:tf,s:strengthAt(tf)});}
  else keepChain(times[segs[segs.length-1].b].t+1e-6,Infinity);
  if(options.debug)options.debug.segs=segs.map(function(g2){var e2=edge(g2,true);return {from:times[g2.a].t,to:times[g2.b].t,beats:g2.b-g2.a+1,P:e2.P};});
  outT.sort(function(x,y){return x.t-y.t;});times=outT;
 }
 // ---- snap each beat to a clear kick within +-40 ms (never further: no beat can be dropped, doubled or moved
 // to the off-beat here). Removes the small drift of a grid carried through a long stretch.
 await tick();
 var kb=new Float64Array(N);for(i=0;i<N;i++)kb[i]=bands[0][i]/bandMean[0]+.5*bands[1][i]/bandMean[1];
 var kbMed=new Float64Array(N),SW=100,sorted=[];
 for(i=0;i<N;i+=50){var lo7=Math.max(0,i-SW),hi7=Math.min(N,i+SW);sorted=kb.slice(lo7,hi7).sort();var md=sorted[sorted.length>>1]||0,q9=sorted[Math.floor(sorted.length*.9)]||0;for(j=i;j<Math.min(N,i+50);j++)kbMed[j]=Math.max(md,.35*q9);}
 for(k=0;k<times.length;k++){
  var c8=Math.round(times[k].t*rate),bp=-1,bvv=0;
  for(i=Math.max(1,c8-4);i<=Math.min(N-2,c8+4);i++)if(kb[i]>bvv&&kb[i]>=kb[i-1]&&kb[i]>=kb[i+1]){bvv=kb[i];bp=i;}
  if(bp>=0&&bvv>2.5*kbMed[bp]&&bvv>.5){var z0=kb[bp-1],z1=kb[bp],z2=kb[bp+1],dz=z0-2*z1+z2,oz=dz<0?Math.max(-.5,Math.min(.5,.5*(z0-z2)/dz)):0;times[k].t=(bp+oz)/rate;}
 }
 times.sort(function(x,y){return x.t-y.t;});
 var beats=[];for(k=0;k<times.length;k++)if(times[k].t>=0&&(!beats.length||times[k].t-beats[beats.length-1].time>.2))beats.push({time:times[k].t,strength:times[k].s});
 // ---- outputs (same shape as v18)
 var tempos=[],measuredTempo=[];
 for(w=0;w<path.length;w++){if(!wins[w].ok)continue;var pw=path[w];tempos.push(6000/pw.L);
  measuredTempo.push({time:wins[w].base/rate,bpm:6000/pw.L,beat_interval:pw.L/rate,confidence:Math.max(0,Math.min(1,acAt(wins[w].ac,pw.L))),octave_candidates:[pw.L/2,pw.L,pw.L*2].filter(function(z){return z>=MINL&&z<=MAXL;}).map(function(z){return {bpm:6000/z,evidence:acAt(wins[w].ac,z)};}),tracker:'dp-global-v19'});}
 var markers=[];
 for(i=0;i<beats.length;i++){
  var at=Math.round(beats[i].time*rate),before=0,after=0;
  if(at>=100&&at+100<N){for(j=at-100;j<at;j++)before+=rms[j]*rms[j];for(j=at;j<at+100;j++)after+=rms[j]*rms[j];}
  markers.push({time:beats[i].time,reason:before>1e-7&&after/before>3.2?'Energy change':'Beat',strength:beats[i].strength});
 }
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
