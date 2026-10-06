'use strict';
(() => {
 const key='rp_plugin_google_v1',origin='https://r-multicam.pages.dev';
 const hash=window.location.hash||'',params=new URLSearchParams(window.location.search);
 let flow=null,start=hash.startsWith('#plugin-google=');
 if(start){try{flow=JSON.parse(decodeURIComponent(hash.slice(15)));}catch{} }
 else if(params.get('oauth')==='google'&&(params.has('code')||params.has('error'))){try{flow=JSON.parse(sessionStorage.getItem(key)||'null');}catch{} }
 if(!start&&!flow)return;
 window.RP_PLUGIN_GOOGLE_ACTIVE=true;
 history.replaceState(null,'','/');
 const valid=x=>x&&Number.isInteger(x.port)&&x.port>=1024&&x.port<=65535&&/^[0-9a-f]{64}$/.test(x.state||'')&&/^[A-Za-z0-9_-]{43}$/.test(x.challenge||'');
 const card=document.createElement('section');card.className='container';
 card.style.cssText='position:fixed;inset:0;z-index:99999;background:#070911;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px;text-align:center;gap:18px';
 const title=document.createElement('h1');title.textContent='Sign in to the Premiere plugin';
 const message=document.createElement('p');message.setAttribute('role','status');
 card.append(title,message);document.body.append(card);
 function failed(text){message.textContent=text;}
 if(window.location.origin!==origin||!valid(flow)){failed('Invalid plugin login request. Return to Premiere and retry.');return;}
 if(!start){
  sessionStorage.removeItem(key);
  if(!Number.isFinite(flow.createdAt)||Date.now()-flow.createdAt>300000||flow.createdAt>Date.now()){failed('Plugin login expired. Return to Premiere and retry.');return;}
  const result=params.has('error')?'error=cancelled':'code='+encodeURIComponent(params.get('code')||'');
  const back='http://127.0.0.1:'+flow.port+'/rproject-auth/'+flow.state+'?'+result;
  message.textContent='Returning to Premiere. If the browser asks to open a local address, allow it.';
  const link=document.createElement('a');link.href=back;link.textContent='Return to plugin';link.className='button';card.append(link);
  // Top-level navigation: no cross-origin fetch or browser access to session tokens.
  window.location.replace(back);return;
 }
 message.textContent='Continue with Google below. Your login will return to the plugin automatically. Keep Premiere open.';
 const button=document.createElement('button');button.type='button';button.className='button';button.textContent='Continue with Google';card.append(button);
 button.onclick=()=>{
  try{
   sessionStorage.setItem(key,JSON.stringify({...flow,createdAt:Date.now()}));
   const config=window.RP_CONFIG;
   if(!config?.supabaseUrl)throw Error('Login configuration unavailable. Return to Premiere and retry.');
   const query=new URLSearchParams({provider:'google',redirect_to:origin+'/?oauth=google',code_challenge:flow.challenge,code_challenge_method:'s256'});
   window.location.assign(config.supabaseUrl+'/auth/v1/authorize?'+query);
  }catch(error){failed(error.message||'Enable session storage in your browser and retry.');}
 };
})();
