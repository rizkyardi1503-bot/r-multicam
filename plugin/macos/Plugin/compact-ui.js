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
var b2=step(2,'Sync Cameras to Music','Lines up every camera, drone and FPV clip on the music and builds a new synced sequence. Skip it if your cameras are already in sync.','syncBadge');
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
window.RPCompact={summary:function(r){var v=r.musicV12||r.musicV10||{},series=r.music||[],sum=0;series.forEach(function(x){sum+=Number(x.energy)||0;});el('miBpm').textContent=r.tempo||'—';el('miDrops').textContent=v.drop_count==null?'—':v.drop_count;var energy=series.length?sum/series.length:0;el('miEnergy').textContent=energy>=65?'HIGH':energy>=30?'MED':'LOW';el('miConfidence').textContent=v.accepted_drops&&v.accepted_drops.length?Math.round(v.accepted_drops[0].confidence_score)+'/100':'—';},running:function(busy,tool){document.querySelectorAll('#compactProgress .toolstatus').forEach(function(x){x.style.display=busy&&!!x.querySelector('#'+tool+'State')?'block':'none';});if(busy)el('compactError').hidden=true;if(window.RPSections)window.RPSections.running(busy,tool);},error:function(text){el('compactError').textContent=text;el('compactError').hidden=false;}};
window.RPCompact.running(false,'multi');
// Foldable sections: each step card folds to its header, which keeps a one-line status; the steps are an accordion
// and every section remembers open/closed. A step whose job runs or shows an error/warning opens by itself.
// Folding is CSS only: no node is removed, so ids clicked or read by other scripts keep working.
// Runs after customer-experience.js and music-training-ui.js have added their cards (DOMContentLoaded).
var SECT_KEY='rp.panelSections.v1',sect={busy:null,tool:null,active:null,owner:null,att:{},timer:null,ready:false};
function list(x){return Array.prototype.slice.call(x||[]);}
function steps(){return list(dash.querySelectorAll('section.step'));}
function cards(all){return list(dash.children).filter(function(x){return x.tagName==='DETAILS'&&x.id&&x.style.display!=='none'&&(all||x.id!=='firstEditGuide');});}
function isOpen(s){return !s.classList.contains('collapsed');}
function pinned(id){return sect.att[id]==='running'||sect.att[id]==='error';}
function save(){if(!sect.ready)return;var v={};steps().forEach(function(s){v[s.id]=isOpen(s);});cards().forEach(function(d){v[d.id]=!!d.open;});try{localStorage.setItem(SECT_KEY,JSON.stringify(v));}catch(ignore){}}
function setStep(s,open,why){if(isOpen(s)===open&&why!=='init')return;
 if(open&&(why==='user'||why==='auto'))steps().forEach(function(o){if(o!==s&&isOpen(o)&&!pinned(o.id)){o.classList.add('collapsed');o.firstChild.setAttribute('aria-expanded','false');}});
 s.classList.toggle('collapsed',!open);s.firstChild.setAttribute('aria-expanded',open?'true':'false');save();
 // the steps above may just have folded: keep the header the user is acting on in view
 if(open&&(why==='user'||why==='auto')&&s.firstChild.scrollIntoView)setTimeout(function(){try{s.firstChild.scrollIntoView({block:'nearest'});}catch(ignore){}},0);}
