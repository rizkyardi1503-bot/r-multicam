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

// Feature tiles: one choreographed loop per tile over its illustration (Web Animations), replayed every LOOP ms
// while the grid is on screen and stopped when it leaves. Reduced motion or no Web Animations: the still pictures stay.
(()=>{
 const g=document.querySelector('[data-feat-loop]');if(!g||!g.animate||!('IntersectionObserver' in window))return;
 if(window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches)return;
 const LOOP=6400,IO='cubic-bezier(.65,0,.35,1)',OUT='cubic-bezier(.22,1,.36,1)';
 const $=(s,r)=>(r||g).querySelector(s),$$=(s,r)=>[...(r||g).querySelectorAll(s)];
 const run=[];const anim=(el,k,o)=>{if(el)run.push(el.animate(k,Object.assign({fill:'both',easing:IO},o)));};
 const sweep=(head,from,to,dur,delay)=>anim(head,[{left:from+'%',opacity:0},{opacity:1,offset:.06},{opacity:1,offset:.94},{left:to+'%',opacity:0}],{duration:dur,delay:delay||0,easing:'linear'});
 const tiles={
  map(t){const D=3600;sweep($('.fx-head',t),2,98,D,300);
   anim($('.fx-lit',t),[{clipPath:'inset(0 98% 0 0)',opacity:1},{clipPath:'inset(0 2% 0 0)',opacity:1,offset:.82},{clipPath:'inset(0 2% 0 0)',opacity:0}],{duration:D+1400,delay:300,easing:'linear'});
   anim($('.fx-bloom',t),[{transform:'translate(-50%,-50%) scale(.4)',opacity:0},{transform:'translate(-50%,-50%) scale(1.1)',opacity:1,offset:.3},{transform:'translate(-50%,-50%) scale(1.7)',opacity:0}],{duration:1700,delay:300+D*.5-150,easing:OUT});},
  sync(t){anim($('img',t),[{transform:'translateY(0)'},{transform:'translateY(-3px)'},{transform:'translateY(0)'}],{duration:LOOP-200});
   $$('.fx-ray',t).forEach((r,k)=>{const from=parseFloat(r.style.top),to=parseFloat(r.dataset.to)-14,d=700+k*180;
    anim(r,[{top:from+'%',opacity:0},{opacity:1,offset:.2},{top:to+'%',opacity:1,offset:.85},{top:to+'%',opacity:0}],{duration:1100,delay:d});
    anim($$('.fx-ring',t)[k],[{transform:'scale(.4)',opacity:0},{transform:'scale(1)',opacity:1,offset:.2},{transform:'scale(3.2)',opacity:0}],{duration:1200,delay:d+900,easing:OUT});});},
  cut(t){const D=3000,A=3,Z=95.8,head=$('.fx-head',t),ps=$$('.fx-piece',t);sweep(head,A,Z,D,300);
   $$('.fx-blade',t).forEach((b,k)=>{const at=300+D*(parseFloat(b.style.left)-A)/(Z-A);
    anim(b,[{transform:'scaleY(0)',opacity:0},{transform:'scaleY(1)',opacity:1,offset:.25},{transform:'scaleY(1)',opacity:.9,offset:.6},{transform:'scaleY(.2)',opacity:0}],{duration:700,delay:at-120,easing:OUT});
    anim(ps[k+1],[{transform:'translateY(0)'},{transform:'translateY(-6px)',offset:.35},{transform:'translateY(0)'}],{duration:620,delay:at,easing:OUT});});},
  roles(t){const ps=$$('.fx-piece',t),live=$('.fx-live',t),X=['17.6%','49.9%','82.2%'],seq=[0,1,2,1],hold=LOOP/seq.length,n=seq.length;
   const frames=(i)=>seq.map((s,k)=>[{offset:k/n,v:s===i},{offset:(k+.82)/n,v:s===i}]).flat();
   ps.forEach((p,i)=>anim(p,frames(i).map((f)=>({offset:f.offset,transform:f.v?'scale(1.05)':'scale(.96)',opacity:f.v?1:.42,filter:f.v?'saturate(1)':'saturate(.5)'})).concat([{offset:1,transform:seq[0]===i?'scale(1.05)':'scale(.96)',opacity:seq[0]===i?1:.42,filter:seq[0]===i?'saturate(1)':'saturate(.5)'}]),{duration:LOOP,easing:IO}));
   anim(live,seq.map((s,k)=>[{offset:k/n,left:X[s],opacity:1},{offset:(k+.82)/n,left:X[s],opacity:1}]).flat().concat([{offset:1,left:X[seq[0]],opacity:1}]),{duration:LOOP,easing:IO});},
  drops(t){const v=t.closest('.feat-viz'),fr=$('.vz-frame',v),cards=$$('.fx-card',v),box=v.getBoundingClientRect(),f=fr.getBoundingClientRect();
   $$('.fx-glow',t).forEach((gl,k)=>{anim(gl,[{transform:'translate(-50%,-50%) scale(.6)',opacity:0},{transform:'translate(-50%,-50%) scale(1)',opacity:1,offset:.4},{transform:'translate(-50%,-50%) scale(1.15)',opacity:0}],{duration:1400,delay:200+k*350,easing:OUT});
    const r=gl.getBoundingClientRect(),sx=r.left+r.width/2-box.left-17,sy=r.top+r.height/2-box.top-11,ex=f.left+f.width/2-box.left-17,ey=f.top+f.height/2-box.top-11,mx=(sx+ex)/2,my=Math.min(sy,ey)-28;
    anim(cards[k],[{transform:`translate(${sx}px,${sy}px) scale(.5)`,opacity:0},{transform:`translate(${sx}px,${sy-8}px) scale(1)`,opacity:1,offset:.2},{transform:`translate(${mx}px,${my}px) scale(1)`,opacity:1,offset:.6},{transform:`translate(${ex}px,${ey}px) scale(.7)`,opacity:0}],{duration:1500,delay:600+k*350});});
   anim($('i',fr),[{transform:'scale(1)'},{transform:'scale(1)',offset:.3},{transform:'scale(1.16)',offset:.92},{transform:'scale(1)'}],{duration:LOOP-100,easing:'cubic-bezier(.45,0,.55,1)'});
   $$('b',fr).forEach((b,k)=>{const dx=k%2?-6:6,dy=k<2?6:-6;anim(b,[{transform:'translate(0,0)'},{transform:'translate(0,0)',offset:.3},{transform:`translate(${dx}px,${dy}px)`,offset:.92},{transform:'translate(0,0)'}],{duration:LOOP-100,easing:'cubic-bezier(.45,0,.55,1)'});});},
  lut(t){const K=[[0,12],[.42,88],[.62,88],[1,60]],o={duration:LOOP-200,easing:IO};
   anim($('b',t),K.map(([offset,x])=>({offset,clipPath:`inset(0 ${100-x}% 0 0)`})),o);
   anim($('.fx-divider',t),K.map(([offset,x])=>({offset,left:x+'%'})),o);
   anim($('p span i',t),K.map(([offset,x])=>({offset,width:x+'%'})),o);}
 };
 const order=[['.fx-map','map'],['.fx-sync','sync'],['.fx-cut','cut'],['.fx-roles','roles'],['.fx-drops','drops'],['.v-lut','lut']];
 let timer=0;
 const stop=()=>{clearTimeout(timer);run.splice(0).forEach((a)=>a.cancel());};
 const cycle=()=>{stop();order.forEach(([sel,name])=>{const t=$(sel);if(t)try{tiles[name](t);}catch(e){}});timer=setTimeout(cycle,LOOP);};
 let on=false;
 new IntersectionObserver((es)=>es.forEach((e)=>{if(e.isIntersecting&&!on){on=true;cycle();}else if(!e.isIntersecting&&on){on=false;stop();}}),{threshold:.12}).observe(g);
 document.addEventListener('visibilitychange',()=>{if(document.hidden)stop();else if(on)cycle();});
})();
