(function(){
'use strict';
function el(id){return document.getElementById(id);}
function move(id,to){var x=el(id);if(x)to.appendChild(x);return x;}
function details(title,id){var d=document.createElement('details');d.className='support';d.id=id;d.innerHTML='<summary>'+title+'</summary><div class="inside"></div>';return d;}
var dash=document.createElement('main');dash.id='compactDashboard';dash.innerHTML='<div class="mi-heading">AUTO MUSIC MAP <span>V14 · PUBLIC UPDATE</span></div><div class="mi-stats"><div><small>BPM</small><b id="miBpm">—</b></div><div><small>DROPS</small><b id="miDrops">—</b></div><div><small>ENERGY</small><b id="miEnergy">—</b></div><div><small>DROP SCORE</small><b id="miConfidence">—</b></div></div><div id="compactEditRules"></div><div class="primary-grid" id="primaryActions"></div><div id="compactProgress"></div><div id="compactError" role="alert" hidden></div>';
var head=document.querySelector('.apphead');head.parentNode.insertBefore(dash,head.nextSibling);
[['aiMarkerRun','Analyze Music'],['directorRun','Run Multicam'],['bestDropsAnalyze','Best Drops'],['zoomRun','Random Zoom']].forEach(function(pair){var b=move(pair[0],el('primaryActions'));b.textContent=pair[1];b.className='main';});
var quick=el('compactEditRules'),pacingBox=document.querySelector('.pacingSelect'),dropBox=document.querySelector('.dropCameraSelect');if(pacingBox)quick.appendChild(pacingBox);if(dropBox)quick.appendChild(dropBox);
var cam=details('Camera Rules','compactCamera'),music=details('Music Detection','compactMusic'),advanced=details('Advanced','compactAdvanced');dash.appendChild(cam);dash.appendChild(music);dash.appendChild(advanced);
var cb=cam.lastChild,mb=music.lastChild,ab=advanced.lastChild;
['aiRoles','aiVision'].forEach(function(id){var x=el(id);if(x&&x.parentNode)cb.appendChild(x.parentNode);});cb.appendChild(el('cameraToggles').parentNode);el('aiRoles').rows=3;
mb.appendChild(el('dropSensitivity').parentNode.parentNode);
var opts=document.createElement('div');opts.className='row';opts.innerHTML='<label>Minimum main-drop spacing (beats; blank = sensitivity preset)<input id="miSpacing" type="number" min="32" max="256" step="16" placeholder="Preset"></label>';mb.appendChild(opts);
var more=document.createElement('div');more.innerHTML='<label>Minimum drop score (1–99; blank = sensitivity preset)<input id="miThreshold" type="number" min="1" max="99" step="1" placeholder="Preset"></label>';mb.appendChild(more);
var selection=details('Select main drops · shared by Multicam and Best Drops','mainDropSelection');selection.lastChild.innerHTML='<div id="mainDropReview">Analyze Music first.</div>';dash.insertBefore(selection,cam);
var note=document.createElement('small');note.textContent='Auto Music Map V14 analyzes A1 within sequence In/Out (full sequence when marks are cleared), then drives camera decisions from beat, phrase, energy, build-up, breakdown and validated main drops. Cut Pace starts at Mark In and uses checked beat intervals; drops restart it. Coverage fallback is automatic. A physical razor is created only when the selected camera actually changes; same-camera decisions do not create artificial cuts.';mb.appendChild(note);
var render=document.createElement('div');render.id='compactRender';dash.insertBefore(render,cam);move('dropRenderControls',render);move('bestDropsRender',render);el('bestDropsRender').textContent='Render Best Drops';
var review=details('Review ranked drops','compactDropReview');render.appendChild(review);move('dropResult',review.lastChild);move('dropInfo',review.lastChild);
document.querySelectorAll('.toolstatus').forEach(function(x){el('compactProgress').appendChild(x);});
var cprog=el('compactProgress'),bk=el('aiBackup'),bkl=bk&&bk.parentNode;if(bkl&&cprog&&cprog.parentNode){Array.prototype.slice.call(bkl.childNodes).forEach(function(n){if(n.nodeType===3)bkl.removeChild(n);});bkl.appendChild(document.createTextNode('Save backup copy of sequence before applying'));bkl.className=(bkl.className?bkl.className+' ':'')+'backupRow';cprog.parentNode.insertBefore(bkl,cprog);}
var cerr=el('compactError'),anchor=cerr&&cerr.parentNode===(cprog&&cprog.parentNode)?cerr.nextSibling:(cprog?cprog.nextSibling:null);['menuResume','menuSync','menuPodcast'].forEach(function(id){var x=el(id);if(x&&cprog&&cprog.parentNode){cprog.parentNode.insertBefore(x,anchor);x.open=false;}});
document.querySelectorAll('body > details').forEach(function(x){ab.appendChild(x);x.open=false;});
['menuMulticam','menuDrop'].forEach(function(id){var x=el(id);if(x)x.style.display='none';});
var zt=el('menuZoom').querySelector('summary .tooltitle');if(zt&&zt.firstChild&&zt.firstChild.nodeType===3)zt.firstChild.nodeValue='Zoom settings ';else if(zt)zt.textContent='Zoom settings';el('menuZoom').querySelectorAll('small,.musicbox').forEach(function(x){x.style.display='none';});
el('accountBarMessage').textContent='';
var ids=['dropSensitivity','dropPreBeats','dropPostBeats','miSpacing','miThreshold'];
try{var settings=JSON.parse(localStorage.getItem('rp.musicRules.v10.94')||'{}');['dropPreBeats','dropPostBeats'].forEach(function(id){if(settings[id]!=null&&el(id))el(id).value=settings[id];});}catch(ignore){}
ids.forEach(function(id){if(!el(id))return;el(id).addEventListener('change',function(){var settings={};ids.forEach(function(k){if(el(k))settings[k]=el(k).value;});try{localStorage.setItem('rp.musicRules.v10.94',JSON.stringify(settings));}catch(ignore){}if(window.RPCompactRulesChanged)window.RPCompactRulesChanged();});});
// Workflow order: five numbered steps, each with a plain name, a one-line explanation, its button and its own
// settings. Everything optional sits below under "More".
function step(n,title,desc,badgeId){var sec=document.createElement('section');sec.className='step';sec.id='step'+n;
 sec.innerHTML='<div class="stephead"><span class="stepnum">'+n+'</span><span class="steptitle">'+title+'</span></div><p class="stepdesc">'+desc+'</p><div class="stepbody" id="step'+n+'Body"></div>';
 var b=badgeId&&el(badgeId);if(b)sec.firstChild.appendChild(b);dash.insertBefore(sec,stepAnchor);return sec.lastChild;}
function button(id,label){var b=el(id);if(b){b.textContent=label;b.className='main';}return b;}
function rename(id,title){var d=el(id),s=d&&d.querySelector('summary');if(s)s.textContent=title;return d;}
var stepAnchor=document.createElement('div');dash.insertBefore(stepAnchor,el('compactCamera'));
var top=document.createElement('div');top.id='workflowStatus';dash.insertBefore(top,dash.firstChild);top.appendChild(cprog);top.appendChild(cerr);
var b1=step(1,'Analyze Music','Reads the tempo, beats and drops of the music on A1. Do this first.',null);
b1.appendChild(dash.querySelector('.mi-stats'));b1.appendChild(button('aiMarkerRun','Analyze Music'));
b1.appendChild(rename('mainDropSelection','Choose the main drops'));
var b2=step(2,'Sync Cameras to Music <em>BETA</em>','Lines up every camera, drone and FPV clip on the music and builds a new synced sequence. Skip it if your cameras are already in sync.','syncBadge');
var syncCard=el('menuSync');if(syncCard){var tb=syncCard.querySelector('.toolbody');if(tb){var intro=tb.querySelector(':scope > small');if(intro)intro.style.display='none';b2.appendChild(tb);}syncCard.style.display='none';}
var b3=step(3,'Auto Cut Multicam','Cuts between your cameras on the beat. Pick the pace and the camera roles, then run it on a duplicate sequence.','multiBadge');
b3.appendChild(quick);b3.appendChild(rename('compactCamera','Camera roles & cameras used'));
var reviewSlot=document.createElement('div');reviewSlot.id='step3Review';b3.appendChild(reviewSlot);
if(bkl)b3.appendChild(bkl);b3.appendChild(button('directorRun','Run Auto Cut'));var resume=el('menuResume');if(resume)b3.appendChild(resume);
var b4=step(4,'Best Drops','Finds the strongest drops in the music and renders short highlight clips around them.','dropBadge');
b4.appendChild(button('bestDropsAnalyze','Find Best Drops'));
// Music detection settings are not shown (engine defaults); the clip length around a drop belongs to Best Drops.
var lenRow=document.createElement('div');lenRow.className='row';['dropPreBeats','dropPostBeats'].forEach(function(id){var x=el(id);if(x&&x.parentNode)lenRow.appendChild(x.parentNode);});b4.appendChild(lenRow);b4.appendChild(render);
var mus=el('compactMusic');if(mus)mus.style.display='none';
var b5=step(5,'Random Zoom','Adds zoom moves to the clips of the edited sequence. Run it after Auto Cut is finished.','zoomBadge');
b5.appendChild(button('zoomRun','Add Random Zoom'));var zoom=el('menuZoom');if(zoom){b5.appendChild(zoom);zoom.open=false;}
var heading=dash.querySelector('.mi-heading');if(heading)heading.parentNode.removeChild(heading);
var grid=el('primaryActions');if(grid&&!grid.children.length)grid.style.display='none';
var moreHead=document.createElement('div');moreHead.className='moreheading';moreHead.textContent='More';dash.insertBefore(moreHead,stepAnchor);
if(el('menuPodcast'))dash.insertBefore(el('menuPodcast'),stepAnchor);
// Old card numbers (00 / 01B / 04) no longer match the steps: keep the names and the status badges only.
['menuPodcast','menuResume'].forEach(function(id){var t=el(id)&&el(id).querySelector('summary .tooltitle');if(t&&t.firstChild&&t.firstChild.nodeType===3)t.firstChild.nodeValue=t.firstChild.nodeValue.replace(/^\s*\d+[A-Z]?\s*\/\s*/,'');});stepAnchor.parentNode.removeChild(stepAnchor);
window.RPCompact={summary:function(r){var v=r.musicV12||r.musicV10||{},series=r.music||[],sum=0;series.forEach(function(x){sum+=Number(x.energy)||0;});el('miBpm').textContent=r.tempo||'—';el('miDrops').textContent=v.drop_count==null?'—':v.drop_count;var energy=series.length?sum/series.length:0;el('miEnergy').textContent=energy>=65?'HIGH':energy>=30?'MED':'LOW';el('miConfidence').textContent=v.accepted_drops&&v.accepted_drops.length?Math.round(v.accepted_drops[0].confidence_score)+'/100':'—';},running:function(busy,tool){document.querySelectorAll('#compactProgress .toolstatus').forEach(function(x){x.style.display=busy&&!!x.querySelector('#'+tool+'State')?'block':'none';});if(busy)el('compactError').hidden=true;},error:function(text){el('compactError').textContent=text;el('compactError').hidden=false;}};
window.RPCompact.running(false,'multi');
}());
