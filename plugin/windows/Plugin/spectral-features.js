/* 8 kHz PCM features, 512 point Hann FFT, 10 ms hop. No audio leaves the device. */
(function(root){
'use strict';
root.RPBeat.features=function(){
 var N=512,ring=new Float64Array(N),re=new Float64Array(N),im=new Float64Array(N),previous=new Float64Array(N/2),win=new Float64Array(N),pos=0,count=0,sum=0,dxsum=0,last=0;
 var out={rms:[],bass:[],subbass:[],mid:[],high:[],transient:[],flux:[]};
 for(var i=0;i<N;i++)win[i]=.5-.5*Math.cos(2*Math.PI*i/(N-1));
 function frame(){
  var i,j,k;for(i=0;i<N;i++){re[i]=ring[(pos+i)%N]*win[i];im[i]=0;}
  for(i=1,j=0;i<N;i++){var bit=N>>1;for(;j&bit;bit>>=1)j^=bit;j^=bit;if(i<j){var tmp=re[i];re[i]=re[j];re[j]=tmp;}}
  for(var len=2;len<=N;len<<=1){var angle=-2*Math.PI/len,wr0=Math.cos(angle),wi0=Math.sin(angle);for(i=0;i<N;i+=len){var wr=1,wi=0;for(j=0;j<len/2;j++){var a=i+j,b=a+len/2,tr=wr*re[b]-wi*im[b],ti=wr*im[b]+wi*re[b];re[b]=re[a]-tr;im[b]=im[a]-ti;re[a]+=tr;im[a]+=ti;var nr=wr*wr0-wi*wi0;wi=wr*wi0+wi*wr0;wr=nr;}}}
  var sub=0,bass=0,mid=0,high=0,flux=0;for(k=1;k<N/2;k++){var hz=k*8000/N,power=(re[k]*re[k]+im[k]*im[k])/(N*N),mag=Math.sqrt(power),delta=Math.max(0,mag-previous[k]);previous[k]=mag;flux+=delta*delta;if(hz<20)continue;if(hz<60)sub+=power;else if(hz<250)bass+=power;else if(hz<2000)mid+=power;else high+=power;}
  out.rms.push(Math.sqrt(sum/80));out.transient.push(Math.sqrt(dxsum/80));out.subbass.push(Math.sqrt(sub));out.bass.push(Math.sqrt(bass));out.mid.push(Math.sqrt(mid));out.high.push(Math.sqrt(high));out.flux.push(Math.sqrt(flux));sum=0;dxsum=0;
 }
 return {push:function(x){if(!isFinite(x))x=0;ring[pos]=x;pos=(pos+1)%N;sum+=x*x;dxsum+=(x-last)*(x-last);last=x;if(++count%80===0)frame();},result:function(){return out;}};
};
}(typeof window!=='undefined'?window:globalThis));
