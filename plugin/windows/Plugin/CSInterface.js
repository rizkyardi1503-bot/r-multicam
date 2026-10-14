/* R Project Multicam - minimal robust CEP bridge. */
(function(g){
'use strict';
var SystemPath={USER_DATA:'userData',COMMON_FILES:'commonFiles',MY_DOCUMENTS:'myDocuments',APPLICATION:'application',EXTENSION:'extension',HOST_APPLICATION:'hostApplication'};
function CSInterface(){}
CSInterface.prototype.evalScript=function(script,callback){
 if(!g.__adobe_cep__||typeof g.__adobe_cep__.evalScript!=='function')throw new Error('Adobe CEP evalScript API is unavailable.');
 g.__adobe_cep__.evalScript(script,callback||function(){});
};
CSInterface.prototype.getSystemPath=function(pathType){
 if(!g.__adobe_cep__||typeof g.__adobe_cep__.getSystemPath!=='function')throw new Error('Adobe CEP getSystemPath API is unavailable.');
 return g.__adobe_cep__.getSystemPath(pathType);
};
g.SystemPath=SystemPath;g.CSInterface=CSInterface;
}(window));
