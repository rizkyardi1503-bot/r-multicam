/* LUT for All Footage, panel side: the LUT list (the plugin's own LUT folder + Premiere's Creative LUTs), adding and
   forgetting .cube files, and the saved choice. panel.js starts the host job (rp_lutBegin) with RPLut.request().
   An added LUT is copied into the plugin's LUT folder under a plain file name, so the Lumetri state the host writes
   never holds characters it would have to escape, and the LUT stays where the project expects it. */
(function(root){
'use strict';
var KEY='rp.lut.v1';
function node(){return root.cep_node||null;}
function req(m){return node().require(m);}
function $(id){return root.document?root.document.getElementById(id):null;}
/** Plugin data folder (same place as drone-offsets.json) + LUTs. */
function libraryDir(){var n=node();if(!n)return null;var path=req('path'),os=req('os'),proc=req('process');
 return proc.platform==='darwin'?path.join(os.homedir(),'Library','Application Support','RProjectMulticamAI','LUTs'):path.join(proc.env.LOCALAPPDATA||os.homedir(),'RProjectMulticamAI','LUTs');}
/** Premiere's Creative LUT folder: <install>/Lumetri/LUTs/Creative (Windows) or <app>/Contents/Lumetri/LUTs/Creative (macOS). */
function builtinDir(hostPath){
 var n=node();if(!n||!hostPath)return null;var path=req('path'),fs=req('fs'),dir=String(hostPath),i,c;
 for(i=0;i<6&&dir;i++){
  for(c=0;c<2;c++){var p=c?path.join(dir,'Contents','Lumetri','LUTs','Creative'):path.join(dir,'Lumetri','LUTs','Creative');try{if(fs.statSync(p).isDirectory())return p;}catch(e){}}
  var up=path.dirname(dir);if(up===dir)break;dir=up;
 }
 return null;
}
function cubes(dir){
 if(!dir)return [];var fs=req('fs'),path=req('path'),out=[];
 try{fs.readdirSync(dir).forEach(function(f){if(/\.cube$/i.test(f))out.push({name:f.replace(/\.cube$/i,''),file:path.join(dir,f)});});}catch(e){}
 return out.sort(function(a,b){return a.name.toLowerCase()<b.name.toLowerCase()?-1:1;});
}
/** Plain name for the copy: letters, digits, space, - _ . ( ) only, never a Windows device name. */
function safeName(file){var base=String(file).replace(/^.*[\\\/]/,'').replace(/\.cube$/i,'').replace(/[^A-Za-z0-9 ._()\-]+/g,'_').replace(/^[\s.]+|[\s.]+$/g,'').slice(0,80);
 if(/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(base))base='_'+base;return (base||'LUT')+'.cube';}
/** A Look needs a 3D .cube (a LUT_3D_SIZE line in its header); anything else, or over 64 MB, is refused before it is copied. */
function checkCube(file){
 var fs=req('fs'),st=fs.statSync(file);if(!st.isFile())throw Error('Not a file.');if(st.size>64*1024*1024)throw Error('This .cube file is larger than 64 MB.');
 var fd=fs.openSync(file,'r'),buf=req('buffer').Buffer.alloc(20000),n;try{n=fs.readSync(fd,buf,0,buf.length,0);}finally{fs.closeSync(fd);}
 if(!/^\s*LUT_3D_SIZE\s+\d+/m.test(buf.toString('utf8',0,n)))throw Error('This file is not a 3D .cube LUT (no LUT_3D_SIZE line).');
}
function sameFile(a,b){var fs=req('fs');try{return fs.statSync(a).size===fs.statSync(b).size&&fs.readFileSync(a).equals(fs.readFileSync(b));}catch(e){return false;}}
/** Copy a chosen .cube into the library; returns the library path. A different LUT with the same name gets "Name (2)",
    so projects keep pointing at the file they were given; adding the same LUT again reuses its copy. */
function addLut(file){
 checkCube(file);if(inLibrary(file))return file;
 var fs=req('fs'),path=req('path'),dir=libraryDir(),name=safeName(file).replace(/\.cube$/,''),dest=path.join(dir,name+'.cube'),n=1;fs.mkdirSync(dir,{recursive:true});
 while(fs.existsSync(dest)&&!sameFile(file,dest))dest=path.join(dir,name+' ('+(++n)+').cube');
 if(!fs.existsSync(dest))fs.copyFileSync(file,dest);
 return dest;
}
function inLibrary(file){var path=req('path'),dir=libraryDir();return !!dir&&path.resolve(path.dirname(String(file))).toLowerCase()===path.resolve(dir).toLowerCase();}
function forgetLut(file){if(!inLibrary(file))throw Error('Only LUTs you added can be removed from the list.');req('fs').unlinkSync(file);}
function load(){try{var x=JSON.parse(root.localStorage.getItem(KEY)||'{}');return x&&typeof x==='object'?x:{};}catch(e){return {};}}
function save(){try{root.localStorage.setItem(KEY,JSON.stringify({lut:$('lutChoice').value,intensity:$('lutIntensity').value,scope:$('lutScope').value}));}catch(e){}}
/** CEP system paths are file:// URIs (percent-encoded, /C:/ on Windows); the file system needs a plain path. */
function plainPath(p){p=String(p||'').replace(/^file:\/\//i,'');try{p=decodeURIComponent(p);}catch(e){}if(/^\/[A-Za-z]:/.test(p))p=p.slice(1);return p;}
function hostPath(){try{return plainPath(new root.CSInterface().getSystemPath(root.SystemPath.HOST_APPLICATION));}catch(e){return '';}}
function render(selectFile){
 var sel=$('lutChoice');if(!sel)return;var keep=selectFile||sel.value||load().lut||'',mine=cubes(libraryDir()),adobe=cubes(builtinDir(hostPath()));
 sel.textContent='';
 function group(label,list){if(!list.length)return;var g=root.document.createElement('optgroup');g.label=label;list.forEach(function(x){var o=root.document.createElement('option');o.value=x.file;o.textContent=x.name;g.appendChild(o);});sel.appendChild(g);}
 group('My LUTs',mine);group('Premiere Creative LUTs',adobe);
 if(!sel.options.length){var o=root.document.createElement('option');o.value='';o.textContent='No LUT yet · click Add .cube LUT';sel.appendChild(o);}
 for(var i=0;i<sel.options.length;i++)if(sel.options[i].value===keep){sel.selectedIndex=i;break;}
 if($('lutForget'))$('lutForget').disabled=!sel.value||!inLibrary(sel.value);
}
function showIntensity(){if($('lutIntensityText'))$('lutIntensityText').textContent=$('lutIntensity').value+'%';}
function browse(){
 var r;try{r=root.cep.fs.showOpenDialogEx(false,false,'Choose a .cube LUT',null,['cube']);}catch(e){throw Error('The file dialog did not open ('+e.message+').');}
 if(r&&r.err)throw Error('The file dialog did not open (error '+r.err+').');
 var file=r&&r.data&&r.data[0];if(!file)return null;
 var dest=addLut(file);render(dest);save();return dest;
}
/** What panel.js sends to the host: {lut, intensity, scope, template}. Throws with a message for the status line. */
function request(){
 var lut=$('lutChoice').value,intensity=Math.round(Number($('lutIntensity').value));
 if(!lut)throw Error('Add or choose a .cube LUT first.');if(!req('fs').existsSync(lut))throw Error('That LUT file is gone. Choose it again.');
 if(!(intensity>=0&&intensity<=100))throw Error('Intensity must be 0 to 100 %.');
 var template=req('fs').readFileSync(req('path').join(extensionDir(),'lumetri-look.xml'),'utf8');
 return {lut:lut,intensity:intensity,scope:$('lutScope').value==='selected'?'selected':'all',template:template};
}
function extensionDir(){try{return plainPath(new root.CSInterface().getSystemPath(root.SystemPath.EXTENSION));}catch(e){return '';}}
function wire(){
 if(!$('menuLut'))return;var x=load();
 if(x.intensity!=null&&$('lutIntensity'))$('lutIntensity').value=x.intensity;if(x.scope&&$('lutScope'))$('lutScope').value=x.scope;
 render();showIntensity();
 $('lutIntensity').oninput=function(){showIntensity();save();};$('lutScope').onchange=save;
 $('lutChoice').onchange=function(){render($('lutChoice').value);save();};
 $('lutBrowse').onclick=function(){try{var d=browse();if(d&&root.RPPanel){root.RPPanel.setActiveTool('lut');root.RPPanel.state('LUT added: '+d.replace(/^.*[\\\/]/,''),false,'success');}}catch(e){if(root.RPPanel){root.RPPanel.setActiveTool('lut');root.RPPanel.state('Could not add the LUT: '+e.message,true,'error');}}};
 // The copy is deleted: clips that use it lose the LUT the next time Premiere loads it.
 $('lutForget').onclick=function(){var f=$('lutChoice').value;if(root.confirm&&!root.confirm('Delete '+f.replace(/^.*[\\\/]/,'')+' from the plugin LUT folder? Clips that use it can lose this LUT.'))return;try{forgetLut(f);render();save();}catch(e){if(root.RPPanel){root.RPPanel.setActiveTool('lut');root.RPPanel.state(e.message,true,'error');}}};
}
root.RPLut={request:request,render:render,safeName:safeName,plainPath:plainPath,builtinDir:builtinDir,libraryDir:libraryDir,checkCube:checkCube,addLut:addLut,forgetLut:forgetLut,inLibrary:inLibrary};
if(root.document){if(root.document.readyState==='loading')root.document.addEventListener('DOMContentLoaded',wire);else wire();}
if(typeof module!=='undefined'&&module.exports)module.exports=root.RPLut;
}(typeof window!=='undefined'?window:globalThis));
