/* Local FFmpeg decoder. No user media is uploaded. */
(function(root){
'use strict';
function runtime(){
 var n=root.cep_node;if(!n)throw Error('CEP Node is unavailable. Reinstall and restart Premiere.');
 return {fs:n.require('fs'),path:n.require('path'),cp:n.require('child_process'),os:n.require('os'),Buffer:n.require('buffer').Buffer};
}
/* A candidate is used only if it actually runs: a saved path can point at a broken binary (for example an old copy of
   Homebrew's ffmpeg after "brew upgrade"). Only a successful check is cached (per path, this panel session), so an
   FFmpeg installed or repaired later is picked up without restarting Premiere. */
var runsCache={};
function runs(r,file){
 if(!file||!r.fs.existsSync(file))return false;
 if(runsCache[file])return true;
 try{r.cp.execFileSync(file,['-version'],{windowsHide:true,timeout:5000,stdio:'ignore'});return (runsCache[file]=true);}catch(e){return false;}
}
function executable(userPath){
 var r=runtime(),proc=root.cep_node.require('process'),env=proc.env||{},platform=proc.platform,candidate=userPath&&userPath.trim(),candidates=[];
 if(candidate&&runs(r,candidate))return candidate;
 var base=platform==='darwin'?r.path.join(r.os.homedir(),'Library','Application Support','RProjectMulticam','tools'):r.path.join(env.LOCALAPPDATA||r.os.homedir(),'RProjectMulticam','tools');
 var saved=r.path.join(base,'ffmpeg-path.txt');
 if(r.fs.existsSync(saved)){candidate=r.fs.readFileSync(saved,'utf8').replace(/^\uFEFF/,'').trim();if(candidate&&runs(r,candidate))return candidate;}
 if(platform==='darwin')candidates=[r.path.join(base,'ffmpeg'),'/opt/homebrew/bin/ffmpeg','/usr/local/bin/ffmpeg','/usr/bin/ffmpeg'];
 else if(platform==='win32')candidates=[r.path.join(base,'ffmpeg.exe')];
 for(var i=0;i<candidates.length;i++)if(runs(r,candidates[i]))return candidates[i];
 try{var cmd=platform==='win32'?'where':'which',out=String(r.cp.execFileSync(cmd,['ffmpeg'],{encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','ignore']})).split(/\r?\n/)[0].trim();if(out&&runs(r,out))return out;}catch(e){}
 throw Error('FFmpeg is unavailable. Install FFmpeg or choose the FFmpeg executable in Settings.');
}
function fingerprint(snapshot){
 var r=runtime();
 return snapshot.clips.map(function(c){var s=r.fs.statSync(c.file);return [c.file,s.size,s.mtimeMs].join('|');}).join('\n');
}
function median(values){
 if(!values.length)return null;var a=values.slice().sort(function(x,y){return x-y;}),m=Math.floor(a.length/2);return a.length%2?a[m]:(a[m-1]+a[m])/2;
}
function quantile(values,q){
 if(!values.length)return 0;var a=values.slice().sort(function(x,y){return x-y;}),pos=(a.length-1)*q,lo=Math.floor(pos),hi=Math.ceil(pos);return lo===hi?a[lo]:a[lo]+(a[hi]-a[lo])*(pos-lo);
}
function clamp(v,a,b){return Math.max(a,Math.min(b,v));}
function tempoStats(values){
 var clean=values.filter(function(v){return Number.isFinite(v)&&v>=40&&v<=240;});
 if(!clean.length)return {bpm:null,confidence:'low',spread:null,samples:0,beatInterval:null};
 var bpm=median(clean),dev=clean.map(function(v){return Math.abs(v-bpm);}),mad=median(dev)||0;
 // 'high' also needs most windows to agree: a median over mixed tempo-octave windows can have MAD 0 yet be wrong.
 var agree=clean.filter(function(v){return Math.abs(v-bpm)<=bpm*.03;}).length/clean.length;
 var confidence=clean.length>=4&&mad<2.5&&agree>=.6?'high':clean.length>=2&&mad<7?'medium':'low';
 return {bpm:Math.round(bpm),confidence:confidence,spread:Math.round(mad*10)/10,samples:clean.length,beatInterval:Math.round((60/bpm)*1000)/1000};
}
var DECODE_IDLE_MS=Number(root.RP_DECODE_IDLE_MS)||60000; // RP_DECODE_IDLE_MS: tests only
var LITTLE_ENDIAN=new Uint8Array(new Uint32Array([1]).buffer)[0]===1;
// Seek exactly: an input -ss on AAC audio (m4a, mp4/mov camera files) lands 8-64 ms off (even -ss 0 drops
// the first AAC frame). Seek the input to 10 s before the start, then trim the rest after decoding: exact.
function seekArgs(file,start){var s=Math.max(0,Number(start)||0),coarse=Math.max(0,s-10),fine=s-coarse,out=[];if(coarse>=1e-6)out.push('-ss',coarse.toFixed(6));out.push('-i',file);if(fine>=1e-6)out.push('-ss',fine.toFixed(6));return out;}
function decode(clip,ffmpeg,state,onProgress){
 var r=runtime();
 return new Promise(function(resolve,reject){
  if(state.cancelled)return reject(Error('Analysis stopped.'));
  var feature=root.RPBeat.features(),carry=r.Buffer.alloc(0),sampleCount=0,stderr='',last=0,settled=false,memoryAt=Date.now(),memoryPending=false;
  // Seek to source in point, then read only the visible clip duration.
  var profile=root.RPResourceGuard&&root.RPResourceGuard.profile?root.RPResourceGuard.profile():{threads:2};
  var args=['-nostdin','-hide_banner','-v','error','-threads',String(profile.threads),'-filter_threads','1'].concat(seekArgs(clip.file,clip.input),['-t',(clip.end-clip.start).toFixed(6),
   '-map','0:a:0','-vn','-ac','1','-ar','8000','-af','highpass=f=20,lowpass=f=3800','-f','f32le','pipe:1']);
  var proc=r.cp.spawn(ffmpeg,args,{windowsHide:true,shell:false});state.process=proc;
  // A stalled FFmpeg (offline network drive, a hung codec) used to leave the analysis waiting forever. Without data for
  // DECODE_IDLE_MS it is killed like Stop does, with its own message. A deliberate pause (memory check) does not count.
  var lastData=Date.now(),idle=setInterval(function(){if(memoryPending)lastData=Date.now();if(settled||state.cancelled||Date.now()-lastData<DECODE_IDLE_MS)return;fail(Error('FFmpeg stopped sending audio for '+Math.round(DECODE_IDLE_MS/100)/10+' s while reading A1 ('+String(clip.file).split(/[\\/]/).pop()+'). Check that the media drive is reachable, then Analyze again.'));try{proc.kill();}catch(e){}},Math.min(5000,DECODE_IDLE_MS));
  function fail(err){clearInterval(idle);if(!settled){settled=true;reject(err);}}
  proc.stdout.on('data',function(chunk){
   lastData=Date.now();
   if(settled)return;
   if(state.cancelled){proc.kill();return;}
   try{
    var b=carry.length?r.Buffer.concat([carry,chunk]):chunk,end=b.length-b.length%4;
    // Read the f32le PCM as a Float32Array view (copy only when the chunk is unaligned)
    // instead of one Buffer.readFloatLE call per sample.
    var count=end>>2;
    if(LITTLE_ENDIAN){var pcm=b.byteOffset%4===0?new Float32Array(b.buffer,b.byteOffset,count):new Float32Array(new Uint8Array(b.subarray(0,end)).buffer,0,count);
     if(feature.pushMany)feature.pushMany(pcm,0,count);else for(var i=0;i<count;i++)feature.push(pcm[i]);}
    else for(var i2=0;i2<end;i2+=4)feature.push(b.readFloatLE(i2));
    sampleCount+=count;
    carry=r.Buffer.from(b.subarray(end));
    if(Date.now()-last>350){onProgress(Math.min(1,sampleCount/8000/(clip.end-clip.start)));last=Date.now();}
    // Backpressure while sampling memory; never accumulate a second decoder
    // or an unbounded queue of pending memory checks during a long clip.
    if(!memoryPending&&Date.now()-memoryAt>=5000&&root.RPResourceGuard&&root.RPResourceGuard.preflight){
     memoryPending=true;memoryAt=Date.now();proc.stdout.pause();
     root.RPResourceGuard.preflight(state,'audio decoding').then(function(){memoryPending=false;lastData=Date.now();if(!settled&&!state.cancelled)proc.stdout.resume();},function(err){memoryPending=false;proc.kill();fail(err);});
    }
   }catch(e){proc.kill();fail(e);}
  });
  proc.stderr.on('data',function(b){stderr=(stderr+b.toString()).slice(-2000);});
  proc.on('error',function(e){fail(Error('Could not start FFmpeg: '+e.message));});
  proc.on('close',function(code){
   clearInterval(idle);state.process=null;
   if(state.cancelled)return fail(Error('Analysis stopped.'));
   if(code!==0)return fail(Error('Cannot read A1 audio: '+stderr));
   if(sampleCount/8000<clip.end-clip.start-.15)return fail(Error('A1 media is shorter than the timeline clip. Check trimming or render A1 to WAV.'));
   if(!settled){settled=true;onProgress(1);resolve(feature.result());}
  });
 });
}
root.RPAudio={
 executable:executable,
 fresh:function(snapshot,original){return fingerprint(snapshot)===original;},
 applyPacing:function(result,pacing,duration,maxPoints){
  if(!root.RPBeatFirst)throw Error('Music timing engine unavailable. Reinstall this build.');
  return root.RPBeatFirst.apply(result,pacing,duration,maxPoints||6000);
 },
 run:async function(snapshot,userPath,state,progress){
  // Backward compatibility with v1.2.7 run(snapshot, density, ffmpeg, state, progress).
  if(typeof userPath==='number'){userPath=arguments[2];state=arguments[3];progress=arguments[4];}
  progress=progress||function(){};state=state||{cancelled:false};
  var ffmpeg=executable(userPath),stamp=fingerprint(snapshot),results=[],music=[],dropSeries=[],onsetSeries=[],lowSeries=[];
  var total=snapshot.clips.reduce(function(s,c){return s+c.end-c.start;},0),processed=0;
  // Yield to the panel only after ~40 ms of work and sample memory at most once per second:
  // a timer (and a memory probe) on every 4 s analysis hop used to dominate analysis time.
  var lastYield=Date.now(),lastGuard=0;
  async function tick(){if(state.cancelled)throw Error('Analysis stopped.');if(root.RPResourceGuard&&root.RPResourceGuard.preflight&&Date.now()-lastGuard>=1000){lastGuard=Date.now();await root.RPResourceGuard.preflight(state,'music analysis');}if(Date.now()-lastYield<40)return;return new Promise(function(resolve,reject){setTimeout(function(){lastYield=Date.now();state.cancelled?reject(Error('Analysis stopped.')):resolve();},0);});}
  for(var i=0;i<snapshot.clips.length;i++){
   await tick();var clip=snapshot.clips[i],length=clip.end-clip.start;
   var feature=await decode(clip,ffmpeg,state,function(p){progress((processed+length*p*.8)/total,'Reading A1 clip '+(i+1)+'/'+snapshot.clips.length);});
   var levels=[];
   for(var base=0;base<feature.rms.length;base+=200){
    var sum=0,limit=Math.min(base+200,feature.rms.length);
    for(var n=base;n<limit;n++)sum+=feature.rms[n]*feature.rms[n];
    var level=Math.sqrt(sum/Math.max(1,limit-base));levels.push(level);
   }
   // Keep raw values until every A1 clip has been scanned. Normalizing each clip
   // independently creates false 'drops' at clip boundaries and across mixed levels.
   levels.forEach(function(level,k){music.push({time:clip.start+k*2,raw_energy:level});});
   // Retain 10 ms low-band attacks for impact localization; the structural
   // half-second envelope cannot resolve the exact start of a kick.
   for(var oi=2;oi<feature.rms.length;oi++){
    var lowNow=Number(feature.bass[oi])||0,energyNow=Number(feature.rms[oi])||0;
    var attack=.7*Math.max(0,lowNow-(Number(feature.bass[oi-2])||0))+.3*Math.max(0,energyNow-(Number(feature.rms[oi-2])||0));
    if(attack>1e-8)onsetSeries.push({time:clip.start+oi/100,attack:attack});
   }
   for(var lb=0;lb<feature.rms.length;lb+=5){var le=0,ln=Math.min(lb+5,feature.rms.length);for(var lk=lb;lk<ln;lk++){var b1=feature.bass[lk]||0,s1=(feature.subbass&&feature.subbass[lk])||0;le+=b1*b1+s1*s1;}lowSeries.push({time:clip.start+lb/100,low:Math.sqrt(le/Math.max(1,ln-lb))});}
   for(base=0;base<feature.rms.length;base+=50){
    var rsum=0,bsum=0,ssum=0,msum=0,hsum=0,tsum=0,fsum=0,lim=Math.min(base+50,feature.rms.length);
    for(n=base;n<lim;n++){
     var rv=feature.rms[n]||0,bv=feature.bass[n]||0,sv=(feature.subbass&&feature.subbass[n])||0,mv=(feature.mid&&feature.mid[n])||0,hv=(feature.high&&feature.high[n])||0,tv=(feature.transient&&feature.transient[n])||0,fv=(feature.flux&&feature.flux[n])||0;
     rsum+=rv*rv;bsum+=bv*bv;ssum+=sv*sv;msum+=mv*mv;hsum+=hv*hv;tsum+=tv*tv;fsum+=fv*fv;
    }
    var den=Math.max(1,lim-base);
    dropSeries.push({time:clip.start+base/100,raw_energy:Math.sqrt(rsum/den),raw_bass:Math.sqrt(bsum/den),raw_subbass:Math.sqrt(ssum/den),raw_mid:Math.sqrt(msum/den),raw_high:Math.sqrt(hsum/den),raw_transient:Math.sqrt(tsum/den),raw_flux:Math.sqrt(fsum/den)});
   }
   results.push(await root.RPBeat.analyze(feature,{tick:tick,progress:function(p){progress((processed+length*(.8+.2*p))/total,'Analyzing A1 beats');}}));
   // Do not hold the last clip's full feature arrays through normalization,
   // timeline mapping and subsequent director analysis.
   feature=null;levels=null;
   processed+=length;
  }
  if(fingerprint(snapshot)!==stamp)throw Error('Audio changed during analysis. Analyze again.');
  // Full-A1 robust normalization (95th percentile instead of per-clip peak). This
  // preserves relative energy across edits and prevents a single clipped peak from
  // flattening the rest of the song. Values can exceed 100 slightly, then clamp.
  function scaleOf(key,list){var vals=[];for(var si=0;si<list.length;si++){var v=Number(list[si][key]);if(isFinite(v)&&v>0)vals.push(v);}return Math.max(1e-8,quantile(vals,.95)||quantile(vals,.9)||1e-8);}
  var scales={energy:scaleOf('raw_energy',dropSeries),bass:scaleOf('raw_bass',dropSeries),subbass:scaleOf('raw_subbass',dropSeries),mid:scaleOf('raw_mid',dropSeries),high:scaleOf('raw_high',dropSeries),transient:scaleOf('raw_transient',dropSeries),flux:scaleOf('raw_flux',dropSeries)};
  for(var di=0;di<dropSeries.length;di++){
   var ds=dropSeries[di];
   ds.energy=Math.round(clamp(Number(ds.raw_energy||0)/scales.energy*100,0,125)*10)/10;
   ds.bass=Math.round(clamp(Number(ds.raw_bass||0)/scales.bass*100,0,125)*10)/10;
   ds.subbass=Math.round(clamp(Number(ds.raw_subbass||0)/scales.subbass*100,0,125)*10)/10;
   ds.mid=Math.round(clamp(Number(ds.raw_mid||0)/scales.mid*100,0,125)*10)/10;
   ds.high=Math.round(clamp(Number(ds.raw_high||0)/scales.high*100,0,125)*10)/10;
   ds.transient=Math.round(clamp(Number(ds.raw_transient||0)/scales.transient*100,0,125)*10)/10;
   ds.flux=Math.round(clamp(Number(ds.raw_flux||0)/scales.flux*100,0,125)*10)/10;
  }
  var musicScale=scaleOf('raw_energy',music),prevMusic=0;
  for(var mi=0;mi<music.length;mi++){var me=clamp(Number(music[mi].raw_energy||0)/musicScale*100,0,125);music[mi].energy=Math.round(me);music[mi].change=mi&&prevMusic>1e-5?Math.round(me/prevMusic*100)/100:null;prevMusic=me;}
  var mapped=root.RPBeat.timeline(results,snapshot),tempos=[],beatCount=0;
  results.forEach(function(x){tempos=tempos.concat(x.tempos);beatCount+=x.beatCount||0;});
  var tempoMap=[],musicGrid=[];results.forEach(function(x,ri){var c=snapshot.clips[ri];(x.tempoMap||[]).forEach(function(t){tempoMap.push({time:c.start+t.time,bpm:Math.round(t.bpm*10)/10,beat_interval:Math.round(t.beat_interval*10000)/10000,confidence:Number(t.confidence)||0});});(x.grid||[]).forEach(function(g){var q={};for(var k in g)q[k]=g[k];q.time=c.start+g.time;musicGrid.push(q);});});tempoMap.sort(function(a,b){return a.time-b.time;});musicGrid.sort(function(a,b){return a.time-b.time;});
  var tempo=tempoStats(tempos);
  onsetSeries.sort(function(a,b){return a.time-b.time;});
  var output={snapshot:snapshot,points:[],meta:[],beats:mapped.points,beatMeta:mapped.meta,music:music,dropSeries:dropSeries,onsetSeries:onsetSeries,lowSeries:lowSeries,fingerprint:stamp,tempo:tempo.bpm,bpm:tempo.bpm,tempoConfidence:tempo.confidence,tempoSpread:tempo.spread,tempoSamples:tempo.samples,beatInterval:tempo.beatInterval,beatCount:beatCount,tempoMap:tempoMap,musicGrid:musicGrid,pacing:null,structure:null};
  output.structure={events:[],zones:[],drop_count:0,build_up_count:0};
  return output;
 }
};
}(typeof window!=='undefined'?window:globalThis));