function txt(id){var x=el(id);return x?String(x.textContent||'').replace(/\s+/g,' ').trim():'';}
function kindOf(id){var c=String(el(id)&&el(id).className||'');return /\berror\b/.test(c)?'error':/\bwarning\b/.test(c)?'warning':/\bsuccess\b/.test(c)?'success':'';}
function idle(t){return !t||/^ready\.?$/i.test(t);}
function shown(id){var x=el(id);return !!x&&x.style.display!=='none'&&x.style.display!=='';}
// Step 2 is Lifetime only. Locked = the lock note sync-ui.js shows from its isLifetime() (license mode + account access),
// so the card follows login, logout, purchase and trial expiry live. Undecided while the saved login is restoring.
function syncLocked(){var a=null;try{a=window.RPAccountAuth&&window.RPAccountAuth.status();}catch(ignore){}if(a&&a.restoring)return false;return shown('syncLocked');}
function unlock(){var buy=el('accountBuyLifetime');if(buy&&buy.style.display!=='none'&&!buy.disabled)buy.click();else if(el('openCustomerWebsite'))el('openCustomerWebsite').click();}
function applyLock(on){var s=el('step2');if(!s||s.classList.contains('locked')===on)return;s.classList.toggle('locked',on);var b=el('syncUnlock');if(b)b.setAttribute('aria-hidden',on?'false':'true');var n=s.querySelector('.stepnum');if(n)n.title=on?'Lifetime members only':'';}
// One status per step, built only from text the panel already renders (no engine calls).
function status(){var out={},owner=sect.owner||'step3';
 function tool(id,prefix,base){var k=kindOf(prefix+'Badge');if(sect.busy===id)return {text:txt(prefix+'State')||'Working…',kind:'running',att:'running'};if((k==='error'||k==='warning')&&(prefix!=='multi'||owner===id))return {text:txt(prefix+'State'),kind:k,att:k};return base;}
 var bpm=txt('miBpm'),drops=txt('miDrops');
 out.step1=tool('step1','multi',bpm&&bpm!=='—'?{text:bpm+' BPM'+(drops&&drops!=='—'?' · '+drops+' drops':''),kind:'success'}:{text:'Not analyzed yet',kind:''});
 var res=txt('syncResult'),cams=/^Synced (\d+) camera/.exec(res),placed=/On camera tracks: (\d+)/.exec(res),review=/Review track: (\d+)/.exec(res),ss=txt('syncState');
 out.step2=sect.locked?{text:'Lifetime members only',kind:'locked'}:tool('step2','sync',cams&&placed?{text:cams[1]+' cam'+(cams[1]==='1'?'':'s')+' · '+placed[1]+' placed · '+(review?review[1]:0)+' review',kind:'success'}:{text:idle(ss)?'Optional · not run yet':ss,kind:kindOf('syncBadge')});
 var pace=txt('pacingSummary'),dc=txt('dropCameraSummary'),ms=txt('multiState'),base3={text:(pace?'Pace '+pace:'')+(dc&&dc!=='AUTO'?' · drop cam '+dc:'')+(sect.owner==='step3'&&!idle(ms)?' · '+ms:''),kind:sect.owner==='step3'?kindOf('multiBadge'):''};
 out.step3=shown('menuResume')&&sect.busy!=='step3'?{text:'Saved job · Continue available',kind:'warning',att:'resume'}:tool('step3','multi',base3);
 var ds=txt('dropState');out.step4=tool('step4','drop',{text:idle(ds)?'Not run yet':ds,kind:kindOf('dropBadge')});
 var zs=txt('zoomState'),zr=el('zoomMin')&&el('zoomMax')?'Zoom '+el('zoomMin').value+'–'+el('zoomMax').value+' %':'';out.step5=tool('step5','zoom',{text:idle(zs)?zr:zs,kind:kindOf('zoomBadge')});
 return out;}
function refresh(){sect.timer=null;if(!sect.ready)return;sect.locked=syncLocked();applyLock(sect.locked);var st=status();steps().forEach(function(s){var x=st[s.id]||{text:''},sum=el(s.id+'Sum'),cls='stepsum'+(x.kind?' '+x.kind:''),now=x.att||'',prev=sect.att[s.id]||'';
 if(sum){if(sum.textContent!==x.text)sum.textContent=x.text;if(sum.className!==cls)sum.className=cls;}
 sect.att[s.id]=now;['running','error','warning','resume'].forEach(function(a){if(s.classList.contains('att-'+a)!==(now===a))s.classList.toggle('att-'+a,now===a);});
 if(now&&now!==prev)setStep(s,true,'auto');});}
function queue(){if(!sect.timer)sect.timer=setTimeout(refresh,80);}
window.RPSections={running:function(busy,tool){var id=null;if(busy)id=sect.busy&&sect.tool===tool?sect.busy:tool==='sync'?'step2':tool==='drop'?'step4':tool==='zoom'?'step5':tool==='multi'?(sect.active==='step1'?'step1':'step3'):null;
 if(id==='step1'||id==='step3')sect.owner=id;if(id!==sect.busy){sect.busy=id;sect.tool=busy?tool:null;queue();}},
 open:function(id){var s=el(id);if(s&&s.classList.contains('step'))setStep(s,true,'user');},refresh:queue};
