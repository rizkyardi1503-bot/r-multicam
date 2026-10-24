/* 8 kHz PCM features, 512 point Hann FFT, 10 ms hop. No audio leaves the device. */
(function(root){
'use strict';
// The 512-point real FFT runs as a 256-point complex FFT (even/odd samples packed into re/im)
// with precomputed twiddle, bit-reverse and band tables: same spectrum, about a quarter of the work.
var N=512,M=N>>1,TABLES=null;
function tables(){
 if(TABLES)return TABLES;
 var win=new Float64Array(N),rev=new Uint16Array(M),cosM=new Float64Array(M>>1),sinM=new Float64Array(M>>1),cosN=new Float64Array(M),sinN=new Float64Array(M),band=new Int8Array(M),i,bits=0;
 for(i=0;i<N;i++)win[i]=.5-.5*Math.cos(2*Math.PI*i/(N-1));
 while((1<<bits)<M)bits++;
 for(i=0;i<M;i++){var r=0;for(var b=0;b<bits;b++)if(i&(1<<b))r|=1<<(bits-1-b);rev[i]=r;}
 for(i=0;i<M>>1;i++){cosM[i]=Math.cos(2*Math.PI*i/M);sinM[i]=-Math.sin(2*Math.PI*i/M);}
 for(i=0;i<M;i++){cosN[i]=Math.cos(2*Math.PI*i/N);sinN[i]=-Math.sin(2*Math.PI*i/N);var hz=i*8000/N;band[i]=hz<20?-1:hz<60?0:hz<250?1:hz<2000?2:3;}
 return TABLES={win:win,rev:rev,cosM:cosM,sinM:sinM,cosN:cosN,sinN:sinN,band:band};
}
root.RPBeat.features=function(){
 var T=tables(),win=T.win,rev=T.rev,cosM=T.cosM,sinM=T.sinM,cosN=T.cosN,sinN=T.sinN,band=T.band;
 var ring=new Float64Array(N),zr=new Float64Array(M),zi=new Float64Array(M),previous=new Float64Array(M),pos=0,hop=0,sum=0,dxsum=0,last=0,scale=1/(N*N);
 var out={rms:[],bass:[],subbass:[],mid:[],high:[],transient:[],flux:[]};
 function frame(){
  var m,k,len;
  // Oldest sample is ring[pos]; pack windowed pairs straight into bit-reversed order.
  for(m=0;m<M;m++){var n0=m<<1,a=pos+n0;if(a>=N)a-=N;var b=a+1;if(b>=N)b-=N;var r=rev[m];zr[r]=ring[a]*win[n0];zi[r]=ring[b]*win[n0+1];}
  for(len=2;len<=M;len<<=1){
   var half=len>>1,step=M/len;
   for(var i=0;i<M;i+=len)for(var j=0;j<half;j++){var w=j*step,wr=cosM[w],wi=sinM[w],p=i+j,q=p+half,tr=wr*zr[q]-wi*zi[q],ti=wr*zi[q]+wi*zr[q];zr[q]=zr[p]-tr;zi[q]=zi[p]-ti;zr[p]+=tr;zi[p]+=ti;}
  }
  var sub=0,bass=0,mid=0,high=0,flux=0;
  for(k=1;k<M;k++){
   // X[k] = E[k] + W^k O[k], E = (Z[k]+conj Z[M-k])/2, O = (Z[k]-conj Z[M-k])/2i
   var mk=M-k,ar=zr[k],ai=zi[k],br=zr[mk],bi=-zi[mk],er=(ar+br)*.5,ei=(ai+bi)*.5,qr=(ai-bi)*.5,qi=-(ar-br)*.5;
   var xr=er+cosN[k]*qr-sinN[k]*qi,xi=ei+cosN[k]*qi+sinN[k]*qr,power=(xr*xr+xi*xi)*scale,mag=Math.sqrt(power),delta=mag-previous[k];
   if(delta>0)flux+=delta*delta;previous[k]=mag;
   var bi2=band[k];if(bi2===0)sub+=power;else if(bi2===1)bass+=power;else if(bi2===2)mid+=power;else if(bi2===3)high+=power;
  }
  out.rms.push(Math.sqrt(sum/80));out.transient.push(Math.sqrt(dxsum/80));out.subbass.push(Math.sqrt(sub));out.bass.push(Math.sqrt(bass));out.mid.push(Math.sqrt(mid));out.high.push(Math.sqrt(high));out.flux.push(Math.sqrt(flux));sum=0;dxsum=0;
 }
 function push(x){if(!isFinite(x))x=0;ring[pos]=x;if(++pos===N)pos=0;sum+=x*x;var d=x-last;dxsum+=d*d;last=x;if(++hop===80){hop=0;frame();}}
 return {push:push,
  // Bulk path for decoded Float32 PCM: avoids a function call and a Buffer read per sample.
  pushMany:function(samples,from,to){for(var i=from;i<to;i++)push(samples[i]);},
  result:function(){return out;}};
};
}(typeof window!=='undefined'?window:globalThis));
