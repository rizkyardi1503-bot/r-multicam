'use strict';
// Visual quality timeline per camera file, for the Agent AI Director's camera choice.
// One FFmpeg pass decodes keyframes only (-discard nokey: the demuxer skips the other frames, so even 4K
// 100 Mb/s camera originals read about 30x faster than real time) at 64x36 gray. Per keyframe:
//   brightness (0-255), sharpness (mean |Laplacian|) and the global shift from the previous keyframe
//   (row/column intensity profiles), from which shake = a large, direction-changing shift.
// Results are cached on disk by file path + size + modified time, so a file is analysed once.
(function(root){
var VERSION=1,W=64,H=36,FRAME=W*H;
function node(name){var n=root.cep_node;if(n)return n.require(name);if(typeof require==='function')return require(name);throw Error('Node is unavailable. Reinstall and restart Premiere.');}
function cacheDir(){var path=node('path'),os=node('os'),base=(typeof process!=='undefined'&&process.env&&process.env.LOCALAPPDATA)||path.join(os.homedir(),'AppData','Local');return path.join(base,'RProjectMulticam','visual-cache');}
function cacheKey(file){var fs=node('fs'),st=fs.statSync(file);return node('crypto').createHash('sha1').update(VERSION+'|'+file+'|'+st.size+'|'+Math.round(st.mtimeMs)).digest('hex');}
function readCache(file){try{var fs=node('fs'),p=node('path').join(cacheDir(),cacheKey(file)+'.json');if(!fs.existsSync(p))return null;var v=JSON.parse(fs.readFileSync(p,'utf8'));return v&&v.v===VERSION&&Array.isArray(v.t)?v:null;}catch(e){return null;}}
function writeCache(file,tl){try{var fs=node('fs'),d=cacheDir();fs.mkdirSync(d,{recursive:true});fs.writeFileSync(node('path').join(d,cacheKey(file)+'.json'),JSON.stringify(tl));}catch(e){}}

function profiles(f){var col=new Float64Array(W),row=new Float64Array(H),x,y;for(y=0;y<H;y++)for(x=0;x<W;x++){var v=f[y*W+x];col[x]+=v;row[y]+=v;}for(x=0;x<W;x++)col[x]/=H;for(y=0;y<H;y++)row[y]/=W;return {col:col,row:row};}
// Best shift of profile b against a (search +-max), mean removed so a light change is not read as motion.
function shift1d(a,b,max){var n=a.length,ma=0,mb=0,i;for(i=0;i<n;i++){ma+=a[i];mb+=b[i];}ma/=n;mb/=n;var best=0,bestErr=Infinity;for(var s=-max;s<=max;s++){var err=0,cnt=0;for(i=Math.max(0,-s);i<n&&i+s<n;i++){var d=(a[i]-ma)-(b[i+s]-mb);err+=d*d;cnt++;}err/=Math.max(1,cnt);if(err<bestErr){bestErr=err;best=s;}}return best;}
/** Metrics of one 64x36 gray frame: brightness, sharpness; plus shift from the previous frame's profiles. */
function frameMetrics(f,prev){
 var sum=0,lap=0,x,y;for(var i=0;i<FRAME;i++)sum+=f[i];
 for(y=1;y<H-1;y++)for(x=1;x<W-1;x++){var k=y*W+x;lap+=Math.abs(4*f[k]-f[k-1]-f[k+1]-f[k-W]-f[k+W]);}
 var p=profiles(f),dx=0,dy=0;if(prev){dx=shift1d(prev.col,p.col,8);dy=shift1d(prev.row,p.row,5);}
 return {b:sum/FRAME,s:lap/((W-2)*(H-2)),dx:dx,dy:dy,p:p};
}
function median(a){var v=a.filter(function(x){return isFinite(x);}).sort(function(x,y){return x-y;});return v.length?v[Math.floor(v.length/2)]:0;}
/** Build the timeline from raw 64x36 gray frames and their timestamps (media seconds). */
function fromFrames(frames,times){
 var t=[],b=[],s=[],j=[],prev=null,pdx=0,pdy=0;
 for(var i=0;i<frames.length;i++){var m=frameMetrics(frames[i],prev);
  // Shake: the shift changes direction/size sharply between keyframes; a steady pan keeps the same shift.
  var jit=prev?Math.hypot(m.dx-pdx,m.dy-pdy):0;t.push(Math.round(times[i]*1000)/1000);b.push(Math.round(m.b*10)/10);s.push(Math.round(m.s*100)/100);j.push(Math.round(jit*10)/10);prev=m.p;pdx=m.dx;pdy=m.dy;}
 return {v:VERSION,t:t,b:b,s:s,j:j,medS:median(s),medB:median(b),medJ:median(j)};
}
/* Decoder threading for the keyframe pass. FFmpeg decodes H.264 keyframes about 2x faster with frame threads than
   with one thread, but a camera file whose frames are cut into several slices (Sony, Panasonic, Canon...) decodes
   ~1.8x faster again with slice threads. Single-slice H.264 and HEVC (frame threads scale well there) keep the
   default. Decoding is bit-exact either way, so the frames and the timeline are identical. One extra FFmpeg run reads
   the first video packet's slice headers; only for large files (>= 256 MB), where the pass takes seconds. */
function threadArgs(ffmpeg,file,state){
 return new Promise(function(resolve){
  try{if(node('fs').statSync(file).size<268435456)return resolve([]);}catch(e){return resolve([]);}
  var proc,out='',done=false,timer=null;
  function finish(x){if(done)return;done=true;if(timer)clearTimeout(timer);var i=(state.processes||[]).indexOf(proc);if(i>=0)state.processes.splice(i,1);resolve(x);}
  try{proc=node('child_process').spawn(ffmpeg,['-nostdin','-hide_banner','-v','info','-i',file,'-map','0:v:0','-frames:v','1','-c','copy','-bsf:v','trace_headers','-f','null','-'],{windowsHide:true,shell:false});}catch(e){return resolve([]);}
  (state.processes=state.processes||[]).push(proc);timer=setTimeout(function(){try{proc.kill();}catch(e){}finish([]);},15000);
  proc.stderr.on('data',function(d){if(out.length<4000000)out+=d;});
  proc.on('error',function(){finish([]);});
  proc.on('close',function(){var v=/Stream #[^\n]*Video: (\w+)/.exec(out),slices=(out.match(/first_mb_in_slice/g)||[]).length;finish(v&&v[1]==='h264'&&slices>=3&&!state.cancelled?['-thread_type','slice']:[]);});
 });
}
/** Analyse a camera file (cached). Resolves {v,t[],b[],s[],j[],medS,medB,medJ}. */
function analyze(ffmpeg,file,state){
 state=state||{};var hit=readCache(file);if(hit)return Promise.resolve(Object.assign(hit,{cached:true}));
 return threadArgs(ffmpeg,file,state).then(function(threads){return new Promise(function(resolve,reject){
  var cp=node('child_process'),Buffer=node('buffer').Buffer;
  var args=['-nostdin','-hide_banner','-v','info'].concat(threads,['-discard:v','nokey','-skip_frame','nokey','-i',file,'-map','0:v:0','-an','-sn','-dn','-vf','scale='+W+':'+H+':flags=area,format=gray,showinfo','-fps_mode','passthrough','-f','rawvideo','pipe:1']);
  var proc=cp.spawn(ffmpeg,args,{windowsHide:true,shell:false}),frames=[],times=[],carry=Buffer.alloc(0),err='',settled=false;
  (state.processes=state.processes||[]).push(proc);state.process=proc;
  function done(e,v){if(settled)return;settled=true;var i=state.processes.indexOf(proc);if(i>=0)state.processes.splice(i,1);if(state.process===proc)state.process=state.processes[0]||null;e?reject(e):resolve(v);}
  proc.stdout.on('data',function(c){carry=carry.length?Buffer.concat([carry,c]):c;while(carry.length>=FRAME){frames.push(new Uint8Array(carry.subarray(0,FRAME)));carry=carry.subarray(FRAME);}if(state.cancelled){try{proc.kill();}catch(e){}}});
  proc.stderr.on('data',function(d){err+=d;var lines=err.split(/\r?\n/);err=lines.pop();for(var i=0;i<lines.length;i++){var m=/showinfo.*\bpts_time:\s*(-?[0-9.]+)/.exec(lines[i]);if(m)times.push(Number(m[1]));}if(err.length>100000)err=err.slice(-2000);});
  proc.on('error',function(e){done(Error('Could not start FFmpeg for AI Vision: '+e.message));});
  proc.on('close',function(code){
   if(state.cancelled)return done(Error('Agent AI Director stopped.'));
   var m=/showinfo.*\bpts_time:\s*(-?[0-9.]+)/.exec(err);if(m)times.push(Number(m[1]));
   var n=Math.min(frames.length,times.length);if(code!==0&&!n)return done(Error('AI Vision could not decode '+file));
   var tl=fromFrames(frames.slice(0,n),times.slice(0,n));frames.length=0;writeCache(file,tl);done(null,tl);
  });
 });});
}
/** Is sample i bad? Dark, blown out, blurry for this camera, or shaking. */
// Shake needs a big jump in the frame shift (over 8 px of 64, and 5x this camera's usual) at this keyframe AND both
// neighbours: lasers, dancers and a slow pan move the profiles for one keyframe, a shaking camera keeps doing it.
// Checked on the Kaehla The Room footage: tripod/gimbal cameras ~0-0.5 % flagged, the handheld crowd camera ~9 %.
function shaky(tl,i){var lim=Math.max(8,tl.medJ*5);return i>0&&i+1<tl.j.length&&tl.j[i]>lim&&tl.j[i-1]>lim&&tl.j[i+1]>lim;}
function badSample(tl,i){
 var b=tl.b[i],s=tl.s[i];
 if(b<Math.max(10,tl.medB*.3)||b>245)return true;
 if(tl.medS>0&&s<tl.medS*.45)return true;
 return shaky(tl,i);
}
/** Share of bad samples between media times a and b (null if the timeline has no sample there). */
function badShare(tl,a,b){
 if(!tl||!tl.t||!tl.t.length)return null;var lo=0,hi=tl.t.length;while(lo<hi){var mid=(lo+hi)>>1;if(tl.t[mid]<a)lo=mid+1;else hi=mid;}
 var n=0,bad=0;for(var i=lo;i<tl.t.length&&tl.t[i]<=b;i++){n++;if(badSample(tl,i))bad++;}
 if(!n){var k=Math.min(tl.t.length-1,lo);if(Math.abs(tl.t[k]-(a+b)/2)>3)return null;n=1;bad=badSample(tl,k)?1:0;}
 return bad/n;
}
var api={VERSION:VERSION,analyze:analyze,fromFrames:fromFrames,badSample:badSample,badShare:badShare,frameMetrics:frameMetrics};
root.RPVisual=api;
if(typeof module!=='undefined'&&module.exports)module.exports=api;
}(typeof window!=='undefined'?window:globalThis));
