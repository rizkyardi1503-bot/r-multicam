(function(){
'use strict';
var learning=window.RPMusicLearning;if(!learning)return;
var box=document.createElement('section');box.style.cssText='padding:12px;border:1px solid #364559;margin:12px 0';
var title=document.createElement('strong');title.textContent='Music Engine V18 · local learning & benchmark';box.appendChild(title);
var info=document.createElement('p');info.textContent='Rules-only until you import a model trained on your labeled songs. Export analysis first; mark correct drops and false detections in the JSON. No audio is uploaded.';box.appendChild(info);
function button(label,fn){var b=document.createElement('button');b.textContent=label;b.onclick=function(){try{fn();}catch(e){info.textContent=e.message;}};box.appendChild(b);}
function download(name,obj){var blob=new Blob([JSON.stringify(obj,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(function(){URL.revokeObjectURL(url);},1000);}
button('Export labeled-data template',function(){var r=window.RPMusicTrainingResult;if(!r)throw Error('Run Analyze Music first.');download('music-labels-v18.json',learning.dataset(r,r.fingerprint&&r.fingerprint.signature||r.snapshot&&r.snapshot.sequenceName||'set-your-song-id'));});
var input=document.createElement('input');input.type='file';input.accept='.json,application/json';input.style.display='none';box.appendChild(input);
button('Import trained model',function(){input.click();});input.onchange=function(){var f=input.files[0];if(!f)return;if(f.size>200000){info.textContent='Model file exceeds 200 KB.';return;}var reader=new FileReader();reader.onload=function(){try{learning.setModel(JSON.parse(reader.result));info.textContent='Local model loaded. Re-run analysis to apply it; structural safety gates remain enabled.';}catch(e){info.textContent=e.message;}};reader.readAsText(f);};
button('Use rules only',function(){learning.clearModel();info.textContent='Model cleared. Re-run analysis to use rules only.';});
var target=document.getElementById('mainDropReview');if(target&&target.parentNode)target.parentNode.insertBefore(box,target);else document.body.appendChild(box);
}());
