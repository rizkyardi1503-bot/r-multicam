'use strict';
(() => {
  const ENDPOINT='https://ngotkvqtzqiotztnqwaw.supabase.co/functions/v1/website-analytics';
  const VISITOR_KEY='rp_analytics_visitor_v1';
  const SESSION_KEY='rp_analytics_session_v1';
  const UTM_KEY='rp_analytics_attribution_v2';

  const uuid=()=>crypto.randomUUID ? crypto.randomUUID() : '10000000-1000-4000-8000-100000000000'.replace(/[018]/g,c=>(+c^crypto.getRandomValues(new Uint8Array(1))[0]&15>>+c/4).toString(16));
  function getId(storeName,key){
    try{const store=window[storeName];let value=store.getItem(key);if(!value){value=uuid();store.setItem(key,value);}return value;}catch{return uuid();}
  }
  const visitorId=getId('localStorage',VISITOR_KEY);
  const sessionId=getId('sessionStorage',SESSION_KEY);

  let referrerHost=null;
  try{referrerHost=document.referrer?new URL(document.referrer).hostname:null;}catch{}
  const query=new URLSearchParams(location.search);
  const sourceName=value=>value==='ig'||value==='insta'?'instagram':value==='thread'?'threads':value;
  const external=referrerHost&&referrerHost!=='r-multicam.pages.dev'&&referrerHost!=='accounts.google.com'&&!referrerHost.endsWith('.supabase.co')?referrerHost:null;
  let inferred=null;
  if(external&&/(^|\.)instagram\.com$/.test(external))inferred={utm_source:'instagram',utm_medium:'social'};
  else if(external&&/(^|\.)threads\.(net|com)$/.test(external))inferred={utm_source:'threads',utm_medium:'social'};
  else if(external&&/^(www\.|m\.)?google\.(com|co\.(id|uk|in|jp|kr|nz|za)|com\.(au|br|sg|my|mx|tr)|[a-z]{2})$/.test(external))inferred={utm_source:'google',utm_medium:'organic'};
  const current={utm_source:sourceName((query.get('utm_source')||inferred?.utm_source||'').trim().toLowerCase().slice(0,120)),utm_medium:(query.get('utm_medium')||inferred?.utm_medium||'').slice(0,120),utm_campaign:(query.get('utm_campaign')||'').slice(0,200)};
  const contentId=(query.get('utm_content')||'').replace(/[^a-zA-Z0-9_.-]/g,'').slice(0,100);
  const qa=query.get('analytics_test')==='1'||current.utm_source==='qa';
  let attribution={};
  try{const saved=JSON.parse(window.sessionStorage.getItem(UTM_KEY)||'null');if(saved&&Number.isFinite(saved.expires_at)&&saved.expires_at>Date.now()&&saved.expires_at<=Date.now()+1800000)attribution=saved;}catch{}
  // Explicit campaign / recognized external entry wins. Internal pages and OAuth returns preserve it.
  if(current.utm_source||current.utm_medium||current.utm_campaign||external){attribution={...current,referrer_host:external,expires_at:Date.now()+1800000};try{window.sessionStorage.setItem(UTM_KEY,JSON.stringify(attribution));}catch{}}
  if(contentId)attribution.content_id=contentId;
  if(qa){attribution.reporting_exclude=true;attribution.expires_at=Date.now()+1800000;}
  try{if(Object.keys(attribution).length)window.sessionStorage.setItem(UTM_KEY,JSON.stringify(attribution));}catch{}
  referrerHost=attribution.referrer_host||external||null;

  function track(eventName,metadata={},authToken=null){
    const headers={'content-type':'application/json'};
    if(authToken)headers.authorization='Bearer '+authToken;
    fetch(ENDPOINT,{
      method:'POST',
      headers,
      body:JSON.stringify({
        event_name:eventName,visitor_id:visitorId,session_id:sessionId,path:location.pathname,
        referrer_host:referrerHost,utm_source:attribution.utm_source||null,
        utm_medium:attribution.utm_medium||null,utm_campaign:attribution.utm_campaign||null,
        metadata:{...metadata,content_id:attribution.content_id||null,reporting_exclude:attribution.reporting_exclude===true}
      }),
      keepalive:true
    }).catch(()=>{});
  }

  window.RP_ANALYTICS=Object.freeze({track,visitorId,sessionId});
  track('page_view',{title:document.title});
  document.querySelectorAll('[data-track="guide_opened"]').forEach(link=>{
    link.addEventListener('click',()=>track('guide_opened',{entry_point:(link.dataset.content||'guide_link').slice(0,100)}));
  });

  document.querySelectorAll('[data-signup]').forEach((button,index)=>{
    button.addEventListener('click',()=>track('trial_cta_clicked',{
      label:(button.textContent||'').trim().slice(0,100),
      position:index+1
    }));
  });

  const demoButton=document.getElementById('practice-next');
  if(demoButton){
    let demoSent=false;
    demoButton.addEventListener('click',()=>{
      if(demoSent)return;
      demoSent=true;
      track('demo_started',{label:'interactive_practice'});
    });
  }

  const pricing=document.getElementById('pricing');
  if(pricing && 'IntersectionObserver' in window){
    let sent=false;
    const observer=new IntersectionObserver(entries=>{
      if(!sent && entries.some(e=>e.isIntersecting&&e.intersectionRatio>=0.35)){
        sent=true;track('pricing_view');observer.disconnect();
      }
    },{threshold:[0.35]});
    observer.observe(pricing);
  }
})();
