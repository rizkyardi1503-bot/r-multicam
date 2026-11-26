'use strict';
const config = window.RP_CONFIG || {};
const notice = document.querySelector('#notice');
function safeUrl(value) { try { const url = new URL(value); return url.protocol === 'https:' ? url.href : null; } catch { return null; } }
function message(title, body, url, label) {
 document.querySelector('#notice-title').textContent = title;
 document.querySelector('#notice-body').textContent = body;
 const link = document.querySelector('#notice-link'); const valid = safeUrl(url);
 link.hidden = !valid; if(valid) {link.href = valid; link.textContent = label; link.rel = 'noopener noreferrer';link.target = '_blank';} else link.removeAttribute('href');
 if (typeof notice.showModal === 'function') notice.showModal();
 else { notice.setAttribute('open', ''); Object.assign(notice.style, { display: 'block', position: 'fixed', top: '24px', left: '0', right: '0', margin: '0 auto', zIndex: '1000' }); }
}
// Safari before 15.4 (macOS Catalina) has no <dialog>: without this the notice would sit open in the page.
function closeNotice() { if (typeof notice.close === 'function') notice.close(); else { notice.removeAttribute('open'); notice.style.display = 'none'; } }
if (notice) {
if (typeof notice.showModal !== 'function') notice.style.display = 'none';
document.querySelector('#close-notice').onclick = closeNotice;
document.querySelector('#notice-done').onclick = closeNotice;
// Fallback handlers; portal.js replaces them with the account dialog once it has loaded.
if (config.checkoutOpen !== true) document.querySelectorAll('[data-buy]').forEach(button => { button.hidden = true; });
document.querySelectorAll('[data-buy]').forEach(button => button.onclick = () => {
 const url = safeUrl(config.paymentUrl);
 message(url ? 'Continue to secure checkout' : 'Checkout is not open yet', url ? 'The displayed license price is '+(window.RPPrice?.label()||'Rp2.000.000')+'. Review the final billing amount, currency and purchase terms on Midtrans before paying. Use the email address linked to your plugin account.' : 'Online purchases are not available yet. Please check back when checkout opens. No payment or license activation has taken place.', url, 'Continue to Midtrans');
});
document.querySelectorAll('[data-account]').forEach(button => button.onclick = () => message('Your Multicam AI license', 'You can check your current license by signing in to the Multicam AI panel inside Premiere. '+(safeUrl(config.customerPortalUrl) ? 'Open the customer portal to manage your account.' : 'The website customer portal is not available yet.'), config.customerPortalUrl, 'Open customer portal'));
document.querySelectorAll('[data-download]').forEach(button => button.onclick = () => {
 message('Account required to download', 'Sign in or create a free R Project account first. After your email is confirmed, sign in to download the Windows or macOS installer.', null);
});
}

