'use strict';
const config = window.RP_CONFIG || {};
const notice = document.querySelector('#notice');
function safeUrl(value) { try { const url = new URL(value); return url.protocol === 'https:' ? url.href : null; } catch { return null; } }
function message(title, body, url, label) {
 document.querySelector('#notice-title').textContent = title;
 document.querySelector('#notice-body').textContent = body;
 const link = document.querySelector('#notice-link'); const valid = safeUrl(url);
 link.hidden = !valid; if(valid) {link.href = valid; link.textContent = label; link.rel = 'noopener noreferrer';link.target = '_blank';} else link.removeAttribute('href');
 notice.showModal();
}
document.querySelector('#close-notice').onclick = () => notice.close();
document.querySelector('#notice-done').onclick = () => notice.close();
if (config.checkoutOpen !== true) document.querySelectorAll('[data-buy]').forEach(button => { button.hidden = true; });
document.querySelectorAll('[data-buy]').forEach(button => button.onclick = () => {
 const url = safeUrl(config.paymentUrl);
 message(url ? 'Continue to secure checkout' : 'Checkout is not open yet', url ? 'The displayed license price is '+(window.RPPrice?.label()||'Rp2.000.000')+'. Review the final billing amount, currency and purchase terms on Midtrans before paying. Use the email address linked to your plugin account.' : 'Online purchases are not available yet. Please check back when checkout opens. No payment or license activation has taken place.', url, 'Continue to Midtrans');
});
document.querySelectorAll('[data-account]').forEach(button => button.onclick = () => message('Your Multicam AI license', 'You can check your current license by signing in to the Multicam AI panel inside Premiere. '+(safeUrl(config.customerPortalUrl) ? 'Open the customer portal to manage your account.' : 'The website customer portal is not available yet.'), config.customerPortalUrl, 'Open customer portal'));
document.querySelectorAll('[data-download]').forEach(button => button.onclick = () => {
 message('Account required to download', 'Sign in or create a free R Project account first. After your email is confirmed, sign in to download the Windows or macOS installer.', null);
});
const waveform = document.querySelector('#waveform');
for(let i=0;i<72;i++){const bar=document.createElement('span');bar.style.height=(18+Math.abs(Math.sin(i*1.3)*Math.cos(i*.37))*75)+'%';waveform.appendChild(bar);}
let timer=null, beat=0;
const play=document.querySelector('#play-demo'), pace=document.querySelector('#pacing');
function render(){const camera=[0,2,1,3][Math.floor(beat/Number(pace.value))%4];document.querySelector('#camera-number').textContent=String(camera+1).padStart(2,'0');document.querySelector('#camera-role').textContent=['WIDE SHOT','CLOSE-UP','SIDE ANGLE','DETAIL SHOT'][camera];document.querySelector('#beat-counter').textContent=String(Math.floor(beat/4)+1).padStart(2,'0')+' : '+String(beat%4+1).padStart(2,'0');document.querySelector('#playhead').style.left=(7+beat/16*90)+'%';}
play.onclick=()=>{if(timer){clearInterval(timer);timer=null;play.textContent='Play illustration';}else{play.textContent='Pause illustration';timer=setInterval(()=>{beat=(beat+1)%16;render();},400);}};
pace.onchange=()=>{document.querySelector('#pace-label').textContent=pace.value+' BEATS / CUT';render();};
document.addEventListener('visibilitychange',()=>{if(document.hidden&&timer){clearInterval(timer);timer=null;play.textContent='Play illustration';}});
render();

// Homepage edit showcase: tap for sound (restarts from the top), pause when off-screen, no autoplay with reduced
// motion. The shot timeline follows the video: playhead, highlighted shot and angle; tapping a shot seeks to it.
(()=>{
 const fig=document.querySelector('.edit-show'),v=fig&&fig.querySelector('.promo-video'),b=fig&&fig.querySelector('.promo-sound');if(!v)return;
 const still=window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches;if(still){v.removeAttribute('autoplay');v.pause();v.controls=true;}
 if(b)b.addEventListener('click',()=>{const on=v.muted;v.muted=!on;if(on){v.currentTime=0;v.play().catch(()=>{});}b.setAttribute('aria-pressed',String(on));b.querySelector('.promo-sound-on').hidden=on;b.querySelector('.promo-sound-off').hidden=!on;window.RP_ANALYTICS?.track('demo_started',{label:on?'promo_video_sound_on':'promo_video_sound_off'});});
 if(!still&&'IntersectionObserver' in window)new IntersectionObserver((es)=>es.forEach((e)=>{if(e.isIntersecting)v.play().catch(()=>{});else v.pause();}),{threshold:.2}).observe(v);
 const shots=[...fig.querySelectorAll('.edit-shot')],head=fig.querySelector('.edit-head-line'),track=fig.querySelector('.edit-track'),now=fig.querySelector('[data-edit-now]'),count=fig.querySelector('[data-edit-count]'),legend=[...fig.querySelectorAll('.edit-legend li')];
 let labels={};try{labels=JSON.parse(fig.dataset.labels||'{}');}catch(e){}
 const end=Number(shots[shots.length-1]?.dataset.end)||v.duration||1;let cur=-1;
 const draw=()=>{const t=v.currentTime||0;head.style.transform='translateX('+(track.clientWidth*Math.min(1,t/end))+'px)';const i=shots.findIndex((s)=>t>=+s.dataset.start&&t<+s.dataset.end);if(i>=0&&i!==cur){cur=i;const a=shots[i].dataset.angle;shots.forEach((s,k)=>s.classList.toggle('is-on',k===i));legend.forEach((l)=>l.classList.toggle('is-on',l.dataset.angle===a));now.textContent=labels[a]||a;count.textContent=fig.dataset.shotWord+' '+(i+1)+' '+fig.dataset.ofWord+' '+shots.length;}};
 const loop=()=>{draw();if(!v.paused)requestAnimationFrame(loop);};
 v.addEventListener('play',()=>requestAnimationFrame(loop));v.addEventListener('seeked',draw);v.addEventListener('timeupdate',draw);draw();if(!v.paused)requestAnimationFrame(loop);
 shots.forEach((s,i)=>s.addEventListener('click',()=>{v.currentTime=+s.dataset.start+0.02;v.play().catch(()=>{});draw();window.RP_ANALYTICS?.track('demo_started',{label:'edit_show_shot_'+(i+1)});}));
})();
