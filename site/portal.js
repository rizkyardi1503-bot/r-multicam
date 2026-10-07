'use strict';
(() => {
 if(window.RP_PLUGIN_GOOGLE_ACTIVE)return;
 const cfg=window.RP_CONFIG;
 // Google uses PKCE; only the temporary verifier is kept in this tab.
 const GOOGLE_FLOW_KEY='rp_google_pkce_v1';
 const callbackParams=new URLSearchParams(window.location.search);
 const callbackHash=new URLSearchParams((window.location.hash||'').replace(/^#/,''));
 let googleCallback=null;
 if(callbackParams.has('code')){
  googleCallback={code:callbackParams.get('code')};
 }else if(callbackParams.get('oauth')==='google'&&(callbackParams.has('error')||callbackHash.has('error'))){
  googleCallback={error:true};
 }
 if(googleCallback)history.replaceState(null,'',window.location.pathname);
 const SESSION_KEY='rp_multicam_refresh_v1';
 const LATEST_VERSIONS=Object.freeze({windows:'2.3.11.0',macos:'2.3.11.1'});
 const newerVersion=(installed,latest)=>{const a=String(installed).split('.').map(Number),b=latest.split('.').map(Number);if(a.length!==b.length||a.some(n=>!Number.isFinite(n)))return false;for(let i=0;i<b.length;i++){if(b[i]!==a[i])return b[i]>a[i];}return false;};
 let session=null, user=null, profile=null, busy=false, generation=0, refreshFlight=null, authMode="signin", purchaseIntent=false, downloadIntent=null;
 let affiliateIntent=window.location.pathname==='/affiliate/', affiliateUI=null;
 const promoFromLink=new URLSearchParams(window.location.search).get('ref')||'';
 const portal=document.createElement('dialog'); portal.id='customer-portal';portal.setAttribute('aria-labelledby','customer-portal-title');
 portal.innerHTML=`<div class="dialog-top"><span class="eyebrow">CUSTOMER ACCOUNT</span><button data-close aria-label="Close account">✕</button></div>
 <h2 id="customer-portal-title">Your Multicam AI.</h2><p>Create an account here or sign in with your existing plugin account.</p><div id="auth-options" class="auth-options"><button id="mode-signin" type="button" class="button secondary" aria-pressed="true">Sign in</button><button id="mode-signup" type="button" class="button secondary" aria-pressed="false">Create account</button></div><p id="auth-guide" class="subtle">Already using the plugin? Use the same email and password.</p>
 <div id="google-auth"><button id="google-signin" class="button full" type="button" style="display:flex;align-items:center;justify-content:center;gap:12px;background:#fff;color:#1f1f1f;border:1px solid #747775;border-radius:999px;min-height:44px;font-size:14px;font-weight:500;letter-spacing:0;text-transform:none"><img src="https://developers.google.com/static/identity/images/g-logo.png" width="20" height="20" alt="" aria-hidden="true" style="width:20px;height:20px;flex:0 0 20px;object-fit:contain"><span>Continue with Google</span></button><p class="subtle">Or use email and password below. Use the same email as your existing account.</p></div>
 <form id="login-form"><label for="account-email">Email</label><input id="account-email" type="email" autocomplete="username" required><label for="account-password">Password</label><input id="account-password" type="password" autocomplete="current-password" required><div id="confirm-password-group" hidden><label for="account-confirm-password">Confirm password</label><input id="account-confirm-password" type="password" autocomplete="new-password"></div><button id="auth-submit" class="button full" type="submit">Sign in</button></form>
 <div id="email-help"><button class="text-button" id="resend-confirmation" type="button">Resend confirmation email</button><button class="text-button" id="forgot-password" type="button">Forgot password?</button></div>
 <div id="account-details" hidden><p id="signed-in-email"></p><div class="license-box"><span class="eyebrow">ACCOUNT OVERVIEW</span><strong id="account-summary"></strong><p id="trial-summary"></p><p id="version-summary"></p></div><div class="license-box"><span class="eyebrow">LICENSE STATUS</span><strong id="license-state"></strong><p id="license-detail"></p></div><div class="actions"><button class="button" id="account-purchase">Buy lifetime · <b data-rp-price style="font:inherit">Rp3.575.000</b></button><button class="button secondary" id="check-payment">Check payment</button><button class="button secondary" id="refresh-license">Refresh license</button></div><div id="google-plugin-help" hidden><p class="subtle">Plugin v2.3.11.0 includes Continue with Google. Email/password remains optional for this same account. Never enter your Google password in the plugin.</p><button id="google-password-email" class="button secondary" type="button">Set up plugin password by email</button></div><h3>Your active plugin</h3><div id="device-details" class="license-box"></div><h3>Downloads & help</h3><div class="actions"><button class="button secondary" id="download-windows" type="button">Download Windows</button><button class="button secondary" id="download-macos" type="button">Download macOS</button><a class="button secondary" href="/help/">Open help center</a><a class="button secondary" href="/releases/">Release notes</a></div><h3>Promo code</h3><label for="promo-code">Optional affiliate code · 10% off</label><input id="promo-code" type="text" maxlength="40" autocomplete="off"><p class="subtle">The server checks the code before creating your order. Remove it to pay the standard price.</p><button class="button secondary" id="account-affiliate" type="button">Affiliate dashboard</button><section id="affiliate-dashboard" hidden></section><h3>Recent orders</h3><div id="orders-list"></div><button class="text-button" id="account-signout">Sign out of website</button></div>
 <p id="account-message" role="status" aria-live="polite"></p>
 <div id="checkout-confirm" hidden><h3>Review your checkout</h3><p id="checkout-amount"></p><p id="checkout-rate" class="subtle"></p><a class="button" id="checkout-link" target="_blank" rel="noopener noreferrer">Open Midtrans checkout</a><p class="subtle">The standard lifetime price is fixed at Rp3.575.000. Approved affiliate codes can reduce the amount before the order is created.</p><p class="subtle">After paying, return here and click Check payment. Your license is activated only after server verification.</p></div>`;
 document.body.appendChild(portal);
 const el=id=>portal.querySelector('#'+id);
 el('promo-code').value=/^[a-z0-9]{3,40}$/i.test(promoFromLink)?promoFromLink.toUpperCase():'';
 if(window.RP_Affiliate)affiliateUI=window.RP_Affiliate.create(el('affiliate-dashboard'),authed);
 const say=(text,error=false)=>{el('account-message').textContent=text;el('account-message').classList.toggle('error',error);};
 function show(){if(!portal.open)portal.showModal();}
 function controls(){portal.querySelectorAll('button:not([data-close])').forEach(b=>{if(!b.closest('#affiliate-dashboard'))b.disabled=busy;});}
 function friendly(error){const m=String(error.message||error);if(error.name==='TimeoutError'||error.name==='AbortError')return 'The request took too long. Check your connection and try again.';if(/failed to fetch|networkerror|load failed/i.test(m))return 'Connection unavailable. Check your internet connection and try again.';if(/invalid login credentials/i.test(m))return 'Email or password is incorrect.';if(/email not confirmed/i.test(m))return 'Confirm your email before signing in. Use Resend confirmation email if needed.';if(/email rate limit|over_email_send_rate_limit|over_request_rate_limit|too many requests/i.test(m))return 'Too many email requests. Wait a few minutes and try once, or contact support.';if(/email address not authorized|email_address_not_authorized/i.test(m))return 'Email delivery is not available for this address yet. Contact R Project support.';if(/PRODUCTION_NOT_CONFIGURED|SERVER_NOT_CONFIGURED/i.test(m))return 'Checkout is temporarily unavailable. Please try again later.';return m;}
 async function run(action){if(busy)return;busy=true;controls();say('Please wait…');try{await action();}catch(error){say(friendly(error),true);}finally{busy=false;controls();}}
 async function request(path,{method='GET',body,token}={}){
  const headers={apikey:cfg.supabasePublishableKey,'Content-Type':'application/json'};if(token)headers.Authorization='Bearer '+token;
  const res=await fetch(cfg.supabaseUrl+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(30000)});
  const data=await res.json().catch(()=>({}));if(!res.ok){const e=new Error(data.msg||data.error_description||data.error||data.message||'Request failed ('+res.status+').');e.status=res.status;throw e;}return data;
 }
 function persistSession(){try{if(session?.refresh_token)localStorage.setItem(SESSION_KEY,JSON.stringify({refresh_token:session.refresh_token}));}catch{}}
 function clearStoredSession(){try{localStorage.removeItem(SESSION_KEY);}catch{}}
 async function token(){if(!session)throw Error('Sign in first.');if(session.expires_at>Date.now()/1000+60)return session.access_token;
  if(!refreshFlight){const current=generation;refreshFlight=request('/auth/v1/token?grant_type=refresh_token',{method:'POST',body:{refresh_token:session.refresh_token}}).then(next=>{if(current!==generation)throw Error('Session changed. Please sign in again.');session={...next,expires_at:Date.now()/1000+(next.expires_in||3600)};persistSession();return session.access_token;}).finally(()=>{refreshFlight=null;});}return refreshFlight;
 }
 async function authed(path,options={}){return request(path,{...options,token:await token()});}
 async function downloadRelease(platform){
  if(platform!=='windows'&&platform!=='macos')throw Error('Choose Windows or macOS.');
  if(!user)throw Error('Sign in first.');
  const access=await token();
  window.RP_ANALYTICS?.track('download_requested',{platform},access);
  const res=await fetch(cfg.supabaseUrl+(cfg.websiteDownloadPath||'/functions/v1/website-download')+'?platform='+encodeURIComponent(platform),{
   method:'GET',
   headers:{apikey:cfg.supabasePublishableKey,Authorization:'Bearer '+access},
   signal:AbortSignal.timeout(60000)
  });
  if(!res.ok){if(res.status===401)throw Error('Your session has expired. Sign out and sign in again to download.');if(res.status===403)throw Error('Confirm your email before downloading.');throw Error('The installer is temporarily unavailable. Please try again or contact support.');}
  const blob=await res.blob();
  const signature=new Uint8Array(await blob.slice(0,4).arrayBuffer());
  if(signature[0]!==0x50||signature[1]!==0x4b||signature[2]!==0x03||signature[3]!==0x04)throw Error('The server returned an invalid installer. Please try again or contact support.');
  const disposition=res.headers.get('content-disposition')||'';
  const match=/filename="?([^";]+)"?/i.exec(disposition);
  const filename=match?.[1]||('R-Project-Multicam-AI-'+(platform==='macos'?'macOS':'Windows')+'-PUBLIC.zip');
  const objectUrl=URL.createObjectURL(blob);
  const a=document.createElement('a');a.href=objectUrl;a.download=filename;a.style.display='none';document.body.appendChild(a);a.click();a.remove();
  window.RP_ANALYTICS?.track('download_started',{platform,filename},access);
  setTimeout(()=>URL.revokeObjectURL(objectUrl),60000);
  say((platform==='macos'?'macOS':'Windows')+' download started. Save your Premiere project and close Premiere before installing.');
 }
 function render(){document.querySelectorAll('[data-login]').forEach(b=>b.textContent=user?'My account':'Login');el('google-auth').hidden=!!user;el('google-plugin-help').hidden=!user?.identities?.some(identity=>identity.provider==='google');el('login-form').hidden=!!user;el('auth-options').hidden=!!user;el('email-help').hidden=!!user;el('auth-guide').hidden=!!user;el('account-details').hidden=!user;if(!user)return;el('signed-in-email').textContent='Signed in as '+user.email;
  const expired=profile?.license_status==='trial'&&profile?.trial_expires_at&&Date.parse(profile.trial_expires_at)<=Date.now();
  const status=expired?'expired':profile?.license_status||'not activated';el('license-state').textContent=status.toUpperCase();
  el('license-detail').textContent=status==='lifetime'?'Your account has a lifetime license. Sign in to the plugin with this account.':status==='trial'?profile.trial_expires_at?'Trial ends '+new Date(profile.trial_expires_at).toLocaleString()+'.':'Trial is ready and begins on first plugin activation.':status==='expired'?'Your free trial has ended. Lifetime access remains available as a one-time purchase.':profile?'Buy a lifetime license to continue using Multicam AI.':'Your account is ready. Your 7-day trial begins on first plugin activation.';
  let trialText='Trial has not started yet. It begins on first plugin activation.';
  if(status==='lifetime')trialText='Lifetime access is active.';
  else if(status==='expired')trialText='Trial expired.';
  else if(status==='trial'&&profile?.trial_expires_at){const ms=Math.max(0,Date.parse(profile.trial_expires_at)-Date.now());const hours=Math.ceil(ms/3600000);trialText=hours>24?'Trial remaining: '+Math.ceil(hours/24)+' days.':'Trial remaining: '+hours+' hours.';}
  el('account-summary').textContent=status==='lifetime'?'Lifetime customer':status==='expired'?'Trial ended':'Multicam AI account';
  el('trial-summary').textContent=trialText;
  const installed=profile?.plugin_version?String(profile.plugin_version):'not connected';
  const devicePlatform=String(profile?.device_platform||'').toLowerCase();
  const latest=devicePlatform==='macos'||devicePlatform==='darwin'?LATEST_VERSIONS.macos:devicePlatform==='windows'||devicePlatform==='win32'?LATEST_VERSIONS.windows:null;
  el('version-summary').textContent='Installed plugin: '+(installed==='not connected'?installed:'v'+installed)+' · Latest public: '+(latest?'v'+latest:'Windows v'+LATEST_VERSIONS.windows+' / macOS v'+LATEST_VERSIONS.macos)+(installed!=='not connected'&&latest&&newerVersion(installed,latest)?' · Update available.':'');
  el('account-purchase').hidden=status==='lifetime'||status==='blocked';
  el('device-details').textContent=profile?.plugin_version?String(profile.device_platform||'Plugin')+' · v'+profile.plugin_version+' · Last seen '+(profile.last_active_at?new Date(profile.last_active_at).toLocaleString():'not available')+'. One plugin device can be active at a time. Sign in on the new device to switch.':'No plugin installation connected yet. Download the installer and sign in inside Premiere. Your 7-day trial begins on first plugin activation.';
 }
 async function loadAccount(){const epoch=generation,account=user?.id;if(!account)return;const [rows,orders]=await Promise.all([
 authed('/rest/v1/plugin_profiles?select=license_status,trial_started_at,trial_expires_at,lifetime_activated_at,device_platform,plugin_version,last_active_at&user_id=eq.'+encodeURIComponent(account)),
 authed('/rest/v1/plugin_payment_orders?select=order_id,status,charge_currency,gross_amount_idr,created_at&user_id=eq.'+encodeURIComponent(account)+'&order=created_at.desc&limit=5')]);
 if(epoch!==generation||user?.id!==account)return;profile=rows[0]||null;render();
  el('orders-list').replaceChildren();if(!orders.length)el('orders-list').textContent='No orders yet.';
  for(const order of orders){const row=document.createElement('p');row.className='order-row';row.textContent=order.status+' · '+order.charge_currency+' '+Number(order.gross_amount_idr).toLocaleString()+' · '+new Date(order.created_at).toLocaleDateString();el('orders-list').appendChild(row);}
  if(affiliateIntent&&affiliateUI)await affiliateUI.refresh();
 }
 async function purchase(){if(!user){say('Create an account or sign in to continue to checkout.');return;}await loadAccount();if(profile?.license_status==='blocked')throw Error('This account cannot purchase. Please contact support.');if(profile?.license_status==='lifetime'){say('Your lifetime license is already active.');return;}
  el('checkout-confirm').hidden=true;
  window.RP_ANALYTICS?.track('checkout_started',{price_idr:3575000,promo_code_used:!!el('promo-code').value.trim()},session?.access_token||null);
  const data=await authed('/functions/v1/create-lifetime-checkout',{method:'POST',body:{promo_code:el('promo-code').value.trim()}});
  if(data.charge_currency!=='IDR'||!Number.isSafeInteger(Number(data.gross_amount_idr))||Number(data.gross_amount_idr)<=0)throw Error('Checkout returned an invalid payment amount. Please contact support.');
  const url=new URL(data.checkout_url);if(url.protocol!=='https:'||url.hostname!=='app.midtrans.com')throw Error('The payment server returned an unexpected checkout address.');
  el('checkout-amount').textContent='Lifetime license · '+data.charge_currency+' '+Number(data.gross_amount_idr).toLocaleString('id-ID')+(data.discount_percent?' · '+data.discount_percent+'% affiliate discount applied':'')+'. Review this final amount before paying on Midtrans.';
  el('checkout-rate').textContent='Displayed lifetime price: '+(window.RPPrice?.label()||'Rp3.575.000')+' one-time. Midtrans charges the verified amount above in IDR. No recurring plugin subscription.';
  el('checkout-link').href=url.href;el('checkout-confirm').hidden=false;window.RP_ANALYTICS?.track('checkout_created',{amount_idr:Number(data.gross_amount_idr)},session?.access_token);say('Checkout is ready. No payment has been taken. Review the final IDR amount on Midtrans.');await loadAccount();
 }
 async function startGoogle(){
  try{sessionStorage.removeItem('rp_plugin_google_v1');}catch{}
  if(window.location.origin!=='https://r-multicam.pages.dev')throw Error('Google login is available on the official R Project website.');
  if(!crypto?.subtle)throw Error('Google login requires a secure browser with Web Crypto support.');
  const settings=await request('/auth/v1/settings');
  if(!settings.external?.google)throw Error('Google login is temporarily unavailable. Use email and password.');
  const verifier=Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier));
  const challenge=btoa(String.fromCharCode(...new Uint8Array(digest))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  try{sessionStorage.setItem(GOOGLE_FLOW_KEY,JSON.stringify({verifier,createdAt:Date.now(),purchaseIntent,downloadIntent,affiliateIntent,promo:el('promo-code').value}));}
  catch{throw Error('Allow session storage in this browser to continue with Google, or use email and password.');}
  const params=new URLSearchParams({provider:'google',redirect_to:'https://r-multicam.pages.dev/?oauth=google',code_challenge:challenge,code_challenge_method:'s256'});
  // Navigate, rather than fetch: Auth responds with a 302 to Google's consent page.
  try{window.location.assign(cfg.supabaseUrl+'/auth/v1/authorize?'+params);}
  catch(error){sessionStorage.removeItem(GOOGLE_FLOW_KEY);throw error;}
 }
 async function finishGoogle(){
  let pending=null;
  try{pending=JSON.parse(sessionStorage.getItem(GOOGLE_FLOW_KEY)||'null');sessionStorage.removeItem(GOOGLE_FLOW_KEY);}catch{}
  show();
  if(googleCallback.error)throw Error('Google sign-in was cancelled or could not be completed. Try again or use email and password.');
  if(!pending||typeof pending.createdAt!=='number'||Date.now()-pending.createdAt>600000||pending.createdAt>Date.now()||!/^[0-9a-f]{64}$/.test(pending.verifier||'')||!googleCallback.code)throw Error('Google sign-in expired or belongs to another browser tab. Click Continue with Google again.');
  const data=await request('/auth/v1/token?grant_type=pkce',{method:'POST',body:{auth_code:googleCallback.code,code_verifier:pending.verifier}});
  if(!data.access_token||!data.refresh_token)throw Error('Google did not return a valid session. Try signing in again.');
  // Discard provider tokens: the website only needs its Supabase session.
  await acceptSession({access_token:data.access_token,refresh_token:data.refresh_token,expires_in:data.expires_in});
  el('promo-code').value=/^[a-z0-9]{3,40}$/i.test(pending.promo||'')?pending.promo.toUpperCase():'';
  affiliateIntent=!!pending.affiliateIntent;
  if(affiliateIntent&&affiliateUI)await affiliateUI.refresh();
  window.RP_ANALYTICS?.track('login_success',{method:'google'},session.access_token);
  say(pending.purchaseIntent?'Signed in with Google. Click Buy lifetime to continue to checkout.':'Signed in with Google. You can download the installer and manage your license. Plugin v2.3.11.0 supports Continue with Google directly.');
  if(pending.downloadIntent==='windows'||pending.downloadIntent==='macos')await downloadRelease(pending.downloadIntent);
 }
 el('google-signin').onclick=()=>run(startGoogle);
 el('google-password-email').onclick=()=>run(async()=>{if(!user?.email)throw Error('Sign in first.');el('account-email').value=user.email;await sendAccountEmail('recovery');});
 portal.querySelector('[data-close]').onclick=()=>portal.close();
 function setMode(mode){authMode=mode;el('account-password').value='';el('account-confirm-password').value='';el('confirm-password-group').hidden=mode!=='signup';el('account-confirm-password').required=mode==='signup';el('account-password').minLength=mode==='signup'?8:1;el('account-password').autocomplete=mode==='signup'?'new-password':'current-password';el('auth-submit').textContent=mode==='signup'?'Create account':'Sign in';el('mode-signin').setAttribute('aria-pressed',String(mode==='signin'));el('mode-signup').setAttribute('aria-pressed',String(mode==='signup'));el('auth-guide').textContent=mode==='signup'?'1. Create account → 2. Confirm email → 3. Sign in and download. Your 7-day trial starts only when you first activate the plugin in Premiere.':'Already using the plugin? Use the same email and password.';say('');}
 el('mode-signin').onclick=()=>setMode('signin');el('mode-signup').onclick=()=>setMode('signup');
 el('login-form').onsubmit=event=>{event.preventDefault();run(async()=>{const email=el('account-email').value.trim(),password=el('account-password').value;
 if(authMode==='signup'){if(password.length<8)throw Error('Use a password with at least 8 characters.');if(password!==el('account-confirm-password').value)throw Error('Passwords do not match.');
 const data=await request('/auth/v1/signup?redirect_to='+encodeURIComponent('https://r-multicam.pages.dev/auth/confirmed/'),{method:'POST',body:{email,password}});el('account-password').value='';el('account-confirm-password').value='';
 window.RP_ANALYTICS?.track('signup_submitted',{requires_confirmation:!data.access_token},data.access_token||null);
 if(!data.access_token){setMode('signin');say('Thank you for creating your R Project account. Check your inbox and spam folder, click Confirm email, then sign in here. Download access is available only after you sign in with a confirmed account.');return;}
 await acceptSession(data);
 }else{
  el('account-password').value='';
  const loginData=await request('/auth/v1/token?grant_type=password',{method:'POST',body:{email,password}});
  await acceptSession(loginData);
  window.RP_ANALYTICS?.track('login_success',{method:'password'},loginData.access_token);
 }
 if(downloadIntent){const pending=downloadIntent;downloadIntent=null;await downloadRelease(pending);}
 else if(purchaseIntent)await purchase();
 else say('Signed in. You can download the installer, manage your license, or buy lifetime access here.');});};
 async function acceptSession(data){const epoch=++generation;const identity=await request('/auth/v1/user',{token:data.access_token});if(epoch!==generation)throw Error('Session changed. Please sign in again.');session={...data,expires_at:Date.now()/1000+(data.expires_in||3600)};user=identity;persistSession();render();await loadAccount();}
 async function restoreStoredSession(){
  let saved=null;
  try{saved=JSON.parse(localStorage.getItem(SESSION_KEY)||'null');}catch{clearStoredSession();}
  if(!saved?.refresh_token)return false;
  try{
   const next=await request('/auth/v1/token?grant_type=refresh_token',{method:'POST',body:{refresh_token:saved.refresh_token}});
   await acceptSession(next);
   return true;
  }catch(error){
   if(error.status===400||error.status===401||error.status===403)clearStoredSession();generation++;session=null;user=null;profile=null;render();
   return false;
  }
 }
 const emailCooldowns={confirmation:0,recovery:0};
 async function sendAccountEmail(kind){const email=el('account-email').value.trim();if(!email||!el('account-email').checkValidity())throw Error('Enter a valid email address first.');const wait=emailCooldowns[kind]-Date.now();if(wait>0)throw Error('Please wait '+Math.ceil(wait/1000)+' seconds before requesting another email.');const redirect=encodeURIComponent('https://r-multicam.pages.dev/auth/confirmed/');await request('/auth/v1/'+(kind==='recovery'?'recover':'resend')+'?redirect_to='+redirect,{method:'POST',body:kind==='recovery'?{email}:{email,type:'signup'}});emailCooldowns[kind]=Date.now()+65000;say(kind==='recovery'?'If an account exists for this email, check your inbox and spam folder for the password reset link.':'If this account still needs confirmation, check your inbox and spam folder. Already confirmed? Sign in.');}
 el('resend-confirmation').onclick=()=>run(()=>sendAccountEmail('confirmation'));
 el('forgot-password').onclick=()=>run(()=>sendAccountEmail('recovery'));
 el('account-signout').onclick=()=>run(async()=>{const access=session?.access_token;try{if(access)await request('/auth/v1/logout',{method:'POST',token:access});}catch{}affiliateUI?.clear();clearStoredSession();generation++;session=null;user=null;profile=null;downloadIntent=null;purchaseIntent=false;el('orders-list').replaceChildren();el('checkout-confirm').hidden=true;el('checkout-link').removeAttribute('href');render();say('Signed out of this website.');});
  el('account-purchase').onclick=()=>run(purchase);
  el('checkout-link').onclick=()=>window.RP_ANALYTICS?.track('checkout_opened',{},session?.access_token||null);
 el('download-windows').onclick=()=>run(()=>downloadRelease('windows'));
 el('download-macos').onclick=()=>run(()=>downloadRelease('macos'));
 el('account-affiliate').onclick=()=>{affiliateIntent=true;run(async()=>{if(affiliateUI)await affiliateUI.refresh();else say('Open the affiliate program from the website homepage.');});};
 document.querySelectorAll('[data-affiliate]').forEach(b=>b.onclick=()=>{affiliateIntent=true;purchaseIntent=false;downloadIntent=null;show();if(user)run(()=>affiliateUI.refresh());else say('Create and confirm an account, then sign in to apply or manage your affiliate account.');});
 el('check-payment').onclick=()=>run(async()=>{const data=await authed('/functions/v1/check-lifetime-payment',{method:'POST',body:{}});await loadAccount();say(data.paid?'Payment verified. Refresh your license in the Premiere plugin.':data.status==='no_order'?'No payment order was found for this account.':'No completed payment was confirmed yet. Please check again after paying.');});
 el('refresh-license').onclick=()=>run(async()=>{await loadAccount();say('License status refreshed from your plugin account.');});
 document.querySelectorAll('[data-login]').forEach(b=>b.onclick=()=>{show();purchaseIntent=false;downloadIntent=null;if(user)run(loadAccount);else{setMode('signin');say('Sign in to access your license and affiliate dashboard.');}});
 document.querySelectorAll('[data-signup]').forEach(b=>b.onclick=()=>{show();purchaseIntent=false;downloadIntent=null;if(user)run(loadAccount);else setMode('signup');});
 document.querySelectorAll('[data-account]').forEach(button=>button.onclick=()=>{show();purchaseIntent=false;downloadIntent=null;if(user)run(async()=>{await loadAccount();say('License status refreshed.');});else say('Create an account or sign in with your existing plugin account.');});
 document.querySelectorAll('[data-buy]').forEach(button=>button.onclick=()=>{show();purchaseIntent=true;downloadIntent=null;if(user)run(purchase);else say('Create an account or sign in to buy a lifetime license.');});
 document.querySelectorAll('[data-download]').forEach(button=>button.onclick=()=>{
  const platform=button.dataset.download==='macos'?'macos':'windows';
  purchaseIntent=false;
  if(user){downloadIntent=null;run(()=>downloadRelease(platform));}
  else{downloadIntent=platform;show();setMode('signin');say('Sign in or create a free account to download the '+(platform==='macos'?'macOS':'Windows')+' installer. New accounts must confirm their email before signing in.');}
 });
 async function bootstrap(){
  if(googleCallback){await run(finishGoogle);return;}
  busy=true;controls();let restored=false;try{restored=await restoreStoredSession();}finally{busy=false;controls();}
  const initialParams=new URLSearchParams(window.location.search);
  const initialDownload=initialParams.get('download');
  if(initialDownload==='windows'||initialDownload==='macos'){
   purchaseIntent=false;
   if(restored){downloadIntent=null;show();say('Signed in as '+user.email+'. Preparing your '+(initialDownload==='macos'?'macOS':'Windows')+' download…');run(()=>downloadRelease(initialDownload));}
   else{downloadIntent=initialDownload;show();setMode('signin');say('Sign in or create a free account to download the '+(initialDownload==='macos'?'macOS':'Windows')+' installer. New accounts must confirm their email first.');}
  }else if(initialParams.get('account')==='signin'){
   show();
   if(restored){run(async()=>{await loadAccount();say('Signed in as '+user.email+'.');});}
   else{setMode('signin');say('Sign in with the email and password you used when creating your account.');}
  }
 }
 window.addEventListener('storage',event=>{if(event.key===SESSION_KEY&&!event.newValue){generation++;session=null;user=null;profile=null;purchaseIntent=false;downloadIntent=null;el('checkout-confirm').hidden=true;el('checkout-link').removeAttribute('href');render();say('Signed out in another tab. Sign in again to continue.');}});
 bootstrap().catch(error=>say(friendly(error),true));
})();
