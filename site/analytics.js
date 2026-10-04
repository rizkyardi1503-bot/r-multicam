'use strict';
(() => {
  const ENDPOINT='https://ngotkvqtzqiotztnqwaw.supabase.co/functions/v1/website-analytics';
  const VISITOR_KEY='rp_analytics_visitor_v1';
  const SESSION_KEY='rp_analytics_session_v1';
  const UTM_KEY='rp_analytics_utm_v1';

  const uuid=()=>crypto.randomUUID ? crypto.randomUUID() : '10000000-1000-4000-8000-100000000000'.replace(/[018]/g,c=>(+c^crypto.getRandomValues(new Uint8Array(1))[0]&15>>+c/4).toString(16));
  function getId(store,key){
    try{let value=store.getItem(key);if(!value){value=uuid();store.setItem(key,value);}return value;}catch{return uuid();}
  }
  const visitorId=getId(localStorage,VISITOR_KEY);
  const sessionId=getId(sessionStorage,SESSION_KEY);

  const query=new URLSearchParams(location.search);
  let attribution={};
  try{
    const current={
      utm_source:(query.get('utm_source')||'').slice(0,120),
      utm_medium:(query.get('utm_medium')||'').slice(0,120),
      utm_campaign:(query.get('utm_campaign')||'').slice(0,200)
    };
    if(current.utm_source||current.utm_medium||current.utm_campaign){
      sessionStorage.setItem(UTM_KEY,JSON.stringify(current));attribution=current;
    }else attribution=JSON.parse(sessionStorage.getItem(UTM_KEY)||'{}')||{};
  }catch{}

  let referrerHost=null;
  try{referrerHost=document.referrer?new URL(document.referrer).hostname:null;}catch{}

  function track(eventName,metadata={},authToken=null){
    const headers={'content-type':'application/json'};
    if(authToken)headers.authorization='Bearer '+authToken;
    fetch(ENDPOINT,{
      method:'POST',
      headers,
      body:JSON.stringify({
        event_name:eventName,visitor_id:visitorId,session_id:sessionId,path:location.pathname,
        referrer_host:referrerHost,utm_source:attribution.utm_source||null,
        utm_medium:attribution.utm_medium||null,utm_campaign:attribution.utm_campaign||null,metadata
      }),
      keepalive:true
    }).catch(()=>{});
  }

  window.RP_ANALYTICS=Object.freeze({track,visitorId,sessionId});
  track('page_view',{title:document.title});

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