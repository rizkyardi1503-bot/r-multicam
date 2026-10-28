'use strict';
(async()=>{
 const fragment=new URLSearchParams(location.hash.slice(1)),query=new URLSearchParams(location.search);
 let access=fragment.get('access_token');
 const error=fragment.get('error')||query.get('error'),code=fragment.get('error_code')||query.get('error_code'),type=fragment.get('type');
 const callback=!!(access||error||code),standalone=/^\/auth\/confirmed\/?$/.test(location.pathname);
 if(!callback&&!standalone)return;
 if(callback)history.replaceState(null,'',location.pathname);
 let title=document.getElementById('confirmation-title'),message=document.getElementById('confirmation-message');
 if(!title){const box=document.createElement('dialog');box.id='email-confirmation';box.innerHTML='<div class="dialog-top"><span class="eyebrow">ACCOUNT EMAIL</span><button aria-label="Close confirmation">✕</button></div><h2 id="confirmation-title"></h2><p id="confirmation-message" role="status"></p><a class="button" href="/?account=signin">Sign in</a><a class="button secondary" href="/?account=signin">Sign in to download</a><a class="button secondary" href="/help/">Get help</a>';document.body.appendChild(box);box.querySelector('button').onclick=()=>box.close();box.showModal();title=box.querySelector('h2');message=box.querySelector('p');}
 const show=(heading,text)=>{title.textContent=heading;message.textContent=text;};
 // Most people tap the confirmation email on their phone, but the plugin installs on a computer: say so, and offer
 // the website link to copy. No account data is involved; the link is the public homepage.
 const onPhone=/iPhone|iPad|iPod|Android/i.test(navigator.userAgent||'')||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
 function laptopStep(){if(!onPhone||document.getElementById('confirmation-copy'))return;const link=location.origin+'/?utm_source=handoff&utm_medium=confirm_email&utm_campaign=mobile_to_desktop';const b=document.createElement('button');b.id='confirmation-copy';b.type='button';b.className='button';b.textContent='Copy link for my laptop';
  b.onclick=async()=>{let ok=false;try{if(navigator.clipboard?.writeText){await navigator.clipboard.writeText(link);ok=true;}}catch{}
   if(!ok){try{const t=document.createElement('textarea');t.value=link;t.setAttribute('readonly','');t.style.position='fixed';t.style.opacity='0';document.body.appendChild(t);t.select();ok=document.execCommand('copy');t.remove();}catch{}}
   b.textContent=ok?'Link copied':link;window.RP_ANALYTICS?.track('trial_cta_clicked',{label:'mobile_handoff',method:ok?'copy':'copy_failed',entry_point:'email_confirmed'});};
  message.after(b);}
 if(error||code){show('This email link could not be used.','The link may have expired or already been used. Sign in if you already confirmed your email, or request a new email from the website or plugin.');return;}
 if(!access){show('Thank you for choosing R Project Multicam AI!',onPhone?'The plugin installs on your laptop or PC. Open r-multicam.pages.dev there, sign in, download the plugin and sign in inside Premiere. If you still need confirmation, open the link from your inbox or request a new email.':'Download the plugin and sign in inside Premiere after confirming your email. If you still need confirmation, open the link from your inbox or request a new email.');laptopStep();return;}
 const cfg=window.RP_CONFIG;
 async function authRequest(path,options={}){const response=await fetch(cfg.supabaseUrl+path,{...options,headers:{apikey:cfg.supabasePublishableKey,Authorization:'Bearer '+access,'Content-Type':'application/json'},signal:AbortSignal.timeout(15000)});const data=await response.json().catch(()=>({}));if(!response.ok)throw Error(data.msg||data.message||data.error_description||data.error||'The account request failed.');return data;}
 try{
  show('Checking your email link…','Please wait while we check your account.');
  const user=await authRequest('/auth/v1/user');
  if(!user.id)throw Error('Invalid email link.');
  if(type==='recovery'){
   show('Choose your new password.','Use at least 8 characters. After saving, sign in again on the website or in Premiere.');
   const form=document.createElement('form');form.innerHTML='<label for="recovery-password">New password</label><input id="recovery-password" type="password" autocomplete="new-password" minlength="8" required><label for="recovery-confirm">Confirm new password</label><input id="recovery-confirm" type="password" autocomplete="new-password" minlength="8" required><button class="button" type="submit">Save new password</button>';
   message.after(form);let pending=false;
   form.onsubmit=async event=>{event.preventDefault();if(pending)return;const password=form.querySelector('#recovery-password').value,confirm=form.querySelector('#recovery-confirm').value;if(password.length<8||password!==confirm){show('Check your new password.','Use at least 8 characters and enter the same password twice.');return;}pending=true;const submit=form.querySelector('button');submit.disabled=true;try{await authRequest('/auth/v1/user',{method:'PUT',body:JSON.stringify({password})});access=null;form.reset();form.remove();show('Your password is updated.','Return to the website or Premiere and sign in with your new password.');}catch(e){show('Password could not be updated.',e.message);}finally{pending=false;submit.disabled=false;}};
   return;
  }
  if(type&&type!=='signup'){access=null;show('Return to your account.','This page handles signup confirmation and password reset. Contact support if you need another account action.');return;}
  if(!user.email_confirmed_at)throw Error('Email is not confirmed.');access=null;
  show('Thank you! Your email is confirmed.',onPhone?'Next step on your laptop or PC: open r-multicam.pages.dev, sign in with this email and download the Windows or macOS installer. Your 7-day trial starts on first plugin activation.':'Sign in on the website to unlock the Windows or macOS installer, then sign in inside Premiere using the same account. Your 7-day trial starts on first plugin activation.');laptopStep();
 }catch(e){access=null;show('Please check your account.', 'This link could not be verified. Request a new email or try signing in if you already confirmed your email.');}
})();