// Hero edit: the video never autoplays from markup (preload="none"). It plays muted only while it is on screen,
// and not at all with reduced motion or Save-Data (the poster stays and native controls appear).
// Without IntersectionObserver it counts as always visible and shows native controls. A pause by the user
// sticks: scrolling back or returning to the tab does not restart it until they ask again.
// The shot timeline follows the video; tapping a shot seeks to it; the sound button restarts with sound.
(()=>{
 const fig=document.querySelector('.edit-show'),v=fig&&fig.querySelector('.promo-video'),b=fig&&fig.querySelector('.promo-sound'),panel=document.querySelector('.edit-panel');if(!v)return;
 const still=(window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches)||!!(navigator.connection&&navigator.connection.saveData);
 const io='IntersectionObserver' in window;
 let visible=!io,wanted=!still,selfPause=false;
 const play=()=>{if(v.preload==='none')v.preload='auto';const p=v.play();if(p)p.catch(()=>{});};
 const pause=()=>{if(!v.paused){selfPause=true;v.pause();}};
 if(still||!io)v.controls=true;
 v.addEventListener('pause',()=>{if(selfPause){selfPause=false;return;}if(visible&&!document.hidden&&!v.ended)wanted=false;});
 if(io)new IntersectionObserver((es)=>es.forEach((e)=>{visible=e.isIntersecting;if(visible&&wanted)play();else if(!visible)pause();}),{threshold:.25}).observe(v);
 else if(wanted)play();
 document.addEventListener('visibilitychange',()=>{if(document.hidden)pause();else if(visible&&wanted)play();});
 if(b)b.addEventListener('click',()=>{const on=v.muted;v.muted=!on;wanted=true;if(on){v.currentTime=0;play();}b.setAttribute('aria-pressed',String(on));window.RP_ANALYTICS?.track('demo_started',{label:on?'promo_video_sound_on':'promo_video_sound_off'});});
 if(!panel)return;
 const shots=[...panel.querySelectorAll('.edit-shot')],head=panel.querySelector('.edit-head-line'),track=panel.querySelector('.edit-track'),now=panel.querySelector('[data-edit-now]'),count=panel.querySelector('[data-edit-count]'),legend=[...panel.querySelectorAll('.edit-legend li')];
 let labels={};try{labels=JSON.parse(panel.dataset.labels||'{}');}catch(e){}
 const end=Number(shots[shots.length-1]?.dataset.end)||1;let cur=-1,width=track.clientWidth;
 addEventListener('resize',()=>{width=track.clientWidth;draw();},{passive:true});
 const draw=()=>{const t=v.currentTime||0;head.style.transform='translateX('+(width*Math.min(1,t/end))+'px)';const i=shots.findIndex((s)=>t>=+s.dataset.start&&t<+s.dataset.end);if(i>=0&&i!==cur){cur=i;const a=shots[i].dataset.angle;shots.forEach((s,k)=>{s.classList.toggle('is-on',k===i);if(k===i)s.setAttribute('aria-current','true');else s.removeAttribute('aria-current');});legend.forEach((l)=>l.classList.toggle('is-on',l.dataset.angle===a));now.textContent=labels[a]||a;count.textContent=panel.dataset.shotWord+' '+(i+1)+' '+panel.dataset.ofWord+' '+shots.length;}};
 // One rAF per frame only while the video is actually playing (it is paused off-screen).
 const loop=()=>{draw();if(!v.paused&&!v.ended)requestAnimationFrame(loop);};
 v.addEventListener('play',()=>requestAnimationFrame(loop));v.addEventListener('seeked',draw);
 shots.forEach((s,i)=>s.addEventListener('click',()=>{wanted=true;v.currentTime=+s.dataset.start+0.02;play();draw();window.RP_ANALYTICS?.track('demo_started',{label:'edit_show_shot_'+(i+1)});}));
 draw();
})();

// "How it works" walkthrough video (never autoplays): chapter buttons seek and play; the current chapter lights up.
(()=>{
 const v=document.querySelector('.how-video-player');if(!v)return;
 const bs=[...document.querySelectorAll('.how-chapters button')],ts=bs.map((b)=>Number(b.dataset.t)||0);
 const mark=()=>{const t=v.currentTime||0;let k=0;ts.forEach((s,i)=>{if(t>=s)k=i;});bs.forEach((b,i)=>{const on=(t>0||!v.paused)&&i===k;b.classList.toggle('is-on',on);if(on)b.setAttribute('aria-current','true');else b.removeAttribute('aria-current');});};
 v.addEventListener('timeupdate',mark);v.addEventListener('seeked',mark);
 v.addEventListener('play',()=>window.RP_ANALYTICS?.track('demo_started',{label:'how_it_works_video'}),{once:true});
 bs.forEach((b,i)=>b.addEventListener('click',()=>{const go=()=>{v.currentTime=ts[i];const p=v.play();if(p)p.catch(()=>{});mark();};if(v.readyState>=1)go();else{v.preload='auto';v.addEventListener('loadedmetadata',go,{once:true});v.load();}}));
})();

