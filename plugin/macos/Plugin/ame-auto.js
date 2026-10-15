(function(root,factory){
 var api=factory();
 if(typeof module==='object'&&module.exports)module.exports=api;
 if(root)root.RPAME=api;
})(typeof window!=='undefined'?window:this,function(){
 'use strict';
 function req(name){
  if(typeof window!=='undefined'&&window.cep_node&&window.cep_node.require)return window.cep_node.require(name);
  if(typeof require==='function')return require(name);
  throw Error('Node.js bridge is unavailable.');
 }
 function defaultRoots(){
  var fs=req('fs'),path=req('path'),proc=(typeof process!=='undefined'?process:req('process')),env=(proc&&proc.env)||{},out=[],seen={};
  function add(p){if(!p)return;try{p=path.normalize(p);}catch(e){}var k=String(p).toLowerCase();if(!seen[k]){seen[k]=1;out.push(p);}}
  function addIfDir(p){try{if(p&&fs.existsSync(p)&&fs.statSync(p).isDirectory())add(p);}catch(e){}}
  function addAdobeChildren(parent){
   if(!parent)return;var adobe=path.join(parent,'Adobe'),items=[];try{items=fs.readdirSync(adobe);}catch(e){}
   for(var i=0;i<items.length;i++)if(/media encoder|premiere pro/i.test(items[i])){
    var app=path.join(adobe,items[i]);add(app);add(path.join(app,'MediaIO'));add(path.join(app,'MediaIO','systempresets'));add(path.join(app,'Presets'));
   }
   add(adobe);
  }
  addAdobeChildren(env.ProgramFiles);addAdobeChildren(env['ProgramFiles(x86)']);
  if(env.PROGRAMDATA){add(path.join(env.PROGRAMDATA,'Adobe','Common','AME'));add(path.join(env.PROGRAMDATA,'Adobe','Common'));}
  if(env.APPDATA){add(path.join(env.APPDATA,'Adobe','Common','AME'));add(path.join(env.APPDATA,'Adobe','Adobe Media Encoder'));add(path.join(env.APPDATA,'Adobe','Common'));}
  if(env.LOCALAPPDATA){add(path.join(env.LOCALAPPDATA,'Adobe','Common','AME'));add(path.join(env.LOCALAPPDATA,'Adobe','Adobe Media Encoder'));add(path.join(env.LOCALAPPDATA,'Adobe','Common'));}
  if(env.USERPROFILE){add(path.join(env.USERPROFILE,'Documents','Adobe','Adobe Media Encoder'));add(path.join(env.USERPROFILE,'Documents','Adobe','Premiere Pro'));}
  if(env.PUBLIC)add(path.join(env.PUBLIC,'Documents','Adobe','Adobe Media Encoder'));
  if((proc&&proc.platform)==='darwin'){
   var home=env.HOME||'';
   add('/Library/Application Support/Adobe/Common/AME');add('/Library/Application Support/Adobe/Common');add('/Library/Application Support/Adobe');
   if(home){
    add(path.join(home,'Documents','Adobe','Adobe Media Encoder'));
    add(path.join(home,'Documents','Adobe','Premiere Pro'));
    add(path.join(home,'Library','Application Support','Adobe','Common','AME'));
    add(path.join(home,'Library','Application Support','Adobe','Common'));
    add(path.join(home,'Library','Application Support','Adobe','Adobe Media Encoder'));
   }
   try{
    var apps=fs.readdirSync('/Applications');
    for(var m=0;m<apps.length;m++)if(/^Adobe (Media Encoder|Premiere Pro)/i.test(apps[m])){
     var bundle=path.join('/Applications',apps[m]);
     add(bundle);add(path.join(bundle,'Contents'));add(path.join(bundle,'Contents','Resources'));
     add(path.join(bundle,'Contents','Resources','Presets'));add(path.join(bundle,'Contents','Presets'));
     add(path.join(bundle,'Contents','MediaIO'));add(path.join(bundle,'Contents','MediaIO','systempresets'));
     add(path.join(bundle,'Contents','Adobe','MediaIO'));add(path.join(bundle,'Contents','Adobe','MediaIO','systempresets'));
    }
   }catch(macAppsError){}
  }
  // Keep only existing directories when possible, but retain unresolved roots for diagnostic reporting.
  var existing=[],missing=[];for(var r=0;r<out.length;r++){try{if(fs.existsSync(out[r])&&fs.statSync(out[r]).isDirectory())existing.push(out[r]);else missing.push(out[r]);}catch(e){missing.push(out[r]);}}
  return existing.length?existing:out;
 }
 function readVariants(fs,file,max){
  var fd=null,b;
  try{
   fd=fs.openSync(file,'r');var B=(typeof Buffer!=='undefined'?Buffer:req('buffer').Buffer);b=B.alloc(max||1048576);var n=fs.readSync(fd,b,0,b.length,0);b=b.slice(0,n);
   var texts=[];try{texts.push(b.toString('utf8'));}catch(e){}
   try{texts.push(b.toString('utf16le'));}catch(e2){}
   // Some Adobe resources contain UTF-16BE strings. Swap byte pairs so Node can decode them as LE.
   try{var c=B.from(b);for(var i=0;i+1<c.length;i+=2){var x=c[i];c[i]=c[i+1];c[i+1]=x;}texts.push(c.toString('utf16le'));}catch(e3){}
   return texts.join('\n');
  }catch(e){return '';}
  finally{if(fd!==null)try{fs.closeSync(fd);}catch(closeError){}}
 }
 function scorePreset(file,text){
  var hay=(String(file)+'\n'+String(text||'')).replace(/\u0000/g,'').toLowerCase(),score=0;
  var match=/match[ _-]*source/.test(hay),h264=/(h\.?264|h264|avc|avc1)/.test(hay),mp4=/(mpeg4|mpeg-4|\.mp4|m4v)/.test(hay);
  var high=/high[ _-]*bitrate/.test(hay),adaptive=/adaptive[ _-]*high/.test(hay),hevc=/(hevc|h\.?265|h265|hev1)/.test(hay);
  if(match)score+=320;if(h264)score+=260;if(mp4)score+=80;if(high)score+=130;if(adaptive)score+=120;if(/mediaio|systempresets|media encoder|premiere pro|presets/.test(hay))score+=30;
  if(/youtube|vimeo|facebook|twitter|mobile|vr|proxy/.test(hay))score-=70;if(hevc)score-=800;
  // Strong preference: Match Source + H.264 evidence. Allow H.264 + adaptive/high bitrate as fallback even when the resource filename is opaque.
  var qualified=!hevc&&((match&&(h264||mp4||high||adaptive))||(h264&&(high||adaptive)&&mp4));
  return {score:score,qualified:qualified,match:match,h264:h264,mp4:mp4,hevc:hevc};
 }
 // Iterative depth-first scan (same order and limits as the former recursive walk) that can run in
 // bounded slices, so the async variant keeps the panel responsive on huge Adobe/Program Files trees.
 function createScan(options){
  options=options||{};var fs=options.fs||req('fs'),path=options.path||req('path'),roots=options.roots||defaultRoots();
  var maxDepth=options.maxDepth==null?12:Number(options.maxDepth),maxEntries=options.maxEntries==null?60000:Number(options.maxEntries),found=[],fallback=[],visited=0,seenDir={},seenFile={},stack=[],nextRoot=0;
  function open(dir,depth){
   if(depth>maxDepth||visited>=maxEntries)return;
   var real=String(dir);try{real=fs.realpathSync(dir);}catch(e){}var dk=real.toLowerCase();if(seenDir[dk])return;seenDir[dk]=1;
   var stat;try{stat=fs.statSync(dir);}catch(e2){return;}if(!stat||!stat.isDirectory())return;
   var items;try{items=fs.readdirSync(dir);}catch(readError){return;}
   // Preset-oriented folders first so large app bundles don't exhaust maxEntries before MediaIO/systempresets is reached.
   items.sort(function(a,b){var aa=/preset|mediaio|resource|encode/i.test(a)?0:1,bb=/preset|mediaio|resource|encode/i.test(b)?0:1;return aa-bb;});
   stack.push({dir:dir,depth:depth,items:items,i:0});
  }
  function step(budget){
   var work=0;
   while(work<budget){
    if(!stack.length){if(nextRoot>=roots.length)return true;open(roots[nextRoot++],0);work++;continue;}
    var frame=stack[stack.length-1];
    if(frame.i>=frame.items.length||visited>=maxEntries){stack.pop();continue;}
    var item=frame.items[frame.i++],full=path.join(frame.dir,item);visited++;work++;
    var st;try{st=fs.statSync(full);}catch(statError){continue;}
    if(st.isDirectory()){
     var name=String(item).toLowerCase();
     if(name==='node_modules'||name==='cache'||name==='media cache files'||name==='peak files'||name==='plug-ins'||name==='plugins'||name==='frameworks')continue;
     open(full,frame.depth+1);continue;
    }
    if(!/\.epr$/i.test(item))continue;
    var key=String(full).toLowerCase();if(seenFile[key])continue;seenFile[key]=1;work+=20;
    var text=readVariants(fs,full,1048576),rank=scorePreset(full,text),entry={path:full,score:rank.score,qualified:rank.qualified,h264:rank.h264,mp4:rank.mp4,match:rank.match};
    if(rank.qualified)found.push(entry);else if(!rank.hevc&&(rank.h264||rank.mp4||rank.match))fallback.push(entry);
   }
   return false;
  }
  function result(){
   function sorter(a,b){return b.score-a.score||String(a.path).localeCompare(String(b.path));}
   found.sort(sorter);fallback.sort(sorter);
   return {candidates:found.map(function(x){return x.path;}),fallback:fallback.map(function(x){return x.path;}),scanned:visited,roots:roots};
  }
  return {step:step,result:result};
 }
 function findMatchSourcePresets(options){var scan=createScan(options);scan.step(Infinity);return scan.result();}
 function findMatchSourcePresetsAsync(options){
  options=options||{};var slice=Math.max(1,Number(options.sliceEntries)||250);
  return new Promise(function(resolve,reject){
   var scan;try{scan=createScan(options);}catch(e){reject(e);return;}
   function run(){try{if(options.shouldStop&&options.shouldStop()){reject(Error('Preset search stopped.'));return;}if(scan.step(slice)){resolve(scan.result());return;}setTimeout(run,0);}catch(e){reject(e);}}
   setTimeout(run,0);
  });
 }
 return {defaultRoots:defaultRoots,scorePreset:scorePreset,findMatchSourcePresets:findMatchSourcePresets,findMatchSourcePresetsAsync:findMatchSourcePresetsAsync};
});
