(function(global){
'use strict';
var active=null;
function req(name){if(global.cep_node&&global.cep_node.require)return global.cep_node.require(name);if(typeof require==='function')return require(name);throw Error('Google login requires the plugin Node bridge. Reinstall the latest plugin.');}
function b64(buffer){return buffer.toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
function cancel(){if(active)active.cancel();}
function coded(message,code){var e=Error(message);e.code=code;return e;}
async function start(openBrowser,timeout){
 if(active)throw Error('Google sign-in is already running.');
 var http=req('http'),crypto=req('crypto'),NodeURL=req('url').URL;
 var verifier=b64(crypto.randomBytes(32)),state=crypto.randomBytes(32).toString('hex');
 var challenge=b64(crypto.createHash('sha256').update(verifier).digest());
 var path='/rproject-auth/'+state,server,port,timer,finished=false,resolveResult,rejectResult;
 var result=new Promise(function(resolve,reject){resolveResult=resolve;rejectResult=reject;});
 // Install the rejection handler before startup/cancel can reject the result.
 result.catch(function(){});
 function finish(error,code){if(finished)return;finished=true;clearTimeout(timer);try{server.close();}catch(e){}if(active&&active.server===server)active=null;if(error){verifier='';rejectResult(error);}else{resolveResult({code:code,verifier:verifier});verifier='';}}
 server=http.createServer(function(request,response){
  response.setHeader('Connection','close');response.setHeader('Cache-Control','no-store');response.setHeader('Referrer-Policy','no-referrer');response.setHeader('Content-Security-Policy',"default-src 'none'; frame-ancestors 'none'");response.setHeader('Content-Type','text/plain; charset=utf-8');
  var parsed;try{parsed=new NodeURL(request.url,'http://127.0.0.1');}catch(e){response.statusCode=400;response.end('Invalid request');return;}var host='127.0.0.1:'+port;
  if(finished||request.method!=='GET'||request.headers.host!==host||parsed.pathname!==path){response.statusCode=404;response.end('Not found');return;}
  if(parsed.searchParams.has('error')){response.end('Google sign-in was cancelled. Return to the plugin to retry.');finish(coded('Google sign-in was cancelled or denied.','GOOGLE_DENIED'));return;}
  var code=parsed.searchParams.get('code');
  if(!code||code.length>2048||parsed.searchParams.getAll('code').length!==1){response.statusCode=400;response.end('Missing authorization code');return;}
  response.end('Login response received. Return to Premiere; the plugin will verify your account and license.');
  finish(null,code);
 });
 server.requestTimeout=10000;server.headersTimeout=10000;
 active={server:server,cancel:function(){finish(coded('Google sign-in cancelled.','GOOGLE_CANCELLED'));}};
 timer=setTimeout(function(){finish(coded('Google sign-in timed out. Click Continue with Google to retry.','GOOGLE_TIMEOUT'));},timeout||300000);
 server.on('error',function(){finish(coded('Could not start the local Google callback. Check firewall settings or use email login.','GOOGLE_CALLBACK'));});
 try{
  await new Promise(function(resolve,reject){server.once('error',function(){reject(coded('Could not start the local Google callback. Check firewall settings or use email login.','GOOGLE_CALLBACK'));});server.listen(0,'127.0.0.1',resolve);});
  if(finished){server.close();throw coded('Google sign-in cancelled.','GOOGLE_CANCELLED');}
  port=server.address().port;
  // Only the challenge and a one-use nonce leave the plugin. The verifier stays in memory.
  var link='https://r-multicam.pages.dev/#plugin-google='+encodeURIComponent(JSON.stringify({port:port,state:state,challenge:challenge}));
  if(!openBrowser(link))throw coded('Could not open your system browser. Use email login or reinstall the plugin.','GOOGLE_BROWSER');
  return await result;
 }catch(error){finish(error);throw error;}
}
global.RPPluginGoogle={start:start,cancel:cancel};
}(window));
