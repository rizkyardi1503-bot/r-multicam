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
document.querySelectorAll('[data-buy]').forEach(button => button.onclick = () => {
 const url = safeUrl(config.paymentUrl);
 message(url ? 'Continue to secure checkout' : 'Checkout is not open yet', url ? 'The license is US$200. Review the final billing amount, currency and purchase terms on Midtrans before paying. Use the email address linked to your plugin account.' : 'Online purchases are not available yet. Please check back when checkout opens. No payment or license activation has taken place.', url, 'Continue to Midtrans');
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