// "Three steps" explainer: a small light-theme timeline that plays Analyze Music -> Sync Cameras -> Auto Cut in a loop
// while it is on screen. Motion is CSS transitions switched by state classes; this only builds the bars and keeps time.
// Reduced motion: the finished state is shown, the tabs still switch the caption.
(()=>{
 const root=document.querySelector('[data-flow]');if(!root)return;
 const el=(tag,cls,style)=>{const x=document.createElement(tag);x.className=cls;if(style)x.style.cssText=style;return x;};
 const wave=root.querySelector('[data-flow-wave]'),cam=root.querySelector('[data-flow-cam]'),monitor=root.querySelector('[data-flow-monitor]'),cap=root.querySelector('[data-flow-caption]');
 const tabs=[...root.querySelectorAll('.flow-tabs button')],caps=[...cap.children];
 // Music: quiet intro, build-up, drop at 50 %, then full energy (64 bars, 8 beats).
 const N=64;for(let i=0;i<N;i++){const x=i/N,beat=i%8===0,h=x<.25?.22:x<.5?.22+(x-.25)*2.2:.78;const b=el('span','flow-bar'+(beat?' is-beat':''),'height:'+Math.round((beat?Math.min(1,h+.22):h*(.6+.4*Math.abs(Math.sin(i*1.7))))*100)+'%;transition-delay:'+(i*14)+'ms');wave.appendChild(b);}
 wave.appendChild(el('b','flow-drop','left:50%')).textContent='DROP';
 // Cameras: each track has one long clip (out of place until synced) and the shots Auto Cut keeps.
 const CUTS=[[0,12.5,1],[12.5,25,2],[25,37.5,1],[37.5,50,3],[50,62.5,2],[62.5,75,1],[75,87.5,3],[87.5,100,2]];
 [1,2,3].forEach((n)=>{const lane=root.querySelector('[data-flow-track="'+n+'"]');lane.appendChild(el('span','flow-clip c'+n));
  CUTS.forEach(([a,b,c],k)=>{if(c===n)lane.appendChild(el('span','flow-seg c'+n,'left:'+a+'%;width:'+(b-a)+'%;transition-delay:'+(k*70)+'ms'));});});
 const still=window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches;
 const DUR=[3400,3000,6200],SWEEP=5200;let step=0,timers=[],visible=false;
 const clear=()=>{timers.forEach(clearTimeout);timers=[];};
 const show=(n)=>{step=n;tabs.forEach((b,i)=>b.setAttribute('aria-pressed',String(i===n)));caps.forEach((c,i)=>{c.hidden=i!==n;});
  root.classList.toggle('is-analyzed',n>=0);root.classList.toggle('is-synced',n>=1);root.classList.toggle('is-cut',n>=2);
  monitor.dataset.cam='1';cam.textContent='CAM 1';
  if(n===2&&!still)CUTS.forEach(([a,,c])=>timers.push(setTimeout(()=>{monitor.dataset.cam=String(c);cam.textContent='CAM '+c;},SWEEP*a/100)));
  if(n===2&&still){monitor.dataset.cam='2';cam.textContent='CAM 2';}};
 const run=(n)=>{clear();if(n===0&&!still){root.classList.remove('is-analyzed','is-synced','is-cut');void root.offsetWidth;}show(n);
  if(!still&&visible)timers.push(setTimeout(()=>run((n+1)%3),DUR[n]));};
 tabs.forEach((b,i)=>b.addEventListener('click',()=>run(i)));
 if(still){show(2);return;}
 if('IntersectionObserver' in window)new IntersectionObserver((es)=>es.forEach((e)=>{const was=visible;visible=e.isIntersecting;if(visible&&!was)run(0);else if(!visible)clear();}),{threshold:.3}).observe(root);
 else{visible=true;run(0);}
 document.addEventListener('visibilitychange',()=>{if(document.hidden)clear();else if(visible)run(step);});
})();

// Feature tiles: each tile has a tiny two-state picture; one timer flips all of them while the grid is on screen.
(()=>{
 const g=document.querySelector('[data-feat-loop]');if(!g||!('IntersectionObserver' in window))return;
 if(window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches){g.classList.add('is-b');return;}
 let t=0;new IntersectionObserver((es)=>es.forEach((e)=>{clearInterval(t);if(e.isIntersecting)t=setInterval(()=>{if(!document.hidden)g.classList.toggle('is-b');},2200);}),{threshold:.15}).observe(g);
})();
