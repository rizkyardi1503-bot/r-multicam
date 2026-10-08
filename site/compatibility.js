'use strict';
(() => {
 function evaluate(os,premiere,ram){
  if(!['windows','macos'].includes(os))return {level:'unsupported',text:'This plugin runs in Adobe Premiere Pro desktop on Windows or macOS, not on a phone, tablet or Linux. You can browse the website here; use a supported desktop to install.'};
  if(!['22','23','24','25','26'].includes(premiere))return {level:'check_version',text:'Your Premiere version is outside the declared 22.0–26.99 manifest range or is not known. Contact support and check Adobe requirements before installing or buying.'};
  const version=os==='macos'?'2.3.11.2':'2.3.11.2';
  if(os==='macos'&&['8','12'].includes(ram))return {level:'low_memory',text:'Mac v'+version+' enables Low Memory mode automatically on Macs with 12 GiB RAM or less. Start with proxies and a short duplicate sequence. Native M1/Premiere memory reduction is not yet measured; a large 4K project may still exceed memory. Test the trial before buying.'};
  if(ram==='8'||ram==='12')return {level:'memory_caution',text:'Windows v'+version+' is available, but limited RAM can constrain Premiere and multicam work. Use a short trial project and proxies. Check Adobe requirements; the plugin cannot guarantee preventing memory errors.'};
  if(ram==='unknown')return {level:'check_memory',text:'Check your computer memory and Adobe requirements first. Public '+(os==='macos'?'Mac':'Windows')+' version is '+version+'. The declared Premiere range does not certify your exact hardware; test a duplicate project before buying.'};
  return {level:'trial_first',text:(os==='macos'?'Mac':'Windows')+' v'+version+' declares this Premiere major version. RAM alone does not prove compatibility or performance. Test a duplicate project during the free trial; codecs, footage resolution, OS version and timeline length also matter.'};
 }
 window.RPCompatibility=Object.freeze({evaluate});
 const form=document.getElementById('compatibility-form');if(!form)return;
 form.addEventListener('submit',event=>{event.preventDefault();const os=document.getElementById('compat-os').value,premiere=document.getElementById('compat-premiere').value,ram=document.getElementById('compat-ram').value;if(!os||!premiere||!ram)return;const result=evaluate(os,premiere,ram),element=document.getElementById('compatibility-result');element.hidden=false;element.textContent=result.text;window.RP_ANALYTICS?.track('compatibility_checked',{platform:os,premiere_major:premiere,ram_bucket:ram,result:result.level});});
})();