function initSections(){if(sect.ready||!el('step1'))return;
 cards(true).forEach(function(d){d.addEventListener('toggle',save);});
 list(dash.children).forEach(function(d){if(d.tagName==='DETAILS'&&!d.id){var t=d.querySelector('summary');d.id='sect-'+String(t&&t.textContent||'card').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,40);d.addEventListener('toggle',save);}});
 steps().forEach(function(s){var h=s.firstChild,t=h.querySelector('.steptitle'),wrap=document.createElement('span'),sum=document.createElement('span');wrap.className='steptext';h.insertBefore(wrap,t);wrap.appendChild(t);sum.className='stepsum';sum.id=s.id+'Sum';wrap.appendChild(sum);
  h.setAttribute('role','button');h.setAttribute('tabindex','0');h.setAttribute('aria-controls',s.id+'Body');h.title='Show / hide this step';
  h.addEventListener('click',function(){setStep(s,!isOpen(s),'user');});
  h.addEventListener('keydown',function(e){if(e.key==='Enter'||e.key===' '||e.keyCode===13||e.keyCode===32){e.preventDefault();setStep(s,!isOpen(s),'user');}});});
 var s2=el('step2'),body2=el('step2Body');if(s2&&body2){var lk='<span class="lockicon" aria-hidden="true"></span>',num=s2.querySelector('.stepnum'),badge=document.createElement('span');
  if(num)num.insertAdjacentHTML('beforeend',lk);badge.id='syncLockBadge';badge.className='badge lockbadge';badge.innerHTML=lk+'LIFETIME';s2.firstChild.insertBefore(badge,el('syncBadge')&&el('syncBadge').parentNode===s2.firstChild?el('syncBadge'):null);
  var box=document.createElement('div');box.id='syncUnlock';box.setAttribute('aria-hidden','true');box.innerHTML='<button type="button" id="syncUnlockRun" class="main unlockbtn">'+lk+'Unlock with Lifetime</button><small>Included in Lifetime · sync every camera, drone and FPV clip to the music</small>';body2.insertBefore(box,body2.firstChild);
  var shield=document.createElement('div');shield.id='syncShield';shield.setAttribute('aria-hidden','true');shield.title='Lifetime members only';body2.appendChild(shield);
  el('syncUnlockRun').onclick=unlock;
  // any click on the dimmed controls points at the unlock button instead of doing nothing
  shield.onclick=function(){var u=el('syncUnlockRun');try{u.scrollIntoView({block:'nearest'});}catch(ignore){}u.focus();u.classList.remove('nudge');void u.offsetWidth;u.classList.add('nudge');};}
 // Sticky top: Collapse/Expand all plus the live progress and error boxes, so a running job is always visible.
 var topBox=document.createElement('div'),bar=document.createElement('div');topBox.id='panelTop';bar.id='sectionTools';
 bar.innerHTML='<span>Workflow</span><button type="button" id="sectionsCollapseAll" class="linkbtn">Collapse all</button><button type="button" id="sectionsExpandAll" class="linkbtn">Expand all</button>';
 dash.insertBefore(topBox,dash.firstChild);topBox.appendChild(bar);if(el('workflowStatus'))topBox.appendChild(el('workflowStatus'));
 el('sectionsCollapseAll').onclick=function(){steps().forEach(function(s){setStep(s,false,'all');});cards(true).forEach(function(d){d.open=false;});save();};
 el('sectionsExpandAll').onclick=function(){steps().forEach(function(s){setStep(s,true,'all');});cards().forEach(function(d){d.open=true;});save();};
 dash.addEventListener('click',function(e){if(e.isTrusted===false)return;for(var n=e.target;n&&n!==dash;n=n.parentNode)if(n.classList&&n.classList.contains('stepbody')){sect.active=n.parentNode.id;return;}},true);
 // first run: step 1 open, the rest folded; later: exactly what the user left open
 var saved=null;try{saved=JSON.parse(localStorage.getItem(SECT_KEY)||'null');}catch(ignore){}if(!saved||typeof saved!=='object')saved=null;
 steps().forEach(function(s){setStep(s,saved&&typeof saved[s.id]==='boolean'?saved[s.id]:s.id==='step1','init');});
 if(saved)cards().forEach(function(d){if(typeof saved[d.id]==='boolean')d.open=saved[d.id];});
 sect.ready=true;refresh();
 if(window.MutationObserver)new MutationObserver(queue).observe(dash,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['class','style','hidden']});
 var head=document.querySelector('.apphead');if(window.MutationObserver&&head)new MutationObserver(queue).observe(head,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['style','class']});
 dash.addEventListener('input',queue);dash.addEventListener('change',queue);}
function safeInit(){try{initSections();}catch(e){steps().forEach(function(s){s.classList.remove('collapsed');});}}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',safeInit);else setTimeout(safeInit,0);
}());
