'use strict';
// Drone visual check: after a drone (no audio) is placed from a camera clock, compare the venue lighting the drone sees
// with what the audio-synced cameras see, and find the one shift that makes them agree. A camera clock that is a minute
// or two off (Zumana 25 Nov 2026: the DJI Osmo ~123.5 s behind the Mavic's GPS clock) then no longer moves every drone
// clip by that much.
// Light per keyframe: one FFmpeg pass per file decodes keyframes only (-discard nokey, like AI Vision; a 70-minute 4K file
// reads in well under a minute) at 4x4 RGB. Features: red and green share of the light (colour) and log brightness, each
// with its +-15 s running mean removed and scaled to unit variance, so a slow exposure difference between cameras does
// not count, only the light changes they share (colour washes, strobes, lasers, blackouts).
// The shift is chosen for the whole drone at once: every drone clip is compared with every camera covering it, for every
// shift within +-maxLag, and the scores are added. A short or dark clip cannot decide alone, the sum can. The shift is
// applied only when the peak stands far above the rest of the curve AND several clips or cameras agree on it.
(function(root){
var STEP=.5,DETREND=15,NEAREST=.75,MIN_SAMPLES=6;
function node(name){var n=root.cep_node;if(n)return n.require(name);if(typeof require==='function')return require(name);throw Error('Node is unavailable. Reinstall and restart Premiere.');}

// Results are cached on disk by file path + size + modified time (as AI Vision does), so a second Analyze is quick.
var CACHE_VERSION=1;
function cacheFile(file){try{var path=node('path'),os=node('os'),fs=node('fs'),st=fs.statSync(file),base=(typeof process!=='undefined'&&process.env&&process.env.LOCALAPPDATA)||path.join(os.homedir(),'AppData','Local');
 return path.join(base,'RProjectMulticam','light-cache',node('crypto').createHash('sha1').update(CACHE_VERSION+'|'+file+'|'+st.size+'|'+Math.round(st.mtimeMs)).digest('hex')+'.json');}catch(e){return null;}}
function readCache(file){try{var p=cacheFile(file);if(!p||!node('fs').existsSync(p))return undefined;var v=JSON.parse(node('fs').readFileSync(p,'utf8'));return v&&v.v===CACHE_VERSION?v.light:undefined;}catch(e){return undefined;}}
function writeCache(file,light){try{var p=cacheFile(file);if(!p)return;var fs=node('fs');fs.mkdirSync(node('path').dirname(p),{recursive:true});fs.writeFileSync(p,JSON.stringify({v:CACHE_VERSION,light:light}));}catch(e){}}
/** Keyframes of one file: {t:[media s], f:[[r,g,logB] detrended+scaled]} (null when the file has no readable video). */
function readLight(ffmpeg,file,state){
 state=state||{};var hit=readCache(file);if(hit!==undefined)return Promise.resolve(hit);
 return readLightNow(ffmpeg,file,state).then(function(l){writeCache(file,l);return l;});
}
function readLightNow(ffmpeg,file,state){
 return new Promise(function(resolve,reject){
  if(state.cancelled)return reject(Error('Sync stopped.'));
  var cp=node('child_process'),Buffer=node('buffer').Buffer,FRAME=48;
  var args=['-nostdin','-hide_banner','-v','info','-discard:v','nokey','-skip_frame','nokey','-i',file,'-map','0:v:0','-an','-sn','-dn','-vf','scale=4:4:flags=area,format=rgb24,showinfo','-fps_mode','passthrough','-f','rawvideo','pipe:1'];
  var proc=cp.spawn(ffmpeg,args,{windowsHide:true,shell:false}),frames=[],times=[],carry=Buffer.alloc(0),err='',settled=false;
  (state.processes=state.processes||[]).push(proc);
  function done(e,v){if(settled)return;settled=true;var i=state.processes.indexOf(proc);if(i>=0)state.processes.splice(i,1);e?reject(e):resolve(v);}
  proc.stdout.on('data',function(c){carry=carry.length?Buffer.concat([carry,c]):c;while(carry.length>=FRAME){frames.push(new Uint8Array(carry.subarray(0,FRAME)));carry=carry.subarray(FRAME);}if(state.cancelled){try{proc.kill();}catch(e){}}});
  proc.stderr.on('data',function(d){err+=d;var lines=err.split(/\r?\n/);err=lines.pop();for(var i=0;i<lines.length;i++){var m=/showinfo.*\bpts_time:\s*(-?[0-9.]+)/.exec(lines[i]);if(m)times.push(Number(m[1]));}if(err.length>100000)err=err.slice(-2000);});
  proc.on('error',function(e){done(Error('Could not start FFmpeg for the drone visual check: '+e.message));});
  proc.on('close',function(){
   if(state.cancelled)return done(Error('Sync stopped.'));
   var m=/showinfo.*\bpts_time:\s*(-?[0-9.]+)/.exec(err);if(m)times.push(Number(m[1]));
   var n=Math.min(frames.length,times.length);if(!n)return done(null,null);
   var raw=[];for(var i=0;i<n;i++){var f=frames[i],r=0,g=0,b=0;for(var k=0;k<FRAME;k+=3){r+=f[k];g+=f[k+1];b+=f[k+2];}var s=r+g+b+1;raw.push([r/s,g/s,Math.log(s)]);}
   done(null,features(times.slice(0,n),raw));
  });
 });
}
/** Running mean (+-DETREND s) removed per channel, then unit variance. */
function features(t,raw){
 var n=t.length,out=[],ch,i,lo=0,hi=0,sum=[0,0,0];
 for(i=0;i<n;i++)out.push([0,0,0]);
 for(i=0;i<n;i++){
  while(hi<n&&t[hi]<=t[i]+DETREND){for(ch=0;ch<3;ch++)sum[ch]+=raw[hi][ch];hi++;}
  while(t[lo]<t[i]-DETREND){for(ch=0;ch<3;ch++)sum[ch]-=raw[lo][ch];lo++;}
  for(ch=0;ch<3;ch++)out[i][ch]=raw[i][ch]-sum[ch]/(hi-lo);
 }
 for(ch=0;ch<3;ch++){var v=0;for(i=0;i<n;i++)v+=out[i][ch]*out[i][ch];v=Math.sqrt(v/Math.max(1,n))||1;for(i=0;i<n;i++)out[i][ch]/=v;}
 return {t:t,f:out};
}
/** Feature at media time m: the nearest keyframe within NEAREST s, else null. */
function at(light,m){
 var t=light.t,lo=0,hi=t.length;if(!hi)return null;
 while(lo<hi){var mid=(lo+hi)>>1;if(t[mid]<m)lo=mid+1;else hi=mid;}
 var best=-1,bd=Infinity;[lo-1,lo].forEach(function(k){if(k>=0&&k<t.length&&Math.abs(t[k]-m)<bd){bd=Math.abs(t[k]-m);best=k;}});
 return bd<=NEAREST?light.f[best]:null;
}
/** Camera feature at timeline time t (the clip covering t), else null. */
function camAt(cam,lights,t){
 for(var i=0;i<cam.clips.length;i++){var c=cam.clips[i],len=c.sourceOut-c.sourceIn;if(t>=c.start&&t<c.start+len){var L=lights[c.file];return L?at(L,t-c.start+c.sourceIn):null;}}
 return null;
}
/** Correlation curve over lags for one drone clip against one camera (null where too few samples overlap). */
function curve(clip,dl,cam,lights,lags){
 var samples=[];for(var m=clip.sourceIn;m<clip.sourceIn+clip.duration;m+=STEP){var v=at(dl,m);if(v)samples.push([m-clip.sourceIn,v]);}
 if(samples.length<MIN_SAMPLES)return null;
 var out=new Float64Array(lags.length),ok=false;
 for(var k=0;k<lags.length;k++){
  var s=0,n=0;for(var i=0;i<samples.length;i++){var c=camAt(cam,lights,clip.start+lags[k]+samples[i][0]);if(!c)continue;var d=samples[i][1];s+=d[0]*c[0]+d[1]*c[1]+d[2]*c[2];n++;}
  if(n>=Math.max(MIN_SAMPLES,samples.length*.6)){out[k]=s/(3*n)*Math.sqrt(n);ok=true;}else out[k]=NaN;
 }
 return ok?out:null;
}
function median(a){var b=a.filter(function(v){return isFinite(v);}).sort(function(x,y){return x-y;});return b.length?b[b.length>>1]:0;}
/** Peak of a curve and how far it stands above the rest (robust z; +-5 s around the peak left out of the background). */
function peak(sum,lags){
 var bi=-1;for(var k=0;k<sum.length;k++)if(isFinite(sum[k])&&(bi<0||sum[k]>sum[bi]))bi=k;
 if(bi<0)return null;
 var rest=[];for(k=0;k<sum.length;k++)if(isFinite(sum[k])&&Math.abs(lags[k]-lags[bi])>5)rest.push(sum[k]);
 var med=median(rest),mad=median(rest.map(function(v){return Math.abs(v-med);}))*1.4826||1e-9;
 return {lag:lags[bi],z:(sum[bi]-med)/mad};
}

/**
 * Verify one drone placed by clock.
 * drone: {clips:[{id,file,start (timeline s of the clip's In),sourceIn,duration}]}
 * cameras: [{name, clips:[{file,start,sourceIn,sourceOut}]}] audio-synced placements
 * opts: {ffmpeg, state, maxLag (s, default 300), zMin (default 6), progress(p,msg), lights (cache {file:light})}
 * Returns {verdict:'shift'|'confirmed'|'inconclusive', shift (s), z, clipsAgree, clipsChecked, camerasAgree, cameras:[...]}.
 */
async function verify(drone,cameras,opts){
 opts=opts||{};var state=opts.state||{},maxLag=Number(opts.maxLag)||300,zMin=Number(opts.zMin)||6,progress=opts.progress||function(){};
 var lights=opts.lights||{},lags=[];for(var L=-maxLag;L<=maxLag+1e-9;L+=STEP)lags.push(Math.round(L*1000)/1000);
 var clips=drone.clips.filter(function(c){return c.duration>=3;});
 if(!clips.length)return {verdict:'inconclusive',reason:'no drone clip of 3 s or longer',shift:0,z:0,clipsAgree:0,clipsChecked:0,camerasAgree:0,cameras:[]};
 var lo=Math.min.apply(null,clips.map(function(c){return c.start;}))-maxLag,hi=Math.max.apply(null,clips.map(function(c){return c.start+c.duration;}))+maxLag;
 // Only camera clips that can meet a drone clip within the search window are read.
 var cams=cameras.map(function(cam){return {name:cam.name,clips:cam.clips.filter(function(c){return c.start<hi&&c.start+(c.sourceOut-c.sourceIn)>lo;})};}).filter(function(cam){return cam.clips.length;});
 var readAll=async function(files){
  files=files.filter(function(f,i){return files.indexOf(f)===i&&!(f in lights);});
  // Several files at once: most are short clips, where starting FFmpeg costs more than decoding their keyframes.
  var next=0,doneN=0,workers=[],PAR=Math.max(1,Number(opts.parallel)||4);
  function worker(){if(next>=files.length||state.cancelled)return Promise.resolve();var f=files[next++];return readLight(opts.ffmpeg,f,state).then(function(l){lights[f]=l;},function(e){if(state.cancelled)throw e;lights[f]=null;}).then(function(){doneN++;progress(doneN/files.length,'Drone visual check: reading light '+doneN+'/'+files.length);return worker();});}
  for(var w=0;w<Math.min(PAR,files.length);w++)workers.push(worker());
  await Promise.all(workers);if(state.cancelled)throw Error('Sync stopped.');
 };
 // Cameras in order of how much of the search window they cover. Reading is disk-bound (a 70-minute 4K file is ~30 GB):
 // stop as soon as two cameras agree on a clear shift; otherwise read the next camera, up to all of them.
 var cover=function(cam){return cam.clips.reduce(function(n,c){return n+Math.max(0,Math.min(hi,c.start+(c.sourceOut-c.sourceIn))-Math.max(lo,c.start));},0);};
 cams.sort(function(a,b){return cover(b)-cover(a);});
 await readAll(clips.map(function(c){return c.file;}));
 var out=null;
 for(var used=1;used<=cams.length;used++){
  var set=cams.slice(0,used);
  await readAll([].concat.apply([],set[used-1].clips.map(function(c){return [c.file];})));
  progress(1,'Drone visual check: comparing light ('+used+' camera'+(used===1?'':'s')+')');
  out=score(set);
  if(used>=2&&out.verdict!=='inconclusive')break;
 }
 return out;
 function score(set){
  var total=new Float64Array(lags.length),perCam=set.map(function(){return new Float64Array(lags.length);}),clipPeaks=[];
  clips.forEach(function(clip){
   var dl=lights[clip.file];if(!dl)return;var mine=new Float64Array(lags.length),any=false;
   set.forEach(function(cam,ci){var cv=curve(clip,dl,cam,lights,lags);if(!cv)return;any=true;for(var k=0;k<lags.length;k++)if(isFinite(cv[k])){mine[k]+=cv[k];perCam[ci][k]+=cv[k];total[k]+=cv[k];}});
   if(any){var p=peak(mine,lags);if(p)clipPeaks.push(p);}
  });
  var best=peak(total,lags);
  if(!best||!clipPeaks.length)return {verdict:'inconclusive',reason:'no camera sees the same light as the drone',shift:0,z:0,clipsAgree:0,clipsChecked:clipPeaks.length,camerasAgree:0,cameras:[]};
  var near=function(p){return Math.abs(p.lag-best.lag)<=2;};
  var clipsAgree=clipPeaks.filter(near).length,camResults=set.map(function(cam,ci){var p=peak(perCam[ci],lags);return {name:cam.name,lag:p?p.lag:null,z:p?Math.round(p.z*10)/10:0};});
  var camerasAgree=camResults.filter(function(c){return c.lag!==null&&Math.abs(c.lag-best.lag)<=2&&c.z>=zMin/2;}).length;
  var sure=best.z>=zMin&&(clipsAgree>=Math.max(3,Math.ceil(clipPeaks.length*.2))||camerasAgree>=2);
  var r={shift:best.lag,z:Math.round(best.z*10)/10,clipsAgree:clipsAgree,clipsChecked:clipPeaks.length,camerasAgree:camerasAgree,cameras:camResults};
  r.verdict=!sure?'inconclusive':Math.abs(best.lag)<=1?'confirmed':'shift';
  if(r.verdict==='inconclusive')r.reason='the light match is not clear enough';
  return r;
 }
}
var api={verify:verify,readLight:readLight,features:features,peak:peak,STEP:STEP};
root.RPDroneVisual=api;
if(typeof module!=='undefined'&&module.exports)module.exports=api;
}(typeof window!=='undefined'?window:globalThis));
