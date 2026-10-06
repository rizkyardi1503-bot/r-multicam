'use strict';
(()=>{
 const $=id=>document.getElementById(id);
 const next=$('practice-next'),play=$('practice-play'),frame=$('practice-frame'),film=$('practice-film'),tracks=$('practice-tracks'),clips=$('practice-clips'),progress=$('practice-progress'),scanner=$('practice-scan'),preview=$('practice-preview-stage');
 if(!next||!play||!frame||!tracks||!clips)return;
 const names=['WIDE','DJ','DETAIL','CROWD'],totalBeats=16,bpm=120,dropBeat=8;
 let stage=0,plan=[],playing=false,raf=0,elapsed=0,startedAt=0,epoch=0,busy=false;
 const style=document.createElement('style');style.textContent=`
 #try-editor .demo-settings{display:grid;gap:14px;margin:16px 0;padding:16px;border:1px solid #ffffff20;border-radius:14px;background:#ffffff05}
 #try-editor .demo-settings label{display:grid;gap:6px;font-size:13px;color:#cbd5e1}
 #try-editor .demo-settings select{width:100%;min-height:40px;background:#141b29;border:1px solid #ffffff30;border-radius:8px;padding:8px;color:#fff}
 #try-editor .demo-settings fieldset{border:0;padding:0;margin:0;min-width:0}#try-editor .demo-settings legend{font-size:13px;margin-bottom:8px}
 #try-editor .demo-cameras{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}#try-editor .demo-cameras label{display:flex;align-items:center;gap:8px;border:1px solid #ffffff20;padding:8px;border-radius:8px}
 #try-editor .demo-settings input{width:16px;height:16px;accent-color:#a5b4fc}#try-editor .demo-settings :focus-visible,#try-editor .practice-cut:focus-visible{outline:2px solid #c4b5fd;outline-offset:3px}
 #try-editor .demo-map{display:flex;gap:3px;padding:12px 0;position:relative;min-height:54px}#try-editor .demo-beat{flex:1;min-width:0;height:30px;border-radius:4px;background:#ffffff18;font-size:10px;text-align:center;padding-top:7px;color:#cbd5e1}
 #try-editor .demo-beat.drop{background:#f59e0b;color:#111827;font-weight:700}#try-editor .demo-beat.current{outline:2px solid #fff;outline-offset:2px;background:#8b5cf6;color:#fff}
 #try-editor .practice-source-row{grid-template-columns:30px repeat(16,minmax(0,1fr));gap:2px}#try-editor .practice-source-cell{min-height:28px;padding:3px 0;font-size:0;border-radius:3px;background-size:cover}#try-editor .practice-source-cell.chosen{outline:1px solid #ddd6fe;outline-offset:-1px}
 #try-editor .practice-cut{min-width:0;font-size:11px;padding:8px 2px;overflow:hidden;min-height:44px;border:1px solid #ffffff20;cursor:pointer}#try-editor .practice-cut[aria-current=true]{outline:2px solid #fff;outline-offset:-2px}
 #try-editor .demo-simulation-note{font-size:12px;line-height:1.6;color:#94a3b8}#try-editor .demo-map[hidden],#try-editor [hidden]{display:none!important}
 @media(prefers-reduced-motion:reduce){#try-editor *{animation:none!important;transition:none!important}}
 `;document.head.appendChild(style);
 const settings=document.createElement('div');settings.className='demo-settings';settings.innerHTML='<label for="demo-pace">Camera rhythm<select id="demo-pace"><option value="2">Every 2 beats · fast</option><option value="4" selected>Every 4 beats · balanced</option><option value="8">Every 8 beats · relaxed</option></select></label><label for="demo-drop-camera">Main-drop angle · beat 9<select id="demo-drop-camera"><option value="auto">Auto</option><option value="0">CAM 1 · Wide</option><option value="1" selected>CAM 2 · DJ</option><option value="2">CAM 3 · Detail</option><option value="3">CAM 4 · Crowd</option></select></label><fieldset><legend>Active cameras · keep at least one</legend><div class="demo-cameras">'+names.map((name,i)=>'<label><input type="checkbox" data-demo-camera="'+i+'" checked>CAM '+(i+1)+' · '+name+'</label>').join('')+'</div></fieldset>';
 next.parentNode.insertBefore(settings,next);
 const map=document.createElement('div');map.className='demo-map';map.setAttribute('aria-label','Prepared sample beat grid: 16 beats, drop on beat 9');map.hidden=true;clips.parentNode.insertBefore(map,clips);
 const note=$('practice-result-note');if(note){note.className='demo-simulation-note';note.hidden=false;note.textContent='Interactive simulation · prepared 120 BPM map · fictional camera images · no audio analysis, files uploaded or Premiere timeline edited. Preview is silent and follows your selected settings.';}
 const title=$('try-title');if(title)title.textContent='Direct your first multicam edit.';
 const section=next.closest('section');const intro=section?.querySelector('.play-intro p:not(.eyebrow)');if(intro)intro.textContent='Try a prepared music map, choose your camera rhythm and watch your own simulated edit play.';
 const small=section?.querySelector('.play-intro small');if(small)small.textContent='Original interactive workflow simulation · no account or upload required';
 if(film){film.pause();film.hidden=true;}
 const steps=document.querySelectorAll('.practice-steps li');['Analyze','Camera plan','Apply','Preview'].forEach((s,i)=>{if(steps[i])steps[i].textContent=s;});
 function active(){return Array.from(settings.querySelectorAll('[data-demo-camera]:checked')).map(c=>Number(c.dataset.demoCamera));}
 function makePlan(pace,enabled,drop){
  if(![2,4,8].includes(pace)||!enabled.length||enabled.some(c=>![0,1,2,3].includes(c)))throw Error('Invalid demo settings');
  const result=[];let current=enabled[0],lastChange=0,rotation=0;
  for(let beat=0;beat<totalBeats;beat++){
   if(beat===dropBeat){const target=enabled.includes(drop)?drop:enabled[(rotation+1)%enabled.length];current=target;rotation=enabled.indexOf(current);lastChange=beat;}
   else if(beat>0&&beat-lastChange>=pace){rotation=(rotation+1)%enabled.length;current=enabled[rotation];lastChange=beat;}
   const previous=result[result.length-1];if(previous&&previous.camera===current)previous.end=beat+1;else result.push({start:beat,end:beat+1,camera:current});
  }
  return result;
 }
 function say(message){$('practice-status').textContent=message;}
 function step(n,title,help){$('practice-title').textContent=title;$('practice-help').textContent=help;steps.forEach((li,i)=>{li.classList.toggle('complete',i<n);if(i===n)li.setAttribute('aria-current','step');else li.removeAttribute('aria-current');});}
 function camera(i){frame.hidden=false;frame.src='/assets/practice-cam-'+(i+1)+'.webp';frame.alt=names[i].toLowerCase()+' camera sample of a fictional DJ performance';$('practice-camera').textContent='CAM '+(i+1)+' · '+names[i];document.querySelectorAll('[data-practice-camera]').forEach(b=>b.setAttribute('aria-pressed',String(Number(b.dataset.practiceCamera)===i+1)));}
 function drawTracks(){tracks.replaceChildren();for(let cam=0;cam<4;cam++){const row=document.createElement('div');row.className='practice-source-row';const label=document.createElement('span');label.textContent='V'+(cam+1);row.append(label);for(let beat=0;beat<totalBeats;beat++){const cell=document.createElement('div');cell.className='practice-source-cell cam-'+(cam+1);cell.style.backgroundImage="linear-gradient(#10131b88,#10131b88),url('/assets/practice-cam-"+(cam+1)+".webp')";cell.dataset.beat=String(beat);row.append(cell);}tracks.append(row);}}
 function paintBeat(beat){Array.from(map.children).forEach((node,i)=>node.classList.toggle('current',i===beat));Array.from(clips.children).forEach((node,i)=>node.setAttribute('aria-current',String(beat>=plan[i].start&&beat<plan[i].end)));}
 function seek(seconds){elapsed=Math.max(0,Math.min(8,seconds));const beat=Math.min(15,Math.floor(elapsed*2));const cut=plan.find(c=>beat>=c.start&&beat<c.end);if(cut)camera(cut.camera);paintBeat(beat);$('practice-clock').textContent='00:'+String(Math.floor(elapsed)).padStart(2,'0')+' / 00:08';$('practice-timing').textContent='BEAT '+(beat+1)+' / 16'+(beat===dropBeat?' · DROP':'');}
 function stop(){playing=false;cancelAnimationFrame(raf);play.textContent=elapsed>=8?'Replay your edit':'Play your edit';}
 function tick(now){if(!playing)return;seek((now-startedAt)/1000);if(elapsed>=8){stop();say('Preview complete. Change the rhythm or drop camera to create another edit.');return;}raf=requestAnimationFrame(tick);}
 function reset(){epoch++;busy=false;stop();elapsed=0;stage=0;plan=[];film?.pause();preview.className='';tracks.className='practice-source-tracks';drawTracks();clips.replaceChildren();map.replaceChildren();map.hidden=true;scanner.hidden=true;progress.value=0;next.disabled=false;next.textContent='1. Analyze sample →';play.disabled=true;play.textContent='Play your edit';settings.querySelectorAll('input,select').forEach(c=>c.disabled=false);$('practice-clock').textContent='00:00 / 00:08';$('practice-timing').textContent='16 beats · 120 BPM sample';$('practice-metrics').textContent='Prepared sample · 120 BPM · drop at beat 9';camera(active()[0]??0);step(0,'Start with the music.','Analyze a prepared 8-second example, then choose which cameras tell the story. This is a simulation, not real audio detection.');say('Ready. Try the sample without an account.');}
 function generate(){stop();elapsed=0;const pace=Number($('demo-pace').value),enabled=active(),drop=$('demo-drop-camera').value==='auto'?null:Number($('demo-drop-camera').value);plan=makePlan(pace,enabled,drop);clips.replaceChildren();drawTracks();for(const cut of plan){const node=document.createElement('button');node.type='button';node.className='practice-cut cam-'+(cut.camera+1);node.style.flex=String(cut.end-cut.start);node.textContent='C'+(cut.camera+1);node.setAttribute('aria-label','Camera '+(cut.camera+1)+', beats '+(cut.start+1)+' to '+cut.end);node.onclick=()=>{if(busy)return;stop();seek(cut.start/2);};clips.append(node);for(let b=cut.start;b<cut.end;b++)tracks.children[cut.camera].children[b+1].classList.add('chosen');}
  stage=2;progress.value=65;play.disabled=true;next.textContent='3. Apply simulation →';next.disabled=false;const fallback=drop!==null&&!enabled.includes(drop);step(2,'Review your camera plan.','Colored segments show your selected angles. Click a segment to preview it. Apply the simulation when you are happy.');$('practice-metrics').textContent='120 BPM · '+pace+'-beat rhythm · '+plan.length+' continuous camera segments';say(fallback?'Your drop camera is disabled. Auto selected an enabled angle instead.':'Plan ready. The drop at beat 9 uses your chosen angle; same-camera intervals stay continuous.');seek(0);
 }
 next.onclick=async()=>{
  if(busy)return;
  if(stage===0){busy=true;const id=++epoch;next.disabled=true;settings.querySelectorAll('input,select').forEach(c=>c.disabled=true);scanner.hidden=false;preview.classList.add('analyzing');step(0,'Reveal the prepared music map.','This example contains 16 beats at 120 BPM and a sample drop on beat 9. No music is being uploaded or analyzed.');
   for(let i=1;i<=4;i++){progress.value=i*8;scanner.style.left=(i*23)+'%';say('Revealing prepared beat grid… '+(i*25)+'%');await new Promise(resolve=>setTimeout(resolve,180));if(id!==epoch)return;}
   scanner.hidden=true;preview.classList.remove('analyzing');map.hidden=false;for(let b=0;b<totalBeats;b++){const node=document.createElement('span');node.className='demo-beat'+(b===dropBeat?' drop':'');node.textContent=String(b+1);node.title=b===dropBeat?'Sample drop · beat 9':'Beat '+(b+1);map.append(node);}stage=1;busy=false;settings.querySelectorAll('input,select').forEach(c=>c.disabled=false);next.disabled=false;next.textContent='2. Generate camera plan →';step(1,'You are the director.','Choose 2, 4 or 8-beat pacing. Pick a main-drop camera and enable the angles you want, then generate your plan.');say('Prepared map ready. Set your cameras and generate a plan.');return;
  }
  if(stage===1){generate();return;}
  if(stage===2){tracks.classList.add('removing');let removed=0;for(let cam=0;cam<4;cam++)for(let b=0;b<totalBeats;b++){const cut=plan.find(c=>b>=c.start&&b<c.end);if(cut.camera!==cam){tracks.children[cam].children[b+1].classList.add('discarded');removed++;}}tracks.classList.add('collapsed');stage=3;progress.value=100;play.disabled=false;next.textContent='Create another edit ↺';step(3,'Play the edit you designed.','Your settings drive this silent preview. Watch the selected cameras change at the planned beat intervals and the drop.');say('Simulation applied: '+plan.length+' continuous segments. Unused intervals hidden; source media unchanged.');return;}
  reset();
 };
 play.onclick=()=>{if(stage!==3||busy)return;if(playing){stop();return;}if(elapsed>=8)elapsed=0;playing=true;startedAt=performance.now()-elapsed*1000;play.textContent='Pause preview';say('Playing your simulated edit · silent preview.');raf=requestAnimationFrame(tick);};
 settings.addEventListener('change',event=>{if(!active().length){event.target.checked=true;say('Keep at least one camera enabled.');return;}if(stage>=2){stop();stage=1;plan=[];clips.replaceChildren();drawTracks();paintBeat(-1);play.disabled=true;progress.value=35;next.textContent='2. Regenerate camera plan →';step(1,'Settings changed.','Generate a new camera plan to apply your new rhythm and angles.');say('Settings changed. Generate a new plan to preview the difference.');}});
 document.querySelectorAll('[data-practice-camera]').forEach(b=>b.onclick=()=>{if(busy)return;stop();camera(Number(b.dataset.practiceCamera)-1);});
 $('practice-reset').onclick=reset;document.addEventListener('visibilitychange',()=>{if(document.hidden)stop();});reset();
})();
